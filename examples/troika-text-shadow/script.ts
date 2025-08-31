import {
    _testFinish,
    _testStart,
    BaseGroundPlugin,
    Color,
    DirectionalLight2,
    LoadingScreenPlugin,
    PhysicalMaterial,
    PickingPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {Text} from 'troika-three-text'

// Note - This examples show how to use Troika Text directly,
// check out the TroikaTextPlugin example for integrated use with complete UI and serialization - https://threepipe.org/examples/#troika-text-plugin/

// optional
// configureTextBuilder({
//     useWorker: false
// })

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        plugins: [LoadingScreenPlugin, GeometryGeneratorPlugin, PickingPlugin, BaseGroundPlugin],
    })

    viewer.scene.backgroundColor = new Color(0x333333)

    const myText = new Text()

    myText.material = new PhysicalMaterial({
        side: 2,
        userData: {renderToGBuffer: true},
        emissive: 0xffffff,
        emissiveIntensity: 8,
        transparent: false,
    })
    viewer.scene.addObject(myText)
    console.log(myText.material)

    // Set properties to configure:
    myText.text = 'Troika Text'
    myText.fontSize = 1.25
    myText.position.y = -0.5
    myText.color = 0x9966FF
    myText.font = 'https://samples.threepipe.org/minimal/inter/inter_light.woff'
    // or
    // myText.font = (await import('https://unpkg.com/@pmndrs/assets@1.7.0/fonts/inter_regular.woff.js' as any)).default
    myText.anchorX = 'center'
    myText.anchorY = 'middle'
    myText.castShadow = true

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

    const light = new DirectionalLight2()
    light.position.set(0, 1, 2)
    light.intensity = 3
    viewer.scene.addObject(light)
    light.lookAt(0, 0, 0)
    light.shadowFrustum = 7
    light.castShadow = true

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(light.uiConfig)
    ui.setupPluginUi(PickingPlugin)

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>({texture: light.shadow.map?.texture}),
        'shadowMap', true, true,
        true, (s)=>s + ' = vec4(' + s + '.rgb, 1.);')
}

_testStart()
init().finally(_testFinish)
