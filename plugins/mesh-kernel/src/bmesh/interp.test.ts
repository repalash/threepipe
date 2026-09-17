import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMFace, BMLoop, BMVert} from './types'
import {splitEdgeMakeVert} from './euler'
import {diskEdgeExists} from './structure'
import {getComponent, getValue, setValue} from './customdata'
import {
    dataInterpFromEdges,
    dataInterpFromVerts,
    faceCalcNormal,
    faceInterpFromFace,
    interpWeightsPolyV2,
    loopInterpFromFace,
    vertInterpFromFace,
} from './interp'
import {createIcoSphere, PRIMITIVE_UV_LAYER} from '../generate/primitives'

/**
 * Two quads sharing the edge `b-c`, wound so that the two faces traverse that edge in *opposite*
 * directions - which is what a consistently wound surface always does, and what makes "the corner
 * before the split" a different loop on each of the two faces.
 *
 * ```
 *   d(0,1) --- c(1,1) --- f(2,1)
 *     |          |          |
 *     |    f1    |    f2    |
 *     |          |          |
 *   a(0,0) --- b(1,0) --- e(2,0)
 * ```
 */
function twoQuadsWithUvs() {
    const bm = new BMesh()
    const a = bm.vertCreate(0, 0, 0)
    const b = bm.vertCreate(1, 0, 0)
    const c = bm.vertCreate(1, 1, 0)
    const d = bm.vertCreate(0, 1, 0)
    const e = bm.vertCreate(2, 0, 0)
    const g = bm.vertCreate(2, 1, 0)

    const f1 = bm.faceCreate([a, b, c, d])
    const f2 = bm.faceCreate([b, e, g, c])
    const shared = diskEdgeExists(b, c)!

    const uv = bm.addLayer('loop', 'uv', 'float2')

    // Deliberately different layouts per face, so reading the wrong loop cannot accidentally agree.
    // f1 is the unit square; f2 is a small off-centre patch with its V axis running the other way.
    const uvs1 = new Map<BMVert, [number, number]>([
        [a, [0, 0]], [b, [1, 0]], [c, [1, 1]], [d, [0, 1]],
    ])
    const uvs2 = new Map<BMVert, [number, number]>([
        [b, [0.5, 0.3]], [e, [0.9, 0.3]], [g, [0.9, 0.9]], [c, [0.5, 0.9]],
    ])
    for (const l of f1.eachLoop()) setValue(l, bm.ldata, uv, uvs1.get(l.v)!)
    for (const l of f2.eachLoop()) setValue(l, bm.ldata, uv, uvs2.get(l.v)!)

    return {bm, a, b, c, d, e, g, f1, f2, shared, uv, uvs1, uvs2}
}

/** The loop of `f` sitting at `v`. */
function loopAt(f: BMFace, v: BMVert): BMLoop {
    for (const l of f.eachLoop()) if (l.v === v) return l
    throw new Error(`no loop at vertex ${v.id} in face ${f.id}`)
}

/** A square in the XY plane with one float layer, corner values given in winding order. */
function squareWithValues(values: [number, number, number, number]) {
    const bm = new BMesh()
    const v0 = bm.vertCreate(0, 0, 0)
    const v1 = bm.vertCreate(1, 0, 0)
    const v2 = bm.vertCreate(1, 1, 0)
    const v3 = bm.vertCreate(0, 1, 0)
    const f = bm.faceCreate([v0, v1, v2, v3])
    const layer = bm.addLayer('loop', 'val', 'float')
    const loops = f.loops()
    for (let i = 0; i < 4; i++) setValue(loops[i], bm.ldata, layer, [values[i]])
    return {bm, f, layer, verts: [v0, v1, v2, v3] as [BMVert, BMVert, BMVert, BMVert]}
}

/** A lone triangle carrying a loop, used as the destination of a face-based interpolation. */
function probeLoop(bm: BMesh, x: number, y: number, z = 0): BMLoop {
    const p = bm.vertCreate(x, y, z)
    const p2 = bm.vertCreate(x + 0.01, y, z)
    const p3 = bm.vertCreate(x, y + 0.01, z)
    const probe = bm.faceCreate([p, p2, p3])
    return loopAt(probe, p)
}

