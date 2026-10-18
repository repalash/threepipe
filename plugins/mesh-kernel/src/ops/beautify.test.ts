/**
 * Hand-checked behaviour of the beautify / edge-rotate port. Whole-operator results against Blender
 * are in `tests/bmesh-ops-bridge-parity.test.ts` (`beautify fans *`, `rotate *`, and every uneven
 * bridge).
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMVert} from '../bmesh/types'
import {diskEdgeExists} from '../bmesh/structure'
import {ElemFlag} from '../constants'
import {Vec2} from '../math/geom'
import {
    BM_EDGEROT_CHECK_BEAUTY, BM_EDGEROT_CHECK_DEGENERATE, BM_EDGEROT_CHECK_EXISTS, FLT_MAX, VERT_RESTRICT_TAG,
    edgeRotate, edgeRotateCheck, polyfillBeautifyQuadRotateCalcEx, vertsCalcRotateBeauty,
} from './beautify'

/** Two triangles `(0, 1, 2)` and `(0, 2, 3)` sharing the 0-2 diagonal of the quad `pts`. */
function pair(pts: number[][]) {
    const bm = new BMesh()
    const v: BMVert[] = pts.map(p => bm.vertCreate(p[0], p[1], p[2] ?? 0))
    bm.faceCreate([v[0], v[1], v[2]])
    bm.faceCreate([v[0], v[2], v[3]])
    return {bm, v, e: diskEdgeExists(v[0], v[2])!}
}

