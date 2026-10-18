/**
 * Curve evaluation - `bke::CurvesGeometry`'s evaluated data (`blenkernel/intern/curves_geometry.cc:640-1220`) and
 * the per-type `bke::curves::` evaluators: `catmull_rom` (`curve_catmull_rom.cc`), `bezier` (`curve_bezier.cc`),
 * `nurbs` (`curve_nurbs.cc`) and `poly` tangents/normals (`curve_poly.cc`), plus `length_parameterize`'s
 * `accumulate_lengths` (`BLI_length_parameterize.hh:31`).
 *
 * Blender caches all of this on the curves' runtime; here a `CurvesEvaluator` computes each part lazily for one
 * unchanged `CurvesGeometry` (make a new one after changing the curves).
 */

import {f32} from '../blender/f32'
import {angleSignedOnAxisV3V3V3} from '../blender/math/matrixC'
import {add3, angleNormalizedV3V3, cross3, dot3, isZero3, length3, normalize3, scale3, sub3, V3} from '../blender/math/vec'
import {CurvesGeometry} from './components'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {createDefaultMixer, mix2, mix4} from './mixers'
import {sincosf} from '../blender/libm'

export {mix4}

// region enums (`makesdna/DNA_curves_types.h:34-94`)
export const CURVE_TYPE_CATMULL_ROM = 0
export const CURVE_TYPE_POLY = 1
export const CURVE_TYPE_BEZIER = 2
export const CURVE_TYPE_NURBS = 3

export const BEZIER_HANDLE_FREE = 0
export const BEZIER_HANDLE_AUTO = 1
export const BEZIER_HANDLE_VECTOR = 2
export const BEZIER_HANDLE_ALIGN = 3

export const NURBS_KNOT_MODE_NORMAL = 0
export const NURBS_KNOT_MODE_ENDPOINT = 1
export const NURBS_KNOT_MODE_BEZIER = 2
export const NURBS_KNOT_MODE_ENDPOINT_BEZIER = 3
export const NURBS_KNOT_MODE_CUSTOM = 4

export const NORMAL_MODE_MINIMUM_TWIST = 0
export const NORMAL_MODE_Z_UP = 1
export const NORMAL_MODE_FREE = 2
// endregion

/** An attribute's values, or `size` copies of `def` when it does not exist (`get_varray_attribute`, `curves_geometry.cc:229-510`). */
export function curvesAttributeOr(curves: CurvesGeometry, name: string, size: number, def: number): ArrayLike<number> {
    const layer = curves.attributes.get(name)
    if (layer) return layer.data
    const out = new Float64Array(size)
    if (def !== 0) out.fill(def)
    return out
}

/** `CurvesGeometry::curve_types()` (`curves_geometry.cc:229`): Catmull Rom when the attribute does not exist. */
export function curveTypes(curves: CurvesGeometry): ArrayLike<number> {
    return curvesAttributeOr(curves, 'curve_type', curves.curvesNum, CURVE_TYPE_CATMULL_ROM)
}

/** `curves::segments_num` (`BKE_curves.hh:574`). */
export function segmentsNum(pointsNum: number, cyclic: boolean): number {
    return cyclic && pointsNum > 1 ? pointsNum : pointsNum - 1
}

// region Catmull Rom (`curve_catmull_rom.cc`)

/** `catmull_rom::calculate_evaluated_num` (:16). */
export function catmullRomEvaluatedNum(pointsNum: number, cyclic: boolean, resolution: number): number {
    const pointsPerSegment = Math.max(1, resolution)
    const evalNum = pointsPerSegment * segmentsNum(pointsNum, cyclic)
    if (cyclic) return Math.max(evalNum, 1)
    return evalNum + 1
}

/** `catmull_rom::calculate_basis` (:28). */
export function catmullRomBasis(parameter: number): [number, number, number, number] {
    const t = parameter
    const s = f32(1 - parameter)
    return [
        f32(f32(-t * s) * s),
        f32(2 + f32(f32(t * t) * f32(f32(3 * t) - 5))),
        f32(2 + f32(f32(s * s) * f32(f32(3 * s) - 5))),
        f32(f32(-s * t) * t),
    ]
}

/** `w.x * a + w.y * b + w.z * c + w.w * d`, left to right in float. */


/** `catmull_rom::interpolate<T>` (`BKE_curves.hh:842`). */
function catmullRomInterpolate(type: DataType, src: ArrayLike<number>, a: number, b: number, c: number, d: number, parameter: number,
    out: TypedArray, o: number): void {
    const weights = catmullRomBasis(parameter)
    if (type === 'float' || type === 'float2' || type === 'float3') {
        // "Save multiplications by adjusting weights after mix": `0.5f * mix4(weights, ...)`.
        mix4(type, weights, src, a, b, c, d, out, o)
        const n = DATA_TYPES[type].components
        for (let k = 0; k < n; k++) out[o * n + k] = f32(0.5 * out[o * n + k])
    } else {
        mix4(type, weights.map(x => f32(x * 0.5)), src, a, b, c, d, out, o)
    }
}

function copyElement(c: number, src: ArrayLike<number>, s: number, dst: TypedArray, d: number): void {
    for (let k = 0; k < c; k++) dst[d * c + k] = src[s * c + k]
}

/** `catmull_rom::evaluate_segment` (:41): `dst` is `[start, start + size)` of `out`. */
function catmullRomEvaluateSegment(type: DataType, src: ArrayLike<number>, a: number, b: number, c: number, d: number,
    out: TypedArray, start: number, size: number): void {
    const step = f32(1 / size)
    copyElement(DATA_TYPES[type].components, src, b, out, start)
    for (let i = 1; i < size; i++) catmullRomInterpolate(type, src, a, b, c, d, f32(i * step), out, start + i)
}

/**
 * `catmull_rom::interpolate_to_evaluated` (:57 with the per-curve resolution of :116): `src` holds the curve's
 * points, `dst` its evaluated points.
 */
