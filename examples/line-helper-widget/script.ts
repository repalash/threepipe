import {
    _testFinish,
    _testStart,
    CatmullRomCurve3,
    Color,
    LineMaterial2,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [Object3DGeneratorPlugin, GeometryGeneratorPlugin, Object3DWidgetsPlugin, PickingPlugin, TransformControlsPlugin],
        dropzone: false,
    })

    viewer.scene.backgroundColor = new Color(0x2a2a2a)

    const curve = new CatmullRomCurve3([
        new Vector3(0, 0, 0),
        new Vector3(2, 2, 0),
        new Vector3(4, 0, 0),
        new Vector3(6, -2, 0),
        new Vector3(8, 0, 0),
        new Vector3(10, 2, 0),
        new Vector3(12, 0, 0),
    ], false) // false = open curve (no loop)

    // Generate the line object from the curve using the Object3DGeneratorPlugin (GeometryGeneratorPlugin can also be used directly)
    const generator = viewer.getPlugin(Object3DGeneratorPlugin)!
    const lineObject = generator.generate('geometry-line', {
        curve, // this can also be a CurvePath3 to create a line with multiple curves
        segments: 200,
    })!
    lineObject.name = 'Curve'
    const material = lineObject.material as LineMaterial2
    material.color = new Color(0x00ff88)
    material.linewidth = 2

    // Set up UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.appendChild(lineObject.geometry?.uiConfig, {expanded: true, label: 'Line'})

}

_testStart()
init().finally(_testFinish)