describe('BLI_polyfill_beautify_quad_rotate_calc_ex (polyfill_2d_beautify.cc:89)', () => {
    const calc = (q: number[][], lock = false) => polyfillBeautifyQuadRotateCalcEx(
        q[0] as Vec2, q[1] as Vec2, q[2] as Vec2, q[3] as Vec2, lock, null)

    it('is zero for a square (both diagonals are equally good)', () => {
        expect(calc([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(0, 12)
    })

    it('is negative when the 1-3 diagonal is the better one', () => {
        // a rhombus long along 2-4: the current 2-4 diagonal makes two slivers
        expect(calc([[0, -0.2], [3, 0], [0, 0.2], [-3, 0]])).toBeLessThan(0)
        // the same rhombus with the short diagonal current
        expect(calc([[3, 0], [0, 0.2], [-3, 0], [0, -0.2]])).toBeGreaterThan(0)
    })

    it('returns FLT_MAX when 1-3 would make a flipped or zero-area triangle', () => {
        // a chevron with its notch at 2: the 1-3 diagonal runs outside it
        expect(calc([[2, -1], [0.5, 0], [2, 1], [0, 0]])).toBe(FLT_MAX)
    })

    it('returns -FLT_MAX (always rotate) out of an unusable 2-4, unless degenerates are locked', () => {
        // the chevron with its notch at 1: the current 2-4 diagonal is the outside one
        const q = [[0.5, 0], [2, 1], [0, 0], [2, -1]]
        expect(calc(q)).toBe(-FLT_MAX)
        expect(calc(q, true)).toBe(FLT_MAX)
    })

    it('reports the area (both diagonals\' triangles, / 8)', () => {
        const area = {area: 0}
        polyfillBeautifyQuadRotateCalcEx([0, 0], [2, 0], [2, 1], [0, 1], false, area)
        // each pair of triangles covers the 2 x 1 rectangle: (2 + 2) * 2 / 8
        expect(area.area).toBeCloseTo(1, 12)
    })
})

describe('BM_verts_calc_rotate_beauty (bmesh_beautify.cc:171)', () => {
    it('with VERT_RESTRICT_TAG only allows joining a tagged and an untagged vertex', () => {
        const {v} = pair([[3, 0], [0, 0.2], [-3, 0], [0, -0.2]])
        // the quad v1 v2 v3 v4 of `bm_edge_calc_rotate_beauty`, rotating 2-4 to 1-3
        const cost = () => vertsCalcRotateBeauty(v[1], v[0], v[3], v[2], VERT_RESTRICT_TAG, 0)
        expect(cost()).toBe(FLT_MAX)
        v[1].hflag |= ElemFlag.Tag
        expect(cost()).toBeLessThan(0)
        v[3].hflag |= ElemFlag.Tag
        expect(cost()).toBe(FLT_MAX)
    })

    it('by angle is the change in the angle between the two triangle normals', () => {
        // a quad folded along its 0-2 diagonal
        const {v} = pair([[0, 0, 0], [1, -1, 0], [2, 0, 0], [1, 1, 1]])
        const cost = vertsCalcRotateBeauty(v[1], v[0], v[3], v[2], 0, 1)
        // `normal_tri_v3` and the angle between normals, by hand
        const n = (a: number[], b: number[], c: number[]) => {
            const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], w = [b[0] - c[0], b[1] - c[1], b[2] - c[2]]
            const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
            const l = Math.hypot(...x)
            return x.map(t => t / l)
        }
        const ang = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
        const P = [[0, 0, 0], [1, -1, 0], [2, 0, 0], [1, 1, 1]]
        // v1 = P1, v2 = P0, v3 = P3, v4 = P2
        const a24 = ang(n(P[0], P[3], P[2]), n(P[0], P[2], P[1]))
        const a13 = ang(n(P[1], P[0], P[3]), n(P[1], P[3], P[2]))
        expect(cost).toBeCloseTo(a13 - a24, 10)
    })
})

describe('BM_edge_rotate (bmesh_mods.cc:766)', () => {
    it('refuses a boundary edge (BM_edge_rotate_check)', () => {
        const {v} = pair([[0, 0], [1, -1], [2, 0], [1, 1]])
        expect(edgeRotateCheck(diskEdgeExists(v[0], v[1])!)).toBe(false)
    })

    it('CHECK_EXISTS refuses when the rotated edge is already there', () => {
        const {bm, v, e} = pair([[0, 0], [1, -1], [2, 0], [1, 1]])
        bm.edgeCreate(v[1], v[3])
        expect(edgeRotate(bm, e, false, BM_EDGEROT_CHECK_EXISTS)).toBeNull()
        expect(bm.edges.has(e)).toBe(true)
        expect(bm.totface).toBe(2)
    })

    it('CHECK_BEAUTY refuses to make a longer edge', () => {
        const {bm, e} = pair([[0, 0], [1, -3], [2, 0], [1, 3]])
        expect(edgeRotate(bm, e, false, BM_EDGEROT_CHECK_BEAUTY)).toBeNull()
        const b = pair([[0, 0], [3, -1], [6, 0], [3, 1]])
        expect(edgeRotate(b.bm, b.e, false, BM_EDGEROT_CHECK_BEAUTY)).not.toBeNull()
    })

    it('CHECK_DEGENERATE refuses a rotation that folds a triangle over', () => {
        // concave at vertex 2: the 1-3 diagonal leaves the quad
        const {bm, e} = pair([[0, 0], [2, -1], [0.5, 0], [2, 1]])
        expect(edgeRotate(bm, e, false, BM_EDGEROT_CHECK_DEGENERATE)).toBeNull()
        expect(bm.totface).toBe(2)
    })

    it('replaces the edge, keeps two triangles and the winding', () => {
        const {bm, v, e} = pair([[0, 0], [1, -1], [2, 0], [1, 1]])
        const eNew = edgeRotate(bm, e, false, BM_EDGEROT_CHECK_EXISTS)!
        expect(eNew.joins(v[1], v[3])).toBe(true)
        expect(bm.edges.has(e)).toBe(false)
        expect(bm.totface).toBe(2)
        // both triangles still wind counter-clockwise seen from +Z
        for (const f of bm.faces) {
            const [a, b, c] = f.verts()
            expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0)
        }
        expect(bm.validate()).toEqual([])
    })
})