export function catmullRomInterpolateToEvaluated(type: DataType, src: ArrayLike<number>, cyclic: boolean, resolution: number, dst: TypedArray): void {
    const pps = Math.max(1, resolution)
    catmullRomInterpolateRanges(type, src, cyclic, (i: number): [number, number] => [i * pps, pps], dst)
}

/** `catmull_rom::interpolate_to_evaluated(src, cyclic, evaluated_offsets, dst)` (:132): per-segment `offsets`. */
export function catmullRomInterpolateToEvaluatedOffsets(type: DataType, src: ArrayLike<number>, cyclic: boolean, offsets: ArrayLike<number>, dst: TypedArray): void {
    catmullRomInterpolateRanges(type, src, cyclic, (i: number): [number, number] => [offsets[i], offsets[i + 1] - offsets[i]], dst)
}

/** `catmull_rom::interpolate_to_evaluated` (:57) with a `range_fn` giving `[start, size]` of each segment. */
function catmullRomInterpolateRanges(type: DataType, src: ArrayLike<number>, cyclic: boolean, range: (i: number) => [number, number], dst: TypedArray): void {
    const c = DATA_TYPES[type].components
    const n = src.length / c
    const evalNum = dst.length / c
    if (n === 1) {
        copyElement(c, src, 0, dst, 0)
        return
    }
    const first = range(0)
    if (n === 2) {
        catmullRomEvaluateSegment(type, src, 0, 0, 1, 1, dst, first[0], first[1])
        if (cyclic) {
            const last = range(1)
            catmullRomEvaluateSegment(type, src, 1, 1, 0, 0, dst, last[0], last[1])
        } else {
            copyElement(c, src, 1, dst, evalNum - 1)
        }
        return
    }
    const secondToLast = range(n - 2)
    const last = range(n - 1)
    if (cyclic) {
        catmullRomEvaluateSegment(type, src, n - 1, 0, 1, 2, dst, first[0], first[1])
        catmullRomEvaluateSegment(type, src, n - 3, n - 2, n - 1, 0, dst, secondToLast[0], secondToLast[1])
        catmullRomEvaluateSegment(type, src, n - 2, n - 1, 0, 1, dst, last[0], last[1])
    } else {
        catmullRomEvaluateSegment(type, src, 0, 0, 1, 2, dst, first[0], first[1])
        catmullRomEvaluateSegment(type, src, n - 3, n - 2, n - 1, n - 1, dst, secondToLast[0], secondToLast[1])
        copyElement(c, src, n - 1, dst, evalNum - 1)
    }
    for (let i = 1; i < n - 2; i++) {
        const s = range(i)
        catmullRomEvaluateSegment(type, src, i - 1, i, i + 1, i + 2, dst, s[0], s[1])
    }
}
// endregion

// region Bezier (`curve_bezier.cc`, `BKE_curves.hh:1115-1145`)

/** `bezier::segment_is_vector(left, right)` (`BKE_curves.hh:1123`). */
const segmentIsVector = (left: number, right: number) => left === BEZIER_HANDLE_VECTOR && right === BEZIER_HANDLE_VECTOR

/**
 * `bezier::calculate_evaluated_offsets` (:33): `htl`/`htr` are the curve's handle types, `offsets` its
 * `points + 1` slice of the all-Bezier offsets.
 */
export function bezierCalculateEvaluatedOffsets(htl: ArrayLike<number>, htr: ArrayLike<number>, cyclic: boolean, resolution: number,
    offsets: Int32Array): void {
    const size = htl.length
    offsets[0] = 0
    if (size === 1) {
        offsets[1] = 1
        return
    }
    const pps = Math.max(1, resolution)
    let offset = 0
    for (let i = 0; i < size - 1; i++) {
        offsets[i] = offset
        offset += segmentIsVector(htr[i], htl[i + 1]) ? 1 : pps
    }
    offsets[size - 1] = offset
    if (cyclic) offset += segmentIsVector(htr[size - 1], htl[0]) ? 1 : pps
    else offset++
    offsets[size] = offset
}

/** `bezier::calculate_vector_handle` (`BKE_curves.hh:1141`): `math::interpolate(point, next, 1 / 3)`. */
export function bezierVectorHandle(point: ArrayLike<number>, next: ArrayLike<number>): V3 {
    const t = f32(1 / 3)
    const omt = f32(1 - t)
    return [0, 1, 2].map(k => f32(f32(point[k] * omt) + f32(next[k] * t))) as V3
}

/** `calculate_aligned_handle` (:89). */
export function calculateAlignedHandle(position: ArrayLike<number>, otherHandle: ArrayLike<number>, alignedHandle: ArrayLike<number>): V3 {
    const length = length3(sub3(alignedHandle, position))
    const dir = normalize3(sub3(otherHandle, position))
    return sub3(position, scale3(dir, length))
}

