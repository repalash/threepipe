import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    Mesh2,
    PhysicalMaterial,
    PickingPlugin,
    SphereGeometry,
    ThreeViewer,
    BoxGeometry,
    iGeometryCommons,
    UndoManagerPlugin,
} from 'threepipe'
import {MeshEditPlugin, ReferenceImagePlugin} from '@threepipe/plugin-mesh-edit'
import {SelectMode} from '@threepipe/mesh-kernel'

/**
 * Blender-style edit mode.
 *
 * Select a mesh, press Tab, and its vertices, edges and faces become selectable elements. The topology
 * is taken over by the kernel, so what you are clicking is real n-gon topology rather than the
 * triangle buffers the renderer sees.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, UndoManagerPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const picking = viewer.getPlugin(PickingPlugin)!
    // Clicking the selected mesh keeps it selected, as in Blender, rather than deselecting it.
    if (picking.picker) picking.picker.cycleWrap = true
    const meshEdit = viewer.addPluginSync(MeshEditPlugin)
    // Modelling from reference: drop photos onto the viewport, then drag and resize them.
    const references = viewer.addPluginSync(ReferenceImagePlugin)

    const material = new PhysicalMaterial({color: '#b9bcc6', roughness: 0.4, metalness: 0.05})

    /**
     * Returns the framing promise rather than dropping it: `fitToView` animates the camera, so a
     * caller that does not wait carries on with the view still moving. At startup that made the
     * example's first rendered frame depend on timing, which is exactly the sort of thing that shows
     * up later as a flickering screenshot test rather than as an obvious bug.
     */
    function setObject(obj: IObject3D) {
        if (meshEdit.isEditing) meshEdit.exit(false)
        // Add before removing: an empty scene, even for a moment, brings up the loading screen
        // (`LoadingScreenPlugin.showOnSceneEmpty`), which then takes a second to fade out.
        const old = viewer.scene.modelRoot.children.filter(c => (c as IObject3D).assetType !== 'widget')
        viewer.scene.addObject(obj)
        for (const child of old) child.removeFromParent()
        picking.setSelectedObject(obj)
        return viewer.fitToView(undefined, 1.6)
    }

    // Raw three geometries need threepipe's upgrade before a Mesh2 will take them.
    const upgraded = <T extends object>(g: T) => iGeometryCommons.upgradeGeometry.call(g as never) as never

    const load = {
        cube: () => setObject(new Mesh2(upgraded(new BoxGeometry(1, 1, 1, 2, 2, 2)), material)),
        sphere: () => setObject(new Mesh2(upgraded(new SphereGeometry(0.7, 16, 12)), material)),
        suzanne: async () => {
            const obj = await viewer.load<IObject3D>(
                'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true})
            if (!obj) return
            let mesh: IObject3D | undefined
            obj.traverse(o => { if (!mesh && (o as IObject3D).geometry) mesh = o as IObject3D })
            if (mesh) picking.setSelectedObject(mesh)
        },
    }

    const statsEl = document.getElementById('stats')!

    function refreshStats() {
        if (!meshEdit.isEditing || !meshEdit.state) {
            const sel = picking.getSelectedObject() as IObject3D | undefined
            statsEl.textContent = sel
                ? `object mode\n${sel.name || 'mesh'} selected\npress Tab to edit`
                : 'object mode\nclick a mesh to select it'
            return
        }
        const state = meshEdit.state
        const bm = state.bm
        const mode = bm.selectMode & SelectMode.Face ? 'face'
            : bm.selectMode & SelectMode.Edge ? 'edge' : 'vertex'
        const lines = [
            `edit mode — ${mode}`,
            `verts ${bm.totvert}  edges ${bm.totedge}  faces ${bm.totface}`,
            `selected ${bm.totvertsel} / ${bm.totedgesel} / ${bm.totfacesel}`,
        ]
        if (state.weldedCount > 0) lines.push(`welded ${state.weldedCount} split corners on entry`)
        const t = meshEdit.activeTransform
        if (t) lines.push('', t.status)
        statsEl.textContent = lines.join('\n')
    }

    meshEdit.addEventListener('editModeChanged', refreshStats)
    meshEdit.addEventListener('elementSelectionChanged', refreshStats)
    meshEdit.addEventListener('transformChanged', refreshStats)
    picking.addEventListener('selectedObjectChanged', refreshStats)

    // --- transform settings: Blender's header widgets for pivot, orientation, snapping, proportional ---

    const transformStatus = document.getElementById('transform-status')!
    meshEdit.addEventListener('transformChanged', e => {
        transformStatus.textContent = e.transform ? e.transform.status : ''
    })

    const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
    // Controls hand the keyboard back to the viewport after a change, so G/R/S keep working.
    const settle = (el: HTMLElement) => el.blur()

    byId<HTMLSelectElement>('pivot').addEventListener('change', e => {
        meshEdit.setPivot((e.target as HTMLSelectElement).value as never)
        settle(e.target as HTMLElement)
    })
    byId<HTMLSelectElement>('orientation').addEventListener('change', e => {
        meshEdit.setOrientation((e.target as HTMLSelectElement).value as never)
        settle(e.target as HTMLElement)
    })
    const applySnap = () => meshEdit.setSnapping({
        enabled: byId<HTMLInputElement>('snap').checked,
        targets: [byId<HTMLSelectElement>('snap-target').value as never],
    })
    byId('snap').addEventListener('change', e => {
        applySnap()
        settle(e.target as HTMLElement)
    })
    byId('snap-target').addEventListener('change', e => {
        applySnap()
        settle(e.target as HTMLElement)
    })
    const applyProportional = () => meshEdit.setProportional({
        enabled: byId<HTMLInputElement>('proportional').checked,
        falloff: byId<HTMLSelectElement>('prop-falloff').value as never,
        connected: byId<HTMLInputElement>('prop-connected').checked,
    })
    for (const id of ['proportional', 'prop-falloff', 'prop-connected']) {
        byId(id).addEventListener('change', e => {
            applyProportional()
            settle(e.target as HTMLElement)
        })
    }
    byId('gizmo').addEventListener('change', e => {
        meshEdit.showGizmo((e.target as HTMLInputElement).checked)
        settle(e.target as HTMLElement)
    })
    // This example is about the transform tools, so the gizmo is on; an app with a toolbar shows it
    // with the Move/Rotate/Scale tools, as Blender does.
    meshEdit.showGizmo(byId<HTMLInputElement>('gizmo').checked)
    byId('xray').addEventListener('change', e => {
        meshEdit.xray = (e.target as HTMLInputElement).checked
        settle(e.target as HTMLElement)
    })

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#panel button'))) {
        button.addEventListener('click', async () => {
            const op = button.dataset.op as keyof typeof load
            await load[op]()
            refreshStats()
        })
    }

    // A three-quarter view, as Blender's default scene: straight on, a cube reads as a flat square and
    // the gizmo's Z handles point at the camera.
    const camera = viewer.scene.mainCamera
    camera.position.set(4, 3, 5)
    camera.target.set(0, 0, 0)
    camera.setDirty()
    await load.cube()
    refreshStats()

    // The scripting API is the agent API: everything the UI does is reachable from here.
    Object.assign(window as never, {viewer, meshEdit, picking, references})
    console.log('Try: meshEdit.enter(); meshEdit.selectAllElements(); meshEdit.state.describe()')
}

_testStart()
init().finally(_testFinish)
