import {
    _testFinish, _testStart,
    BufferGeometry,
    BVHPlugin,
    CapsuleGeometry,
    ContactShadowGroundPlugin,
    CylinderGeometry,
    Group,
    IcosahedronGeometry,
    IGeometry,
    Intersection,
    LoadingScreenPlugin,
    Mesh,
    MeshBasicMaterial,
    PhysicalMaterial,
    PickingPlugin,
    Raycaster,
    Sphere,
    SphereGeometry,
    ThreeViewer,
    TorusGeometry,
    TorusKnotGeometry,
    Vector2,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })
    const ground = viewer.addPluginSync(ContactShadowGroundPlugin)

    // threepipe does not depend on three-mesh-bvh: install it and give the plugin a loader.
    // A bundler puts three-mesh-bvh in its own chunk, loaded when the plugin is added.
    const bvh = viewer.addPluginSync(new BVHPlugin(true, {load: async() => import('three-mesh-bvh')}))

    // clicks select (with a box); the hover below is done by the example, to time each raycast
    viewer.addPluginSync(PickingPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    viewer.scene.backgroundColor?.set('#ebe7e1')
    // contact shadows only (in the alpha of a dark ground), on the background colour: no edge of a ground plane
    ground.size = 36
    ground.mapMode = 'alphaMap'
    const groundMaterial = ground.material as PhysicalMaterial | undefined
    if (groundMaterial) {
        groundMaterial.transparent = true
        groundMaterial.color.set('#3b332c')
        groundMaterial.roughness = 1
        groundMaterial.setDirty()
    }

    const field = makeField()
    viewer.scene.addObject(field.root, {autoScale: false, autoCenter: false})
    viewer.scene.mainCamera.position.set(0, 11.5, 20)
    viewer.scene.mainCamera.target.set(0, 0.6, 0)
    viewer.scene.mainCamera.setDirty()

    const panel = setupPanel(viewer, bvh, field)
    setupHover(viewer, bvh, field, panel)

    // expanded on desktop, collapsed on phones and tablets (the default), where it would cover the scene
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin())
    ui.setupPluginUi(BVHPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin, {expanded: false})

}

interface Field {
    root: Group
    meshes: Mesh[]
    geometries: BufferGeometry[]
    triangles: number
}

/**
 * A phyllotaxis spiral of a few thousand objects around a torus knot of a million triangles. The objects share a few
 * detailed geometries (one tree for each), so the scene draws millions of triangles without the memory of millions.
 */
function makeField(): Field {
    const random = mulberry32(7)
    const shapes: [string, BufferGeometry][] = [
        // 1,000 to 2,300 triangles each: over autoMinTriangles, so each gets a tree
        ['Knot', new TorusKnotGeometry(0.62, 0.2, 128, 8)],
        ['Sphere', new IcosahedronGeometry(0.8, 8)],
        ['Ring', new TorusGeometry(0.62, 0.26, 16, 40)],
        ['Capsule', new CapsuleGeometry(0.45, 0.7, 10, 28)],
        ['Column', new CylinderGeometry(0.55, 0.65, 1.3, 48, 10)],
    ]
    const material = (color: string, roughness: number, metalness = 0, clearcoat = 0) =>
        new PhysicalMaterial({color, roughness, metalness, clearcoat, clearcoatRoughness: 0.1})
    const materials = [
        material('#f1ece3', 0.35), // porcelain
        material('#cf6a4c', 0.5), // terracotta
        material('#8fae8b', 0.45), // sage
        material('#2f4a7a', 0.25, 0, 1), // lacquered blue
        material('#e2b04a', 0.4), // mustard
        material('#d8b46a', 0.22, 1), // gold
        material('#e6e8ec', 0.12, 1), // chrome
    ]

    const root = new Group()
    root.name = 'BVH field'
    const meshes: Mesh[] = []
    let triangles = 0
    const count = 2000
    const skip = 140 // the centre stays free for the big knot
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    for (let i = skip; i < skip + count; i++) {
        const r = 0.255 * Math.sqrt(i)
        const a = i * goldenAngle
        const [name, geometry] = shapes[Math.floor(random() * shapes.length)]
        const m = new Mesh(geometry, materials[Math.floor(random() * materials.length)])
        const s = 0.17 + 0.08 * random() + 0.06 * (1 - i / (skip + count)) // a bit larger towards the centre
        m.scale.setScalar(s)
        m.position.set(Math.cos(a) * r, s * 0.8, Math.sin(a) * r)
        m.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
        m.name = `${name} ${i - skip + 1}`
        root.add(m)
        meshes.push(m)
        triangles += triangleCount(geometry)
    }

    // the centrepiece: a million triangles in one mesh
    const knotGeometry = new TorusKnotGeometry(1.3, 0.42, 2500, 200)
    const knot = new Mesh(knotGeometry, material('#d8b46a', 0.18, 1))
    knot.name = 'Torus knot (1M triangles)'
    knot.position.set(0, 2.1, 0)
    root.add(knot)
    meshes.push(knot)
    triangles += triangleCount(knotGeometry)

    const geometries = [...shapes.map(s => s[1]), knotGeometry]
    for (const g of geometries) g.computeBoundingSphere() // for the sphere test of the hover
    return {root, meshes, geometries, triangles}
}