/** `calculate_point_handles` (:143). `left`/`right` are updated in place. */
function calculatePointHandles(typeLeft: number, typeRight: number, position: ArrayLike<number>, prevPosition: ArrayLike<number>,
    nextPosition: ArrayLike<number>, left: V3, right: V3): void {
    if (typeLeft === BEZIER_HANDLE_AUTO || typeRight === BEZIER_HANDLE_AUTO) {
        const prevDiff = sub3(position, prevPosition)
        const nextDiff = sub3(nextPosition, position)
        let prevLen = length3(prevDiff)
        let nextLen = length3(nextDiff)
        if (prevLen === 0) prevLen = 1
        if (nextLen === 0) nextLen = 1
        const dir = add3([f32(nextDiff[0] / nextLen), f32(nextDiff[1] / nextLen), f32(nextDiff[2] / nextLen)],
            [f32(prevDiff[0] / prevLen), f32(prevDiff[1] / prevLen), f32(prevDiff[2] / prevLen)])
        const len = f32(length3(dir) * f32(2.5614))
        if (len !== 0) {
            if (typeLeft === BEZIER_HANDLE_AUTO) {
                const n5 = f32(nextLen * 5)
                const prevLenClamped = n5 < prevLen ? n5 : prevLen
                const v = add3(position, scale3(dir, -f32(prevLenClamped / len)))
                left[0] = v[0]; left[1] = v[1]; left[2] = v[2]
            }
            if (typeRight === BEZIER_HANDLE_AUTO) {
                const p5 = f32(prevLen * 5)
                const nextLenClamped = p5 < nextLen ? p5 : nextLen
                const v = add3(position, scale3(dir, f32(nextLenClamped / len)))
                right[0] = v[0]; right[1] = v[1]; right[2] = v[2]
            }
        }
    }
    if (typeLeft === BEZIER_HANDLE_VECTOR) {
        const v = bezierVectorHandle(position, prevPosition)
        left[0] = v[0]; left[1] = v[1]; left[2] = v[2]
    }
    if (typeRight === BEZIER_HANDLE_VECTOR) {
        const v = bezierVectorHandle(position, nextPosition)
        right[0] = v[0]; right[1] = v[1]; right[2] = v[2]
    }
    if (typeLeft === BEZIER_HANDLE_ALIGN && typeRight !== BEZIER_HANDLE_ALIGN) {
        const v = calculateAlignedHandle(position, right, left)
        left[0] = v[0]; left[1] = v[1]; left[2] = v[2]
    } else if (typeLeft !== BEZIER_HANDLE_ALIGN && typeRight === BEZIER_HANDLE_ALIGN) {
        const v = calculateAlignedHandle(position, left, right)
        right[0] = v[0]; right[1] = v[1]; right[2] = v[2]
    }
}

/**
 * `bezier::calculate_auto_handles` (:263) for one curve: arrays are the curve's slices (`positionsLeft/Right`
 * written in place).
 */
export function bezierCalculateAutoHandles(cyclic: boolean, typesLeft: ArrayLike<number>, typesRight: ArrayLike<number>,
    positions: ArrayLike<number>, positionsLeft: Float32Array, positionsRight: Float32Array): void {
    const n = positions.length / 3
    if (n === 1) return
    const p = (i: number): V3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
    const twiceMinus = (a: V3, b: V3): V3 => [f32(f32(2 * a[0]) - b[0]), f32(f32(2 * a[1]) - b[1]), f32(f32(2 * a[2]) - b[2])]
    const run = (i: number, prev: V3, next: V3) => {
        const left = Array.from(positionsLeft.subarray(i * 3, i * 3 + 3)) as V3
        const right = Array.from(positionsRight.subarray(i * 3, i * 3 + 3)) as V3
        calculatePointHandles(typesLeft[i], typesRight[i], p(i), prev, next, left, right)
        positionsLeft.set(left, i * 3)
        positionsRight.set(right, i * 3)
    }
    run(0, cyclic ? p(n - 1) : twiceMinus(p(0), p(1)), p(1))
    for (let i = 1; i < n - 1; i++) run(i, p(i - 1), p(i + 1))
    run(n - 1, p(n - 2), cyclic ? p(0) : twiceMinus(p(n - 1), p(n - 2)))
}

/** `bezier::evaluate_segment_ex<float3>` (:304) into `out[start .. start + size)` (float3 elements). */
export function bezierEvaluateSegment(p0: ArrayLike<number>, p1: ArrayLike<number>, p2: ArrayLike<number>, p3: ArrayLike<number>,
    out: Float32Array, start: number, size: number): void {
    const invLen = f32(1 / size)
    const invLenSquared = f32(invLen * invLen)
    const invLenCubed = f32(invLenSquared * invLen)
    const q0: number[] = [], q1: number[] = [], q2: number[] = [], q3: number[] = []
    for (let k = 0; k < 3; k++) {
        const rt1 = f32(f32(3 * f32(p1[k] - p0[k])) * invLen)
        const rt2 = f32(f32(f32(f32(p0[k] - f32(2 * p1[k])) + p2[k]) * 3) * invLenSquared)
        const rt3 = f32(f32(f32(p3[k] - p0[k]) + f32(3 * f32(p1[k] - p2[k]))) * invLenCubed)
        q0[k] = p0[k]
        q1[k] = f32(f32(rt1 + rt2) + rt3)
        q2[k] = f32(f32(2 * rt2) + f32(6 * rt3))
        q3[k] = f32(6 * rt3)
    }
    for (let i = 0; i < size; i++) {
        for (let k = 0; k < 3; k++) {
            out[(start + i) * 3 + k] = q0[k]
            q0[k] = f32(q0[k] + q1[k])
            q1[k] = f32(q1[k] + q2[k])
            q2[k] = f32(q2[k] + q3[k])
        }
    }
}

/** `bezier::calculate_evaluated_positions` (:340). Arrays are the curve's slices; `offsets` has `points + 1` entries. */
export function bezierCalculateEvaluatedPositions(positions: Float32Array, handlesLeft: Float32Array, handlesRight: Float32Array,
    offsets: ArrayLike<number>, out: Float32Array): void {
    const n = positions.length / 3
    const p = (a: Float32Array, i: number) => a.subarray(i * 3, i * 3 + 3)
    if (offsets[n] - offsets[0] === 1) {
        out.set(p(positions, 0), 0)
        return
    }
    bezierEvaluateSegment(p(positions, 0), p(handlesRight, 0), p(handlesLeft, 1), p(positions, 1), out, offsets[0], offsets[1] - offsets[0])
    for (let i = 1; i < n - 1; i++) {
        const start = offsets[i], size = offsets[i + 1] - offsets[i]
        if (size === 1) out.set(p(positions, i), start * 3)
        else bezierEvaluateSegment(p(positions, i), p(handlesRight, i), p(handlesLeft, i + 1), p(positions, i + 1), out, start, size)
    }
    const lastStart = offsets[n - 1], lastSize = offsets[n] - offsets[n - 1]
    if (lastSize === 1) out.set(p(positions, n - 1), (out.length / 3 - 1) * 3)
    else bezierEvaluateSegment(p(positions, n - 1), p(handlesRight, n - 1), p(handlesLeft, 0), p(positions, 0), out, lastStart, lastSize)
}

