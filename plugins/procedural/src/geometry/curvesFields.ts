/**
 * Control-point normals and tangents of curves (Blender 5.2.2): `curve_normals_varray` / `curve_normal_point_domain`
 * (`blenkernel/intern/geometry_component_curves.cc:149-244`) and the Curve Tangent field
 * (`nodes/geometry/nodes/node_geo_input_tangent.cc:16-88`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {CurvesGeometry} from './components'
import {
    CURVE_TYPE_BEZIER, CURVE_TYPE_CATMULL_ROM, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, CurvesEvaluator, curveTypes, NORMAL_MODE_FREE,
    NORMAL_MODE_MINIMUM_TWIST, NORMAL_MODE_Z_UP, curvesAttributeOr, polyCalculateNormalsMinimum, polyCalculateNormalsZUp, polyCalculateTangents,
} from './curvesEval'
import {GVArray} from './varray'

/** `CurvesGeometry::is_single_type` (`BKE_curves.hh`): every curve has `type` (true without curves). */
export function curvesIsSingleType(curves: CurvesGeometry, type: number): boolean {
    const types = curveTypes(curves)
    for (let c = 0; c < curves.curvesNum; c++) if (types[c] !== type) return false
    return true
}

/**
 * The evaluated values of each curve sampled at its control points: catmull-rom every `resolution`th, poly all,
 * Bezier the first and then each point's evaluated offset; NURBS by `nurbs` (no point correspondence).
 */
function pointDomainFromEvaluated(curves: CurvesGeometry, ev: CurvesEvaluator, evaluated: Float32Array,
    nurbs: (curve: number, start: number, end: number, out: Float32Array) => void): Float32Array {
    const results = new Float32Array(curves.pointsNum * 3)
    for (let c = 0; c < curves.curvesNum; c++) {
        const [s, e] = curves.pointsRange(c)
        const [es] = ev.evaluatedRange(c)
        const out = results.subarray(s * 3, e * 3)
        const n = e - s
        switch (ev.types[c]) {
        case CURVE_TYPE_CATMULL_ROM: {
            const resolution = ev.resolution[c]
            for (let i = 0; i < n; i++) out.set(evaluated.subarray((es + resolution * i) * 3, (es + resolution * i) * 3 + 3), i * 3)
            break
        }
        case CURVE_TYPE_POLY:
            out.set(evaluated.subarray(es * 3, (es + n) * 3))
            break
        case CURVE_TYPE_BEZIER: {
            if (n === 0) break
            out.set(evaluated.subarray(es * 3, es * 3 + 3), 0)
            const offsets = ev.bezierOffsets(c)
            for (let i = 1; i < n; i++) out.set(evaluated.subarray((es + offsets[i]) * 3, (es + offsets[i]) * 3 + 3), i * 3)
            break
        }
        case CURVE_TYPE_NURBS:
            nurbs(c, s, e, out)
            break
        }
    }
    return results
}

/** Point values on the point domain, or mixed to curves (`adapt_domain`); nothing on other domains. */
function onDomain(curves: CurvesGeometry, values: Float32Array, domain: AttrDomain): GVArray | undefined {
    const v = GVArray.fromArray('float3', values)
    if (domain === AttrDomain.Point) return v
    if (domain === AttrDomain.Curve) return curves.accessor().adaptDomain(v, AttrDomain.Point, AttrDomain.Curve)
    return undefined
}

/** `curve_normal_point_domain` (`geometry_component_curves.cc:149`). */
function curveNormalPointDomain(curves: CurvesGeometry, ev: CurvesEvaluator): Float32Array {
    const normalModes = curvesAttributeOr(curves, 'normal_mode', curves.curvesNum, NORMAL_MODE_MINIMUM_TWIST)
    const custom = curves.attributes.get('custom_normal')
    const positions = curves.positions
    return pointDomainFromEvaluated(curves, ev, ev.normals, (c, s, e, out) => {
        // "For NURBS curves there is no obvious correspondence between specific evaluated points and control points,
        // so normals are determined by treating them as poly curves."
        const cyclic = !!ev.cyclic[c]
        const tangents = new Float32Array((e - s) * 3)
        polyCalculateTangents(positions.subarray(s * 3, e * 3), cyclic, tangents)
        switch (normalModes[c]) {
        case NORMAL_MODE_Z_UP: polyCalculateNormalsZUp(tangents, out); break
        case NORMAL_MODE_MINIMUM_TWIST: polyCalculateNormalsMinimum(tangents, cyclic, out); break
        case NORMAL_MODE_FREE:
            // `lookup_or_default<float3>("custom_normal", Point, float3(0, 0, 1))`.
            if (custom && custom.domain === AttrDomain.Point && custom.type === 'float3') out.set(custom.data.subarray(s * 3, e * 3))
            else if (custom) throw new Error('curve normals: a custom_normal attribute of another type or domain is not ported (lookup_or_default conversion)')
            else for (let i = 0; i < e - s; i++) out.set([0, 0, 1], i * 3)
            break
        }
    })
}

/** `curve_normals_varray` (`geometry_component_curves.cc:222`). */
export function curveNormalsVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
    const ev = new CurvesEvaluator(curves)
    if (curvesIsSingleType(curves, CURVE_TYPE_POLY)) return curves.accessor().adaptDomain(GVArray.fromArray('float3', ev.normals), AttrDomain.Point, domain)
    return onDomain(curves, curveNormalPointDomain(curves, ev), domain)
}

/** `construct_curve_tangent_gvarray` (`node_geo_input_tangent.cc:68`) with `curve_tangent_point_domain` (:16). */
export function curveTangentsVArray(curves: CurvesGeometry, domain: AttrDomain): GVArray | undefined {
    const ev = new CurvesEvaluator(curves)
    if (curvesIsSingleType(curves, CURVE_TYPE_POLY)) return curves.accessor().adaptDomain(GVArray.fromArray('float3', ev.tangents), AttrDomain.Point, domain)
    const positions = curves.positions
    const tangents = pointDomainFromEvaluated(curves, ev, ev.tangents, (c, s, e, out) =>
        polyCalculateTangents(positions.subarray(s * 3, e * 3), !!ev.cyclic[c], out))
    return onDomain(curves, tangents, domain)
}

