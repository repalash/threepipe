/**
 * Tests for the BMesh topology walkers.
 *
 * Every expectation here is derived from `bmesh_walkers_impl.cc` and from the fixture's topology, not
 * from running the port and writing down what came out. Where an answer is countable by hand - a row of
 * a grid, a ring around a cylinder - the whole *set* is asserted, not just its size, because a walker
 * that stops one edge early or wanders onto the neighbouring row still has a plausible count.
 *
 * The M1 subplan records that twenty-five hand-written Euler tests passed against an operator that was
 * corrupting the mesh, and only exhaustive enumeration caught it. The lesson applies here, so the loop
 * and ring walks are checked over every edge of a grid and of a sphere, not over one lucky edge.
 *
 * Every test ends with `bm.validate()` returning `[]`: walkers must not mutate the mesh.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMEdge, BMElem, BMFace, BMVert} from './types'
import {diskCount, diskEdgeExists, edgeIsBoundary, radialLength} from './structure'
import {MeshData} from '../MeshData'
import {bmFromMesh} from './convert'
import {ElemFlag} from '../constants'
import {
    walkEdgeBoundary,
    walkEdgeLoop,
    walkEdgeRing,
    walkEdgeRingIter,
    walkFaceLoop,
    walkFaceLoopIter,
    walkIsland,
    walkLoopShell,
    walkVertShell,
    walkVertShellEdges,
} from './walkers'

/** Sorted element ids, so expectations read as sets and failures print something legible. */
function ids(elems: BMElem[]): number[] {
    return elems.map(e => e.id).sort((a, b) => a - b)
}

// region fixtures

/**
 * A `cols` x `rows` grid of quads.
 *
 * `v(i, j)` sits at `(i, j, 0)`, `h(i, j)` is the horizontal edge from `v(i, j)` to `v(i + 1, j)`,
 * `w(i, j)` the vertical one from `v(i, j)` to `v(i, j + 1)`, and `f(i, j)` the quad with `v(i, j)` as
 * its lower-left corner. Interior vertices have valence 4, so loops run all the way across; the four
 * corner vertices have valence 2 and the rest of the border valence 3.
 */
function grid(cols: number, rows: number) {
    const bm = new BMesh()
    const verts: BMVert[][] = []
    for (let i = 0; i <= cols; i++) {
        verts[i] = []
        for (let j = 0; j <= rows; j++) verts[i][j] = bm.vertCreate(i, j, 0)
    }
    const faces: BMFace[][] = []
    for (let i = 0; i < cols; i++) {
        faces[i] = []
        for (let j = 0; j < rows; j++) {
            faces[i][j] = bm.faceCreate([verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]])
        }
    }
    return {
        bm,
        cols,
        rows,
        v: (i: number, j: number) => verts[i][j],
        f: (i: number, j: number) => faces[i][j],
        h: (i: number, j: number) => diskEdgeExists(verts[i][j], verts[i + 1][j])!,
        w: (i: number, j: number) => diskEdgeExists(verts[i][j], verts[i][j + 1])!,
        /** Every horizontal edge of row `j`, which is what an edge loop through one of them must be. */
        row: (j: number) => Array.from({length: cols}, (_, i) => diskEdgeExists(verts[i][j], verts[i + 1][j])!),
        /** Every horizontal edge of column `i`, which is what an edge *ring* through one of them must be. */
        column: (i: number) => Array.from({length: rows + 1}, (_, j) => diskEdgeExists(verts[i][j], verts[i + 1][j])!),
        boundary: () => [...bm.edges].filter(edgeIsBoundary),
    }
}

/** The six quads of a unit cube. Every vertex has valence 3, which is the interesting part. */
function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: [number, number, number][] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s],
        [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = co.map(c => bm.vertCreate(...c))
    for (const f of [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]) {
        bm.faceCreate(f.map(i => verts[i]))
    }
    return {bm, verts}
}

/**
 * An open cylinder: one band of `n` quads, both ends unclosed.
 *
 * Both rings are closed loops of boundary edges, and the `n` vertical edges form a closed ring - the
 * two cases a walker can spin on forever if its visit set is wrong.
 */