/** `bezier::linear_interpolation` (:385) into `dst[start .. start + size)`. */
function bezierLinearInterpolation(type: DataType, src: ArrayLike<number>, a: number, b: number, dst: TypedArray, start: number, size: number): void {
    copyElement(DATA_TYPES[type].components, src, a, dst, start)
    const step = f32(1 / size)
    for (let i = 1; i < size; i++) mix2(type, f32(i * step), src, a, src, b, dst, start + i)
}

/** `bezier::interpolate_to_evaluated` (:395). */
export function bezierInterpolateToEvaluated(type: DataType, src: ArrayLike<number>, offsets: ArrayLike<number>, dst: TypedArray): void {
    const c = DATA_TYPES[type].components
    const n = src.length / c
    if (n === 1) {
        copyElement(c, src, 0, dst, 0)
        return
    }
    bezierLinearInterpolation(type, src, 0, 1, dst, offsets[0], offsets[1] - offsets[0])
    for (let i = 1; i < n - 1; i++) bezierLinearInterpolation(type, src, i, i + 1, dst, offsets[i], offsets[i + 1] - offsets[i])
    bezierLinearInterpolation(type, src, n - 1, 0, dst, offsets[n - 1], offsets[n] - offsets[n - 1])
}
// endregion

// region NURBS (`curve_nurbs.cc`, `BKE_curves.hh:1156-1166`)

export const nurbsKnotsNum = (pointsNum: number, order: number, cyclic: boolean) => pointsNum + order + (cyclic ? order - 1 : 0)
export const nurbsControlPointsNum = (pointsNum: number, order: number, cyclic: boolean) => pointsNum + (cyclic ? order - 1 : 0)

/** `nurbs::check_valid_eval_params` (:16). */
export function nurbsCheckValidEvalParams(pointsNum: number, order: number, cyclic: boolean, knotsMode: number, resolution: number): boolean {
    if (pointsNum < order) return false
    if (order < 2) return false
    if (resolution < 1) return false
    if (knotsMode === NURBS_KNOT_MODE_BEZIER || knotsMode === NURBS_KNOT_MODE_ENDPOINT_BEZIER) {
        if (knotsMode === NURBS_KNOT_MODE_BEZIER && pointsNum <= order) return false
        return !cyclic || pointsNum % (order - 1) === 0
    }
    return true
}

/** `calc_nonzero_knot_spans` (:44). */
function calcNonzeroKnotSpans(pointsNum: number, mode: number, order: number, cyclic: boolean): number {
    const isBezier = mode === NURBS_KNOT_MODE_BEZIER || mode === NURBS_KNOT_MODE_ENDPOINT_BEZIER
    const isEndPoint = mode === NURBS_KNOT_MODE_ENDPOINT || mode === NURBS_KNOT_MODE_ENDPOINT_BEZIER
    const repeatInner = isBezier ? order - 1 : 1
    const knotsBeforeGeometry = order + (isBezier && !isEndPoint && order > 2 ? 1 : 0)
    const knotsAfterGeometry = order - 1 + (cyclic && mode === NURBS_KNOT_MODE_ENDPOINT ? order - 2 : 0)
    const knotsTotal = nurbsKnotsNum(pointsNum, order, cyclic)
    const geometryKnots = knotsTotal - knotsBeforeGeometry - knotsAfterGeometry
    return Math.trunc((geometryKnots + repeatInner - 1) / repeatInner)
}

/** `nurbs::calculate_evaluated_num` (:89). Custom knots are not stored on `CurvesGeometry` here. */
export function nurbsEvaluatedNum(pointsNum: number, order: number, cyclic: boolean, resolution: number, knotsMode: number): number {
    if (!nurbsCheckValidEvalParams(pointsNum, order, cyclic, knotsMode, resolution)) return pointsNum
    if (knotsMode === NURBS_KNOT_MODE_CUSTOM) throw new Error('NURBS custom knots (CurvesGeometry::nurbs_custom_knots) are not ported')
    return resolution * calcNonzeroKnotSpans(pointsNum, knotsMode, order, cyclic) + (cyclic ? 0 : 1)
}

/** `nurbs::calculate_knots` (:122). */
export function nurbsCalculateKnots(pointsNum: number, mode: number, order: number, cyclic: boolean): Float32Array {
    const knots = new Float32Array(nurbsKnotsNum(pointsNum, order, cyclic))
    const isBezier = mode === NURBS_KNOT_MODE_BEZIER || mode === NURBS_KNOT_MODE_ENDPOINT_BEZIER
    const isEndPoint = mode === NURBS_KNOT_MODE_ENDPOINT || mode === NURBS_KNOT_MODE_ENDPOINT_BEZIER
    const repeatInner = isBezier ? order - 1 : 1
    const head = isEndPoint ? order - (cyclic ? 1 : 0) : (isBezier ? Math.min(2, repeatInner) : 1)
    const tail = cyclic ? 2 * order - 1 : (isEndPoint ? order : 0)
    let r = head
    let current = 0
    const offset = isEndPoint && cyclic ? 1 : 0
    if (offset) {
        knots[0] = current
        current = f32(current + 1)
    }
    for (let i = offset; i < knots.length - tail; i++) {
        knots[i] = current
        r--
        if (r === 0) {
            current = f32(current + 1)
            r = repeatInner
        }
    }
    const tailIndex = knots.length - tail
    for (let i = 0; i < tail; i++) knots[tailIndex + i] = f32(current + f32(knots[i] - knots[0]))
    return knots
}

/** `nurbs::BasisCache` (`BKE_curves.hh`). */
export interface NurbsBasisCache {
    weights: Float32Array
    startIndices: Int32Array
    invalid: boolean
}

const isBreakpoint = (knots: ArrayLike<number>, span: number) => f32(knots[span + 1] - knots[span]) > 0

