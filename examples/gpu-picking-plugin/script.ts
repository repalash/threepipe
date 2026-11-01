import {
    _testFinish, _testStart,
    BoxGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    GPUPickingPlugin,
    Group,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    Raycaster,
    SphereGeometry,
    ThreeViewer,
    TorusKnotGeometry,
    UnlitMaterial,
    Vector2,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const gpuPicking = viewer.addPluginSync(GPUPickingPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // a few meshes in a row; the knot has 400k triangles, the pick costs the same for all of them
    const knot = new Mesh(new TorusKnotGeometry(0.7, 0.22, 1000, 200), new PhysicalMaterial({color: '#d8b46a', metalness: 1, roughness: 0.25}))
    knot.name = 'Torus knot'
    const box = new Mesh(new BoxGeometry(1.2, 1.2, 1.2), new PhysicalMaterial({color: '#4f86c6', roughness: 0.5}))
    box.name = 'Box'
    box.position.set(-2.2, 0, 0)
    const sphere = new Mesh(new SphereGeometry(0.7, 64, 32), new PhysicalMaterial({color: '#c64f6d', roughness: 0.3}))
    sphere.name = 'Sphere'
    sphere.position.set(2.2, 0, 0)
    viewer.scene.addObject(knot)
    viewer.scene.addObject(box)
    viewer.scene.addObject(sphere)

    // a marker at the picked point, outside the model root so it is not picked
    const marker = viewer.scene.addObject(new Mesh(new SphereGeometry(1, 16, 8), new UnlitMaterial({color: '#ffffff'})), {addToRoot: true})
    marker.visible = false

    // an arrow along the picked normal, from the picked point (+Y in the group), 1 long and scaled to the scene. It is
    // drawn over everything, so the surface does not hide its base.
    const arrowMaterial = new UnlitMaterial({color: '#ffe14d', depthTest: false, depthWrite: false})
    const shaft = new Mesh(new CylinderGeometry(0.025, 0.025, 0.75, 12), arrowMaterial)
    shaft.position.y = 0.375
    const head = new Mesh(new ConeGeometry(0.08, 0.25, 16), arrowMaterial)
    head.position.y = 0.875
    const arrow = new Group()
    arrow.add(shaft, head)
    shaft.renderOrder = head.renderOrder = 10
    viewer.scene.addObject(arrow, {addToRoot: true})
    arrow.visible = false
    const up = new Vector3(0, 1, 0)

    // the arrow a tenth of the scene size long, the marker in proportion
    const sizeToScene = () => {
        const length = viewer.scene.getBounds().getSize(new Vector3()).length() * 0.1
        arrow.scale.setScalar(length)
        marker.scale.setScalar(length * 0.07)
    }
    sizeToScene()

    // the triangles of the meshes in the model root
    const countTriangles = () => {
        let n = 0
        viewer.scene.modelRoot.traverse((o) => {
            const g = o.isMesh ? o.geometry : undefined
            if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3
        })
        return n
    }

    // "Huge scene": 400 knots of 50k triangles each (20M triangles), in a block of 10 × 8 × 5 behind the row. The GPU
    // pick draws only what the 1-pixel view sees, so its time does not grow with the scene; a Raycaster without a BVH
    // tests every triangle of each mesh whose bounding sphere the ray crosses (up to 5 knots deep here).
    const hugeGeometry = new TorusKnotGeometry(0.3, 0.09, 250, 100)
    const huge: Mesh[] = []
    const setHuge = (on: boolean) => {
        if (on && !huge.length) {
            for (let k = 0; k < 5; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) {
                const n = huge.length
                const m = new Mesh(hugeGeometry, new PhysicalMaterial({
                    color: new Color().setHSL(n / 400, 0.6, 0.55),
                    metalness: n % 2, roughness: 0.3,
                }))
                m.name = `Knot ${n + 1}`
                m.position.set((i - 4.5) * 1.1, (j - 3.5) * 1.1, -2.5 - k * 1.1)
                m.rotation.set(i * 0.4, j * 0.3, k * 0.5)
                huge.push(viewer.scene.addObject(m))
            }
        } else if (!on && huge.length) {
            for (const m of huge) {
                m.removeFromParent()
                ;(m.material as PhysicalMaterial).dispose()
            }
            huge.length = 0
            hugeGeometry.dispose()
        }
        viewer.scene.setDirty({refreshScene: true})
        sizeToScene()
        viewer.fitToView(viewer.scene.modelRoot)
        showScene()
    }
    const state = {huge: false}

    const info = document.getElementById('pick-info') as HTMLDivElement
    const lines = {scene: '', hover: 'Move the pointer over the objects', click: 'Click to compare with a Raycaster (no BVH) at the same point'}
    const showLines = () => info.textContent = `${lines.scene}\n${lines.hover}\n${lines.click}`
    const showScene = () => {
        lines.scene = `${huge.length + 3} meshes, ${(countTriangles() / 1e6).toFixed(1)}M triangles`
        showLines()
    }
    showScene()

    // CSS pixels from the top-left corner of the canvas
    const canvasPoint = (ev: MouseEvent) => {
        const rect = viewer.canvas.getBoundingClientRect()
        return [ev.clientX - rect.left, ev.clientY - rect.top] as const
    }

    viewer.canvas.addEventListener('pointermove', (ev) => {
        const hit = gpuPicking.pick(...canvasPoint(ev))
        marker.visible = arrow.visible = !!hit
        if (hit) {
            marker.position.copy(hit.point)
            arrow.position.copy(hit.point)
            arrow.quaternion.setFromUnitVectors(up, hit.normal)
        }
        viewer.setDirty()
        lines.hover = hit ?
            `${hit.object.name}, distance ${hit.distance.toFixed(2)}, normal (${hit.normal.toArray().map(v => v.toFixed(2)).join(', ')}), GPU pick ${gpuPicking.lastPickMs} ms` :
            `Nothing, GPU pick ${gpuPicking.lastPickMs} ms`
        showLines()
    })

    // on a click (not a drag of the camera): the GPU pick and a Raycaster at the same point. The Raycaster runs only on a
    // click, because without a BVH it takes too long on the huge scene to run on each move.
    const raycaster = new Raycaster()
    let down = [0, 0]
    viewer.canvas.addEventListener('pointerdown', (ev) => down = [ev.clientX, ev.clientY])
    viewer.canvas.addEventListener('click', (ev) => {
        if (Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 3) return
        const [x, y] = canvasPoint(ev)
        const hit = gpuPicking.pick(x, y)
        const t0 = performance.now()
        // through the centre of the pixel under the point, as the GPU pick
        const cx = Math.floor(x) + 0.5, cy = Math.floor(y) + 0.5
        raycaster.setFromCamera(new Vector2(cx / viewer.canvas.clientWidth * 2 - 1, -(cy / viewer.canvas.clientHeight) * 2 + 1), viewer.scene.mainCamera)
        const ref = raycaster.intersectObject(viewer.scene.modelRoot, true)[0]
        const rayMs = performance.now() - t0
        lines.click = `Click: GPU pick ${gpuPicking.lastPickMs} ms (${hit?.object.name ?? 'nothing'}), Raycaster ${rayMs.toFixed(1)} ms (${ref?.object.name ?? 'nothing'})`
        showLines()
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(GPUPickingPlugin, {expanded: true})
    ui.appendChild({
        type: 'checkbox',
        label: 'Huge scene (20M triangles)',
        property: [state, 'huge'],
        onChange: () => setHuge(state.huge),
    })

}

_testStart()
init().finally(_testFinish)