/** Signed area of a face's UV triangle/polygon, by the shoelace formula. */
function uvArea(bm: BMesh, layer: ReturnType<BMesh['addLayer']>, f: BMFace): number {
    const pts = [...f.eachLoop()].map(l => getValue(l, layer) as [number, number])
    let sum = 0
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        const q = pts[(i + 1) % pts.length]
        sum += p[0] * q[1] - q[0] * p[1]
    }
    return sum / 2
}

describe('splitEdgeMakeVert - corner interpolation (BM_data_interp_face_vert_edge)', () => {
    // The filed bug: `kernel-split-edge-copies-corner-data.md`. The new corner used to take the UV
    // of the corner it was split from, on both faces.
    for (const fac of [0.25, 0.5, 0.75]) {
        it(`blends both faces' corners along the split edge at fac ${fac}`, () => {
            const {bm, b, c, f1, f2, shared, uv, uvs1, uvs2} = twoQuadsWithUvs()
            const {vNew} = splitEdgeMakeVert(bm, shared, b, fac)

            // The new vertex sits `fac` of the way from b to c, so its corner data must too.
            expect(vNew.y).toBeCloseTo(fac, 12)

            const lerp = (p: [number, number], q: [number, number]): [number, number] =>
                [p[0] + (q[0] - p[0]) * fac, p[1] + (q[1] - p[1]) * fac]

            const on1 = getValue(loopAt(f1, vNew), uv)
            const want1 = lerp(uvs1.get(b)!, uvs1.get(c)!)
            expect(on1[0]).toBeCloseTo(want1[0], 6)
            expect(on1[1]).toBeCloseTo(want1[1], 6)

            const on2 = getValue(loopAt(f2, vNew), uv)
            const want2 = lerp(uvs2.get(b)!, uvs2.get(c)!)
            expect(on2[0]).toBeCloseTo(want2[0], 6)
            expect(on2[1]).toBeCloseTo(want2[1], 6)

            // The two faces traverse the shared edge in opposite directions, so a port that took
            // "the next corner" on both would blend the endpoints the wrong way round on one of
            // them. Assert directly that neither face got the reversed blend.
            if (fac !== 0.5) {
                const rev1 = lerp(uvs1.get(c)!, uvs1.get(b)!)
                const rev2 = lerp(uvs2.get(c)!, uvs2.get(b)!)
                expect(Math.hypot(on1[0] - rev1[0], on1[1] - rev1[1])).toBeGreaterThan(0.1)
                expect(Math.hypot(on2[0] - rev2[0], on2[1] - rev2[1])).toBeGreaterThan(0.1)
            }

            expect(bm.validate()).toEqual([])
        })
    }

    it('leaves the untouched corners of both faces exactly as they were', () => {
        const {bm, b, c, f1, f2, shared, uv, uvs1, uvs2} = twoQuadsWithUvs()
        splitEdgeMakeVert(bm, shared, b, 0.25)

        for (const [f, table] of [[f1, uvs1], [f2, uvs2]] as const) {
            for (const l of f.eachLoop()) {
                const want = table.get(l.v)
                if (!want) continue // the corner at the new vertex
                const got = getValue(l, uv)
                // Stored as float32, so compare with a tolerance rather than bit-for-bit.
                expect(got[0]).toBeCloseTo(want[0], 6)
                expect(got[1]).toBeCloseTo(want[1], 6)
            }
        }
        expect(bm.validate()).toEqual([])
    })

    it('interpolates on a boundary edge, where the radial cycle holds one loop', () => {
        const {bm, b, f1, uv, uvs1} = twoQuadsWithUvs()
        // The a-b edge belongs to f1 alone, so its radial cycle holds exactly one loop.
        const boundary = diskEdgeExists(loopAt(f1, b).prev.v, b)!
        const a = boundary.otherVert(b)
        const {vNew} = splitEdgeMakeVert(bm, boundary, a, 0.25)

        const got = getValue(loopAt(f1, vNew), uv)
        const pa = uvs1.get(a)!
        const pb = uvs1.get(b)!
        expect(got[0]).toBeCloseTo(pa[0] + (pb[0] - pa[0]) * 0.25, 6)
        expect(got[1]).toBeCloseTo(pa[1] + (pb[1] - pa[1]) * 0.25, 6)
        expect(bm.validate()).toEqual([])
    })

    it('does not throw on a wire edge, which has no radial cycle at all', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const e = bm.edgeCreate(a, b)
        bm.addLayer('loop', 'uv', 'float2')
        const w = bm.addLayer('vert', 'weight', 'float')
        setValue(a, bm.vdata, w, [0])
        setValue(b, bm.vdata, w, [4])

        const {vNew} = splitEdgeMakeVert(bm, e, a, 0.25)
        // The vertex domain still interpolates, the corner domain simply has nothing to do.
        expect(getComponent(vNew, w)).toBeCloseTo(1, 6)
        expect(bm.validate()).toEqual([])
    })

    it('carries every attribute type through a split, each by its own Blender rule', () => {
        const {bm, b, c, f1, shared} = twoQuadsWithUvs()
        const f3 = bm.addLayer('loop', 'f3', 'float3')
        const f1L = bm.addLayer('loop', 'f1', 'float')
        const col = bm.addLayer('loop', 'col', 'byteColor')
        const grp = bm.addLayer('loop', 'grp', 'int32')

        const lb = loopAt(f1, b)
        const lc = loopAt(f1, c)
        setValue(lb, bm.ldata, f3, [0, 10, 100])
        setValue(lc, bm.ldata, f3, [2, 30, 200])
        setValue(lb, bm.ldata, f1L, [1])
        setValue(lc, bm.ldata, f1L, [5])
        setValue(lb, bm.ldata, col, [0, 40, 200, 255])
        setValue(lc, bm.ldata, col, [100, 80, 0, 255])
        setValue(lb, bm.ldata, grp, [2])
        setValue(lc, bm.ldata, grp, [8])

        const {vNew} = splitEdgeMakeVert(bm, shared, b, 0.25)
        const lNew = loopAt(f1, vNew)

        expect(getValue(lNew, f3)).toEqual([0.5, 15, 125])
        expect(getComponent(lNew, f1L)).toBeCloseTo(2, 6)
        // `layerInterp_mloopcol`: weighted per channel, then `round_fl_to_uchar_clamp`.
        expect(getValue(lNew, col)).toEqual([25, 50, 150, 255])
        // `layerInterp_propInt`: 0.75 * 2 + 0.25 * 8 = 3.5, rounded away from zero.
        expect(getComponent(lNew, grp)).toBe(4)
        expect(Number.isInteger(getComponent(lNew, grp))).toBe(true)
    })
})

