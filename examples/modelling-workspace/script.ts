import {
    _testFinish,
    _testStart,
    GeometryGeneratorPlugin,
    IObject3D,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {MeshEditPlugin, ReferenceImagePlugin} from '@threepipe/plugin-mesh-edit'
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
        plugins: [LoadingScreenPlugin, PickingPlugin, TransformControlsPlugin, GeometryGeneratorPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const picking = viewer.getPlugin(PickingPlugin)!
    const generators = viewer.addPluginSync(Object3DGeneratorPlugin)
    const meshEdit = viewer.addPluginSync(MeshEditPlugin)
    const references = viewer.addPluginSync(ReferenceImagePlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(ReferenceImagePlugin)
    ui.setupPluginUi(TransformControlsPlugin)

    // --- add primitives, the demo's Add > Mesh menu -------------------------------------------

    const primitives = ['box', 'plane', 'circle', 'sphere', 'cylinder', 'torus'] as const

    function addPrimitive(type: typeof primitives[number]) {
        const obj = generators.generate('geometry-' + type, {})
        if (obj) picking.setSelectedObject(obj as IObject3D)
        refresh()
    }

    // --- status ------------------------------------------------------------------------------

    const modeEl = document.getElementById('mode')!
    const statsEl = document.getElementById('stats')!

    function refresh() {
        const editing = meshEdit.isEditing
        modeEl.textContent = editing ? 'EDIT MODE' : 'OBJECT MODE'
        modeEl.className = editing ? 'edit' : 'object'

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
                ? `${sel.name || 'object'} selected\n${count} objects in scene\nTab to edit it`
                : `${count} objects in scene\nclick one to select`
        }
    }

    meshEdit.addEventListener('editModeChanged', refresh)
    meshEdit.addEventListener('elementSelectionChanged', refresh)
    meshEdit.addEventListener('transformChanged', refresh)
    meshEdit.addEventListener('meshChanged', refresh)
    picking.addEventListener('selectedObjectChanged', refresh)

    // --- wiring ------------------------------------------------------------------------------

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-add]'))) {
        button.addEventListener('click', () => addPrimitive(button.dataset.add as never))
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

    addPrimitive('box')
    await viewer.fitToView(undefined, 2)
    refresh()

    // The scripting surface is the agent surface: everything the UI does is reachable here.
    Object.assign(window as never, {viewer, picking, meshEdit, references, generators})
    console.log('Try: meshEdit.enter(); meshEdit.setSelectMode(4); meshEdit.selectAllElements(); meshEdit.extrude()')
}

_testStart()
init().finally(_testFinish)