function tube(n: number, caps = false) {
    const bm = new BMesh()
    const bottom: BMVert[] = []
    const top: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        bottom.push(bm.vertCreate(Math.cos(a), 0, Math.sin(a)))
        top.push(bm.vertCreate(Math.cos(a), 1, Math.sin(a)))
    }
    const side: BMFace[] = []
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        side.push(bm.faceCreate([bottom[i], bottom[j], top[j], top[i]]))
    }
    // Wound against the quads' top and bottom loops, so the whole surface is consistently wound.
    const capTop = caps ? bm.faceCreate([...top]) : null
    const capBottom = caps ? bm.faceCreate([...bottom].reverse()) : null
    return {
        bm,
        n,
        bottom,
        top,
        side,
        capTop,
        capBottom,
        vertical: (i: number) => diskEdgeExists(bottom[i], top[i])!,
        topRing: (i: number) => diskEdgeExists(top[i], top[(i + 1) % n])!,
        bottomRing: (i: number) => diskEdgeExists(bottom[i], bottom[(i + 1) % n])!,
        verticals: () => Array.from({length: n}, (_, i) => diskEdgeExists(bottom[i], top[i])!),
        topRings: () => Array.from({length: n}, (_, i) => diskEdgeExists(top[i], top[(i + 1) % n])!),
        bottomRings: () => Array.from({length: n}, (_, i) => diskEdgeExists(bottom[i], bottom[(i + 1) % n])!),
    }
}

/**
 * An open cylinder closed at the top by a fan of `n` triangles meeting at an apex.
 *
 * The apex is a valence-`n` pole, and every top-ring vertex has valence 4, so a loop entering from a
 * vertical edge crosses the ring vertex onto a spoke and then has to stop at the pole.
 */
function fanCappedTube(n: number) {
    const t = tube(n)
    const apex = t.bm.vertCreate(0, 2, 0)
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        t.bm.faceCreate([t.top[i], t.top[j], apex])
    }
    return {
        ...t,
        apex,
        spoke: (i: number) => diskEdgeExists(t.top[i], apex)!,
    }
}

/** A path of four wire vertices, plus one wire edge in a separate component. */
function wirePath() {
    const bm = new BMesh()
    const v = Array.from({length: 4}, (_, i) => bm.vertCreate(i, 0, 0))
    const edges = [bm.edgeCreate(v[0], v[1]), bm.edgeCreate(v[1], v[2]), bm.edgeCreate(v[2], v[3])]
    const far = [bm.vertCreate(0, 5, 0), bm.vertCreate(1, 5, 0)]
    const farEdge = bm.edgeCreate(far[0], far[1])
    return {bm, v, edges, far, farEdge}
}

/** Three quads sharing one edge: the shared edge has a radial cycle of length 3. */
function nonManifoldFan() {
    const bm = new BMesh()
    const v0 = bm.vertCreate(0, 0, 0)
    const v1 = bm.vertCreate(1, 0, 0)
    const faces: BMFace[] = []
    for (let k = 0; k < 3; k++) {
        const a = bm.vertCreate(1, 1, k)
        const b = bm.vertCreate(0, 1, k)
        faces.push(bm.faceCreate([v0, v1, a, b]))
    }
    const shared = diskEdgeExists(v0, v1)!
    return {bm, v0, v1, faces, shared}
}

/** A hexagonal n-gon surrounded by a ring of quads: the n-gon is the "face hub" of the loop walker. */
function ngonHub(n = 6) {
    const bm = new BMesh()
    const inner: BMVert[] = []
    const outer: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        inner.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
        outer.push(bm.vertCreate(2 * Math.cos(a), 2 * Math.sin(a), 0))
    }
    const hub = bm.faceCreate([...inner])
    const ring: BMFace[] = []
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        ring.push(bm.faceCreate([inner[j], inner[i], outer[i], outer[j]]))
    }
    return {
        bm,
        n,
        inner,
        outer,
        hub,
        ring,
        innerEdge: (i: number) => diskEdgeExists(inner[i], inner[(i + 1) % n])!,
        innerEdges: () => Array.from({length: n}, (_, i) => diskEdgeExists(inner[i], inner[(i + 1) % n])!),
        spoke: (i: number) => diskEdgeExists(inner[i], outer[i])!,
    }
}

/** The UV sphere Blender wrote into `tests/fixtures`: 32 segments, 16 rings, two valence-32 poles. */
function blenderSphere() {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures')
    const gt = JSON.parse(readFileSync(resolve(dir, 'blend-load-test-prim.json'), 'utf8'))
    const faces: number[][] = []
    for (let f = 0; f < gt.facesNum; f++) faces.push(gt.cornerVerts.slice(gt.faceOffsets[f], gt.faceOffsets[f + 1]))
    const mesh = MeshData.fromFaces({positions: gt.positions, faces})
    return {bm: bmFromMesh(mesh), gt}
}

