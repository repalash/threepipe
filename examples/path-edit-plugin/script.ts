import {
    _testFinish,
    _testStart,
    CatmullRomCurve3,
    CubicBezierCurve3,
    CurvePath3,
    GeometryGeneratorPlugin,
    LineCurve3,
    LineMaterial2,
    LoadingScreenPlugin,
    Object3DWidgetsPlugin,
    PathEditPlugin,
    PickingPlugin,
    ThreeViewer,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    // Object3DWidgetsPlugin shows the points of every line (LineHelper); PathEditPlugin edits them
    plugins: [LoadingScreenPlugin, GeometryGeneratorPlugin, Object3DWidgetsPlugin, PickingPlugin, UndoManagerPlugin],
})

async function init() {
    viewer.scene.setBackgroundColor('#2a2a2a')
    const pathEdit = viewer.addPluginSync(PathEditPlugin)
    const generator = viewer.getPlugin(GeometryGeneratorPlugin)!

    const addLine = (name: string, curve: any, color: string, y: number) => {
        const obj = viewer.scene.addObject(generator.generateObject('line', {curve, segments: 120}), {autoScale: false, autoCenter: false})
        obj.name = name
        obj.position.y = y
        const material = obj.material as LineMaterial2
        material.color.set(color)
        material.linewidth = 3
        return obj
    }

    // A spline through points
    addLine('Spline', new CatmullRomCurve3([
        new Vector3(-4, 0, 0),
        new Vector3(-2, 1.2, 0),
        new Vector3(0, -0.6, 0),
        new Vector3(2, 1, 0),
        new Vector3(4, 0, 0),
    ]), '#00d084', 2)

    // A path of cubic Beziers, sharing the points at the joints (like PenToolPlugin makes)
    const a = new Vector3(-4, 0, 0), b = new Vector3(0, 0, 0), c = new Vector3(4, 0, 0)
    const path = new CurvePath3()
    path.add(new CubicBezierCurve3(a, new Vector3(-4, 1.5, 0), new Vector3(-1.5, 1.5, 0), b))
    path.add(new CubicBezierCurve3(b, new Vector3(1.5, -1.5, 0), new Vector3(4, -1.5, 0), c))
    const bezier = addLine('Bezier Path', path, '#ff6b3d', 0)

    // A straight line: a + makes it a path of two lines
    addLine('Straight Line', new LineCurve3(new Vector3(-4, 0, 0), new Vector3(4, 0, 0)), '#4aa3ff', -2)

    viewer.scene.mainCamera.position.set(0, 0, 11)
    viewer.scene.mainCamera.target.set(0, 0, 0)
    viewer.scene.mainCamera.setDirty()

    // Double-click a line to edit its points, or select it and click "Edit selected line".
    // Drag a point, click + to add one, Alt+click (or select and Delete) to remove one, Esc or a click away to finish.
    // Ctrl/Cmd+Z undoes each change.
    pathEdit.edit(bezier)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(pathEdit, {expanded: true})
    ui.setupPluginUi(PickingPlugin)
}

_testStart()
init().finally(_testFinish)