describe('dataInterpFromVerts / dataInterpFromEdges', () => {
    it('blends two vertices at fac, and short-circuits at the ends', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const dst = bm.vertCreate(0.5, 0, 0)
        const layer = bm.addLayer('vert', 'w', 'float')
        setValue(a, bm.vdata, layer, [10])
        setValue(b, bm.vdata, layer, [20])

        dataInterpFromVerts(bm, a, b, dst, 0.25)
        expect(getComponent(dst, layer)).toBeCloseTo(12.5, 6)

        // `bm_data_interp_from_elem` copies rather than weights at the extremes.
        dataInterpFromVerts(bm, a, b, dst, 0)
        expect(getComponent(dst, layer)).toBe(10)
        dataInterpFromVerts(bm, a, b, dst, 1)
        expect(getComponent(dst, layer)).toBe(20)
    })

    it('blends two edges at fac', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const c = bm.vertCreate(2, 0, 0)
        const e1 = bm.edgeCreate(a, b)
        const e2 = bm.edgeCreate(b, c)
        const dst = bm.edgeCreate(a, c)
        const layer = bm.addLayer('edge', 'crease', 'float')
        setValue(e1, bm.edata, layer, [0])
        setValue(e2, bm.edata, layer, [1])

        dataInterpFromEdges(bm, e1, e2, dst, 0.75)
        expect(getComponent(dst, layer)).toBeCloseTo(0.75, 6)
    })
})