// endregion

describe('walkVertShell', () => {
    it('takes the whole connected component and nothing else', () => {
        const bm = new BMesh()
        const a = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0)]
        const b = [bm.vertCreate(5, 0, 0), bm.vertCreate(6, 0, 0), bm.vertCreate(6, 1, 0), bm.vertCreate(5, 1, 0)]
        bm.faceCreate(a)
        bm.faceCreate(b)

        const edgesA = [...bm.edges].filter(e => a.includes(e.v1))
        expect(ids(walkVertShellEdges(a[0]))).toEqual(ids(edgesA))
        expect(ids(walkVertShell(a[0]))).toEqual(ids(a))
        // Seeding from an edge of the same component must give the same shell.
        expect(ids(walkVertShellEdges(edgesA[0]))).toEqual(ids(edgesA))
        expect(bm.validate()).toEqual([])
    })

    it('crosses wire edges and stops at a disconnected component', () => {
        const {bm, v, edges, far, farEdge} = wirePath()
        expect(ids(walkVertShellEdges(v[0]))).toEqual(ids(edges))
        expect(ids(walkVertShell(v[0]))).toEqual(ids(v))
        expect(ids(walkVertShellEdges(far[0]))).toEqual(ids([farEdge]))
        expect(bm.validate()).toEqual([])
    })

    it('yields a loose vertex and no edges', () => {
        const bm = new BMesh()
        const v = bm.vertCreate(0, 0, 0)
        expect(walkVertShellEdges(v)).toEqual([])
        expect(walkVertShell(v)).toEqual([v])
        expect(bm.validate()).toEqual([])
    })

    it('reaches every edge and vertex of a grid from any seed', () => {
        const g = grid(3, 2)
        for (const v of g.bm.verts) {
            expect(ids(walkVertShellEdges(v))).toEqual(ids([...g.bm.edges]))
            expect(ids(walkVertShell(v))).toEqual(ids([...g.bm.verts]))
        }
        expect(g.bm.validate()).toEqual([])
    })

    it('visits each edge exactly once on a mesh full of cycles', () => {
        const t = tube(8)
        const walked = walkVertShellEdges(t.vertical(0))
        expect(walked.length).toBe(t.bm.totedge)
        expect(new Set(walked).size).toBe(walked.length)
        expect(t.bm.validate()).toEqual([])
    })
})

