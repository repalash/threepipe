import {
    _testFinish,
    _testStart,
    EllipseCurve3D,
    GeometryGeneratorPlugin,
    IMaterial,
    Mesh,
    Object3DGeneratorPlugin,
    PickingPlugin,
    ShapeTubeExtrudePlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, Object3DGeneratorPlugin],
    })
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)
    const extrudePlugin = viewer.addPluginSync(ShapeTubeExtrudePlugin)

    viewer.scene.setBackgroundColor('#2d3436')
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const spacing = 3.5

    // ── Three flat shapes the user can select and extrude ──

    const pentagon = generator.generateObject('shape', {
        shapeType: 'polygon', sides: 5, polygonRadius: 0.35, curveSegments: 1,
    })
    pentagon.name = 'Pentagon'
    pentagon.position.set(-spacing, 0, 0)
    ;(pentagon.material as IMaterial).color?.setStyle('#ff6b6b')
    ;(pentagon.material as IMaterial).roughness = 0.3
    ;(pentagon.material as IMaterial).metalness = 0.5
    viewer.scene.addObject(pentagon)

    const hexagon = generator.generateObject('shape', {
        shapeType: 'polygon', sides: 6, polygonRadius: 0.3, curveSegments: 1,
    })
    hexagon.name = 'Hexagon'
    hexagon.position.set(0, 0, 0)
    ;(hexagon.material as IMaterial).color?.setStyle('#4ecdc4')
    ;(hexagon.material as IMaterial).roughness = 0.3
    ;(hexagon.material as IMaterial).metalness = 0.5
    viewer.scene.addObject(hexagon)

    const rectangle = generator.generateObject('shape', {
        shapeType: 'rectangle', width: 0.5, height: 0.25, curveSegments: 1,
    })
    rectangle.name = 'Rectangle'
    rectangle.position.set(spacing, 0, 0)
    ;(rectangle.material as IMaterial).color?.setStyle('#f9ca24')
    ;(rectangle.material as IMaterial).roughness = 0.3
    ;(rectangle.material as IMaterial).metalness = 0.5
    viewer.scene.addObject(rectangle)

    // ── Auto-extrude the hexagon on load to show the result ──
    const circleCurve = new EllipseCurve3D(0, 0, 1, 1, 0, 2 * Math.PI, false, 0)
    extrudePlugin.extrudeObject(hexagon as any as Mesh, circleCurve as any)

    // Style the extruded result
    const extrudedMesh = hexagon.parent?.children.find(o => o.uuid === hexagon.userData.extrudedObject)
    if (extrudedMesh) {
        const mat = (extrudedMesh as any).material as IMaterial
        mat.color?.setStyle('#a29bfe')
        mat.roughness = 0.15
        mat.metalness = 0.8
    }

    // ── Camera ──
    const camera = viewer.scene.mainCamera
    camera.position.set(0, 1.2, 7)
    camera.target = new Vector3(0, 0, 0)
    camera.setDirty?.()

    const baseFov = 40
    function refreshFov() {
        const size = viewer.renderManager.renderSize
        camera.fov = baseFov * (size.y / size.x)
        camera.updateProjectionMatrix()
    }
    refreshFov()
    viewer.renderManager.addEventListener('resize', refreshFov)

    // ── UI ──
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(ShapeTubeExtrudePlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(GeometryGeneratorPlugin)
    ui.setupPluginUi(Object3DGeneratorPlugin)

}

_testStart()
init().finally(_testFinish)
