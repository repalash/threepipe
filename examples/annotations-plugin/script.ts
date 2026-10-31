import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    Matrix4,
    Quaternion,
    Raycaster,
    ThreeViewer,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {AnnotationsPlugin, AnnotationView} from '@threepipe/plugin-annotations'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        // UndoManagerPlugin: Ctrl+Z / Ctrl+Shift+Z undo and redo the edits of the annotations
        plugins: [LoadingScreenPlugin, UndoManagerPlugin],
    })

    // editable: add (the UI button, then click a surface), edit the title and text in the card, drag a marker, delete
    const annotations = viewer.addPluginSync(new AnnotationsPlugin({editable: true}))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!model) return

    // Annotations from code: the camera looks from `from` at `at`, and the annotation is where that line meets the model.
    // Loading a .glb or a viewer config that has annotations restores them instead.
    viewer.scene.modelRoot.updateMatrixWorld(true)
    const add = (from: Vector3, at: Vector3, title: string, text: string) => {
        const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, at, new Vector3(0, 1, 0)))
        const view: AnnotationView = {position: from.toArray(), target: at.toArray(), quaternion: quaternion.toArray(), zoom: 1}
        const hit = new Raycaster(from, at.clone().sub(from).normalize()).intersectObject(model, true)[0]
        if (!hit?.face) return
        const object = hit.object as IObject3D
        annotations.add(object, object.worldToLocal(hit.point.clone()), hit.face.normal.clone(), view, {title, text})
    }
    add(new Vector3(0, 0.6, 3), new Vector3(0, 0.1, 0), 'Visor', '**Glass visor** with a scratched coating.\nClick the numbers, or use ← → to go to the next one.')
    add(new Vector3(-3, 0.3, 0.4), new Vector3(0, 0.1, 0), 'Side panel', 'Notes are saved in the viewer config and in the exported .glb, with their camera view.')
    add(new Vector3(0.4, 3, 0.8), new Vector3(0, 0.3, 0), 'Top', '- Editable: Add annotation in the panel\n- Drag a marker to move it\n- [threepipe.org](https://threepipe.org)')
    // the annotations from code are not edits: keep them out of the undo history
    viewer.getPlugin(UndoManagerPlugin)?.undoManager?.reset()

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(AnnotationsPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
