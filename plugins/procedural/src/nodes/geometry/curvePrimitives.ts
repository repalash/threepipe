/**
 * Curve primitives: Curve Line (`node_geo_curve_primitive_line.cc`), Curve Circle
 * (`node_geo_curve_primitive_circle.cc`), Bézier Segment (`node_geo_curve_primitive_bezier_segment.cc`), Arc, Spiral, Star,
 * Quadrilateral and Quadratic Bézier (`node_geo_curve_primitive_{arc,spiral,star,quadrilateral,quadratic_bezier}.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {cross3, interpolate3, length3, normalize3, sub3, V3} from '../../blender/math/vec'
import {CurvesGeometry} from '../../geometry/components'
import {BEZIER_HANDLE_ALIGN, CURVE_TYPE_BEZIER, CURVE_TYPE_POLY} from '../../geometry/curvesEval'
import {fillCurveTypes} from '../../geometry/curvesEdit'
import {AttributeFieldInput, GField} from '../../fields'
import {angleSignedOnAxisV3V3V3, axisAngleToMat3, mulV3M3V3} from '../../blender/math/matrixC'
import {normalTriV3} from '../../blender/math/geom'
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

// region Arc (`node_geo_curve_primitive_arc.cc`)

const add3f = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2])]
const scale3f = (a: ArrayLike<number>, s: number): V3 => [f32(a[0] * s), f32(a[1] * s), f32(a[2] * s)]
const eq3 = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
/** `math::distance_squared`. */
const distSq3 = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    const d = sub3(a, b)
    return f32(f32(f32(d[0] * d[0]) + f32(d[1] * d[1])) + f32(d[2] * d[2]))
}

/** `rotate_vector_around_axis` (:125): `axis_angle_to_mat3` then `mul_m3_v3`. */
const rotateVectorAroundAxis = (v: ArrayLike<number>, axis: ArrayLike<number>, angle: number) => mulV3M3V3(axisAngleToMat3(axis, angle), v)

interface ArcResult {
    curves?: CurvesGeometry
    center: V3
    normal: V3
    radius: number
}

/** `create_arc_curve_from_points` (:141). */
function createArcCurveFromPoints(resolution: number, a: V3, b: V3, c: V3, angleOffset: number, connectCenter: boolean, invertArc: boolean): ArcResult {
    const size = connectCenter ? resolution + 1 : resolution
    const curves = curvesNewSingle(size, CURVE_TYPE_POLY)
    const stepcount = resolution - 1
    const positions = curves.positions
    const isColinear = colinear(a, b, c)
    let center: V3
    let normal: V3
    let radius: number
    const midAC = scale3f(add3f(a, c), 0.5)
    normal = normalTriV3(a, c, b)
    if (isColinear || eq3(a, c) || eq3(a, b) || eq3(b, c) || resolution === 2) {
        // "If colinear, generate a point line between points" - between the two furthest apart.
        let p1: V3, p2: V3
        const ab = distSq3(a, b), ac = distSq3(a, c), bc = distSq3(b, c)
        if (ab > ac && ab > bc) [p1, p2] = [a, b]
        else if (bc > ab && bc > ac) [p1, p2] = [b, c]
        else [p1, p2] = [a, c]
        const step = f32(1 / stepcount)
        for (let i = 0; i < resolution; i++) positions.set(interpolate3(p1, p2, f32(step * i)), i * 3)
        center = midAC
        radius = 0
    } else {
        const midAB = scale3f(add3f(a, b), 0.5)
        const midBC = scale3f(add3f(c, b), 0.5)
        const nba = normalize3(sub3(b, a))
        const ncb = normalize3(sub3(c, b))
        const nabc = normalize3(cross3(nba, ncb))
        const isect = isectPlanePlanePlane(planeFromPointNormal(midAB, nabc), planeFromPointNormal(midAB, nba), planeFromPointNormal(midBC, ncb))
        if (!isect) return {center: midAC, normal, radius: 0}
        center = isect
        const radA = normalize3(sub3(a, center))
        const radB = normalize3(sub3(b, center))
        const radC = normalize3(sub3(c, center))
        radius = length3(sub3(center, b))
        // `float + 2.0f * M_PI`: the sum in double, stored as float.
        const angleAB = f32(angleSignedOnAxisV3V3V3(radA, radB, normal) + 2 * Math.PI)
        const angleAC = f32(angleSignedOnAxisV3V3V3(radA, radC, normal) + 2 * Math.PI)
        let angle = angleAC > angleAB ? angleAC : angleAB
        angle = f32(angle - 2 * Math.PI)
        if (invertArc) angle = f32(-(2 * Math.PI - angle))
        const step = f32(angle / stepcount)
        const negNormal: V3 = [-normal[0], -normal[1], -normal[2]]
        for (let i = 0; i < resolution; i++) {
            const factor = f32(f32(step * i) + angleOffset)
            const out = rotateVectorAroundAxis(radA, negNormal, factor)
            positions.set(add3f(scale3f(out, radius), center), i * 3)
        }
    }
    if (connectCenter) {
        curves.accessor().add('cyclic', AttrDomain.Curve, 'bool', [1])
        positions.set(center, resolution * 3)
    }
    // "Ensure normal is relative to Z-up": `dot(float3(0, 0, 1), normal) < 0`.
    if (f32(f32(f32(0 * normal[0]) + f32(0 * normal[1])) + f32(1 * normal[2])) < 0) normal = [-normal[0], -normal[1], -normal[2]]
    return {curves, center, normal, radius}
}