/** `calculate_basis_for_point` (:204), "The NURBS Book" p. 70. */
function nurbsBasisForPoint(knots: ArrayLike<number>, degree: number, parameter: number, spanIndex: number,
    weights: Float32Array, w0: number): number {
    const order = degree + 1
    const left = new Float32Array(order), right = new Float32Array(order)
    weights[w0] = 1
    for (let j = 1; j <= degree; j++) {
        left[j] = f32(parameter - knots[spanIndex + 1 - j])
        right[j] = f32(knots[spanIndex + j] - parameter)
        let saved = 0
        for (let r = 0; r < j; r++) {
            const temp = f32(weights[w0 + r] / f32(right[r + 1] + left[j - r]))
            weights[w0 + r] = f32(saved + f32(right[r + 1] * temp))
            saved = f32(left[j - r] * temp)
        }
        weights[w0 + j] = saved
    }
    return spanIndex - degree
}

/** `nurbs::calculate_basis_cache` (:236). */
export function nurbsCalculateBasisCache(pointsNum: number, evaluatedNum: number, order: number, resolution: number, cyclic: boolean,
    knotsMode: number, knots: ArrayLike<number>): NurbsBasisCache {
    const cache: NurbsBasisCache = {weights: new Float32Array(evaluatedNum * order), startIndices: new Int32Array(evaluatedNum), invalid: false}
    const degree = order - 1
    const wrappedPointsNum = nurbsControlPointsNum(pointsNum, order, cyclic)
    if (evaluatedNum === 0) return cache
    if (!nurbsCheckValidEvalParams(pointsNum, order, cyclic, knotsMode, resolution)) return cache
    const spanOffsets: number[] = []
    for (let span = degree; span < wrappedPointsNum; span++) if (isBreakpoint(knots, span)) spanOffsets.push(span)
    for (let index = 0; index < spanOffsets.length; index++) {
        const span = spanOffsets[index]
        let evalPoint = index * resolution
        const knotDelta = f32(knots[span + 1] - knots[span])
        const knotStep = f32(knotDelta / resolution)
        for (let step = 0; step < resolution; step++) {
            const parameter = f32(knots[span] + f32(step * knotStep))
            cache.startIndices[evalPoint] = nurbsBasisForPoint(knots, degree, parameter, span, cache.weights, evalPoint * order)
            evalPoint++
        }
    }
    if (!cyclic) {
        cache.startIndices[evaluatedNum - 1] = nurbsBasisForPoint(knots, degree, knots[wrappedPointsNum], spanOffsets[spanOffsets.length - 1],
            cache.weights, cache.weights.length - order)
    }
    return cache
}

/** `nurbs::interpolate_to_evaluated` (:337) and its rational variant (:316). `controlWeights` is the curve's `nurbs_weight` slice. */
export function nurbsInterpolateToEvaluated(cache: NurbsBasisCache, order: number, controlWeights: ArrayLike<number> | undefined,
    type: DataType, src: ArrayLike<number>, dst: TypedArray): void {
    const c = DATA_TYPES[type].components
    if (cache.invalid) {
        dst.set(src as ArrayLike<number> & TypedArray)
        return
    }
    const n = src.length / c
    const mixer = createDefaultMixer(type, dst)
    const count = dst.length / c
    for (let i = 0; i < count; i++) {
        for (let j = 0; j < order; j++) {
            const point = (cache.startIndices[i] + j) % n
            const w = controlWeights ? f32(cache.weights[i * order + j] * controlWeights[point]) : cache.weights[i * order + j]
            mixer.mixIn(i, src, point, w)
        }
    }
    mixer.finalize()
}
// endregion

// region poly (`curve_poly.cc`)

const EPS_DIR = f32(1.0e-9)

/** `delta_dir` (:16). */
function deltaDir(pos: ArrayLike<number>, next: ArrayLike<number>): V3 | undefined {
    const delta = sub3(next, pos)
    const norm = length3(delta)
    if (norm < EPS_DIR) return undefined
    return [f32(delta[0] / norm), f32(delta[1] / norm), f32(delta[2] / norm)]
}

/** `direction_bisect` (:33). `state` holds `other_dir` and `is_equal`. */
function directionBisect(pos: ArrayLike<number>, next: ArrayLike<number>, state: {dir: V3, equal: boolean}): V3 {
    const prevEqual = state.equal
    const nextDelta = sub3(next, pos)
    const nextNorm = length3(nextDelta)
    state.equal = nextNorm < EPS_DIR
    if (state.equal) return state.dir
    const prevDir = state.dir
    state.dir = [f32(nextDelta[0] / nextNorm), f32(nextDelta[1] / nextNorm), f32(nextDelta[2] / nextNorm)]
    if (prevEqual) return state.dir
    const tangent = add3(prevDir, state.dir)
    const norm = length3(tangent)
    if (norm < f32(0.6627619)) {
        if (norm < 2e-7) return state.dir
        const binormal = cross3(state.dir, prevDir)
        const normal = sub3(state.dir, prevDir)
        return normalize3(cross3(binormal, normal))
    }
    return [f32(tangent[0] / norm), f32(tangent[1] / norm), f32(tangent[2] / norm)]
}

/** `poly::calculate_tangents` (:74) for one curve's evaluated positions. */
export function polyCalculateTangents(positions: Float32Array, cyclic: boolean, tangents: Float32Array): void {
    const n = positions.length / 3
    if (n === 0) return
    const p = (i: number) => positions.subarray(i * 3, i * 3 + 3)
    if (n === 1) {
        tangents.set([0, 0, 1])
        return
    }
    let firstValid = -1
    for (let i = 0; i < n - 1; i++) {
        const d = deltaDir(p(i), p(i + 1))
        if (d) {
            tangents.set(d, i * 3)
            firstValid = i
            break
        }
    }
    if (firstValid === -1) {
        for (let i = 0; i < n; i++) tangents.set([0, 0, 1], i * 3)
        return
    }
    const fv = Array.from(tangents.subarray(firstValid * 3, firstValid * 3 + 3)) as V3
    for (let i = 0; i < firstValid; i++) tangents.set(fv, i * 3)
    const state = {dir: fv, equal: false}
    for (let i = firstValid + 1; i < n - 1; i++) tangents.set(directionBisect(p(i), p(i + 1), state), i * 3)
    if (cyclic) {
        tangents.set(directionBisect(p(n - 1), p(0), state), (n - 1) * 3)
        tangents.set(directionBisect(p(0), p(1), state), 0)
    } else {
        const d = deltaDir(p(n - 2), p(n - 1))
        tangents.set(d ?? state.dir, (n - 1) * 3)
    }
}