interface Panel {
    addRaycast(ms: number, withBVH: boolean): void
    setHovered(name: string): void
    update(): void
}

/** The on-page panel: the BVH toggle, the counts, the raycast times with and without the trees, the build time */
function setupPanel(viewer: ThreeViewer, bvh: BVHPlugin, field: Field): Panel {
    const $ = (id: string) => document.getElementById(id)!
    const toggle = $('bvh-toggle') as HTMLInputElement
    toggle.addEventListener('change', () => {
        bvh.enabled = toggle.checked
        update()
    })
    $('stat-objects').textContent = field.meshes.length.toLocaleString()
    $('stat-triangles').textContent = (field.triangles / 1e6).toFixed(1) + ' M'

    // the last raycasts of each kind, for the averages
    const times = {bvh: [] as number[], plain: [] as number[]}
    const average = (list: number[]) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN
    const ms = (v: number) => isNaN(v) ? '–' : v < 1 ? v.toFixed(3) + ' ms' : v.toFixed(1) + ' ms'

    /** Shows the state of the plugin and the raycast times */
    function update() {
        // read from the plugin every time: the state can change from its own UI or from code
        const state = bvhState(bvh, field)
        toggle.checked = bvh.enabled
        $('bvh-state').textContent = state.text
        $('bvh-state').dataset.state = state.id
        $('stat-trees').textContent = `${bvh.builtCount} · ${bvh.memoryMB} MB`
        $('stat-build').textContent = bvh.builtCount ? bvh.buildMs.toLocaleString() + ' ms' : '–'
        const withBVH = average(times.bvh), without = average(times.plain)
        $('stat-ray-bvh').textContent = ms(withBVH)
        $('stat-ray-plain').textContent = ms(without)
        $('stat-speedup').textContent = withBVH > 0 && without > 0 ? `${Math.round(without / withBVH).toLocaleString()}× faster with the BVH` : ''
    }

    let last = 0
    viewer.addEventListener('postFrame', () => {
        const now = performance.now()
        if (now - last < 200) return
        last = now
        update()
    })
    bvh.addEventListener('bvhBuilt', update)
    bvh.addEventListener('bvhDisposed', update)
    update()

    return {
        addRaycast(t, withBVH) {
            const list = withBVH ? times.bvh : times.plain
            list.push(t)
            if (list.length > 30) list.shift()
        },
        setHovered(name) {
            $('stat-hover').textContent = name
        },
        update,
    }
}

/** The state of the trees of the scene, from the plugin's public API */
function bvhState(bvh: BVHPlugin, field: Field) {
    if (bvh.isDisabled()) return {id: 'off', text: 'Off: three.js raycasts'}
    if (!bvh.lib) return {id: 'pending', text: 'Loading three-mesh-bvh…'}
    if (field.geometries.some(g => !g.boundsTree && bvh.wants(g as IGeometry))) return {id: 'pending', text: 'Building trees…'}
    return {id: 'on', text: 'On: raycasts use the trees'}
}

