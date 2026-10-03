import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMEdge, BMVert} from './types'
import {edgeIsBoundary} from './structure'
import {
    edgeloopCalcCenter,
    edgeloopCalcNormal,
    edgeloopEdgesGet,
    edgeloopExpand,
    edgeloopFromVerts,
    edgeloopsCalcOrder,
    edgeloopsFind,
    edgeloopsFindPath,
} from './edgeloop'
import {foreachSparseRange} from '../math/geom'
import {edgeSplit, faceSplit} from './mods'
import {ElemFlag, SelectMode} from '../constants'
import {edgeSelectSet, selectModeFlush} from './marking'

/** An `n` x `m` grid of quads in the XY plane; vertex (x, y) is `verts[y * (n + 1) + x]`. */
function grid(bm: BMesh, n: number, m: number): BMVert[] {
    const verts: BMVert[] = []
    for (let y = 0; y <= m; y++) for (let x = 0; x <= n; x++) verts.push(bm.vertCreate(x, y, 0))
    for (let y = 0; y < m; y++) {
        for (let x = 0; x < n; x++) {
            const a = y * (n + 1) + x
            bm.faceCreate([verts[a], verts[a + 1], verts[a + n + 2], verts[a + n + 1]])
        }
    }
    return verts
}

function ring(bm: BMesh, n: number, z = 0, r = 1): {verts: BMVert[], edges: BMEdge[]} {
    const verts: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        verts.push(bm.vertCreate(r * Math.cos(a), r * Math.sin(a), z))
    }
    const edges = verts.map((v, i) => bm.edgeCreate(v, verts[(i + 1) % n]))
    return {verts, edges}
}

describe('BLI_FOREACH_SPARSE_RANGE', () => {
    it('spreads dst picks over src as the macro does', () => {
        // Worked by hand from `BLI_utildefines_iter.h:28` with `divide_floor_i`.
        expect([...foreachSparseRange(5, 3)]).toEqual([0, 2, 4])
        expect([...foreachSparseRange(4, 4)]).toEqual([0, 1, 2, 3])
        expect([...foreachSparseRange(7, 1)]).toEqual([3])
        expect([...foreachSparseRange(3, 0)]).toEqual([])
        for (let src = 1; src < 12; src++) {
            for (let dst = 0; dst <= src; dst++) {
                const picks = [...foreachSparseRange(src, dst)]
                expect(picks.length).toBe(dst)
                expect(new Set(picks).size).toBe(dst)
                expect(picks.every(i => i >= 0 && i < src)).toBe(true)
            }
        }
    })
})

describe('BM_mesh_edgeloops_find', () => {
    it('finds the closed boundary of a grid, in chain order', () => {
        const bm = new BMesh()
        grid(bm, 3, 2)
        const loops = edgeloopsFind(bm, edgeIsBoundary)
        expect(loops.length).toBe(1)
        expect(loops[0].closed).toBe(true)
        expect(loops[0].len).toBe(10)
        // Every consecutive pair (and the closing pair) shares an edge.
        expect(edgeloopEdgesGet(loops[0]).length).toBe(10)
    })

    it('finds separate rings and open chains, and drops branches', () => {
        const bm = new BMesh()
        ring(bm, 5, 0)
        ring(bm, 7, 1)
        // An open chain of three edges.
        const c = [0, 1, 2, 3].map(i => bm.vertCreate(i, 5, 0))
        for (let i = 0; i < 3; i++) bm.edgeCreate(c[i], c[i + 1])
        // A Y: three edges meeting at one vertex - the walk fails at the branch.
        const y0 = bm.vertCreate(10, 0, 0)
        for (let i = 0; i < 3; i++) bm.edgeCreate(y0, bm.vertCreate(11, i, 0))

        const loops = edgeloopsFind(bm, () => true)
        const summary = loops.map(l => [l.len, l.closed]).sort((a, b) => (a[0] as number) - (b[0] as number))
        expect(summary).toEqual([[4, false], [5, true], [7, true]])
        const open = loops.find(l => !l.closed)!
        expect([open.first, open.last].sort((a, b) => a.x - b.x)).toEqual([c[0], c[3]])
    })
})

describe('BM_mesh_edgeloops_find_path', () => {
    it('finds a shortest chain between two vertices', () => {
        const bm = new BMesh()
        const v = grid(bm, 3, 3)
        const path = edgeloopsFindPath(bm, null, v[0], v[15])!
        expect(path).not.toBeNull()
        expect(path.first).toBe(v[0])
        expect(path.last).toBe(v[15])
        // Manhattan distance 6 on a grid: 7 vertices.
        expect(path.len).toBe(7)
        expect(edgeloopEdgesGet(path).length).toBe(6)
    })

    it('respects the edge test and fails when the ends are not connected', () => {
        const bm = new BMesh()
        const v = grid(bm, 3, 3)
        // Only boundary edges: the path goes round the outside.
        const p = edgeloopsFindPath(bm, edgeIsBoundary, v[0], v[15])!
        expect(p.len).toBe(7)
        for (const vert of p.verts) {
            const x = vert.x, y = vert.y
            expect(x === 0 || x === 3 || y === 0 || y === 3).toBe(true)
        }
        const lone = bm.vertCreate(9, 9, 9)
        expect(edgeloopsFindPath(bm, null, v[0], lone)).toBeNull()
    })
})

