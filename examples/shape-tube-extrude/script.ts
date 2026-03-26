import {
    _testFinish,
    _testStart,
    EllipseCurve3D,
    GeometryGeneratorPlugin,
    IMaterial,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    PickingPlugin,
    ShapeTubeExtrudePlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {FontLibrary, GeometryGeneratorExtrasPlugin} from '@threepipe/plugin-geometry-generator'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, Object3DGeneratorPlugin, LoadingScreenPlugin],
    })
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)
    viewer.addPluginSync(GeometryGeneratorExtrasPlugin)
    viewer.addPluginSync(ShapeTubeExtrudePlugin)

    await FontLibrary.Init

    viewer.scene.setBackgroundColor('#2d3436')
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // ── Helper to create a 3D text label ──
    function addLabel(text: string, x: number, y: number, size = 0.22, color = '#dfe6e9') {
        const label = generator.generateObject('text', {
            text, size, depth: 0.04,
            alignX: 0.5, alignY: 0.5,
            curveSegments: 12,
            bevelEnabled: false,
        })
        label.position.set(x, y, 0)
        const mat = label.material as IMaterial
        mat.color?.setStyle(color)
        mat.roughness = 0.6
        mat.metalness = 0.1
        viewer.scene.addObject(label)
        return label
    }

    // Layout — symmetric around x=0 (the "=" sign):
    //     Tube
    //      +      =    Tube Shape
    //    Shape

    const leftX = -0.9 // tube & shape column
    const eqX = 0 // "=" sign at center
    const rightX = 1.2 // tube shape result
    const topY = 0.85
    const midY = 0
    const botY = -0.85

    // ── Top-left: Tube ──
    const tube = generator.generateObject('tube', {
        path: new EllipseCurve3D(0, 0, 0.5, 0.5, 0, 2 * Math.PI, false, 0) as any,
        tubularSegments: 64,
        radius: 0.04,
        radialSegments: 12,
        closed: true,
    })
    tube.position.set(leftX, topY, 0)
    const tubeMat = tube.material as IMaterial
    tubeMat.color?.setStyle('#ff6b6b')
    tubeMat.roughness = 0.15
    tubeMat.metalness = 0.85
    viewer.scene.addObject(tube)
    addLabel('Tube', leftX, topY + 0.75)

    // ── "+" ──
    addLabel('+', leftX, midY, 0.3, '#b2bec3')

    // ── Bottom-left: Shape ──
    const shape = generator.generateObject('shape', {
        shapeType: 'rectangle',
        width: 0.7,
        height: 0.35,
        curveSegments: 12,
    })
    shape.position.set(leftX, botY, 0)
    const shapeMat = shape.material as IMaterial
    shapeMat.color?.setStyle('#4ecdc4')
    shapeMat.roughness = 0.25
    shapeMat.metalness = 0.5
    viewer.scene.addObject(shape)
    addLabel('Shape', leftX, botY - 0.5)

    // ── "=" at center ──
    addLabel('=', eqX, midY, 0.3, '#b2bec3')

    // ── Right: Tube Shape ──
    const tubeShape = generator.generateObject('tubeShape', {
        path: new EllipseCurve3D(0, 0, 0.55, 0.55, 0, 2 * Math.PI, false, 0) as any,
        shapeType: 'rectangle',
        width: 0.35,
        height: 0.18,
        shapeSegments: 16,
        tubularSegments: 64,
        closed: true,
        shapeScaleX: 1,
        shapeScaleY: 1,
        primary: 'shape',
        materialSplits: '',
    })
    tubeShape.position.set(rightX, midY, 0)
    const tubeShapeMat = tubeShape.material as IMaterial
    tubeShapeMat.color?.setStyle('#f9ca24')
    tubeShapeMat.roughness = 0.15
    tubeShapeMat.metalness = 0.8
    viewer.scene.addObject(tubeShape)
    addLabel('Tube Shape', rightX, midY + 0.85)

    // ── Camera ──
    const camera = viewer.scene.mainCamera
    camera.position.set(0.23, 0.09, 5.57)
    camera.target = new Vector3(0.23, 0.09, 0)
    camera.setDirty?.()

    const baseFov = 38
    function refreshFov() {
        const size = viewer.renderManager.renderSize
        camera.fov = baseFov * (size.y / size.x)
        camera.updateProjectionMatrix()
    }
    refreshFov()
    viewer.renderManager.addEventListener('resize', refreshFov)

    // ── UI ──
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(GeometryGeneratorPlugin)
    ui.setupPluginUi(ShapeTubeExtrudePlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(Object3DGeneratorPlugin)

}

_testStart()
init().finally(_testFinish)
