import {
    _testFinish,
    _testStart,
    BufferAttribute,
    BufferGeometry2,
    IObject3D,
    LoadingScreenPlugin,
    Mesh2,
    PhysicalMaterial,
    PickingPlugin,
    ThreeViewer,
    UndoManagerPlugin,
} from 'threepipe'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'
import {
    bakeGeometry,
    geometryDataToBufferGeometry,
    MeshData,
    primitiveGrid,
    primitiveUVSphere,
    SelectMode,
} from '@threepipe/mesh-kernel'

/**
 * Edit-mode selection tools: box, lasso and circle select on the selection buffer, loop, ring and
 * shortest-path clicks, select linked, more/less, hide and reveal, with Blender's overlays - fat
 * edges, vertex and face dots - and X-ray.
 *
 * The meshes come straight from the kernel's primitives, so they open in edit mode as the quads they
 * were built from. The "Dense" sphere has 51k faces, for timing the buffer and the overlays.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, UndoManagerPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const picking = viewer.getPlugin(PickingPlugin)!
    if (picking.picker) picking.picker.cycleWrap = true
    const meshEdit = viewer.addPluginSync(MeshEditPlugin)

    // The kernel mesh behind each object, handed to edit mode so no topology is guessed from triangles.
    const meshes = new WeakMap<IObject3D, MeshData>()
    meshEdit.meshProviders.push(object => meshes.get(object))
    meshEdit.meshSinks.push((object, mesh) => meshes.set(object, mesh))

    const material = new PhysicalMaterial({color: '#b9bcc6', roughness: 0.45, metalness: 0.05})

    function makeObject(name: string, mesh: MeshData): Mesh2 {
        const {data} = bakeGeometry(mesh, {includeNormals: true})
        const geometry = geometryDataToBufferGeometry<BufferGeometry2>(data, {BufferGeometry: BufferGeometry2, BufferAttribute})
        const object = new Mesh2(geometry, material)
        object.name = name
        meshes.set(object as never, mesh)
        return object
    }

    async function setObject(object: Mesh2) {
        if (meshEdit.isEditing) meshEdit.exit(false)
        for (const child of [...viewer.scene.modelRoot.children]) {
            if ((child as IObject3D).assetType === 'widget') continue
            child.removeFromParent()
        }
        viewer.scene.addObject(object)
        picking.setSelectedObject(object)
        // A fixed, slightly elevated view, so screen positions are reproducible for the tests.
        const camera = viewer.scene.mainCamera
        camera.position.set(1.2, 2.6, 3.4)
        camera.target.set(0, 0, 0)
        camera.setDirty()
        await viewer.fitToView(undefined, 2.1)
    }

    const load = {
        // An 8x8 grid of quads: loops, rings and paths are easy to see on it.
        grid: () => setObject(makeObject('grid', primitiveGrid({xSegments: 8, ySegments: 8, size: 1}))),
        sphere: () => setObject(makeObject('sphere', primitiveUVSphere({uSegments: 24, vSegments: 12}))),
        // 320 x 160 = 51200 faces.
        dense: () => setObject(makeObject('dense', primitiveUVSphere({uSegments: 320, vSegments: 160}))),
    }

    // --- panel -----------------------------------------------------------------------------------

    const statsEl = document.getElementById('stats')!
    const noticeEl = document.getElementById('notice')!
    const selectButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-select]'))
    const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
    const xrayButton = document.getElementById('xray') as HTMLButtonElement
    const dotsButton = document.getElementById('dots') as HTMLButtonElement

    let noticeTimer = 0
    meshEdit.addEventListener('notice', e => {
        noticeEl.textContent = e.message
        noticeEl.classList.add('show')
        clearTimeout(noticeTimer)
        noticeTimer = window.setTimeout(() => noticeEl.classList.remove('show'), 3500)
    })

    function refresh() {
        const editing = meshEdit.isEditing
        const mode = meshEdit.selectMode
        for (const b of selectButtons) {
            b.disabled = !editing
            b.classList.toggle('active', editing && (mode & Number(b.dataset.select)) !== 0)
        }
        for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === meshEdit.dragSelect)
        xrayButton.classList.toggle('active', meshEdit.xray)
        dotsButton.textContent = 'Dots: ' + meshEdit.faceDots

        if (!editing || !meshEdit.state) {
            const sel = picking.getSelectedObject() as IObject3D | undefined
            statsEl.textContent = sel
                ? `object mode\n${sel.name} selected\npress Tab or double-click to edit`
                : 'object mode\nclick a mesh to select it'
            return
        }
        const bm = meshEdit.state.bm
        const domain = bm.selectMode & SelectMode.Face ? 'face' : bm.selectMode & SelectMode.Edge ? 'edge' : 'vertex'
        let hidden = 0
        for (const f of bm.faces) if (f.hidden) hidden++
        const lines = [
            `edit mode — ${domain}${meshEdit.isCircleSelecting ? ' — circle select' : ''}`,
            `verts ${bm.totvert}  edges ${bm.totedge}  faces ${bm.totface}`,
            `selected ${bm.totvertsel} / ${bm.totedgesel} / ${bm.totfacesel}`,
        ]
        if (hidden) lines.push(`${hidden} faces hidden (Alt+H reveals)`)
        const t = meshEdit.activeTransform
        if (t) lines.push('', t.status)
        statsEl.textContent = lines.join('\n')
    }

    for (const type of ['editModeChanged', 'elementSelectionChanged', 'transformChanged', 'meshChanged', 'regionChanged', 'xrayChanged'] as const) {
        meshEdit.addEventListener(type, refresh)
    }
    picking.addEventListener('selectedObjectChanged', refresh)

    // A clicked button keeps keyboard focus, and keys typed into a button belong to it, not to the
    // viewport: give focus back so the hotkeys keep working after a click.
    for (const b of document.querySelectorAll<HTMLButtonElement>('#panel button')) {
        b.addEventListener('click', () => b.blur())
    }

    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-op]')) {
        b.addEventListener('click', async() => {
            await load[b.dataset.op as keyof typeof load]()
            refresh()
        })
    }
    for (const b of selectButtons) {
        b.addEventListener('click', e => meshEdit.toggleSelectMode(Number(b.dataset.select) as never, {extend: e.shiftKey, expand: e.ctrlKey}))
    }
    for (const b of toolButtons) {
        b.addEventListener('click', () => {
            meshEdit.dragSelect = b.dataset.tool as never
            refresh()
        })
    }
    xrayButton.addEventListener('click', () => meshEdit.xray = !meshEdit.xray)
    dotsButton.addEventListener('click', () => {
        const modes = ['always', 'xray', 'never'] as const
        meshEdit.faceDots = modes[(modes.indexOf(meshEdit.faceDots) + 1) % modes.length]
        refresh()
    })

    await load.grid()
    meshEdit.enter()
    meshEdit.deselectAllElements()
    refresh()

    // The scripting API is the agent API: everything the UI does is reachable from here.
    Object.assign(window as never, {viewer, meshEdit, picking, meshes})
    console.log('Try: meshEdit.boxSelect({x0: 100, y0: 100, x1: 400, y1: 300}); meshEdit.selectMore()')
}

_testStart()
init().finally(_testFinish)