const EPS_NORMAL = f32(1e-4)

/** The `vec_to_quat`-style initial normal of `calculate_normals_z_up` (:125) / `calculate_normals_minimum` (:173). */
function zUpNormal(t: ArrayLike<number>): V3 {
    if (f32(Math.abs(t[0]) + Math.abs(t[1])) < EPS_NORMAL) return [1, 0, 0]
    return normalize3([t[1], -t[0], 0])
}

/** `poly::calculate_normals_z_up` (:117). */
export function polyCalculateNormalsZUp(tangents: Float32Array, normals: Float32Array): void {
    for (let i = 0; i < tangents.length / 3; i++) normals.set(zUpNormal(tangents.subarray(i * 3, i * 3 + 3)), i * 3)
}

/** `math::rotate_direction_around_axis` (`blenlib/intern/math_rotation.cc:112`). `std::cos`/`std::sin` of a float are `cosf`/`sinf`. */
export function rotateDirectionAroundAxis(direction: ArrayLike<number>, axis: ArrayLike<number>, angle: number): V3 {
    const eps = f32(1.1920928955078125e-7)
    if (angle === 0 || (Math.abs(direction[0]) <= eps && Math.abs(direction[1]) <= eps && Math.abs(direction[2]) <= eps)) {
        return [direction[0], direction[1], direction[2]]
    }
    const axisScaled = scale3(axis, dot3(direction, axis))
    const diff = sub3(direction, axisScaled)
    const cross = cross3(axis, diff)
    const [s, c] = sincosf(angle)
    return add3(add3(axisScaled, scale3(diff, c)), scale3(cross, s))
}

/** `calculate_next_normal` (:140). */
function calculateNextNormal(lastNormal: V3, lastTangent: ArrayLike<number>, currentTangent: ArrayLike<number>): V3 {
    if (isZero3(lastTangent) || isZero3(currentTangent)) return lastNormal
    const angle = angleNormalizedV3V3(lastTangent, currentTangent)
    if (angle !== 0) {
        const axis = normalize3(cross3(lastTangent, currentTangent))
        if (!isZero3(axis)) return normalize3(rotateDirectionAroundAxis(lastNormal, axis, angle))
    }
    return lastNormal
}

/** `poly::calculate_normals_minimum` (:162). */
export function polyCalculateNormalsMinimum(tangents: Float32Array, cyclic: boolean, normals: Float32Array): void {
    const n = tangents.length / 3
    if (n === 0) return
    const t = (i: number) => tangents.subarray(i * 3, i * 3 + 3)
    const nr = (i: number) => Array.from(normals.subarray(i * 3, i * 3 + 3)) as V3
    normals.set(zUpNormal(t(0)), 0)
    for (let i = 1; i < n; i++) normals.set(calculateNextNormal(nr(i - 1), t(i - 1), t(i)), i * 3)
    if (!cyclic) return
    const uncorrectedLastNormal = calculateNextNormal(nr(n - 1), t(n - 1), t(0))
    let correctionAngle = angleSignedOnAxisV3V3V3(nr(0), uncorrectedLastNormal, t(0))
    if (correctionAngle > Math.PI) correctionAngle = f32(correctionAngle - 2 * Math.PI)
    const angleStep = f32(correctionAngle / n)
    for (let i = 0; i < n; i++) {
        const axis = t(i)
        if (isZero3(axis)) continue
        normals.set(rotateDirectionAroundAxis(nr(i), axis, f32(angleStep * i)), i * 3)
    }
}
// endregion

/** `length_parameterize::accumulate_lengths<float3>` (`BLI_length_parameterize.hh:31`) into `lengths[start ..)`. */
export function accumulateLengths(values: Float32Array, cyclic: boolean, lengths: Float32Array, start: number): void {
    const n = values.length / 3
    let length = 0
    const d = (a: number, b: number) => length3(sub3(values.subarray(a * 3, a * 3 + 3), values.subarray(b * 3, b * 3 + 3)))
    for (let i = 0; i < n - 1; i++) {
        length = f32(length + d(i, i + 1))
        lengths[start + i] = length
    }
    if (cyclic && n > 1) lengths[start + n - 1] = f32(length + d(n - 1, 0))
}

/**
 * The evaluated data of one `CurvesGeometry`: `evaluated_points_by_curve` (:705), `evaluated_positions` (:828),
 * `evaluated_tangents` (:917), `evaluated_normals` (:1040), `ensure_evaluated_lengths` (:1182) and
 * `interpolate_to_evaluated` (:1135).
 */
export class CurvesEvaluator {
    readonly types: ArrayLike<number>
    readonly cyclic: ArrayLike<number>
    readonly resolution: ArrayLike<number>
    readonly nurbsOrders: ArrayLike<number>
    readonly knotsModes: ArrayLike<number>
    /** `evaluated_offsets` (`curves_num + 1`). */
    readonly evaluatedOffsets: Int32Array
    /** `all_bezier_offsets`: `points + 1` entries per curve, at `per_curve_point_offsets_range` (`BKE_curves.hh:597`). */
    readonly allBezierOffsets: Int32Array
    private _nurbsCache?: (NurbsBasisCache | undefined)[]
    private _positions?: Float32Array
    private _tangents?: Float32Array
    private _normals?: Float32Array
    private _lengths?: Float32Array

