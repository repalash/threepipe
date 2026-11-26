import {
    _testFinish,
    _testStart,
    BufferAttribute,
    BufferGeometry2,
    LoadingScreenPlugin,
    Mesh2,
    PhysicalMaterial,
    ThreeViewer,
} from 'threepipe'
import {
    bakeGeometry,
    BMesh,
    bmFromMesh,
    bmToMesh,
    diskEdgeExists,
    edgeIsManifold,
    geometryDataToBufferGeometry,
    joinFaceKillEdge,
    MeshData,
    splitEdgeMakeVert,
    splitFaceMakeEdge,
} from '@threepipe/mesh-kernel'

/**
 * A playground for the mesh kernel: build an editable n-gon mesh, run real topology operators on it,
 * and see the result.
 *
 * Everything below the bake is renderer-agnostic. The kernel deliberately does not import three, so
 * `geometryDataToBufferGeometry` is handed the constructors it needs. Edits happen on the kernel mesh;
 * the `BufferGeometry` is a derived cache that is thrown away and rebuilt.
 */

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const material = new PhysicalMaterial({color: '#c8c8d0', roughness: 0.35, metalness: 0.05})
    const mesh = new Mesh2(new BufferGeometry2(), material)
    mesh.name = 'Kernel Mesh'
    viewer.scene.addObject(mesh)

    const wireMaterial = new PhysicalMaterial({color: '#101014', wireframe: true, roughness: 1})
    const wire = new Mesh2(new BufferGeometry2(), wireMaterial)
    wire.name = 'Wireframe'
    viewer.scene.addObject(wire)

    // --- starting meshes -------------------------------------------------------------------

    function cube(): MeshData {
        const s = 0.6
        return MeshData.fromFaces({
            positions: [
                -s, -s, -s, -s, -s, s, -s, s, -s, -s, s, s,
                s, -s, -s, s, -s, s, s, s, -s, s, s, s,
            ],
            faces: [
                [0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4],
                [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5],
            ],
        })
    }

    function ngon(sides = 12): MeshData {
        const positions: number[] = []
        const face: number[] = []
        for (let i = 0; i < sides; i++) {
            const a = (i / sides) * Math.PI * 2
            positions.push(Math.cos(a), 0, Math.sin(a))
            face.push(i)
        }
        // A single n-gon face, not a triangle fan. This is the whole point of the representation.
        return MeshData.fromFaces({positions, faces: [face]})
    }

    function grid(n = 4): MeshData {
        const positions: number[] = []
        for (let z = 0; z <= n; z++) {
            for (let x = 0; x <= n; x++) positions.push(x / n - 0.5, 0, z / n - 0.5)
        }
        const faces: number[][] = []
        const at = (x: number, z: number) => z * (n + 1) + x
        for (let z = 0; z < n; z++) {
            for (let x = 0; x < n; x++) faces.push([at(x, z), at(x + 1, z), at(x + 1, z + 1), at(x, z + 1)])
        }
        return MeshData.fromFaces({positions, faces})
    }

    // --- state -----------------------------------------------------------------------------

    let current: MeshData = cube()
    let lastNote = 'cube'

    const statsEl = document.getElementById('stats')!

    function refresh(note?: string) {
        if (note) lastNote = note
        const problems = current.validate()

        const {data, triangleToFace} = bakeGeometry(current, {includeNormals: true})
        // BufferGeometry2 is threepipe's IGeometry-compatible subclass; the kernel does not know or
        // care which constructor it is handed.
        const ctors = {BufferGeometry: BufferGeometry2, BufferAttribute}
        mesh.geometry.dispose()
        mesh.geometry = geometryDataToBufferGeometry<BufferGeometry2>(data, ctors)
        wire.geometry.dispose()
        wire.geometry = geometryDataToBufferGeometry<BufferGeometry2>(
            bakeGeometry(current, {includeNormals: false}).data, ctors)

        // A quick topology read-out, the kind of thing an agent would call measure() for.
        const bm = bmFromMesh(current)
        let boundary = 0
        let nonManifold = 0
        for (const e of bm.edges) {
            const faces = [...(function* () {
                let l = e.l
                if (!l) return
                const first = l
                do {
                    yield l
                    l = l.radialNext!
                } while (l !== first)
            })()].length
            if (faces === 1) boundary++
            else if (faces > 2) nonManifold++
        }

        const chi = current.vertsNum - current.edgesNum + current.facesNum
        statsEl.innerHTML =
            `${lastNote}\n`
            + `verts ${current.vertsNum}  edges ${current.edgesNum}\n`
            + `faces ${current.facesNum}  corners ${current.cornersNum}\n`
            + `triangles ${triangleToFace.length}\n`
            + `V-E+F = ${chi}\n`
            + `boundary edges ${boundary}, non-manifold ${nonManifold}\n`
            + (problems.length
                ? `<span class="bad">INVALID: ${problems[0]}</span>`
                : 'valid')

        viewer.setDirty()
    }

    // --- operators -------------------------------------------------------------------------

    /** Split every edge at its midpoint. Each face gains a corner per edge. */
    function subdivideAllEdges() {
        const bm = bmFromMesh(current)
        for (const e of [...bm.edges]) splitEdgeMakeVert(bm, e, e.v1, 0.5)
        current = bmToMesh(bm)
        refresh('split every edge')
    }

    /** Cut every face across its longest diagonal. */
    function splitAllFaces() {
        const bm = bmFromMesh(current)
        for (const f of [...bm.faces]) {
            if (f.len < 4) continue
            const loops = f.loops()
            splitFaceMakeEdge(bm, f, loops[0], loops[Math.floor(loops.length / 2)])
        }
        current = bmToMesh(bm)
        refresh('split every face')
    }

    /** Dissolve the first manifold edge, merging the two faces that share it into an n-gon. */
    function dissolveAnEdge() {
        const bm = bmFromMesh(current)
        const edge = [...bm.edges].find(e => edgeIsManifold(e))
        if (!edge) {
            refresh('no manifold edge to dissolve')
            return
        }
        const [l1, l2] = [edge.l!, edge.l!.radialNext!]
        const merged = joinFaceKillEdge(bm, l1.f, l2.f, edge)
        current = bmToMesh(bm)
        refresh(merged ? 'dissolved an edge' : 'join refused (would be illegal)')
    }

    /**
     * Poke: put a vertex at each face centre and fan to it. Built only from Euler operators, which is
     * the point: no special-case code, just split-face repeatedly.
     */
    function pokeFaces() {
        const bm = bmFromMesh(current)
        for (const f of [...bm.faces]) {
            const loops = f.loops()
            if (loops.length < 4) continue
            // Fan by repeatedly cutting a triangle off the first corner.
            let face = f
            while (face.len > 3) {
                const ls = face.loops()
                const res = splitFaceMakeEdge(bm, face, ls[0], ls[2])
                face = res.fNew.len > 3 ? res.fNew : face
                if (face.len <= 3) break
            }
        }
        current = bmToMesh(bm)
        refresh('poked faces')
    }

    function roundTrip() {
        const before = current.describe()
        const after = bmToMesh(bmFromMesh(current))
        const same = after.describe() === before
        current = after
        refresh(same ? 'round trip: identical' : 'round trip: CHANGED')
    }

    // --- wiring ----------------------------------------------------------------------------

    const ops: Record<string, () => void> = {
        cube: () => { current = cube(); refresh('cube') },
        ngon: () => { current = ngon(12); refresh('12-gon, one face') },
        grid: () => { current = grid(4); refresh('grid 4x4') },
        subdivide: subdivideAllEdges,
        triangulate: splitAllFaces,
        dissolve: dissolveAnEdge,
        poke: pokeFaces,
        validate: () => refresh('validated'),
        roundtrip: roundTrip,
        reset: () => { current = cube(); refresh('reset to cube') },
    }

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#panel button'))) {
        button.addEventListener('click', () => {
            const op = button.dataset.op!
            try {
                ops[op]()
            } catch (err) {
                statsEl.innerHTML = `<span class="bad">${(err as Error).message}</span>`
            }
        })
    }

    refresh('cube')
    await viewer.fitToView(undefined, 1.4)

    // Expose the kernel for console experiments: the scripting API is the agent API.
    Object.assign(window as never, {
        viewer,
        kernel: {
            get mesh() { return current },
            set mesh(m: MeshData) { current = m; refresh('set from console') },
            refresh,
            BMesh, bmFromMesh, bmToMesh, MeshData, bakeGeometry,
            splitEdgeMakeVert, splitFaceMakeEdge, joinFaceKillEdge, diskEdgeExists,
        },
    })
    console.log('Try: kernel.mesh.describe() — or edit kernel.mesh and call kernel.refresh()')
}

_testStart()
init().finally(_testFinish)
