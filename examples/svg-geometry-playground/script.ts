import {
    _testFinish, _testStart,
    EditorViewWidgetPlugin,
    GBufferPlugin,
    LoadingScreenPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {ThreeSVGRendererPlugin} from '@threepipe/plugin-svg-renderer'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        // zPrepass: true,
        tonemap: false,
        plugins: [GBufferPlugin, PickingPlugin, TransformControlsPlugin, LoadingScreenPlugin],
    })
    viewer.addPluginSync(new EditorViewWidgetPlugin('bottom-left', 128))

    viewer.scene.backgroundColor = null
    // viewer.renderManager.screenPass.clipBackground = true // required when rgbm: true

    viewer.scene.mainCamera.controls!.enableDamping = false

    viewer.renderEnabled = false

    viewer.addPluginSync(new ThreeSVGRendererPlugin(true))

    // viewer.scene.addObject(new DirectionalLight2(0xffffff, 1).rotateZ(0.5).rotateX(0.5))
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)
    // generator.defaultMaterialClass = UnlitMaterial

    console.log(generator.generators)

    // Head (sphere)
    const head = generator.generateObject('sphere', {radius: 0.5, widthSegments: 32, heightSegments: 32})
    head.translateY(1)
    viewer.scene.addObject(head)

    // Body (box)
    const body = generator.generateObject('box', {width: 1.5, height: 1.5, depth: 1})
    body.material.color!.set(0x00ffff)
    viewer.scene.addObject(body)

    // Legs (cylinders)
    const leftLeg = generator.generateObject('cylinder', {radiusTop: 0.125, radiusBottom: 0.125, height: 1.5})
    leftLeg.material.color!.set(0x00ff00)
    leftLeg.translateX(-0.5)
    leftLeg.translateY(-1)
    viewer.scene.addObject(leftLeg)

    const rightLeg = generator.generateObject('cylinder', {radiusTop: 0.125, radiusBottom: 0.125, height: 1.5})
    rightLeg.material.color!.set(0x00ff00)
    rightLeg.translateX(0.5)
    rightLeg.translateY(-1)
    viewer.scene.addObject(rightLeg)

    // Arms (cylinders)
    const leftArm = generator.generateObject('cylinder', {radiusTop: 0.125, radiusBottom: 0.125, height: 1})
    leftArm.material.color!.set(0xff0000)
    leftArm.translateX(-1)
    leftArm.translateY(0.5)
    leftArm.rotateZ(Math.PI / 2)
    viewer.scene.addObject(leftArm)

    const rightArm = generator.generateObject('cylinder', {radiusTop: 0.125, radiusBottom: 0.125, height: 1})
    rightArm.material.color!.set(0xff0000)
    rightArm.translateX(1)
    rightArm.translateY(0.5)
    rightArm.rotateZ(Math.PI / 2)
    viewer.scene.addObject(rightArm)
    viewer.renderEnabled = true

    // waiting because we need to render pipeline once to autoscale
    await viewer.doOnce('postFrame')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPlugins(ThreeSVGRendererPlugin)
    ui.setupPlugins(GeometryGeneratorPlugin)
    ui.setupPlugins(PickingPlugin)
    ui.setupPlugins(TransformControlsPlugin)
}

_testStart()
init().finally(_testFinish)