/** Hover: a raycast under the pointer, timed, with a highlight of the object and a marker at the hit point */
function setupHover(viewer: ThreeViewer, bvh: BVHPlugin, field: Field, panel: Panel) {
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const highlight = new PhysicalMaterial({color: '#ff7a45', emissive: '#ff4d1a', emissiveIntensity: 0.5, roughness: 0.3})
    const marker = new Mesh(new SphereGeometry(0.05, 16, 8), new MeshBasicMaterial({color: '#ffffff'}))
    marker.userData.userSelectable = false
    marker.visible = false
    viewer.scene.addObject(marker, {addToRoot: true, autoScale: false, autoCenter: false})

    let hovered: {mesh: Mesh, material: Mesh['material']} | undefined
    const setHovered = (hit?: Intersection) => {
        const mesh = hit?.object as Mesh | undefined
        if (hovered && hovered.mesh !== mesh) {
            hovered.mesh.material = hovered.material
            hovered = undefined
        }
        if (mesh && !hovered) {
            hovered = {mesh, material: mesh.material}
            mesh.material = highlight
        }
        marker.visible = !!hit
        if (hit) marker.position.copy(hit.point)
        panel.setHovered(mesh?.name ?? '–')
        viewer.setDirty()
    }

    // all the meshes of the field, with their own raycast (accelerated when they have a tree) or the one of three.js.
    // The raycast of three.js skips a mesh when the ray misses its bounding sphere, acceleratedRaycast goes to the tree
    // at once: the sphere test here, for both, keeps the per-mesh cost of the thousands of missed meshes the same.
    const sphere = new Sphere()
    const cast = (useOwnRaycast: boolean) => {
        const hits: Intersection[] = []
        for (const m of field.meshes) {
            if (!raycaster.ray.intersectsSphere(sphere.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld))) continue
            ;(useOwnRaycast ? m.raycast : Mesh.prototype.raycast).call(m, raycaster, hits)
        }
        return hits.sort((a, b) => a.distance - b.distance)
    }
    const timed = (useOwnRaycast: boolean) => {
        const start = performance.now()
        const hits = cast(useOwnRaycast)
        return {hits, ms: performance.now() - start}
    }

    let pending = false
    let dragging = false
    viewer.canvas.addEventListener('pointerdown', () => dragging = true)
    window.addEventListener('pointerup', () => dragging = false)
    viewer.canvas.addEventListener('pointerleave', () => setHovered())
    viewer.canvas.addEventListener('pointermove', (ev) => {
        if (dragging) return
        const rect = viewer.canvas.getBoundingClientRect()
        pointer.set((ev.clientX - rect.left) / rect.width * 2 - 1, -(ev.clientY - rect.top) / rect.height * 2 + 1)
        if (pending) return
        pending = true
        requestAnimationFrame(() => { // one raycast per frame
            pending = false
            raycaster.setFromCamera(pointer, viewer.scene.mainCamera)
            // the hover uses what the plugin set on the meshes; it counts as a BVH raycast only when all trees are there
            const state = bvhState(bvh, field).id
            const {hits, ms} = timed(true)
            if (state !== 'pending') panel.addRaycast(ms, state === 'on')
            setHovered(hits[0])
        })
    })

    // the first numbers for the panel: rays from the camera to objects of the field and to the big knot, with the trees
    // and without them
    const benchmark = () => {
        const camera = viewer.scene.mainCamera.position
        const target = new Vector3()
        const knot = field.meshes[field.meshes.length - 1]
        const aim = (i: number) => {
            if (i % 2) knot.getWorldPosition(target).add(new Vector3(Math.sin(i) * 1.4, Math.cos(i * 1.7) * 0.9, 0))
            else field.meshes[i * 389 % (field.meshes.length - 1)].getWorldPosition(target)
            raycaster.set(camera, target.sub(camera).normalize())
        }
        for (let i = 0; i < 2; i++) { // warm up, not timed
            aim(i)
            cast(true)
            cast(false)
        }
        for (let i = 0; i < 10; i++) { // a short pause once, most of it the rays through the knot without its tree
            aim(i)
            panel.addRaycast(timed(true).ms, true)
            panel.addRaycast(timed(false).ms, false)
        }
        panel.update()
    }
    let benchmarked = false
    bvh.addEventListener('bvhBuilt', () => {
        if (benchmarked || bvhState(bvh, field).id !== 'on') return
        benchmarked = true
        benchmark()
    })
}

/** The number of triangles of a geometry */
function triangleCount(g: BufferGeometry) {
    return Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3)
}

/** A seeded random number generator, so the field is the same on every load */
function mulberry32(seed: number) {
    return () => {
        seed |= 0
        seed = seed + 0x6D2B79F5 | 0
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

_testStart()
init().finally(_testFinish)
