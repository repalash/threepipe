import {
    _testFinish,
    _testStart,
    GeometryGeneratorPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PenToolPlugin,
    PickingPlugin,
    ThreeViewer,
    UndoManagerPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin, GeometryGeneratorPlugin, PickingPlugin, UndoManagerPlugin],
})

async function init() {
    // Click "Draw Path" (or press P), then on the canvas: click to add a point, drag to pull out curve handles,
    // click the first point to close, Enter or double-click to finish, Backspace removes the last point, Esc cancels.
    // Points go on the model under the pointer, else on the ground. Ctrl/Cmd+Z undoes a new path.
    const pen = viewer.addPluginSync(new PenToolPlugin({color: '#ff6b3d', linewidth: 3}))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    // the model on the ground, and the camera above it, so the pen can draw around and over it
    if (model) model.position.y = 1
    viewer.scene.mainCamera.position.set(0, 4, 6)
    viewer.scene.mainCamera.target.set(0, 0.5, 0)
    viewer.scene.mainCamera.setDirty()

    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) pen.toggle()
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(pen, {expanded: true})
    ui.setupPluginUi(PickingPlugin)
}

_testStart()
init().finally(_testFinish)
