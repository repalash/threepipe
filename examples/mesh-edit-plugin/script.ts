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
        plugins: [LoadingScreenPlugin, PickingPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const picking = viewer.getPlugin(PickingPlugin)!
    const meshEdit = viewer.addPluginSync(MeshEditPlugin)
    // Modelling from reference: drop photos onto the viewport, then drag and resize them.
    const references = viewer.addPluginSync(ReferenceImagePlugin)

    const material = new PhysicalMaterial({color: '#b9bcc6', roughness: 0.4, metalness: 0.05})

    function setObject(obj: IObject3D) {
        if (meshEdit.isEditing) meshEdit.exit(false)
        for (const child of [...viewer.scene.modelRoot.children]) {
            if ((child as IObject3D).assetType === 'widget') continue
            child.removeFromParent()
        }
        viewer.scene.addObject(obj)
        picking.setSelectedObject(obj)
        viewer.fitToView(undefined, 1.6)
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

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#panel button'))) {
        button.addEventListener('click', async () => {
            const op = button.dataset.op as keyof typeof load
            await load[op]()
            refreshStats()
        })
    }

    load.cube()
    refreshStats()

    // The scripting API is the agent API: everything the UI does is reachable from here.
    Object.assign(window as never, {viewer, meshEdit, picking, references})
    console.log('Try: meshEdit.enter(); meshEdit.selectAllElements(); meshEdit.state.describe()')
}

_testStart()
init().finally(_testFinish)
