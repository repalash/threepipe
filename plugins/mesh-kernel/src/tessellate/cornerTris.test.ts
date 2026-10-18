import {describe, expect, it} from 'vitest'
import {MeshData} from '../MeshData'
import {cornerTrisCalc, cornerTriFaces, polyToTriCount} from './cornerTris'
import {crossPolyV2, polyfillCalc} from '../math/polyfill2d'
import {polyfillBeautify} from '../math/polyfill2dBeautify'

/** Signed area of a 2D triangle, Blender's `area_tri_signed_v2` sense (positive counter-clockwise). */
function area2(c: ArrayLike<number>, a: number, b: number, d: number): number {
    return ((c[b * 2] - c[a * 2]) * (c[d * 2 + 1] - c[a * 2 + 1]) - (c[d * 2] - c[a * 2]) * (c[b * 2 + 1] - c[a * 2 + 1])) / 2
}

describe('BLI_polyfill_calc (polyfill_2d.cc)', () => {
    it('clips a convex polygon with USE_CLIP_EVEN: ear 0, then the vertex two along, then the rest', () => {
        // Hand-traced from `pf_triangulate` (:642): no concave vertex, so every candidate is an ear
        // (`pf_ear_tip_check` :839 fast path); after each cut the next candidate is `next->next`.
        const ccw = [0, 0, 2, 0, 3, 1, 1, 3, -1, 1]
        // Pass clockwise order explicitly (coords_sign 1) as mesh tessellation does after projection.
        const cw: number[] = []
        for (let i = 4; i >= 0; i--) cw.push(ccw[i * 2], ccw[i * 2 + 1])
        expect(crossPolyV2(cw, 5)).toBeLessThan(0)
        expect(Array.from(polyfillCalc(cw, 5, 1))).toEqual([4, 0, 1, 1, 2, 3, 1, 3, 4])
    })

    it('detects winding when coords_sign is 0 and lists indices reversed for counter-clockwise input', () => {
        const ccw = [0, 0, 2, 0, 3, 1, 1, 3, -1, 1]
        expect(crossPolyV2(ccw, 5)).toBeGreaterThan(0)
        // Reversed list (`polyfill_prepare` :1015): index(i) = n - 1 - i, then the same clipping order.
        expect(Array.from(polyfillCalc(ccw, 5, 0))).toEqual([0, 4, 3, 3, 2, 1, 3, 1, 0])
    })

    it('fills a concave polygon with n - 2 non-overlapping triangles covering its area', () => {
        // A "comb" with three reflex vertices, clockwise.
        const ccw = [0, 0, 6, 0, 6, 4, 5, 4, 5, 1, 4, 1, 4, 4, 2, 4, 2, 1, 1, 1, 1, 4, 0, 4]
        const n = ccw.length / 2
        const cw: number[] = []
        for (let i = n - 1; i >= 0; i--) cw.push(ccw[i * 2], ccw[i * 2 + 1])
        const tris = polyfillCalc(cw, n, 1)
        expect(tris.length).toBe((n - 2) * 3)
        let sum = 0
        for (let t = 0; t < n - 2; t++) {
            const a = area2(cw, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2])
            expect(a).toBeLessThanOrEqual(0) // every ear keeps the clockwise winding
            sum += a
        }
        expect(-sum).toBeCloseTo(Math.abs(crossPolyV2(cw, n)) / 2, 6)
    })

    it('beautify keeps a fill valid and rotates the long diagonal of a thin quad-like hexagon', () => {
        const ccw = [0, 0, 10, 0, 11, 0.5, 10, 1, 0, 1, -1, 0.5]
        const n = 6
        const cw: number[] = []
        for (let i = n - 1; i >= 0; i--) cw.push(ccw[i * 2], ccw[i * 2 + 1])
        const tris = polyfillCalc(cw, n, 1)
        const before = Array.from(tris)
        polyfillBeautify(cw, n, tris)
        let sum = 0
        for (let t = 0; t < n - 2; t++) sum += area2(cw, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2])
        expect(-sum).toBeCloseTo(Math.abs(crossPolyV2(cw, n)) / 2, 6)
        expect(new Set(Array.from(tris)).size).toBe(n)
        expect(before.length).toBe(tris.length)
    })
})

describe('corner_tris_calc (mesh_tessellate.cc)', () => {
    it('keeps triangles, splits quads 0-1-2 / 0-2-3 and ear-clips n-gons, in face order', () => {
        const mesh = MeshData.fromFaces({
            positions: [
                0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, // quad 0..3
                2, 0, 0, 4, 0, 0, 5, 1, 0, 3, 3, 0, 1, 1, 0, // pentagon 4..8, counter-clockwise from +Z
            ],
            faces: [[0, 1, 2], [0, 1, 2, 3], [4, 5, 6, 7, 8]],
        })
        const tris = cornerTrisCalc(mesh)
        expect(tris.length).toBe((mesh.cornersNum - 2 * mesh.facesNum) * 3)
        expect(Array.from(tris.subarray(0, 3))).toEqual([0, 1, 2])
        expect(Array.from(tris.subarray(3, 9))).toEqual([3, 4, 5, 3, 5, 6])
        // Pentagon corners start at 7. The negated dominant-axis projection (math_geom.cc:3663) mirrors
        // x, so the counter-clockwise face reads clockwise and is clipped as in the convex case above.
        expect(Array.from(tris.subarray(9))).toEqual([11, 7, 8, 8, 9, 10, 8, 10, 11])
        expect(Array.from(cornerTriFaces(mesh))).toEqual([0, 1, 1, 2, 2, 2])
        expect(polyToTriCount(2, 7)).toBe(3)
    })

    it('flips a quad out of the degenerate 0-2 diagonal (is_quad_flip_v3_first_third_fast)', () => {
        // Vertex 3 is reflex, on the same side of the 1-3 diagonal as vertex 1, so the 0-2 diagonal
        // leaves the quad: d12 x d13 and d14 x d13 point the same way and their dot is positive.
        const mesh = MeshData.fromFaces({positions: [0, 0, 0, 2, 0, 0, 2, 2, 0, 1.5, 0.5, 0], faces: [[0, 1, 2, 3]]})
        expect(Array.from(cornerTrisCalc(mesh))).toEqual([0, 1, 3, 1, 2, 3])
    })
})