    constructor(readonly curves: CurvesGeometry) {
        const nc = curves.curvesNum, np = curves.pointsNum
        this.types = curveTypes(curves)
        this.cyclic = curvesAttributeOr(curves, 'cyclic', nc, 0)
        this.resolution = curvesAttributeOr(curves, 'resolution', nc, 12)
        this.nurbsOrders = curvesAttributeOr(curves, 'nurbs_order', nc, 4)
        this.knotsModes = curvesAttributeOr(curves, 'knots_mode', nc, NURBS_KNOT_MODE_NORMAL)
        const hasBezier = Array.prototype.some.call(this.types, (t: number) => t === CURVE_TYPE_BEZIER)
        const htl = hasBezier ? curvesAttributeOr(curves, 'handle_type_left', np, 0) : undefined
        const htr = hasBezier ? curvesAttributeOr(curves, 'handle_type_right', np, 0) : undefined
        this.allBezierOffsets = new Int32Array(hasBezier ? np + nc : 0)
        // `calculate_evaluated_offsets` (:648) with `build_offsets` (:635).
        this.evaluatedOffsets = new Int32Array(nc + 1)
        let offset = 0
        for (let c = 0; c < nc; c++) {
            this.evaluatedOffsets[c] = offset
            const [s, e] = curves.pointsRange(c)
            const n = e - s
            const cyclic = !!this.cyclic[c]
            switch (this.types[c]) {
            case CURVE_TYPE_CATMULL_ROM: offset += catmullRomEvaluatedNum(n, cyclic, this.resolution[c]); break
            case CURVE_TYPE_POLY: offset += n; break
            case CURVE_TYPE_BEZIER: {
                const o = this.allBezierOffsets.subarray(c + s, c + e + 1)
                bezierCalculateEvaluatedOffsets(Array.prototype.slice.call(htl, s, e), Array.prototype.slice.call(htr, s, e), cyclic, this.resolution[c], o)
                offset += o[n]
                break
            }
            case CURVE_TYPE_NURBS: offset += nurbsEvaluatedNum(n, this.nurbsOrders[c], cyclic, this.resolution[c], this.knotsModes[c]); break
            default: throw new Error(`unknown curve type ${this.types[c]}`)
            }
        }
        this.evaluatedOffsets[nc] = offset
    }

    get evaluatedPointsNum(): number {
        return this.evaluatedOffsets[this.curves.curvesNum]
    }

    /** `evaluated_points_by_curve()[curve]` as `[start, end)`. */
    evaluatedRange(curve: number): [number, number] {
        return [this.evaluatedOffsets[curve], this.evaluatedOffsets[curve + 1]]
    }

    /** The curve's slice of `all_bezier_offsets`. */
    bezierOffsets(curve: number): Int32Array {
        const [s, e] = this.curves.pointsRange(curve)
        return this.allBezierOffsets.subarray(curve + s, curve + e + 1)
    }

    /** `ensure_nurbs_basis_cache` (:763). */
    nurbsBasisCache(curve: number): NurbsBasisCache {
        if (!this._nurbsCache) this._nurbsCache = new Array(this.curves.curvesNum)
        let cache = this._nurbsCache[curve]
        if (!cache) {
            const [s, e] = this.curves.pointsRange(curve)
            const n = e - s
            const order = this.nurbsOrders[curve], resolution = this.resolution[curve], cyclic = !!this.cyclic[curve]
            const mode = this.knotsModes[curve]
            const [es, ee] = this.evaluatedRange(curve)
            if (!nurbsCheckValidEvalParams(n, order, cyclic, mode, resolution)) {
                cache = {weights: new Float32Array(0), startIndices: new Int32Array(0), invalid: true}
            } else {
                const knots = nurbsCalculateKnots(n, mode, order, cyclic)
                cache = nurbsCalculateBasisCache(n, ee - es, order, resolution, cyclic, mode, knots)
            }
            this._nurbsCache[curve] = cache
        }
        return cache
    }

    /** `evaluated_positions` (:828). */
    get positions(): Float32Array {
        if (this._positions) return this._positions
        const curves = this.curves
        const positions = curves.positions
        const out = new Float32Array(this.evaluatedPointsNum * 3)
        const hl = curves.attributes.get('handle_left')?.data as Float32Array | undefined
        const hr = curves.attributes.get('handle_right')?.data as Float32Array | undefined
        const weights = curves.attributes.get('nurbs_weight')?.data
        for (let c = 0; c < curves.curvesNum; c++) {
            const [s, e] = curves.pointsRange(c)
            const [es, ee] = this.evaluatedRange(c)
            const src = positions.subarray(s * 3, e * 3)
            const dst = out.subarray(es * 3, ee * 3)
            switch (this.types[c]) {
            case CURVE_TYPE_CATMULL_ROM: catmullRomInterpolateToEvaluated('float3', src, !!this.cyclic[c], this.resolution[c], dst); break
            case CURVE_TYPE_POLY: dst.set(src); break
            case CURVE_TYPE_BEZIER:
                // Without handle positions the evaluated points are zero (`fill_points`, :878).
                if (hl && hr) bezierCalculateEvaluatedPositions(src, hl.subarray(s * 3, e * 3), hr.subarray(s * 3, e * 3), this.bezierOffsets(c), dst)
                break
            case CURVE_TYPE_NURBS:
                nurbsInterpolateToEvaluated(this.nurbsBasisCache(c), this.nurbsOrders[c], weights ? Array.prototype.slice.call(weights, s, e) : undefined,
                    'float3', src, dst)
                break
            }
        }
        return this._positions = out
    }