describe('walkEdgeLoop', () => {
    it('runs the full width of a grid row through an interior edge', () => {
        const g = grid(4, 3)
        // v(0,1) and v(4,1) are border vertices of valence 3, so the loop stops there: exactly 4 edges.
        expect(ids(walkEdgeLoop(g.h(1, 1)))).toEqual(ids(g.row(1)))
        expect(walkEdgeLoop(g.h(1, 1)).length).toBe(4)
        expect(g.bm.validate()).toEqual([])
    })

    it('is perpendicular to the edge ring through the same edge', () => {
        const g = grid(4, 3)
        const e = g.h(1, 1)
        const loop = walkEdgeLoop(e)
        const ring = walkEdgeRing(e)

        // The loop is row 1, the ring is column 1: they are both sets of horizontal edges, but the loop
        // advances along x and the ring along y, and they can only share the edge they started from.
        expect(ids(loop)).toEqual(ids(g.row(1)))
        expect(ids(ring)).toEqual(ids(g.column(1)))
        expect(loop.filter(x => ring.includes(x))).toEqual([e])

        const loopY = new Set(loop.flatMap(x => [x.v1.y, x.v2.y]))
        const ringX = new Set(ring.flatMap(x => [x.v1.x, x.v2.x]))
        expect([...loopY]).toEqual([1])
        expect([...ringX].sort()).toEqual([1, 2])
        expect(g.bm.validate()).toEqual([])
    })

    it('walks vertical edges the same way, transposed', () => {
        const g = grid(4, 3)
        const expected = [g.w(1, 0), g.w(1, 1), g.w(1, 2)]
        expect(ids(walkEdgeLoop(g.w(1, 1)))).toEqual(ids(expected))
        expect(bothEnds(walkEdgeLoop(g.w(1, 1)))).toBe(true)
        expect(g.bm.validate()).toEqual([])
    })

    it('gives every interior edge of a grid the row or column it belongs to', () => {
        const g = grid(4, 3)
        for (let j = 1; j < g.rows; j++) {
            for (let i = 0; i < g.cols; i++) {
                expect(ids(walkEdgeLoop(g.h(i, j)))).toEqual(ids(g.row(j)))
            }
        }
        for (let i = 1; i < g.cols; i++) {
            for (let j = 0; j < g.rows; j++) {
                const column = Array.from({length: g.rows}, (_, k) => g.w(i, k))
                expect(ids(walkEdgeLoop(g.w(i, j)))).toEqual(ids(column))
            }
        }
        expect(g.bm.validate()).toEqual([])
    })

    it('follows the whole border from a boundary edge, turning the corners', () => {
        const g = grid(4, 3)
        // The boundary branch walks the fan at each vertex until it meets another boundary edge, and at
        // a corner of the grid the very first step lands on one - so the walk turns rather than stopping.
        const walked = walkEdgeLoop(g.h(0, 0))
        expect(walked.length).toBe(2 * (g.cols + g.rows))
        expect(ids(walked)).toEqual(ids(g.boundary()))
        expect(g.bm.validate()).toEqual([])
    })

    it('stops at the corners when outer corners delimit', () => {
        const g = grid(4, 3)
        // vert_edge_tot == 2 at a grid corner, and the edge is not "single", so the outer-corner
        // delimiter fires there: only the bottom row survives.
        expect(ids(walkEdgeLoop(g.h(1, 0), {delimitOuterCorners: true}))).toEqual(ids(g.row(0)))
        expect(g.bm.validate()).toEqual([])
    })

    it('stops immediately on a cube, where every vertex is a valence-3 pole', () => {
        const {bm} = cube()
        // Blender steps across a vertex only when vert_edge_tot is 4 or 2 (`bmesh_walkers_impl.cc`), and
        // the n-gon hub needs a face with more than 4 sides, so a cube has no edge loops at all.
        for (const e of bm.edges) expect(walkEdgeLoop(e)).toEqual([e])
        expect(bm.validate()).toEqual([])
    })

    it('crosses a valence-4 vertex and then stops at a pole', () => {
        const t = fanCappedTube(6)
        // Up the side, across the top ring vertex onto the spoke, then the apex (valence 6) ends it, and
        // downwards the open bottom ring vertex (valence 3) ends it too.
        expect(ids(walkEdgeLoop(t.vertical(2)))).toEqual(ids([t.vertical(2), t.spoke(2)]))
        expect(diskCount(t.apex)).toBe(6)
        expect(diskCount(t.top[2])).toBe(4)
        expect(t.bm.validate()).toEqual([])
    })

    it('terminates on a closed boundary loop', () => {
        const t = tube(8)
        const walked = walkEdgeLoop(t.topRing(0))
        expect(ids(walked)).toEqual(ids(t.topRings()))
        expect(walked.length).toBe(8)
        expect(t.bm.validate()).toEqual([])
    })

    it('walks around an n-gon hub', () => {
        const hub = ngonHub(6)
        // Every inner vertex has 3 edges and 3 face corners, and the larger of the two faces on an inner
        // edge is the 6-gon, so `f_hub` is set and the loop follows the n-gon's own edges.
        expect(ids(walkEdgeLoop(hub.innerEdge(0)))).toEqual(ids(hub.innerEdges()))
        expect(hub.bm.validate()).toEqual([])
    })

    it('takes every connected wire edge, and no wire edge from elsewhere', () => {
        const {bm, edges, farEdge} = wirePath()
        expect(ids(walkEdgeLoop(edges[1]))).toEqual(ids(edges))
        expect(walkEdgeLoop(farEdge)).toEqual([farEdge])
        expect(bm.validate()).toEqual([])
    })

    it('stops on a non-manifold edge', () => {
        const {bm, shared} = nonManifoldFan()
        expect(radialLength(shared)).toBe(3)
        expect(walkEdgeLoop(shared)).toEqual([shared])
        expect(bm.validate()).toEqual([])
    })
})

