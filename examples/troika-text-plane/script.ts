import {
    _testFinish,
    _testStart,
    DepthBufferPlugin,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PhysicalMaterial,
    PickingPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {BloomPlugin} from '@threepipe/webgi-plugins'
import {createTextDerivedMaterial, Text} from 'troika-three-text'

// Note - This examples show how to use Troika Text directly,
// check out the TroikaTextPlugin example for integrated use with complete UI and serialization - https://threepipe.org/examples/#troika-text-plugin/

// optional
// configureTextBuilder({
//     useWorker: false
// })

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        debug: true,
        plugins: [LoadingScreenPlugin, DepthBufferPlugin, GeometryGeneratorPlugin, BloomPlugin, PickingPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    viewer.scene.backgroundColor?.set(0x222222)

    // Create:
    const myText = new Text()
    myText.material.userData.renderToGBuffer = true

    // console.log(myText.material)
    myText.material = new PhysicalMaterial({
        side: 2,
        userData: {renderToGBuffer: true},
        emissive: 0xffffff,
        emissiveIntensity: 8,
        transparent: true,
    })
    viewer.scene.addObject(myText)

    // Set properties to configure:
    myText.text = 'Troika Text'
    myText.fontSize = 1.25
    myText.position.z = -1.5
    myText.color = 0x9966FF
    myText.curveRadius = 4
    myText.font = 'https://samples.threepipe.org/minimal/inter/inter_light.woff'
    // or
    // myText.font = (await import('https://unpkg.com/@pmndrs/assets@1.7.0/fonts/inter_regular.woff.js' as any)).default

    myText.anchorX = 'center'
    myText.anchorY = 'middle'
    myText.material.userData.renderToGBuffer = true
    myText.castShadow = true

    const depthBufferPlugin = viewer.getPlugin(DepthBufferPlugin)
    if (depthBufferPlugin) myText.customDepthMaterial.depthPacking = depthBufferPlugin.depthPacking

    const gbufferPlugin = viewer.getPlugin(GBufferPlugin)
    if (gbufferPlugin) {
        myText.customGBufferMaterial = createTextDerivedMaterial(gbufferPlugin.createMaterial())
        myText.customGBufferMaterial.transparent = false
    }


    myText.addEventListener('synccomplete', async() => {
        myText.setDirty()
        // we need to render once as onBeforeRender has to be called once to set the depth material?
        viewer.doOnce('postRender', ()=>{
            viewer.renderManager.resetShadows()
            myText.setDirty()
        })
    })
    // Update the rendering:
    myText.sync()

    console.log(myText.customDepthMaterial.transparent)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild({
        type: 'folder',
        expanded: true,
        label: 'Troika Text',
        value: myText,
        onChange: () => {
            myText.sync()
        },
        children: [
            {
                type: 'input',
                label: 'Text',
                path: 'text',
            },
            {
                type: 'slider',
                label: 'Font Size',
                bounds: [0.1, 5],
                stepSize: 0.01,
                path: 'fontSize',
            },
            {
                type: 'color',
                label: 'Color',
                path: 'material.emissive',
                onChange: () => {
                    myText.material.setDirty()
                },
            },
            {
                type: 'input',
                label: 'Font',
                path: 'font',
            },
        ],
    })
    // ui.appendChild(obj.uiConfig)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)

    const getNormalDepth = ()=>({texture: gbufferPlugin?.normalDepthTexture})
    const getFlags = ()=>({texture: gbufferPlugin?.flagsTexture})
    const getDepthTexture = ()=>({texture: viewer.getPlugin(DepthBufferPlugin)?.texture})

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(getNormalDepth, 'normalDepth')
    targetPreview.addTarget(getFlags, 'gBufferFlags')
    targetPreview.addTarget(getDepthTexture, 'depthTexture')
}

_testStart()
init().finally(_testFinish)

