/**
 * Hand-checked behaviour of the subdivide edge-ring port that the Blender fixtures
 * (`tests/bmesh-ops-bridge-parity.test.ts`, `subdiv *`) cannot show: the error reports, refusals that
 * change nothing, RNA clamping, and the helpers.
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMVert} from '../bmesh/types'
import {diskEdgeExists} from '../bmesh/structure'
import {edgeSelectSet} from '../bmesh/marking'
import {normalsUpdate} from './bevel-bmquery'
import {SelectMode} from '../constants'
import {
    bmoSubdivideEdgering, edgeSplitN, subdFalloffCalc, subdivideEdgeringSelection,
} from './subdivideEdgering'
import {bmoFlagLayerIndex} from './bmo'
import {axisAngleToQuat, bisectV3V3V3, curveForwardDiffBezier} from '../math/geom'
import {closestToLineV3} from './bevel-math'
import {Vec3} from '../math'

/** A strip of quads between rows a (y = 0) and b (y = 1), `n` columns. */
function strip(bm: BMesh, n: number) {
    const a: BMVert[] = []
    const b: BMVert[] = []
    for (let i = 0; i <= n; i++) {
        a.push(bm.vertCreate(i, 0, 0))
        b.push(bm.vertCreate(i, 1, 0))
    }
    for (let i = 0; i < n; i++) bm.faceCreate([a[i], a[i + 1], b[i + 1], b[i]])
    normalsUpdate(bm)
    const rung = (i: number): BMEdge => diskEdgeExists(a[i], b[i])!
    return {a, b, rung}
}

const snapshot = (bm: BMesh) => ({
    verts: [...bm.verts].map(v => [v.x, v.y, v.z]),
    faces: [...bm.faces].map(f => f.verts().map(v => v.id)),
})

describe('bmoSubdivideEdgering refusals (bmo_subdivide_edgering.cc:1168-1203)', () => {
    it('"No edge rings found" when the input edges bound no face pair', () => {
        const bm = new BMesh()
        const {a} = strip(bm, 2)
        const before = snapshot(bm)
        const r = bmoSubdivideEdgering(bm, [diskEdgeExists(a[0], a[1])!], {cuts: 2})
        expect(r).toEqual({ok: false, error: 'No edge rings found', faces: []})
        expect(snapshot(bm)).toEqual(before)
    })

    it('"Edge-ring pair isn\'t connected" when one rim has a vertex with no ring edge to the other', () => {
        const bm = new BMesh()
        const {a, b, rung} = strip(bm, 2)
        // the second quad becomes a ring face through its top edge, so its far side is rim too and the
        // two rims are a0-a1 and b0-b1-b2-a2, where b2 has no ring edge
        const before = snapshot(bm)
        const r = bmoSubdivideEdgering(bm, [rung(0), rung(1), diskEdgeExists(a[1], a[2])!], {cuts: 1})
        expect(r).toEqual({ok: false, error: 'Edge-ring pair isn\'t connected', faces: []})
        expect(snapshot(bm)).toEqual(before)
        expect(b).toHaveLength(3)
    })

    it('cuts a ring and outputs the sliced faces', () => {
        const bm = new BMesh()
        const {rung} = strip(bm, 3)
        const r = bmoSubdivideEdgering(bm, [rung(0), rung(1), rung(2), rung(3)], {cuts: 2, interpMode: 'LINEAR'})
        expect(r.ok).toBe(true)
        // 3 quads, each sliced into 3
        expect(r.faces).toHaveLength(9)
        expect(bm.totface).toBe(9)
        expect(bm.totvert).toBe(8 + 4 * 2)
        // LINEAR without a profile leaves the cuts where BM_edge_split_n put them
        const ys = [...new Set([...bm.verts].map(v => +v.y.toFixed(9)))].sort()
        expect(ys).toEqual([0, +(1 / 3).toFixed(9), +(2 / 3).toFixed(9), 1])
        expect(bm.validate()).toEqual([])
    })
})

