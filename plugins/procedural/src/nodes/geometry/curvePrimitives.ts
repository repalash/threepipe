/**
 * Curve primitives: Curve Line (`node_geo_curve_primitive_line.cc`), Curve Circle
 * (`node_geo_curve_primitive_circle.cc`) and Bézier Segment (`node_geo_curve_primitive_bezier_segment.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {cross3, interpolate3, length3, normalize3, sub3, V3} from '../../blender/math/vec'
import {CurvesGeometry} from '../../geometry/components'
import {BEZIER_HANDLE_ALIGN, CURVE_TYPE_BEZIER, CURVE_TYPE_POLY} from '../../geometry/curvesEval'
import {fillCurveTypes} from '../../geometry/curvesEdit'
import {GField} from '../../fields'
import {GeometrySet} from '../../geometry/GeometrySet'
import {registerNodeType} from '../../runtime/registry'

/** `bke::curves_new_nomain_single(points_num, type)` (`blenkernel/intern/curves.cc:300`). */
export function curvesNewSingle(pointsNum: number, type: number): CurvesGeometry {
    const curves = new CurvesGeometry(pointsNum, 1)
    curves.curveOffsets[1] = pointsNum
    fillCurveTypes(curves, type)
    return curves
}

const cosf = (x: number) => f32(Math.cos(x))
const sinf = (x: number) => f32(Math.sin(x))

registerNodeType({
    idname: 'GeometryNodeCurvePrimitiveLine',
    label: 'Curve Line',
    properties: {mode: 'POINTS'},
    enums: {mode: ['POINTS', 'DIRECTION']},
    declare(b, node) {
        const mode = node.prop<string>('mode')
        b.input('VECTOR', 'Start').subtype('TRANSLATION')
        b.input('VECTOR', 'End').default([0, 0, 1]).subtype('TRANSLATION').available(mode === 'POINTS')
        b.input('VECTOR', 'Direction').default([0, 0, 1]).available(mode === 'DIRECTION')
        b.input('FLOAT', 'Length').default(1).subtype('DISTANCE').available(mode === 'DIRECTION')
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:91).
    execute(p) {
        const curves = curvesNewSingle(2, CURVE_TYPE_POLY)
        const positions = curves.positions
        const start = p.vector('Start')
        positions.set(start, 0)
        if (p.node.prop<string>('mode') === 'POINTS') {
            // `create_point_line_curve` (:69).
            positions.set(p.vector('End'), 3)
        } else {
            // `create_direction_line_curve` (:78): `normalize(direction) * length + start`.
            const d = normalize3(p.vector('Direction'))
            const length = p.float('Length')
            for (let k = 0; k < 3; k++) positions[3 + k] = f32(f32(d[k] * length) + start[k])
        }
        p.set('Curve', GeometrySet.fromCurves(curves))
    },
})

/** `colinear_f3_f3_f3` (:93): `ELEM(a, b, b * -1.0f)`. */
function colinear(p1: ArrayLike<number>, p2: ArrayLike<number>, p3: ArrayLike<number>): boolean {
    const a = normalize3(sub3(p2, p1))
    const b = normalize3(sub3(p3, p1))
    const eq = (x: ArrayLike<number>, y: ArrayLike<number>) => x[0] === y[0] && x[1] === y[1] && x[2] === y[2]
    return eq(a, b) || eq(a, [f32(b[0] * -1), f32(b[1] * -1), f32(b[2] * -1)])
}

/** `dot_v3v3` (`math_vector_inline.cc:640`). */
const dotV3V3 = (a: ArrayLike<number>, b: ArrayLike<number>) => f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]))

/** `plane_from_point_normal_v3` (`math_geom.cc:225`). */
function planeFromPointNormal(co: ArrayLike<number>, no: ArrayLike<number>): number[] {
    return [no[0], no[1], no[2], -dotV3V3(no, co)]
}