describe('BM_edgeloop_calc_center / _normal / calc_order', () => {
    it('weights the centre by edge length', () => {
        const bm = new BMesh()
        const {verts} = ring(bm, 6, 2, 3)
        const s = edgeloopFromVerts(verts, true)
        edgeloopCalcCenter(s)
        expect(s.co[0]).toBeCloseTo(0, 12)
        expect(s.co[1]).toBeCloseTo(0, 12)
        expect(s.co[2]).toBeCloseTo(2, 12)
        expect(edgeloopCalcNormal(s)).toBe(true)
        expect(s.no).toEqual([0, 0, 1].map(x => expect.closeTo(x, 12)))
    })

    it('a degenerate loop gets +Z and reports failure', () => {
        const bm = new BMesh()
        const vs = [0, 1, 2].map(i => bm.vertCreate(i, 0, 0))
        const s = edgeloopFromVerts(vs, false)
        expect(edgeloopCalcNormal(s)).toBe(false)
        expect(s.no).toEqual([0, 0, 1])
    })

    it('orders loops from the outermost, nearest next', () => {
        const bm = new BMesh()
        const stores = [0, 3, 1, 2].map(z => {
            const s = edgeloopFromVerts(ring(bm, 4, z).verts, true)
            edgeloopCalcCenter(s)
            edgeloopCalcNormal(s)
            return s
        })
        const ordered = edgeloopsCalcOrder(stores, false)
        expect(ordered.map(s => Math.round(s.co[2]))).toEqual([0, 1, 2, 3])
    })
})

describe('BM_edgeloop_expand', () => {
    it('without split, repeats vertices where the sparse range picks them', () => {
        const bm = new BMesh()
        const {verts} = ring(bm, 4)
        const s = edgeloopFromVerts(verts, true)
        edgeloopExpand(bm, s, 7, false, null)
        // 4 -> 7: no doubling pass (8 > 7), then 3 copies at sparse indices [0, 1, 3] of 4
        // (by hand: error 2, -6, -8, -4 with divide_floor_i).
        expect([...foreachSparseRange(4, 3)]).toEqual([0, 1, 3])
        expect(s.verts).toEqual([verts[0], verts[0], verts[1], verts[1], verts[2], verts[3], verts[3]])
    })

    it('with split, cuts the next edge for each copy and records the new edges', () => {
        const bm = new BMesh()
        const {verts} = ring(bm, 4)
        const s = edgeloopFromVerts(verts, true)
        const split = new Set<BMEdge>()
        edgeloopExpand(bm, s, 10, true, split)
        expect(s.len).toBe(10)
        expect(bm.totvert).toBe(10)
        expect(bm.totedge).toBe(10)
        expect(split.size).toBe(6)
        // Still a chain: each consecutive pair is joined.
        expect(edgeloopEdgesGet(s).length).toBe(10)
        expect(bm.validate()).toEqual([])
    })

    it('with split on an open chain, the last vertex splits backwards', () => {
        const bm = new BMesh()
        const vs = [0, 1, 2].map(i => bm.vertCreate(i, 0, 0))
        bm.edgeCreate(vs[0], vs[1])
        bm.edgeCreate(vs[1], vs[2])
        const s = edgeloopFromVerts(vs, false)
        edgeloopExpand(bm, s, 6, true, new Set())
        expect(s.len).toBe(6)
        expect(s.first).toBe(vs[0])
        expect(s.last).toBe(vs[2])
        expect(edgeloopEdgesGet(s).length).toBe(5)
        expect(bm.validate()).toEqual([])
    })
})

describe('BM_face_split', () => {
    it('refuses adjacent loops and returns Blender\'s r_l', () => {
        const bm = new BMesh()
        const vs = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => bm.vertCreate(x, y, 0))
        const f = bm.faceCreate(vs)
        const l = [...f.eachLoop()]
        expect(faceSplit(bm, f, l[0], l[1])).toBeNull()
        const r = faceSplit(bm, f, l[0], l[2])!
        expect(r).not.toBeNull()
        expect(r.lNew.f).toBe(r.fNew)
        expect(r.lNew.e).toBe(r.eNew)
        expect(r.lNew.v).toBe(vs[0])
        expect(r.lNew.next.v).toBe(vs[2])
        expect(r.lNew.radialNext.f).toBe(f)
        expect(bm.validate()).toEqual([])
    })
})

describe('BM_edge_split', () => {
    it('gives the new half the split edge\'s header flags raw, select included; the flush recounts', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const vs = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => bm.vertCreate(x, y, 0))
        const f = bm.faceCreate(vs)
        const l = [...f.eachLoop()]
        const e = l[0].e!
        edgeSelectSet(bm, e, true)
        e.hflag |= ElemFlag.Seam
        const {vNew, eNew} = edgeSplit(bm, e, vs[0], 0.25)
        expect(vNew.x).toBeCloseTo(0.25, 12)
        expect(eNew.hflag & ElemFlag.Select).toBe(ElemFlag.Select)
        expect(eNew.hflag & ElemFlag.Seam).toBe(ElemFlag.Seam)
        // `bmesh_marking.cc:531`: the default flush recounts what the raw copy did not. The new
        // vertex is not selected (SEMV's `BM_vert_create` example copy skips the select bit) and an
        // edge-mode flush only goes up, so it stays that way - as in Blender, where the caller
        // (subdivide, bridge's cuts) selects what it wants afterwards.
        expect(bm.totedgesel).toBe(1)
        selectModeFlush(bm)
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([2, 2, 0])
        expect(bm.validate()).toEqual([])
    })
})