/** True when the walk's edges form one connected chain - used to check a loop is not two fragments. */
function bothEnds(edges: BMEdge[]): boolean {
    if (edges.length < 2) return true
    const remaining = new Set(edges)
    const seen = new Set<BMEdge>()
    const stack = [edges[0]]
    while (stack.length) {
        const e = stack.pop()!
        if (seen.has(e)) continue
        seen.add(e)
        for (const other of remaining) {
            if (other !== e && (other.uses(e.v1) || other.uses(e.v2))) stack.push(other)
        }
    }
    return seen.size === edges.length
}

describe('walkEdgeRing', () => {
    it('steps across each quad to the opposite edge, the length of a grid column', () => {
        const g = grid(4, 3)
        // Includes the two boundary edges at the ends: `EDGE_CHECK` accepts boundary as well as manifold.
        expect(ids(walkEdgeRing(g.h(1, 1)))).toEqual(ids(g.column(1)))
        expect(walkEdgeRing(g.h(1, 1)).length).toBe(g.rows + 1)
        expect(g.bm.validate()).toEqual([])
    })

    it('gives the same column from every edge in it, including the boundary ends', () => {
        const g = grid(4, 3)
        for (let i = 0; i < g.cols; i++) {
            for (let j = 0; j <= g.rows; j++) {
                expect(ids(walkEdgeRing(g.h(i, j)))).toEqual(ids(g.column(i)))
            }
        }
        expect(g.bm.validate()).toEqual([])
    })

    it('terminates on a closed ring', () => {
        const t = tube(8)
        const walked = walkEdgeRing(t.vertical(0))
        expect(ids(walked)).toEqual(ids(t.verticals()))
        expect(walked.length).toBe(8)
        expect(t.bm.validate()).toEqual([])
    })

    it('crosses an even-sided n-gon, but not when n-gons delimit', () => {
        const t = tube(6, true)
        // Crossing the hexagonal cap from (t0,t1) lands on the edge three corners along, (t3,t4); crossing
        // the quad below lands on (b0,b1). The ring closes through the bottom cap: four edges.
        expect(ids(walkEdgeRing(t.topRing(0))))
            .toEqual(ids([t.topRing(0), t.topRing(3), t.bottomRing(0), t.bottomRing(3)]))
        // With n-gons delimited only quads are crossed, so the ring is the two edges of that one quad.
        expect(ids(walkEdgeRing(t.topRing(0), {delimitNgons: true})))
            .toEqual(ids([t.topRing(0), t.bottomRing(0)]))
        expect(t.bm.validate()).toEqual([])
    })

    it('stops on wire and non-manifold edges', () => {
        const {bm, edges} = wirePath()
        expect(walkEdgeRing(edges[1])).toEqual([edges[1]])
        expect(bm.validate()).toEqual([])

        const nm = nonManifoldFan()
        expect(walkEdgeRing(nm.shared)).toEqual([nm.shared])
        expect(nm.bm.validate()).toEqual([])
    })
})

describe('walkFaceLoop', () => {
    it('takes the column of quads a horizontal edge cuts across', () => {
        const g = grid(4, 3)
        expect(ids(walkFaceLoop(g.h(1, 1)))).toEqual(ids([g.f(1, 0), g.f(1, 1), g.f(1, 2)]))
        expect(g.bm.validate()).toEqual([])
    })

    it('takes the row of quads a vertical edge cuts across', () => {
        const g = grid(4, 3)
        expect(ids(walkFaceLoop(g.w(1, 1)))).toEqual(ids([g.f(0, 1), g.f(1, 1), g.f(2, 1), g.f(3, 1)]))
        expect(g.bm.validate()).toEqual([])
    })

    it('refuses to start from a boundary, wire or non-manifold edge', () => {
        const g = grid(4, 3)
        // `bmw_FaceLoopWalker_edge_begins_loop` tests the boundary case first but then requires the edge to
        // be manifold, so a boundary edge never begins a face loop despite passing the first test.
        expect(walkFaceLoop(g.h(1, 0))).toEqual([])
        expect(g.bm.validate()).toEqual([])

        const {bm, edges} = wirePath()
        expect(walkFaceLoop(edges[1])).toEqual([])
        expect(bm.validate()).toEqual([])

        const nm = nonManifoldFan()
        expect(walkFaceLoop(nm.shared)).toEqual([])
        expect(nm.bm.validate()).toEqual([])
    })

    it('terminates on a closed face loop, yielding the first face twice', () => {
        const t = tube(8)
        expect(ids(walkFaceLoop(t.vertical(0)))).toEqual(ids(t.side))
        // The raw walk comes back to the first face through the other edge, and `include_face` only
        // rejects a face reached through an edge it was already reached by, so it is yielded again.
        const raw = [...walkFaceLoopIter(t.vertical(0))]
        expect(raw.length).toBe(9)
        expect(new Set(raw).size).toBe(8)
        expect(t.bm.validate()).toEqual([])
    })
})