describe('interpWeightsPolyV2', () => {
    // A unit square, counter-clockwise from the origin.
    const square = [0, 0, 1, 0, 1, 1, 0, 1]

    it('is bilinear at the centre of a square', () => {
        const w: number[] = []
        interpWeightsPolyV2(w, square, 4, 0.5, 0.5)
        for (const x of w) expect(x).toBeCloseTo(0.25, 6)
    })

    it('gives a corner weight 1 and everything else 0', () => {
        const w: number[] = []
        interpWeightsPolyV2(w, square, 4, 1, 1)
        expect(w).toEqual([0, 0, 1, 0])
    })

    it('splits an edge midpoint between that edge\'s two ends only', () => {
        const w: number[] = []
        interpWeightsPolyV2(w, square, 4, 0.5, 0)
        expect(w[0]).toBeCloseTo(0.5, 6)
        expect(w[1]).toBeCloseTo(0.5, 6)
        expect(w[2]).toBe(0)
        expect(w[3]).toBe(0)
    })

    it('splits an off-centre edge point linearly', () => {
        const w: number[] = []
        interpWeightsPolyV2(w, square, 4, 0.25, 0)
        expect(w[0]).toBeCloseTo(0.75, 6)
        expect(w[1]).toBeCloseTo(0.25, 6)
        expect(w[2]).toBe(0)
        expect(w[3]).toBe(0)
    })

    it('extrapolates outside the polygon with negative weights that still sum to 1', () => {
        const w: number[] = []
        interpWeightsPolyV2(w, square, 4, 2, 0.5)
        expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
        // Blender does not clamp: the far corners must go negative or the result is not an
        // extrapolation at all.
        expect(Math.min(...w)).toBeLessThan(0)
    })

    it('sums to 1 for a convex polygon', () => {
        const hexagon: number[] = []
        for (let i = 0; i < 6; i++) {
            hexagon.push(Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3))
        }
        for (const [x, y] of [[0, 0], [0.3, 0.1], [-0.4, 0.25], [0.1, -0.6]]) {
            const w: number[] = []
            interpWeightsPolyV2(w, hexagon, 6, x, y)
            expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
        }
    })

    it('sums to 1 for a concave polygon', () => {
        // An arrowhead: vertex 3 is a reflex corner.
        const concave = [0, 0, 2, 0, 2, 2, 1, 0.5, 0, 2]
        for (const [x, y] of [[0.5, 0.3], [1.5, 0.4], [1, 1.5], [0.2, 1.2]]) {
            const w: number[] = []
            interpWeightsPolyV2(w, concave, 5, x, y)
            expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
        }
    })

    it('rejects a polygon too short to initialise from v[n - 2]', () => {
        expect(() => interpWeightsPolyV2([], [0, 0], 1, 0, 0)).toThrow(/at least 2 corners/)
    })
})