describe('subdivideEdgeringSelection (edbm_subdivide_edge_ring_exec)', () => {
    it('does nothing without a selected edge', () => {
        const bm = new BMesh()
        strip(bm, 2)
        const before = snapshot(bm)
        expect(subdivideEdgeringSelection(bm)).toEqual({ok: true, faces: [], changed: false})
        expect(snapshot(bm)).toEqual(before)
    })

    it('defaults to 10 cuts (MESH_OT_subdivide_edgering: cuts_default = 10)', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const {rung} = strip(bm, 1)
        edgeSelectSet(bm, rung(0), true)
        edgeSelectSet(bm, rung(1), true)
        const r = subdivideEdgeringSelection(bm)
        expect(r).toMatchObject({ok: true, changed: true})
        expect(bm.totvert).toBe(4 + 2 * 10)
        expect(bm.totface).toBe(11)
    })

    it('reports the operator error', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const {a} = strip(bm, 1)
        edgeSelectSet(bm, diskEdgeExists(a[0], a[1])!, true)
        expect(subdivideEdgeringSelection(bm)).toEqual({ok: false, error: 'No edge rings found'})
    })

    it('clamps number_cuts to 0..1000', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const {rung} = strip(bm, 1)
        edgeSelectSet(bm, rung(0), true)
        edgeSelectSet(bm, rung(1), true)
        expect(subdivideEdgeringSelection(bm, {numberCuts: -5})).toMatchObject({ok: true})
        // zero cuts: nothing to split, the face is unchanged
        expect(bm.totvert).toBe(4)
        expect(bm.totface).toBe(1)
    })
})

describe('helpers', () => {
    it('edgeSplitN (BM_edge_split_n) returns the new vertices from v1 to v2, evenly spaced', () => {
        const bm = new BMesh()
        const v1 = bm.vertCreate(0, 0, 0)
        const v2 = bm.vertCreate(4, 0, 0)
        const e = bm.edgeCreate(v1, v2)
        const vs = edgeSplitN(bm, e, 3)
        expect(vs.map(v => v.x)).toEqual([1, 2, 3])
        // `e` keeps v1 and ends at the first new vertex; the chain is v1, vs..., v2
        expect(e.joins(v1, vs[0])).toBe(true)
        expect(diskEdgeExists(vs[2], v2)).not.toBeNull()
    })

    it('subdFalloffCalc (bmesh_subd_falloff_calc) at 0.5', () => {
        expect(subdFalloffCalc('SMOOTH', 0.5)).toBe(0.5)
        expect(subdFalloffCalc('SPHERE', 0.5)).toBe(Math.sqrt(0.75))
        expect(subdFalloffCalc('ROOT', 0.5)).toBe(Math.sqrt(0.5))
        expect(subdFalloffCalc('SHARP', 0.5)).toBe(0.25)
        expect(subdFalloffCalc('LINEAR', 0.5)).toBe(0.5)
        expect(subdFalloffCalc('INVERSE_SQUARE', 0.5)).toBe(0.75)
    })

    it('bmoFlagLayerIndex (BMO_push/pop) numbers verts, edges and faces in mesh order', () => {
        const bm = new BMesh()
        strip(bm, 2)
        bmoFlagLayerIndex(bm)
        expect([...bm.verts].map(v => v.index)).toEqual([0, 1, 2, 3, 4, 5])
        expect([...bm.edges].map(e => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect([...bm.faces].map(f => f.index)).toEqual([0, 1])
    })

    it('curveForwardDiffBezier (BKE_curve_forward_diff_bezier) samples the cubic Bezier', () => {
        const [p0, p1, p2, p3] = [0.5, 2, -1, 3]
        const got = curveForwardDiffBezier(p0, p1, p2, p3, 5)
        expect(got).toHaveLength(6)
        got.forEach((g, i) => {
            const t = i / 5
            const want = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
            expect(g).toBeCloseTo(want, 12)
        })
    })

    it('closestToLineV3 may write into its own line argument, as bezier_handle_calc_length_v3 does', () => {
        const ofs: Vec3 = [1, 1, 0]
        // closest point of p on the line through (0,0,0) and `ofs`, written to `ofs`
        closestToLineV3(ofs, [3, 1, 0], [0, 0, 0], ofs)
        expect(ofs).toEqual([2, 2, 0])
        const z: Vec3 = [0, 0, 0]
        // degenerate line: the origin (closest_to_ray_v3's zero-direction branch)
        expect(closestToLineV3(z, [5, 5, 5], [1, 2, 3], [1, 2, 3])).toBe(0)
        expect(z).toEqual([1, 2, 3])
    })

    it('bisectV3V3V3 and axisAngleToQuat', () => {
        const b = bisectV3V3V3([0, 0, 0], [1, 0, 0], [1, 1, 0])
        expect(b.map(x => +x.toFixed(9))).toEqual([+(Math.SQRT1_2).toFixed(9), +(Math.SQRT1_2).toFixed(9), 0])
        expect(axisAngleToQuat([0, 0, 0], 1)).toEqual([1, 0, 0, 0])
        const q = axisAngleToQuat([0, 0, 2], Math.PI)
        expect(q.map(x => +x.toFixed(9))).toEqual([0, 0, 0, 1])
    })
})