describe('walkEdgeBoundary', () => {
    it('takes every boundary edge of a grid', () => {
        const g = grid(4, 3)
        const walked = walkEdgeBoundary(g.h(0, 0))
        expect(ids(walked)).toEqual(ids(g.boundary()))
        expect(walked.length).toBe(2 * (g.cols + g.rows))
        expect(g.bm.validate()).toEqual([])
    })

    it('takes one ring of a tube and not the other', () => {
        const t = tube(8)
        expect(ids(walkEdgeBoundary(t.topRing(0)))).toEqual(ids(t.topRings()))
        expect(ids(walkEdgeBoundary(t.bottomRing(3)))).toEqual(ids(t.bottomRings()))
        expect(t.bm.validate()).toEqual([])
    })

    it('rejects a seed that is not a boundary edge', () => {
        const g = grid(4, 3)
        expect(() => walkEdgeBoundary(g.h(1, 1))).toThrow(/not a boundary edge/)
        const {edges} = wirePath()
        expect(() => walkEdgeBoundary(edges[0])).toThrow(/not a boundary edge/)
        const nm = nonManifoldFan()
        expect(() => walkEdgeBoundary(nm.shared)).toThrow(/not a boundary edge/)
        expect(g.bm.validate()).toEqual([])
    })
})

describe('walkIsland and walkLoopShell', () => {
    it('takes the connected face region and stops at the component edge', () => {
        const bm = new BMesh()
        const a = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0)]
        const b = [bm.vertCreate(5, 0, 0), bm.vertCreate(6, 0, 0), bm.vertCreate(6, 1, 0), bm.vertCreate(5, 1, 0)]
        const fa = bm.faceCreate(a)
        bm.faceCreate(b)
        expect(walkIsland(fa)).toEqual([fa])

        const g = grid(3, 2)
        expect(ids(walkIsland(g.f(0, 0)))).toEqual(ids([...g.bm.faces]))
        expect(g.bm.validate()).toEqual([])
        expect(bm.validate()).toEqual([])
    })

    it('crosses a non-manifold edge only when manifold-only is off', () => {
        const nm = nonManifoldFan()
        expect(ids(walkIsland(nm.faces[0]))).toEqual(ids(nm.faces))
        // With `only_manifold` the shared edge has three faces, so it is not crossed at all.
        expect(walkIsland(nm.faces[0], true)).toEqual([nm.faces[0]])
        expect(nm.bm.validate()).toEqual([])
    })

    it('takes every loop of a shell', () => {
        const g = grid(3, 2)
        const loops = walkLoopShell(g.v(1, 1))
        expect(loops.length).toBe(g.bm.totloop)
        expect(new Set(loops).size).toBe(loops.length)

        const t = tube(8)
        expect(walkLoopShell(t.side[0]).length).toBe(t.bm.totloop)
        expect(g.bm.validate()).toEqual([])
        expect(t.bm.validate()).toEqual([])
    })
})