describe('loopInterpFromFace (BM_loop_interp_from_face)', () => {
    // Corner values 0 / 1 / 1 / 0 around the square make the field `x` exactly, so any correct
    // weighting reproduces `x` at every interior point.
    const values: [number, number, number, number] = [0, 1, 1, 0]

    it('is bilinear at a known interior point', () => {
        const {bm, f, layer} = squareWithValues(values)
        const l = probeLoop(bm, 0.25, 0.5)
        loopInterpFromFace(bm, l, f)
        expect(getComponent(l, layer)).toBeCloseTo(0.25, 5)
    })

    it('reproduces the whole linear field across the interior', () => {
        const {bm, f, layer} = squareWithValues(values)
        for (const [x, y] of [[0.1, 0.1], [0.5, 0.5], [0.75, 0.2], [0.3, 0.9], [0.6, 0.45]]) {
            const l = probeLoop(bm, x, y)
            loopInterpFromFace(bm, l, f)
            expect(getComponent(l, layer)).toBeCloseTo(x, 5)
        }
    })

    it('lands exactly on a corner value at a corner', () => {
        const {bm, f, layer, verts} = squareWithValues([3, 7, 11, 13])
        for (let i = 0; i < 4; i++) {
            const v = verts[i]
            const l = probeLoop(bm, v.x, v.y)
            loopInterpFromFace(bm, l, f)
            expect(getComponent(l, layer)).toBe([3, 7, 11, 13][i])
        }
    })

    it('is the linear blend at an edge midpoint', () => {
        const {bm, f, layer} = squareWithValues([3, 7, 11, 13])
        const l = probeLoop(bm, 0.5, 0)
        loopInterpFromFace(bm, l, f)
        expect(getComponent(l, layer)).toBeCloseTo(5, 5)

        const l2 = probeLoop(bm, 0, 0.25)
        loopInterpFromFace(bm, l2, f)
        // The v3->v0 edge runs from value 13 at (0,1) to value 3 at (0,0).
        expect(getComponent(l2, layer)).toBeCloseTo(3 + (13 - 3) * 0.25, 5)
    })

    it('extrapolates outside the polygon rather than clamping', () => {
        const {bm, f, layer} = squareWithValues(values)
        const l = probeLoop(bm, 2, 0.5)
        loopInterpFromFace(bm, l, f)
        // The field is `x`, so honest extrapolation gives 2, not the clamped 1.
        expect(getComponent(l, layer)).toBeCloseTo(2, 4)
        expect(getComponent(l, layer)).toBeGreaterThan(1)
    })

    it('works on a face that is not axis aligned', () => {
        // The same square, rotated 45 degrees about X so it leaves the XY plane.
        const bm = new BMesh()
        const s = Math.SQRT1_2
        const v0 = bm.vertCreate(0, 0, 0)
        const v1 = bm.vertCreate(1, 0, 0)
        const v2 = bm.vertCreate(1, s, s)
        const v3 = bm.vertCreate(0, s, s)
        const f = bm.faceCreate([v0, v1, v2, v3])
        const layer = bm.addLayer('loop', 'val', 'float')
        const loops = f.loops()
        for (let i = 0; i < 4; i++) setValue(loops[i], bm.ldata, layer, [values[i]])

        const l = probeLoop(bm, 0.25, s * 0.5, s * 0.5)
        loopInterpFromFace(bm, l, f)
        expect(getComponent(l, layer)).toBeCloseTo(0.25, 4)
    })

    it('interpolates the vertex domain too when asked', () => {
        const {bm, f, verts} = squareWithValues(values)
        const vLayer = bm.addLayer('vert', 'w', 'float')
        setValue(verts[0], bm.vdata, vLayer, [0])
        setValue(verts[1], bm.vdata, vLayer, [4])
        setValue(verts[2], bm.vdata, vLayer, [4])
        setValue(verts[3], bm.vdata, vLayer, [0])

        const l = probeLoop(bm, 0.25, 0.5)
        loopInterpFromFace(bm, l, f, true)
        expect(getComponent(l.v, vLayer)).toBeCloseTo(1, 5)
    })
})

describe('vertInterpFromFace / faceInterpFromFace', () => {
    it('blends a vertex from the source face vertices', () => {
        const {bm, f, verts} = squareWithValues([0, 0, 0, 0])
        const vLayer = bm.addLayer('vert', 'w', 'float')
        const want = [1, 5, 9, 13]
        for (let i = 0; i < 4; i++) setValue(verts[i], bm.vdata, vLayer, [want[i]])

        const dst = bm.vertCreate(0.5, 0.5, 0)
        vertInterpFromFace(bm, dst, f)
        expect(getComponent(dst, vLayer)).toBeCloseTo((1 + 5 + 9 + 13) / 4, 5)
    })

    it('gives every corner of the destination face its value from the source face', () => {
        const {bm, f, layer} = squareWithValues([0, 1, 1, 0])
        // A smaller square inside the first one.
        const p = [
            bm.vertCreate(0.25, 0.25, 0), bm.vertCreate(0.75, 0.25, 0),
            bm.vertCreate(0.75, 0.75, 0), bm.vertCreate(0.25, 0.75, 0),
        ]
        const fDst = bm.faceCreate(p)
        faceInterpFromFace(bm, fDst, f, false)

        for (const l of fDst.eachLoop()) {
            expect(getComponent(l, layer)).toBeCloseTo(l.v.x, 5)
        }
    })
})

