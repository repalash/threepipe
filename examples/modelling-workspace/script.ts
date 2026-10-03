import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    UndoManagerPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {MeshEditPlugin, ReferenceImagePlugin} from '@threepipe/plugin-mesh-edit'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {SelectMode} from '@threepipe/mesh-kernel'

/**
 * A modelling workspace: the object-mode and edit-mode halves of the toolset in one page.
 *
 * This is the workflow the kokraf demo uses. Most of the build is object mode - add a primitive, place
 * it, scale it, duplicate it - with edit mode used to shape individual pieces. Reference photos sit
 * over the viewport throughout.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, TransformControlsPlugin, UndoManagerPlugin],
    })

    // An editor's scene can be empty (Clear): that is not a load, so no loading screen for it.
    viewer.getPlugin(LoadingScreenPlugin)!.isEditor = true

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const picking = viewer.getPlugin(PickingPlugin)!
    // Clicking the selected object keeps it selected (and cycles through objects behind it), as in
    // Blender. Without this the first click on the starting cube deselected it.
    if (picking.picker) picking.picker.cycleWrap = true
    const meshEdit = viewer.addPluginSync(MeshEditPlugin)
    // Primitives come from the modelling document, so they keep their real topology: a cube opens in
    // edit mode as six quads, not twelve triangles welded back together.
    const modelling = viewer.addPluginSync(ModellingPlugin)
    const references = viewer.addPluginSync(ReferenceImagePlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(ReferenceImagePlugin)
    ui.setupPluginUi(TransformControlsPlugin)

    // --- add primitives, the demo's Add > Mesh menu -------------------------------------------

    const primitives = ['cube', 'plane', 'circle', 'sphere', 'cylinder', 'cone', 'torus'] as const

    async function addPrimitive(type: typeof primitives[number]) {
        if (meshEdit.isEditing) meshEdit.exit(true)
        const result = await modelling.run({op: 'primitive', type, name: type})
        const entry = result.ok && result.objects?.[0] ? modelling.document.find(result.objects[0]) : undefined
        if (entry) picking.setSelectedObject(entry.object)
        else showNotice(result.error ?? 'Could not add ' + type)
        refresh()
    }

    // --- notices: what used to go to the console only -----------------------------------------

    const noticeEl = document.getElementById('notice')!
    let noticeTimer = 0
    function showNotice(message: string) {
        noticeEl.textContent = message
        noticeEl.classList.add('show')
        clearTimeout(noticeTimer)
        noticeTimer = window.setTimeout(() => noticeEl.classList.remove('show'), 3500)
    }
    meshEdit.addEventListener('notice', e => showNotice(e.message))

    // --- status ------------------------------------------------------------------------------

    // The top bar wraps on narrow windows; keep the help panel just below it.
    const topbar = document.getElementById('topbar')!
    const panel = document.getElementById('panel')!
    new ResizeObserver(() => panel.style.top = topbar.offsetHeight + 12 + 'px').observe(topbar)

    const modeEl = document.getElementById('mode')!
    const statsEl = document.getElementById('stats')!

    const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    const selectButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-select]'))
    const xrayButton = document.getElementById('xray') as HTMLButtonElement

    function refresh() {
        const editing = meshEdit.isEditing
        modeEl.textContent = editing ? 'EDIT MODE' : 'OBJECT MODE'
        modeEl.className = editing ? 'edit' : 'object'
        for (const b of modeButtons) b.classList.toggle('active', (b.dataset.mode === 'edit') === editing)
        const mode = meshEdit.selectMode
        for (const b of selectButtons) {
            b.disabled = !editing
            b.classList.toggle('active', editing && (mode & Number(b.dataset.select)) !== 0)
        }
        xrayButton.classList.toggle('active', meshEdit.xray)

        if (editing && meshEdit.state) {
            const bm = meshEdit.state.bm
            const domain = bm.selectMode & SelectMode.Face ? 'face'
                : bm.selectMode & SelectMode.Edge ? 'edge' : 'vertex'
            const lines = [
                `${domain} select`,
                `verts ${bm.totvert}  edges ${bm.totedge}  faces ${bm.totface}`,
                `selected ${bm.totvertsel} / ${bm.totedgesel} / ${bm.totfacesel}`,
            ]
            const t = meshEdit.activeTransform
            if (t) lines.push('', t.status)
            statsEl.textContent = lines.join('\n')
        } else {
            const sel = picking.getSelectedObject() as IObject3D | undefined
            const count = viewer.scene.modelRoot.children.filter(c => (c as IObject3D).assetType !== 'widget').length
            statsEl.textContent = sel
                ? `${sel.name || 'object'} selected\n${count} objects in scene\ndouble-click or Tab to edit it`
                : `${count} objects in scene\nclick one to select`
        }
    }

    meshEdit.addEventListener('editModeChanged', refresh)
    meshEdit.addEventListener('elementSelectionChanged', refresh)
    meshEdit.addEventListener('transformChanged', refresh)
    meshEdit.addEventListener('meshChanged', refresh)
    picking.addEventListener('selectedObjectChanged', refresh)

    // --- mode and select-mode buttons: everything a key does, visible -------------------------

    for (const b of modeButtons) {
        b.addEventListener('click', () => {
            if (b.dataset.mode === 'edit' && !meshEdit.isEditing) meshEdit.enter()
            if (b.dataset.mode === 'object' && meshEdit.isEditing) meshEdit.exit(true)
            refresh()
        })
    }
    for (const b of selectButtons) {
        b.addEventListener('click', () => {
            meshEdit.setSelectMode(Number(b.dataset.select) as never)
            refresh()
        })
    }
    xrayButton.addEventListener('click', () => {
        meshEdit.xray = !meshEdit.xray
        refresh()
    })
    const gizmoButton = document.getElementById('gizmo') as HTMLButtonElement
    gizmoButton.addEventListener('click', () => {
        meshEdit.showGizmo(!meshEdit.gizmoVisible)
        gizmoButton.classList.toggle('active', meshEdit.gizmoVisible)
    })
    const undo = viewer.getPlugin(UndoManagerPlugin)!
    document.getElementById('undo')?.addEventListener('click', () => {
        undo.undo()
        refresh()
    })
    document.getElementById('redo')?.addEventListener('click', () => {
        undo.redo()
        refresh()
    })

    // --- wiring ------------------------------------------------------------------------------

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-add]'))) {
        button.addEventListener('click', () => void addPrimitive(button.dataset.add as never))
    }
    document.getElementById('clear')?.addEventListener('click', () => {
        if (meshEdit.isEditing) meshEdit.exit(false)
        for (const child of [...viewer.scene.modelRoot.children]) {
            if ((child as IObject3D).assetType === 'widget') continue
            child.removeFromParent()
        }
        picking.setSelectedObject(null)
        refresh()
    })

    await addPrimitive('cube')
    // Start from a three-quarter view, as Blender's default scene does: straight on, a cube reads as a
    // flat square and nothing shows it is 3D.
    const camera = viewer.scene.mainCamera
    camera.position.set(4, 3, 5)
    camera.target.set(0, 0, 0)
    camera.setDirty()
    await viewer.fitToView(undefined, 2)
    refresh()

    // The scripting surface is the agent surface: everything the UI does is reachable here.
    Object.assign(window as never, {viewer, picking, meshEdit, modelling, references})
    console.log('Try: meshEdit.enter(); meshEdit.setSelectMode(4); meshEdit.selectAllElements(); meshEdit.extrude()')
}

_testStart()
init().finally(_testFinish)