/** `determinant_m3` (`math_matrix_c.cc:1883`) with `determinant_m2` (:1878). */
function determinantM3(a1: number, a2: number, a3: number, b1: number, b2: number, b3: number, c1: number, c2: number, c3: number): number {
    const m2 = (a: number, b: number, c: number, d: number) => f32(f32(a * d) - f32(b * c))
    return f32(f32(f32(a1 * m2(b2, b3, c2, c3)) - f32(b1 * m2(a2, a3, c2, c3))) + f32(c1 * m2(a2, a3, b2, b3)))
}

/** `isect_plane_plane_plane_v3` (`math_geom.cc:2215`). */
function isectPlanePlanePlane(a: number[], b: number[], c: number[]): V3 | undefined {
    const det = determinantM3(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    if (det === 0) return undefined
    let tmp = cross3(c, b)
    const r: V3 = [f32(tmp[0] * a[3]), f32(tmp[1] * a[3]), f32(tmp[2] * a[3])]
    tmp = cross3(a, c)
    for (let k = 0; k < 3; k++) r[k] = f32(r[k] + f32(tmp[k] * b[3]))
    tmp = cross3(b, a)
    for (let k = 0; k < 3; k++) r[k] = f32(r[k] + f32(tmp[k] * c[3]))
    const inv = f32(1 / det)
    return [f32(r[0] * inv), f32(r[1] * inv), f32(r[2] * inv)]
}

/** `create_point_circle_curve` (:100). */
function createPointCircleCurve(p1: ArrayLike<number>, p2: ArrayLike<number>, p3: ArrayLike<number>, resolution: number): {curves?: CurvesGeometry, center: V3} {
    if (colinear(p1, p2, p3)) return {center: [0, 0, 0]}
    const q1 = interpolate3(p1, p2, 0.5)
    const q2 = interpolate3(p2, p3, 0.5)
    const v1 = normalize3(sub3(p2, p1))
    const v2 = normalize3(sub3(p3, p2))
    const v3 = normalize3(cross3(v1, v2))
    const v4 = normalize3(cross3(v3, v1))
    const center = isectPlanePlanePlane(planeFromPointNormal(q1, v3), planeFromPointNormal(q1, v1), planeFromPointNormal(q2, v2))
    if (!center) return {center: [0, 0, 0]}
    const curves = curvesNewSingle(resolution, CURVE_TYPE_POLY)
    curves.accessor().add('cyclic', AttrDomain.Curve, 'bool', [1])
    const positions = curves.positions
    const r = length3(sub3(p1, center))
    // `((2 * M_PI) / float(resolution))` in double, stored as float.
    const thetaStep = f32(2 * Math.PI / resolution)
    for (let i = 0; i < resolution; i++) {
        const theta = f32(thetaStep * i)
        // `center + r * sin(theta) * v1 + r * cos(theta) * v4`.
        const s = f32(r * sinf(theta)), c = f32(r * cosf(theta))
        for (let k = 0; k < 3; k++) positions[i * 3 + k] = f32(f32(center[k] + f32(s * v1[k])) + f32(c * v4[k]))
    }
    return {curves, center}
}

/** `create_radius_circle_curve` (:146). */
function createRadiusCircleCurve(resolution: number, radius: number): CurvesGeometry {
    const curves = curvesNewSingle(resolution, CURVE_TYPE_POLY)
    curves.accessor().add('cyclic', AttrDomain.Curve, 'bool', [1])
    const positions = curves.positions
    // `(2.0f * M_PI) / float(resolution)` in double, stored as float.
    const thetaStep = f32(2 * Math.PI / resolution)
    for (let i = 0; i < resolution; i++) {
        const theta = f32(thetaStep * i)
        positions[i * 3] = f32(radius * cosf(theta))
        positions[i * 3 + 1] = f32(radius * sinf(theta))
        positions[i * 3 + 2] = 0
    }
    return curves
}

registerNodeType({
    idname: 'GeometryNodeCurvePrimitiveCircle',
    label: 'Curve Circle',
    properties: {mode: 'RADIUS'},
    enums: {mode: ['POINTS', 'RADIUS']},
    declare(b, node) {
        const points = node.prop<string>('mode') === 'POINTS'
        b.input('INT', 'Resolution').default(32).min(3).max(512)
        b.input('VECTOR', 'Point 1').default([-1, 0, 0]).subtype('TRANSLATION').available(points)
        b.input('VECTOR', 'Point 2').default([0, 1, 0]).subtype('TRANSLATION').available(points)
        b.input('VECTOR', 'Point 3').default([1, 0, 0]).subtype('TRANSLATION').available(points)
        b.input('FLOAT', 'Radius').default(1).min(0).subtype('DISTANCE').available(!points)
        b.output('GEOMETRY', 'Curve')
        b.output('VECTOR', 'Center').available(points)
    },
    // `node_geo_exec` (:162).
    execute(p) {
        const resolution = Math.max(p.int('Resolution'), 3)
        let curves: CurvesGeometry | undefined
        if (p.node.prop<string>('mode') === 'POINTS') {
            const r = createPointCircleCurve(p.vector('Point 1'), p.vector('Point 2'), p.vector('Point 3'), resolution)
            curves = r.curves
            p.set('Center', GField.constant('float3', r.center))
        } else {
            curves = createRadiusCircleCurve(resolution, p.float('Radius'))
        }
        // `set_default_remaining_outputs()` when there is no circle.
        p.set('Curve', curves ? GeometrySet.fromCurves(curves) : new GeometrySet())
    },
})

registerNodeType({
    idname: 'GeometryNodeCurvePrimitiveBezierSegment',
    label: 'Bézier Segment',
    dslName: 'BezierSegment',
    properties: {mode: 'POSITION'},
    enums: {mode: ['POSITION', 'OFFSET']},
    declare(b) {
        b.input('INT', 'Resolution').default(16).min(1).max(256).subtype('UNSIGNED')
        b.input('VECTOR', 'Start').default([-1, 0, 0]).subtype('TRANSLATION')
        b.input('VECTOR', 'Start Handle').default([-0.5, 0.5, 0]).subtype('TRANSLATION')
        b.input('VECTOR', 'End Handle').subtype('TRANSLATION')
        b.input('VECTOR', 'End').default([1, 0, 0]).subtype('TRANSLATION')
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:92) and `create_bezier_segment_curve` (:57).
    execute(p) {
        const start = p.vector('Start'), startHandleRight = p.vector('Start Handle')
        const end = p.vector('End'), endHandleLeft = p.vector('End Handle')
        const resolution = Math.max(p.int('Resolution'), 1)
        const curves = curvesNewSingle(2, CURVE_TYPE_BEZIER)
        const acc = curves.accessor()
        acc.add('resolution', AttrDomain.Curve, 'int32', [resolution])
        acc.add('handle_type_left', AttrDomain.Point, 'int8', [BEZIER_HANDLE_ALIGN])
        acc.add('handle_type_right', AttrDomain.Point, 'int8', [BEZIER_HANDLE_ALIGN])
        const positions = curves.positions
        positions.set(start, 0)
        positions.set(end, 3)
        acc.add('handle_right', AttrDomain.Point, 'float3')
        acc.add('handle_left', AttrDomain.Point, 'float3')
        const hr = curves.attributes.get('handle_right')!.data, hl = curves.attributes.get('handle_left')!.data
        const twice = (a: ArrayLike<number>, b: ArrayLike<number>) => [0, 1, 2].map(k => f32(f32(2 * a[k]) - b[k]))
        if (p.node.prop<string>('mode') === 'POSITION') {
            hl.set(twice(start, startHandleRight), 0)
            hr.set(startHandleRight, 0)
            hl.set(endHandleLeft, 3)
            hr.set(twice(end, endHandleLeft), 3)
        } else {
            for (let k = 0; k < 3; k++) {
                hl[k] = f32(start[k] - startHandleRight[k])
                hr[k] = f32(start[k] + startHandleRight[k])
                hl[3 + k] = f32(end[k] + endHandleLeft[k])
                hr[3 + k] = f32(end[k] - endHandleLeft[k])
            }
        }
        p.set('Curve', GeometrySet.fromCurves(curves))
    },
})
