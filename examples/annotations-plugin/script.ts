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
import {AnnotationsPlugin, AnnotationView, escapeHtml, renderAnnotationText} from '@threepipe/plugin-annotations'
import {createExampleCard} from '../examples-utils/example-card.js'

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
    const add = (from: Vector3, at: Vector3, title: string, text: string, data?: Record<string, any>) => {
        const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, at, new Vector3(0, 1, 0)))
        const view: AnnotationView = {position: from.toArray(), target: at.toArray(), quaternion: quaternion.toArray(), zoom: 1}
        const hit = new Raycaster(from, at.clone().sub(from).normalize()).intersectObject(model, true)[0]
        if (!hit?.face) return
        const object = hit.object as IObject3D
        annotations.add(object, object.worldToLocal(hit.point.clone()), hit.face.normal.clone(), view, {title, text, data})
    }
    add(new Vector3(0, 0.6, 3), new Vector3(0, 0.1, 0), 'Visor', '**Glass visor** with a scratched coating.\nClick the numbers, or use ← → to go to the next one.', {part: 'VS-200', price: 129})
    add(new Vector3(-3, 0.3, 0.4), new Vector3(0, 0.1, 0), 'Side panel', 'Notes are saved in the viewer config and in the exported .glb, with their camera view.')
    add(new Vector3(0.4, 3, 0.8), new Vector3(0, 0.3, 0), 'Top', '- Editable: Add annotation in the panel\n- Drag a marker to move it\n- [threepipe.org](https://threepipe.org)')
    // the annotations from code are not edits: keep them out of the undo history
    viewer.getPlugin(UndoManagerPlugin)?.undoManager?.reset()

    // a custom card from the app's values in `data` (with Editable off). The others keep the default card. Escape the
    // values of the file before they go into the HTML.
    annotations.renderCardContent = a => a.data?.price === undefined ? undefined :
        `<b>${escapeHtml(a.title)}</b> <small>${escapeHtml(String(a.data.part))}</small>
        <div style="margin-top:4px">${renderAnnotationText(a.text)}</div>
        <div style="margin-top:8px;font-weight:600">$${escapeHtml(String(a.data.price))}</div>`

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    // the UI folder also has Compact card (a title-and-text card and a tour bar at the bottom: try it with Play tour),
    // Close button and Close on canvas interaction
    ui.setupPluginUi(AnnotationsPlugin, {expanded: true})

    createExampleCard(viewer, {
        description: 'AnnotationsPlugin: numbered markers with a title, a text and a camera view, like Sketchfab. Click a number, or go through them here (← → while a card is open). With Editable on, add one from the panel, drag a marker, or edit a card; Ctrl+Z undoes.',
        actions: [
            {type: 'button', label: 'Previous', icon: 'arrow-left', value: () => annotations.prev()},
            {type: 'button', label: 'Next', icon: 'arrow-right', value: () => annotations.next()},
            {type: 'button', label: 'Play tour', icon: 'play', value: () => annotations.playTour()},
            {type: 'checkbox', label: 'Editable', icon: 'square-pen', property: [annotations, 'editable']},
        ],
    })
}

_testStart()
init().finally(_testFinish)