    /** `evaluated_tangents` (:917). */
    get tangents(): Float32Array {
        if (this._tangents) return this._tangents
        const curves = this.curves
        const positions = this.positions
        const out = new Float32Array(positions.length)
        for (let c = 0; c < curves.curvesNum; c++) {
            const [es, ee] = this.evaluatedRange(c)
            polyCalculateTangents(positions.subarray(es * 3, ee * 3), !!this.cyclic[c], out.subarray(es * 3, ee * 3))
        }
        const pos = curves.positions
        for (let c = 0; c < curves.curvesNum; c++) {
            if (this.types[c] !== CURVE_TYPE_BEZIER || this.cyclic[c]) continue
            const hl = curves.attributes.get('handle_left')?.data, hr = curves.attributes.get('handle_right')?.data
            if (!hl || !hr) throw new Error('evaluated_tangents: Bezier curve without handle positions (dereferences an empty optional in Blender)')
            const [s, e] = curves.pointsRange(c)
            const [es, ee] = this.evaluatedRange(c)
            const v = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
            const epsilon = f32(1e-6)
            if (!almostEqualRelative(v(hr, s), v(pos, s), epsilon)) out.set(normalize3(sub3(v(hr, s), v(pos, s))), es * 3)
            if (!almostEqualRelative(v(hl, e - 1), v(pos, e - 1), epsilon)) out.set(normalize3(sub3(v(pos, e - 1), v(hl, e - 1))), (ee - 1) * 3)
        }
        return this._tangents = out
    }

    /** `evaluated_normals` (:1040). */
    get normals(): Float32Array {
        if (this._normals) return this._normals
        const curves = this.curves
        const tangents = this.tangents
        const out = new Float32Array(tangents.length)
        const normalMode = curvesAttributeOr(curves, 'normal_mode', curves.curvesNum, NORMAL_MODE_MINIMUM_TWIST)
        const tiltLayer = curves.attributes.get('tilt')
        // `use_tilt`: the attribute exists (a non-single varray) or is a single non-zero value.
        const tilt = tiltLayer?.data as Float32Array | undefined
        const customNormal = curves.attributes.get('custom_normal')
        for (let c = 0; c < curves.curvesNum; c++) {
            const [es, ee] = this.evaluatedRange(c)
            const t = tangents.subarray(es * 3, ee * 3)
            const dst = out.subarray(es * 3, ee * 3)
            const [s, e] = curves.pointsRange(c)
            switch (normalMode[c]) {
            case NORMAL_MODE_Z_UP: polyCalculateNormalsZUp(t, dst); break
            case NORMAL_MODE_MINIMUM_TWIST: polyCalculateNormalsMinimum(t, !!this.cyclic[c], dst); break
            case NORMAL_MODE_FREE:
                if (!customNormal) polyCalculateNormalsZUp(t, dst)
                else {
                    this.interpolateToEvaluated(c, 'float3', (customNormal.data as Float32Array).subarray(s * 3, e * 3), dst)
                    for (let i = 0; i < ee - es; i++) dst.set(normalize3(dst.subarray(i * 3, i * 3 + 3)), i * 3)
                }
                break
            }
            if (tilt) {
                let tilts: ArrayLike<number>
                if (this.types[c] === CURVE_TYPE_POLY) tilts = tilt.subarray(s, e)
                else {
                    const et = new Float32Array(ee - es)
                    this.interpolateToEvaluated(c, 'float', tilt.subarray(s, e), et)
                    tilts = et
                }
                // `rotate_directions_around_axes` (:977).
                for (let i = 0; i < ee - es; i++) {
                    const axis = t.subarray(i * 3, i * 3 + 3)
                    if (isZero3(axis)) continue
                    dst.set(rotateDirectionAroundAxis(dst.subarray(i * 3, i * 3 + 3), axis, tilts[i]), i * 3)
                }
            }
        }
        return this._normals = out
    }

    /** `evaluate_generic_data_for_curve` (:1009): the curve's point values `src` to its evaluated points `dst`. */
    interpolateToEvaluated(curve: number, type: DataType, src: ArrayLike<number>, dst: TypedArray): void {
        const [s, e] = this.curves.pointsRange(curve)
        switch (this.types[curve]) {
        case CURVE_TYPE_CATMULL_ROM: catmullRomInterpolateToEvaluated(type, src, !!this.cyclic[curve], this.resolution[curve], dst); break
        case CURVE_TYPE_POLY: dst.set(src as TypedArray); break
        case CURVE_TYPE_BEZIER: bezierInterpolateToEvaluated(type, src, this.bezierOffsets(curve), dst); break
        case CURVE_TYPE_NURBS: {
            const weights = this.curves.attributes.get('nurbs_weight')?.data
            nurbsInterpolateToEvaluated(this.nurbsBasisCache(curve), this.nurbsOrders[curve], weights ? Array.prototype.slice.call(weights, s, e) : undefined,
                type, src, dst)
            break
        }
        }
    }

    /** `ensure_evaluated_lengths` (:1182): `evaluated_points_num + curves_num` values. */
    get lengths(): Float32Array {
        if (this._lengths) return this._lengths
        const curves = this.curves
        const positions = this.positions
        const out = new Float32Array(this.evaluatedPointsNum + curves.curvesNum)
        for (let c = 0; c < curves.curvesNum; c++) {
            const [es, ee] = this.evaluatedRange(c)
            accumulateLengths(positions.subarray(es * 3, ee * 3), !!this.cyclic[c], out, es + c)
        }
        return this._lengths = out
    }

    /** `evaluated_lengths_for_curve` (`BKE_curves.hh:1088`) via `lengths_range_for_curve` (:1079). */
    lengthsForCurve(curve: number): Float32Array {
        const [es, ee] = this.evaluatedRange(curve)
        const start = es + curve
        return this.lengths.subarray(start, start + segmentsNum(ee - es, !!this.cyclic[curve]))
    }

    /** `evaluated_length_total_for_curve` (`BKE_curves.hh:1095`). */
    lengthTotal(curve: number): number {
        const l = this.lengthsForCurve(curve)
        return l.length ? l[l.length - 1] : 0
    }
}

/** `math::almost_equal_relative(float3, float3, epsilon_factor)` (`BLI_math_vector.hh:25`). */
export function almostEqualRelative(a: ArrayLike<number>, b: ArrayLike<number>, epsilonFactor: number): boolean {
    for (let i = 0; i < 3; i++) {
        const epsilon = f32(epsilonFactor * Math.abs(a[i]))
        if (Math.abs(f32(a[i] - b[i])) > epsilon) return false
    }
    return true
}