describe('delimiters', () => {
    it('cuts an edge loop short at a seam', () => {
        const g = grid(4, 3)
        const seam = g.h(2, 1)
        seam.setFlag(ElemFlag.Seam, true)

        // Control: the delimiter has to be asked for.
        expect(ids(walkEdgeLoop(g.h(0, 1)))).toEqual(ids(g.row(1)))

        // Blender stops *before* the vertex that touches a marked edge, so the seam edge is not reached.
        expect(ids(walkEdgeLoop(g.h(0, 1), {delimitSeam: true}))).toEqual(ids([g.h(0, 1), g.h(1, 1)]))
        expect(ids(walkEdgeLoop(g.h(3, 1), {delimitSeam: true}))).toEqual(ids([g.h(3, 1)]))
        // Starting *on* the mark is the other half of `bmw_EdgeLoopWalker_delimit_by_mark`: the walk stops
        // as soon as the next edge is unmarked, so it selects the marked edge alone.
        expect(walkEdgeLoop(seam, {delimitSeam: true})).toEqual([seam])
        expect(g.bm.validate()).toEqual([])
    })

    it('cuts an edge loop short at a sharp edge', () => {
        const g = grid(4, 3)
        const sharp = g.h(2, 1)
        // Sharpness is the absence of the smooth flag, which `edgeCreate` sets on every new edge.
        expect(sharp.testFlag(ElemFlag.Smooth)).toBe(true)
        sharp.setFlag(ElemFlag.Smooth, false)

        expect(ids(walkEdgeLoop(g.h(0, 1)))).toEqual(ids(g.row(1)))
        expect(ids(walkEdgeLoop(g.h(0, 1), {delimitSharp: true}))).toEqual(ids([g.h(0, 1), g.h(1, 1)]))
        expect(walkEdgeLoop(sharp, {delimitSharp: true})).toEqual([sharp])
        // A seam delimiter must not react to a sharp edge, and vice versa.
        expect(ids(walkEdgeLoop(g.h(0, 1), {delimitSeam: true}))).toEqual(ids(g.row(1)))
        expect(g.bm.validate()).toEqual([])
    })

    it('cuts an edge ring short at a seam', () => {
        const g = grid(4, 3)
        g.h(1, 2).setFlag(ElemFlag.Seam, true)

        expect(ids(walkEdgeRing(g.h(1, 1)))).toEqual(ids(g.column(1)))
        // The ring includes the delimited edge but cannot step past it, so h(1,3) is left out.
        expect(ids(walkEdgeRing(g.h(1, 1), {delimitSeam: true})))
            .toEqual(ids([g.h(1, 0), g.h(1, 1), g.h(1, 2)]))
        expect(g.bm.validate()).toEqual([])
    })

    it('cuts a face loop short at a seam, one face earlier than the edge ring does', () => {
        const g = grid(4, 3)
        // h(1,2) separates f(1,1) from f(1,2).
        diskEdgeExists(g.v(1, 2), g.v(2, 2))!.setFlag(ElemFlag.Seam, true)
        expect(ids(walkFaceLoop(g.h(1, 1)))).toEqual(ids([g.f(1, 0), g.f(1, 1), g.f(1, 2)]))

        /*
         * The delimited face is *not* included, which is the opposite of what the edge ring walker does
         * with a delimited edge. `bmw_FaceLoopWalker_step` pushes the new state and then, on finding the
         * delimiter, overwrites its loop with the previous one (`lwalk->l = owalk.l`) and sets `no_calc`.
         * So the extra state re-yields the face the walk was already on, and the face across the seam is
         * never yielded at all.
         */
        expect(ids(walkFaceLoop(g.h(1, 1), {delimitSeam: true}))).toEqual(ids([g.f(1, 0), g.f(1, 1)]))
        const raw = [...walkFaceLoopIter(g.h(1, 1), {delimitSeam: true})]
        expect(raw.filter(f => f === g.f(1, 1)).length).toBe(2)
        expect(raw).not.toContain(g.f(1, 2))
        expect(g.bm.validate()).toEqual([])
    })

    it('walks both ways out of an edge ring stopped by a delimiter on the first pass', () => {
        const g = grid(4, 5)
        // Two seams, one on each side of the seed, so whichever direction `begin` rewinds in first ends
        // on a delimited edge with `no_calc` set. Reaching the other seam then depends on `begin` adding
        // the extra opposite-direction state (#157860); without it the ring collapses to one edge.
        g.h(1, 2).setFlag(ElemFlag.Seam, true)
        g.h(1, 4).setFlag(ElemFlag.Seam, true)

        expect(ids(walkEdgeRing(g.h(1, 3)))).toEqual(ids(g.column(1)))
        expect(ids(walkEdgeRing(g.h(1, 3), {delimitSeam: true})))
            .toEqual(ids([g.h(1, 2), g.h(1, 3), g.h(1, 4)]))
        // The stopped state and the added one both yield the edge they stopped on, which is the repeat
        // the array form removes.
        expect([...walkEdgeRingIter(g.h(1, 3), {delimitSeam: true})].length).toBe(4)
        expect(g.bm.validate()).toEqual([])
    })

    it('does not delimit a non-manifold edge in a ring, as Blender does not', () => {
        const nm = nonManifoldFan()
        nm.shared.setFlag(ElemFlag.Seam, true)
        // `bmw_EdgeringWalker_delimit_check` returns false for non-manifold edges before it looks at the
        // marks, so the seeded edge is still yielded rather than being treated as delimited.
        expect(walkEdgeRing(nm.shared, {delimitSeam: true})).toEqual([nm.shared])
        expect(nm.bm.validate()).toEqual([])
    })
})

