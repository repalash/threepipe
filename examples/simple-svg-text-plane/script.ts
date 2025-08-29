import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    makeTextSvgAdvanced, PickingPlugin,
    TextSVGOptions,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {BloomPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, GeometryGeneratorPlugin, BloomPlugin, PickingPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    viewer.scene.backgroundColor?.set(0x222222)

    const bs = 1000

    const options = new TextSVGOptions()
    options.text = 'Simple Text'
    options.fontPath = 'https://rsms.me/inter/font-files/Inter-Regular.woff2?v=4.1'
    options.fontFamily = 'Inter'
    options.maskText = false
    options.fontSize = bs
    options.textColor = '#eeeeee'
    options.bgFillColor = 'transparent'
    options.boxHeight = bs
    options.boxWidth = bs * (options.text.length + 2) / 2
    options.height = bs
    options.width = bs * (options.text.length + 2) / 2
    options.svgBackground = 'transparent'

    const textTexture = await makeTextSvgAdvanced(options, viewer.assetManager.importer)

    const geometryGenerator = viewer.getPlugin(GeometryGeneratorPlugin)!
    const obj = geometryGenerator.generateObject('plane', {
        width: options.width / bs,
        height: options.height / bs,
    })!
    viewer.scene.addObject(obj)
    obj.material.alphaMap = textTexture
    obj.material.emissiveMap = textTexture
    obj.material.emissive!.set(0xffffff)
    obj.material.emissiveIntensity = 8
    obj.material.transparent = true
    obj.material.needsUpdate = true
    obj.material.side = 2
    obj.position.z = -1.5
    obj.material.userData.renderToGBuffer = true
    // obj.userData.userSelectable = false

    // When options are changed in the UI
    options.onChange = ()=>{
        makeTextSvgAdvanced(options, viewer.assetManager.importer).then(tex=>{
            geometryGenerator.updateGeometry(obj.geometry, {width: options.width / bs, height: options.height / bs})
            obj.material.alphaMap = tex
            obj.material.emissiveMap = tex
            obj.material.needsUpdate = true
        })
    }

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(options.uiConfig, {expanded: true})
    // ui.appendChild(obj.uiConfig)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)

}

_testStart()
init().finally(_testFinish)
