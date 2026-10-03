/**
 * Hand-checked behaviour of the triangulate port (`bmesh_polygon.cc:1103` and friends). The quad
 * methods against Blender are in `tests/bmesh-ops-bridge-parity.test.ts` (`triangulate quads *`).
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {diskEdgeExists} from '../bmesh/structure'
import {faceNormalUpdate} from '../bmesh/polygon'
import {ElemFlag} from '../constants'
import {bmoTriangulateExec, faceCreateVerts, faceSwapData, faceTriangulate} from './triangulate'

function quad(bm: BMesh, pts: number[][]): {v: BMVert[], f: BMFace} {
    const v = pts.map(p => bm.vertCreate(p[0], p[1], p[2]))
    const f = bm.faceCreate(v)
    faceNormalUpdate(f)
    return {v, f}
}

/** A 3 x 1 rectangle: the 0-2 diagonal and the 1-3 diagonal have the same length. */
const RECT = [[0, 0, 0], [3, 0, 0], [3, 1, 0], [0, 1, 0]]
/** A kite: the 1-3 diagonal (length 2) is shorter than 0-2 (length 3). */
const KITE = [[0, 0, 0], [1.5, -1, 0], [3, 0, 0], [1.5, 1, 0]]

describe('faceCreateVerts (BM_face_create_verts, create_edges)', () => {
    it("creates the closing edge first, as BM_edges_from_verts_ensure's i_prev loop does", () => {
        const bm = new BMesh()
        const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0)]
        const f = faceCreateVerts(bm, v, null, true)!
        expect([...bm.edges].map(e => [e.v1, e.v2])).toEqual([[v[2], v[0]], [v[0], v[1]], [v[1], v[2]]])
        expect(f.verts()).toEqual(v)
    })

    it('without create_edges returns null when an edge is missing', () => {
        const bm = new BMesh()
        const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0)]
        bm.edgeCreate(v[0], v[1])
        bm.edgeCreate(v[1], v[2])
        expect(faceCreateVerts(bm, v, null, false)).toBeNull()
        bm.edgeCreate(v[2], v[0])
        expect(faceCreateVerts(bm, v, null, false)).not.toBeNull()
    })
})

describe('faceSwapData (bmesh_face_swap_data)', () => {
    it('swaps loops, length, normal, material and header flags but not the attribute block', () => {
        const bm = new BMesh()
        const a = quad(bm, RECT)
        const tv = [bm.vertCreate(5, 0, 0), bm.vertCreate(6, 0, 0), bm.vertCreate(5, 1, 1)]
        const t = bm.faceCreate(tv)
        faceNormalUpdate(t)
        a.f.matNr = 2
        a.f.hflag |= ElemFlag.Smooth
        const layer = bm.addLayer('face', 'w', 'float')
        a.f.fdata = new Float32Array([7])
        t.fdata = new Float32Array([9])
        const [an, tn] = [[a.f.nx, a.f.ny, a.f.nz], [t.nx, t.ny, t.nz]]

        faceSwapData(a.f, t)
        expect(a.f.len).toBe(3)
        expect(a.f.verts()).toEqual(tv)
        expect(t.verts()).toEqual(a.v)
        expect(a.f.loops().every(l => l.f === a.f)).toBe(true)
        expect(t.loops().every(l => l.f === t)).toBe(true)
        expect([a.f.nx, a.f.ny, a.f.nz]).toEqual(tn)
        expect([t.nx, t.ny, t.nz]).toEqual(an)
        expect([a.f.matNr, t.matNr]).toEqual([0, 2])
        expect(t.testFlag(ElemFlag.Smooth)).toBe(true)
        expect(a.f.testFlag(ElemFlag.Smooth)).toBe(false)
        // `head.data` swapped back
        expect([a.f.fdata![layer.offset], t.fdata![layer.offset]]).toEqual([7, 9])
        expect(bm.validate()).toEqual([])
    })
})