describe('faceCalcNormal', () => {
    it('matches the winding of a triangle, a quad and an n-gon', () => {
        const bm = new BMesh()
        const tri = bm.faceCreate([
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(0, 1, 0)])
        expect(faceCalcNormal(tri)).toEqual([0, 0, 1])

        const quad = bm.faceCreate([
            bm.vertCreate(3, 0, 0), bm.vertCreate(4, 0, 0),
            bm.vertCreate(4, 1, 0), bm.vertCreate(3, 1, 0)])
        expect(faceCalcNormal(quad)).toEqual([0, 0, 1])

        const ngon = bm.faceCreate([0, 1, 2, 3, 4].map(i =>
            bm.vertCreate(10 + Math.cos(i * 2 * Math.PI / 5), Math.sin(i * 2 * Math.PI / 5), 0)))
        const n = faceCalcNormal(ngon)
        expect(n[2]).toBeCloseTo(1, 6)
    })
})

describe('icosphere UVs - the symptom the bug was filed for', () => {
    // `kernel-split-edge-copies-corner-data.md`: "an icosphere at subdivisions > 1 gets stepped UVs
    // instead of a smooth unwrap". The icosphere's UVs come from Blender's `icouvs` table on the
    // twenty base triangles and are then carried through `subdivide_edges`, so subdivision must
    // *partition* each base triangle's UV triangle, not duplicate corners of it.

    function icoUvs(subdivisions: number) {
        const bm = new BMesh()
        createIcoSphere(bm, {subdivisions, calcUVs: true, radius: 1})
        const layer = bm.ldata.get(PRIMITIVE_UV_LAYER)!
        return {bm, layer}
    }

    function totalUvArea(subdivisions: number): number {
        const {bm, layer} = icoUvs(subdivisions)
        let total = 0
        for (const f of bm.faces) total += Math.abs(uvArea(bm, layer, f))
        return total
    }

    it('subdivision cuts each base UV triangle into equal sub-triangles', () => {
        const base = totalUvArea(1)
        expect(base).toBeGreaterThan(0)

        // `tri_3edge_subdivide` lays a uniform barycentric grid over each base triangle, so in UV
        // space the 4^(n-1) sub-triangles are congruent and tile the original exactly.
        //
        // The *total* area alone proves nothing: when corner data is copied rather than
        // interpolated, the twenty corner sub-triangles each keep the full base triangle's UV
        // triangle and the other sixty collapse to zero, and the total is unchanged. It is the
        // per-face area that catches it.
        for (const subdivisions of [2, 3]) {
            const {bm, layer} = icoUvs(subdivisions)
            const faces = [...bm.faces]
            const want = base / faces.length
            expect(totalUvArea(subdivisions)).toBeCloseTo(base, 5)
            for (const f of faces) {
                expect(Math.abs(uvArea(bm, layer, f))).toBeCloseTo(want, 6)
            }
        }
    })

    it('no face of a subdivided icosphere has a degenerate UV triangle', () => {
        const {bm, layer} = icoUvs(3)
        const degenerate: number[] = []
        for (const f of bm.faces) {
            if (Math.abs(uvArea(bm, layer, f)) < 1e-9) degenerate.push(f.id)
        }
        expect(degenerate).toEqual([])
    })

    it('UVs march monotonically along a subdivided base edge, in even steps', () => {
        // Take one edge of the base icosahedron and follow the chain of vertices subdivision left
        // along it. Their UVs must run monotonically from one end to the other in equal steps -
        // "stepped UVs" is exactly the failure of repeated values along such a chain.
        const {bm, layer} = icoUvs(3)

        // Pick a base edge from an un-subdivided icosphere and find its two ends again in the
        // subdivided one. `alter_co` projects every vertex onto the sphere, so match on direction
        // rather than on the raw icosahedron coordinates.
        const baseBm = new BMesh()
        createIcoSphere(baseBm, {subdivisions: 1, calcUVs: true, radius: 1})
        const baseLoops = [...baseBm.faces][0].loops()

        const dir = (v: BMVert): [number, number, number] => {
            const l = Math.hypot(v.x, v.y, v.z)
            return [v.x / l, v.y / l, v.z / l]
        }
        const sameDir = (v: BMVert, p: BMVert) => {
            const [ax, ay, az] = dir(v)
            const [bx, by, bz] = dir(p)
            return Math.hypot(ax - bx, ay - by, az - bz) < 1e-5
        }
        const start = [...bm.verts].find(v => sameDir(v, baseLoops[0].v))
        const end = [...bm.verts].find(v => sameDir(v, baseLoops[1].v))
        expect(start).toBeTruthy()
        expect(end).toBeTruthy()
        if (!start || !end) return

        // The chain: every vertex whose position lies (after spherical projection) on the great-arc
        // between start and end. Use the plane through the origin, start and end.
        const nx = start.y * end.z - start.z * end.y
        const ny = start.z * end.x - start.x * end.z
        const nz = start.x * end.y - start.y * end.x
        const nl = Math.hypot(nx, ny, nz)
        const between = (v: BMVert) => {
            const d = (v.x * nx + v.y * ny + v.z * nz) / nl
            if (Math.abs(d) > 1e-6) return false
            // Inside the arc, not the far side of the sphere.
            const dotS = v.x * start.x + v.y * start.y + v.z * start.z
            const dotE = v.x * end.x + v.y * end.y + v.z * end.z
            const dotSE = start.x * end.x + start.y * end.y + start.z * end.z
            return dotS >= dotSE - 1e-6 && dotE >= dotSE - 1e-6
        }
        const chain = [...bm.verts].filter(between)
            .sort((a, b) => (a.x * end.x + a.y * end.y + a.z * end.z)
                - (b.x * end.x + b.y * end.y + b.z * end.z))
        // subdivisions: 3 cuts every base edge into 4.
        expect(chain.length).toBe(5)

        // Every face along *one* side of that base edge belongs to the same base triangle, so they
        // share a UV island. Faces on the other side belong to a different base triangle and have a
        // different unwrap, so the samples have to be taken consistently from one side.
        const sideOf = (v: BMVert) => (v.x * nx + v.y * ny + v.z * nz) / nl
        const faceBetween = (v: BMVert, other: BMVert): BMFace => {
            for (const f of bm.faces) {
                const verts = f.verts()
                if (!verts.includes(v) || !verts.includes(other)) continue
                if (verts.some(w => sideOf(w) > 1e-6)) return f
            }
            throw new Error('no face on the chosen side shares these two vertices')
        }

        const steps: number[] = []
        let prevEndUv: [number, number] | null = null
        for (let i = 0; i < chain.length - 1; i++) {
            const f = faceBetween(chain[i], chain[i + 1])
            const from = getValue(loopAt(f, chain[i]), layer) as [number, number]
            const to = getValue(loopAt(f, chain[i + 1]), layer) as [number, number]
            // Continuous across the island: the UV of a shared vertex agrees between neighbours.
            if (prevEndUv) {
                expect(from[0]).toBeCloseTo(prevEndUv[0], 5)
                expect(from[1]).toBeCloseTo(prevEndUv[1], 5)
            }
            prevEndUv = to
            steps.push(Math.hypot(to[0] - from[0], to[1] - from[1]))
        }

        // Non-zero steps (never two corners sharing a UV - that is what "stepped" means) and equal
        // ones, because `bm_subdivide_multicut` cuts the edge into equal parameter intervals.
        expect(steps.length).toBe(4)
        for (const step of steps) {
            expect(step).toBeGreaterThan(1e-6)
            expect(step).toBeCloseTo(steps[0], 5)
        }
    })
})