/** `create_arc_curve_from_radius` (:256). */
function createArcCurveFromRadius(resolution: number, radius: number, startAngle: number, sweepAngle: number, connectCenter: boolean, invertArc: boolean): CurvesGeometry {
    const size = connectCenter ? resolution + 1 : resolution
    const curves = curvesNewSingle(size, CURVE_TYPE_POLY)
    const stepcount = resolution - 1
    const positions = curves.positions
    const sweep = invertArc ? f32(-(2 * Math.PI - sweepAngle)) : sweepAngle
    const thetaStep = f32(sweep / stepcount)
    for (let i = 0; i < resolution; i++) {
        const theta = f32(f32(thetaStep * i) + startAngle)
        positions[i * 3] = f32(radius * cosf(theta))
        positions[i * 3 + 1] = f32(radius * sinf(theta))
        positions[i * 3 + 2] = 0
    }
    if (connectCenter) {
        curves.accessor().add('cyclic', AttrDomain.Curve, 'bool', [1])
        positions.set([0, 0, 0], resolution * 3)
    }
    return curves
}

registerNodeType({
    idname: 'GeometryNodeCurveArc',
    label: 'Arc',
    // `node_init` (:117): RADIUS.
    properties: {mode: 'RADIUS'},
    enums: {mode: ['POINTS', 'RADIUS']},
    declare(b, node) {
        const points = node.prop<string>('mode') === 'POINTS'
        b.input('INT', 'Resolution').default(16).min(2).max(256).subtype('UNSIGNED')
        b.input('VECTOR', 'Start').default([-1, 0, 0]).subtype('TRANSLATION').available(points)
        b.input('VECTOR', 'Middle').default([0, 2, 0]).subtype('TRANSLATION').available(points)
        b.input('VECTOR', 'End').default([1, 0, 0]).subtype('TRANSLATION').available(points)
        b.input('FLOAT', 'Radius').default(1).min(0).subtype('DISTANCE').available(!points)
        b.input('FLOAT', 'Start Angle').default(0).subtype('ANGLE').available(!points)
        b.input('FLOAT', 'Sweep Angle').default(f32(1.75 * Math.PI)).min(f32(-2 * Math.PI)).max(f32(2 * Math.PI)).subtype('ANGLE').available(!points)
        b.input('FLOAT', 'Offset Angle').default(0).subtype('ANGLE').available(points)
        b.input('BOOLEAN', 'Connect Center').default(false)
        b.input('BOOLEAN', 'Invert Arc').default(false)
        b.output('GEOMETRY', 'Curve')
        b.output('VECTOR', 'Center').available(points)
        b.output('VECTOR', 'Normal').available(points)
        b.output('FLOAT', 'Radius').available(points)
    },
    // `node_geo_exec` (:285).
    execute(p) {
        const resolution = Math.max(p.int('Resolution'), 2)
        if (p.node.prop<string>('mode') === 'POINTS') {
            const r = createArcCurveFromPoints(resolution, p.vector('Start'), p.vector('Middle'), p.vector('End'), p.float('Offset Angle'),
                p.bool('Connect Center'), p.bool('Invert Arc'))
            p.set('Curve', r.curves ? GeometrySet.fromCurves(r.curves) : new GeometrySet())
            p.set('Center', GField.constant('float3', r.center))
            p.set('Normal', GField.constant('float3', r.normal))
            p.set('Radius', GField.constant('float', [r.radius]))
            return
        }
        p.set('Curve', GeometrySet.fromCurves(createArcCurveFromRadius(resolution, p.float('Radius'), p.float('Start Angle'), p.float('Sweep Angle'),
            p.bool('Connect Center'), p.bool('Invert Arc'))))
    },
})

// endregion