describe('walkers do not mutate the mesh', () => {
    it('leaves every element and flag untouched', () => {
        const g = grid(4, 3)
        const before = {
            verts: [...g.bm.verts].map(v => v.id),
            edges: [...g.bm.edges].map(e => [e.id, e.hflag, e.v1.id, e.v2.id]),
            faces: [...g.bm.faces].map(f => [f.id, f.hflag, f.len]),
            loops: g.bm.totloop,
        }

        walkVertShellEdges(g.v(1, 1))
        walkEdgeLoop(g.h(1, 1))
        walkEdgeRing(g.h(1, 1))
        walkFaceLoop(g.h(1, 1))
        walkEdgeBoundary(g.h(0, 0))
        walkIsland(g.f(0, 0))
        walkLoopShell(g.v(1, 1))

        expect([...g.bm.verts].map(v => v.id)).toEqual(before.verts)
        expect([...g.bm.edges].map(e => [e.id, e.hflag, e.v1.id, e.v2.id])).toEqual(before.edges)
        expect([...g.bm.faces].map(f => [f.id, f.hflag, f.len])).toEqual(before.faces)
        expect(g.bm.totloop).toBe(before.loops)
        expect(g.bm.validate()).toEqual([])
    })
})

describe('a real Blender mesh', () => {
    /**
     * The UV sphere from `tests/fixtures/blend-load-test-prim.json`, which Blender itself wrote: 32
     * segments and 16 rings, so 480 latitude edges, 448 interior vertical edges, 64 pole spokes, 448
     * quads and 64 triangles. Every count below follows from that layout, and every edge is walked.
     */
    it('walks every edge of a 482-vertex sphere with the lengths its layout implies', () => {
        const {bm} = blenderSphere()
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([482, 992, 512])

        const poles = [...bm.verts].filter(v => diskCount(v) === 32)
        expect(poles.length).toBe(2)
        // The axis the poles lie on, so "latitude" can be decided without assuming Blender's up axis.
        const axis = ['x', 'y', 'z'].find(k => Math.abs((poles[0] as never)[k] - (poles[1] as never)[k]) > 1) as 'z'
        const level = (v: BMVert) => Math.round(v[axis] * 1e4)

        const counts = {spoke: 0, latitude: 0, vertical: 0}
        for (const e of bm.edges) {
            const touchesPole = poles.includes(e.v1) || poles.includes(e.v2)
            const isLatitude = !touchesPole && level(e.v1) === level(e.v2)

            const loop = walkEdgeLoop(e)
            const ring = walkEdgeRing(e)
            expect(loop).toContain(e)
            expect(ring).toContain(e)
            expect(new Set(loop).size).toBe(loop.length)
            expect(new Set(ring).size).toBe(ring.length)

            if (touchesPole) {
                counts.spoke++
                // Pole to pole down one segment: 16 edges. The ring cannot leave, because the faces on a
                // spoke are triangles and an odd-sided face is never crossed.
                expect(loop.length).toBe(16)
                expect(ring).toEqual([e])
            } else if (isLatitude) {
                counts.latitude++
                // All the way round one line of latitude, and up the column as far as the triangle fans.
                expect(loop.length).toBe(32)
                expect(new Set(loop.map(x => level(x.v1))).size).toBe(1)
                expect(ring.length).toBe(15)
            } else {
                counts.vertical++
                expect(loop.length).toBe(16)
                expect(ring.length).toBe(32)
            }
        }
        expect(counts).toEqual({spoke: 64, latitude: 480, vertical: 448})
    })

    it('walks the sphere shell, boundary and islands', () => {
        const {bm} = blenderSphere()
        const v = bm.vertAt(0)
        expect(walkVertShellEdges(v).length).toBe(bm.totedge)
        expect(walkVertShell(v).length).toBe(bm.totvert)
        expect(walkIsland(bm.faceAt(0)).length).toBe(bm.totface)
        // A closed sphere has no boundary edge to seed a boundary walk with.
        expect([...bm.edges].filter(edgeIsBoundary)).toEqual([])
        expect(bm.validate()).toEqual([])
    })
})