describe('faceTriangulate quad methods (bmesh_polygon.cc:1143-1214)', () => {
    const diag = (method: Parameters<typeof faceTriangulate>[2], pts: number[][]) => {
        const bm = new BMesh()
        const {v, f} = quad(bm, pts)
        const r = faceTriangulate(bm, f, method, 'BEAUTY', false)
        expect(bm.totface).toBe(2)
        expect(bm.faces.has(f)).toBe(true)
        expect(r.facesNew).toHaveLength(1)
        expect(r.edgesNew).toHaveLength(1)
        expect(bm.validate()).toEqual([])
        return diskEdgeExists(v[0], v[2]) ? '0-2' : diskEdgeExists(v[1], v[3]) ? '1-3' : 'none'
    }

    it('FIXED splits from the first corner, ALTERNATE from the second', () => {
        expect(diag('FIXED', KITE)).toBe('0-2')
        expect(diag('ALTERNATE', KITE)).toBe('1-3')
    })

    it('SHORT_EDGE / LONG_EDGE pick the shorter / longer diagonal; a tie goes to 1-3 for both', () => {
        expect(diag('SHORT_EDGE', KITE)).toBe('1-3')
        expect(diag('LONG_EDGE', KITE)).toBe('0-2')
        // equal lengths: `split_24` is `(d2 - d1) > 0` / `< 0`, false either way, which keeps the
        // l_v1-l_v3 diagonal, 1-3 (l_v1 = first->next, l_v3 = first->prev)
        expect(diag('SHORT_EDGE', RECT)).toBe('1-3')
        expect(diag('LONG_EDGE', RECT)).toBe('1-3')
    })

    it('BEAUTY never cuts across the reflex corner of a concave quad', () => {
        // concave at corner 2: only 0-2 splits it into two valid triangles
        expect(diag('BEAUTY', [[0, 0, 0], [2, -1, 0], [0.5, 0, 0], [2, 1, 0]])).toBe('0-2')
        // concave at corner 3: only 1-3 does
        expect(diag('BEAUTY', [[0, 0, 0], [2, 0, 0], [2, 2, 0], [1.6, 0.4, 0]])).toBe('1-3')
    })

    it('keeps the original face as the last triangle and copies its corners', () => {
        const bm = new BMesh()
        const {v, f} = quad(bm, KITE)
        const uv = bm.addLayer('loop', 'uv', 'float2')
        f.loops().forEach((l, i) => { l.fdata = new Float32Array([i, 10 + i]) })
        faceTriangulate(bm, f, 'FIXED', 'BEAUTY', false)
        for (const face of bm.faces) {
            for (const l of face.loops()) {
                const i = v.indexOf(l.v)
                expect([l.fdata![uv.offset], l.fdata![uv.offset + 1]]).toEqual([i, 10 + i])
            }
        }
    })

    it('with use_tag tags the new face and the new edge, never the original face', () => {
        const bm = new BMesh()
        const {f} = quad(bm, KITE)
        const r = faceTriangulate(bm, f, 'BEAUTY', 'BEAUTY', true)
        expect(r.facesNew[0].testFlag(ElemFlag.Tag)).toBe(true)
        expect(f.testFlag(ElemFlag.Tag)).toBe(false)
        expect(r.edgesNew[0].testFlag(ElemFlag.Tag)).toBe(true)
    })

    it('throws on an n-gon rather than guess (BLI_polyfill is not ported)', () => {
        const bm = new BMesh()
        const v = [0, 1, 2, 3, 4].map(i => bm.vertCreate(Math.cos(i), Math.sin(i), 0))
        const f = bm.faceCreate(v)
        expect(() => faceTriangulate(bm, f, 'BEAUTY', 'BEAUTY', false)).toThrow(/not ported/)
    })
})

describe('bmoTriangulateExec (bmo_triangulate.cc:29)', () => {
    it('clears every face and edge tag first, then outputs exactly the tagged result', () => {
        const bm = new BMesh()
        const a = quad(bm, KITE)
        const b = quad(bm, [[5, 0, 0], [6, 0, 0], [6, 1, 0], [5, 1, 0]])
        b.f.hflag |= ElemFlag.Tag
        for (const e of bm.edges) e.hflag |= ElemFlag.Tag
        const r = bmoTriangulateExec(bm, [a.f])
        // b is not input: untagged and untouched
        expect(b.f.len).toBe(4)
        expect(b.f.testFlag(ElemFlag.Tag)).toBe(false)
        // faces.out: the two triangles of a (the input face is tagged by the operator)
        expect(r.faces).toHaveLength(2)
        expect(r.faces).toContain(a.f)
        // edges.out: only the new diagonal
        expect(r.edges).toHaveLength(1)
        expect(r.faceMap.get(a.f)).toBe(a.f)
    })
})