registerNodeType({
    idname: 'GeometryNodeCurveSpiral',
    label: 'Spiral',
    declare(b) {
        b.input('INT', 'Resolution').default(32).min(1).max(1024).subtype('UNSIGNED')
        b.input('FLOAT', 'Rotations').default(2).min(0)
        b.input('FLOAT', 'Start Radius').default(1).subtype('DISTANCE')
        b.input('FLOAT', 'End Radius').default(2).subtype('DISTANCE')
        b.input('FLOAT', 'Height').default(2).subtype('DISTANCE')
        b.input('BOOLEAN', 'Reverse')
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:72) with `create_spiral_curve` (:44).
    execute(p) {
        const rotations = Math.max(p.float('Rotations'), 0)
        if (rotations === 0) return
        const resolution = Math.max(p.int('Resolution'), 1)
        const startRadius = p.float('Start Radius'), endRadius = p.float('End Radius'), height = p.float('Height')
        const direction = p.bool('Reverse')
        const totalpoints = Math.max(Math.trunc(f32(resolution * rotations)), 1)
        const deltaRadius = f32(f32(endRadius - startRadius) / totalpoints)
        const deltaHeight = f32(height / totalpoints)
        // `(M_PI * 2 * rotations) / float(totalpoints) * (direction ? 1.0f : -1.0f)` in double.
        const deltaTheta = f32(Math.PI * 2 * rotations / totalpoints * (direction ? 1 : -1))
        const curves = curvesNewSingle(totalpoints + 1, CURVE_TYPE_POLY)
        const positions = curves.positions
        for (let i = 0; i <= totalpoints; i++) {
            const theta = f32(i * deltaTheta)
            const radius = f32(startRadius + f32(i * deltaRadius))
            positions[i * 3] = f32(radius * cosf(theta))
            positions[i * 3 + 1] = f32(radius * sinf(theta))
            positions[i * 3 + 2] = f32(deltaHeight * i)
        }
        p.set('Curve', GeometrySet.fromCurves(curves))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurveStar',
    label: 'Star',
    declare(b) {
        b.input('INT', 'Points').default(8).min(3).max(256).subtype('UNSIGNED')
        b.input('FLOAT', 'Inner Radius').default(1).min(0).subtype('DISTANCE')
        b.input('FLOAT', 'Outer Radius').default(2).min(0).subtype('DISTANCE')
        b.input('FLOAT', 'Twist').subtype('ANGLE')
        b.output('GEOMETRY', 'Curve')
        b.output('BOOLEAN', 'Outer Points').field()
    },
    // `node_geo_exec` (:72) with `create_star_curve` (:44).
    execute(p) {
        const inner = Math.max(p.float('Inner Radius'), 0), outer = Math.max(p.float('Outer Radius'), 0)
        const twist = p.float('Twist'), points = Math.max(p.int('Points'), 3)
        const curves = curvesNewSingle(points * 2, CURVE_TYPE_POLY)
        curves.accessor().add('cyclic', AttrDomain.Curve, 'bool', [1])
        const positions = curves.positions
        const thetaStep = f32(2 * Math.PI / points)
        for (let i = 0; i < points; i++) {
            const t = f32(thetaStep * i)
            positions.set([f32(outer * cosf(t)), f32(outer * sinf(t)), 0], i * 6)
            const ti = f32(f32(t + f32(thetaStep * 0.5)) + twist)
            positions.set([f32(inner * cosf(ti)), f32(inner * sinf(ti)), 0], i * 6 + 3)
        }
        if (p.outputUsed('Outer Points')) {
            // `create_selection_output` (:61).
            const id = p.anonymousName('Outer Points')
            const sel = new Uint8Array(points * 2)
            for (let i = 0; i < sel.length; i++) sel[i] = i % 2 === 0 ? 1 : 0
            curves.accessor().add(id, AttrDomain.Point, 'bool', sel)
            p.set('Outer Points', GField.fromInput(new AttributeFieldInput(id, 'bool')))
        }
        p.set('Curve', GeometrySet.fromCurves(curves))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurvePrimitiveQuadrilateral',
    label: 'Quadrilateral',
    // `node_init` (:117): RECTANGLE.
    properties: {mode: 'RECTANGLE'},
    enums: {mode: ['RECTANGLE', 'PARALLELOGRAM', 'TRAPEZOID', 'KITE', 'POINTS']},
    declare(b, node) {
        const mode = node.prop<string>('mode')
        const is = (...m: string[]) => m.includes(mode)
        b.input('FLOAT', 'Width').default(2).min(0).subtype('DISTANCE').available(is('RECTANGLE', 'PARALLELOGRAM', 'KITE'))
        b.input('FLOAT', 'Height').default(2).min(0).subtype('DISTANCE').available(is('RECTANGLE', 'PARALLELOGRAM', 'TRAPEZOID'))
        b.input('FLOAT', 'Bottom Width').default(4).min(0).subtype('DISTANCE').available(is('TRAPEZOID'))
        b.input('FLOAT', 'Top Width').default(2).min(0).subtype('DISTANCE').available(is('TRAPEZOID'))
        b.input('FLOAT', 'Offset').default(1).subtype('DISTANCE').available(is('PARALLELOGRAM', 'TRAPEZOID'))
        b.input('FLOAT', 'Bottom Height').default(3).min(0).subtype('DISTANCE').available(is('KITE'))
        b.input('FLOAT', 'Top Height').default(1).subtype('DISTANCE').available(is('KITE'))
        b.input('VECTOR', 'Point 1').default([-1, -1, 0]).subtype('TRANSLATION').available(is('POINTS'))
        b.input('VECTOR', 'Point 2').default([1, -1, 0]).subtype('TRANSLATION').available(is('POINTS'))
        b.input('VECTOR', 'Point 3').default([1, 1, 0]).subtype('TRANSLATION').available(is('POINTS'))
        b.input('VECTOR', 'Point 4').default([-1, 1, 0]).subtype('TRANSLATION').available(is('POINTS'))
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:216).
    execute(p) {
        const curves = curvesNewSingle(4, CURVE_TYPE_POLY)
        curves.accessor().add('cyclic', AttrDomain.Curve, 'bool', [1])
        const positions = curves.positions
        const half = (v: number) => f32(v / 2)
        const pos = (pts: number[][]) => pts.forEach((v, i) => positions.set(v, i * 3))
        switch (p.node.prop<string>('mode')) {
        case 'RECTANGLE': {
            const h = Math.max(p.float('Height'), 0), w = Math.max(p.float('Width'), 0)
            pos([[half(w), half(h), 0], [half(-w), half(h), 0], [half(-w), half(-h), 0], [half(w), half(-h), 0]])
            break
        }
        case 'PARALLELOGRAM': {
            const h = Math.max(p.float('Height'), 0), w = Math.max(p.float('Width'), 0), o = p.float('Offset')
            pos([[f32(half(w) + half(o)), half(h), 0], [f32(half(-w) + half(o)), half(h), 0], [f32(half(-w) - half(o)), half(-h), 0],
                [f32(half(w) - half(o)), half(-h), 0]])
            break
        }
        case 'TRAPEZOID': {
            const bottom = Math.max(p.float('Bottom Width'), 0), top = Math.max(p.float('Top Width'), 0), o = p.float('Offset')
            const h = Math.max(p.float('Height'), 0)
            pos([[f32(half(top) + o), half(h), 0], [f32(half(-top) + o), half(h), 0], [half(-bottom), half(-h), 0], [half(bottom), half(-h), 0]])
            break
        }
        case 'KITE': {
            const w = Math.max(p.float('Width'), 0), bh = Math.max(p.float('Bottom Height'), 0), th = p.float('Top Height')
            pos([[0, -bh, 0], [half(w), 0, 0], [0, th, 0], [half(-w), 0, 0]])
            break
        }
        case 'POINTS':
            pos([p.vector('Point 1'), p.vector('Point 2'), p.vector('Point 3'), p.vector('Point 4')])
            break
        default:
            return
        }
        p.set('Curve', GeometrySet.fromCurves(curves))
    },
})

registerNodeType({
    idname: 'GeometryNodeCurveQuadraticBezier',
    label: 'Quadratic Bézier',
    dslName: 'QuadraticBezier',
    declare(b) {
        b.input('INT', 'Resolution').default(16).min(3).max(256).subtype('UNSIGNED')
        b.input('VECTOR', 'Start').default([-1, 0, 0]).subtype('TRANSLATION')
        b.input('VECTOR', 'Middle').default([0, 2, 0]).subtype('TRANSLATION')
        b.input('VECTOR', 'End').default([1, 0, 0]).subtype('TRANSLATION')
        b.output('GEOMETRY', 'Curve')
    },
    // `node_geo_exec` (:56) with `create_quadratic_bezier_curve` (:37).
    execute(p) {
        const resolution = Math.max(p.int('Resolution'), 3)
        const p1 = p.vector('Start'), p2 = p.vector('Middle'), p3 = p.vector('End')
        const curves = curvesNewSingle(resolution + 1, CURVE_TYPE_POLY)
        const step = f32(1 / resolution)
        for (let i = 0; i <= resolution; i++) {
            const factor = f32(step * i)
            curves.positions.set(interpolate3(interpolate3(p1, p2, factor), interpolate3(p2, p3, factor), factor), i * 3)
        }
        p.set('Curve', GeometrySet.fromCurves(curves))
    },
})
