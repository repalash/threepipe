/**
 * `geometry::fillet_curves_poly` / `fillet_curves_bezier` (Blender 5.2.2 `geometry/intern/fillet_curves.cc`). Line
 * numbers below refer to that file. `std::tan`/`std::sin`/`std::cos` of floats are `tanf`/`sinf`/`cosf`.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {angleV3V3, cross3, length3, normalize3, sub3, V3} from '../blender/math/vec'
import {axisAngleNormalizedToMat3Ex, mulV3M3V3} from '../blender/math/matrixC'
import {CurvesGeometry} from './components'
import {BEZIER_HANDLE_ALIGN, BEZIER_HANDLE_VECTOR, bezierVectorHandle, CURVE_TYPE_BEZIER, CURVE_TYPE_NURBS, curvesAttributeOr, curveTypes, NURBS_KNOT_MODE_CUSTOM} from './curvesEval'
import {calculateBezierAutoHandles, curvesAttributeForWrite} from './curvesEdit'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {copyOnlyCurveDomain} from './resampleCurves'

const tanf = (x: number) => f32(Math.tan(x))
const get3 = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]]
const add = (a: V3, b: V3): V3 => [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2])]
const mul = (a: V3, s: number): V3 => [f32(a[0] * s), f32(a[1] * s), f32(a[2] * s)]

/** `calculate_directions` (:85). */
function calculateDirections(p: V3[]): V3[] {
    const n = p.length
    const d: V3[] = new Array(n)
    for (let i = 0; i < n - 1; i++) d[i] = normalize3(sub3(p[i + 1], p[i]))
    d[n - 1] = normalize3(sub3(p[0], p[n - 1]))
    return d
}

/** `calculate_angles` (:93): `M_PI - angle_v3v3(...)` in double, stored as float. */
function calculateAngles(d: V3[]): number[] {
    const n = d.length
    const a = new Array<number>(n)
    a[0] = f32(Math.PI - angleV3V3(neg(d[n - 1]), d[0]))
    for (let i = 1; i < n; i++) a[i] = f32(Math.PI - angleV3V3(neg(d[i - 1]), d[i]))
    return a
}

/** `math::safe_divide`. */
const safeDivide = (a: number, b: number) => (b === 0 ? 0 : f32(a / b))
const clamp01 = (v: number) => (v < 0 ? 0 : 1 < v ? 1 : v)

/** `limit_radius` (:106). */
function limitRadius(positionPrev: V3, position: V3, positionNext: V3, anglePrev: number, angle: number, angleNext: number,
    radiusPrev: number, radius: number, radiusNext: number): number {
    const displacement = f32(radius * tanf(f32(angle / 2)))
    const displacementPrev = f32(radiusPrev * tanf(f32(anglePrev / 2)))
    const segmentLengthPrev = length3(sub3(position, positionPrev))
    const totalDisplacementPrev = f32(displacementPrev + displacement)
    const factorPrev = clamp01(safeDivide(segmentLengthPrev, totalDisplacementPrev))
    const displacementNext = f32(radiusNext * tanf(f32(angleNext / 2)))
    const segmentLengthNext = length3(sub3(position, positionNext))
    const totalDisplacementNext = f32(displacementNext + displacement)
    const factorNext = clamp01(safeDivide(segmentLengthNext, totalDisplacementNext))
    return f32(radius * Math.min(factorPrev, factorNext))
}

/** `limit_radii` (:133). */
function limitRadii(p: V3[], angles: number[], radii: number[], cyclic: boolean): number[] {
    const n = p.length
    const out = new Array<number>(n)
    if (cyclic) {
        out[0] = limitRadius(p[n - 1], p[0], p[1], angles[n - 1], angles[0], angles[1], radii[n - 1], radii[0], radii[1])
        for (let i = 1; i < n - 1; i++) out[i] = limitRadius(p[i - 1], p[i], p[i + 1], angles[i - 1], angles[i], angles[i + 1], radii[i - 1], radii[i], radii[i + 1])
        out[n - 1] = limitRadius(p[n - 2], p[n - 1], p[0], angles[n - 2], angles[n - 1], angles[0], radii[n - 2], radii[n - 1], radii[0])
    } else {
        const iLast = n - 1
        out[0] = 0
        for (let i = 1; i < n - 1; i++) {
            const radiusPrev = i - 1 === 0 ? 0 : radii[i - 1]
            const radiusNext = i + 1 === iLast ? 0 : radii[i + 1]
            out[i] = limitRadius(p[i - 1], p[i], p[i + 1], angles[i - 1], angles[i], angles[i + 1], radiusPrev, radii[i], radiusNext)
        }
        out[n - 1] = 0
    }
    return out
}

/** `math::rotate_around_axis` (`blenlib/intern/math_rotation.cc:129`). */
function rotateAroundAxis(vector: V3, center: V3, axis: V3, angle: number): V3 {
    const r = sub3(vector, center)
    const m = axisAngleNormalizedToMat3Ex(axis, f32(Math.sin(angle)), f32(Math.cos(angle)))
    return add(mulV3M3V3(m, r), center)
}

/** `calculate_fillet_positions` (:202): `offsets` are the curve's `points + 1` arc offsets, `dst` its result positions. */
function calculateFilletPositions(src: V3[], angles: number[], radii: number[], directions: V3[], offsets: ArrayLike<number>, dst: Float32Array): void {
    const iSrcLast = src.length - 1
    for (let iSrc = 0; iSrc < src.length; iSrc++) {
        const arcStart = offsets[iSrc], arcSize = offsets[iSrc + 1] - offsets[iSrc]
        const s = src[iSrc]
        if (arcSize === 1) {
            dst.set(s, arcStart * 3)
            continue
        }
        const iSrcPrev = iSrc === 0 ? iSrcLast : iSrc - 1
        const angle = angles[iSrc]
        const radius = radii[iSrc]
        const displacement = f32(radius * tanf(f32(angle / 2)))
        const prevDir = neg(directions[iSrcPrev])
        const nextDir = directions[iSrc]
        const start = add(s, mul(prevDir, displacement))
        const end = add(s, mul(nextDir, displacement))
        dst.set(start, arcStart * 3)
        dst.set(end, (arcStart + arcSize - 1) * 3)
        const middle = arcSize - 2
        if (middle <= 0) continue
        const axis = neg(normalize3(cross3(prevDir, nextDir)))
        // `math::midpoint(next_dir, prev_dir)`: `(a + b) * 0.5f`.
        const centerDirection = normalize3(mul(add(nextDir, prevDir), 0.5))
        const distanceToCenter = f32(Math.sqrt(f32(f32(radius * radius) + f32(displacement * displacement))))
        const center = add(s, mul(centerDirection, distanceToCenter))
        const segmentAngle = f32(angle / (middle + 1))
        for (let i = 0; i < middle; i++) dst.set(rotateAroundAxis(start, center, axis, f32(segmentAngle * (i + 1))), (arcStart + 1 + i) * 3)
    }
}

interface Handles {
    hl: Float32Array
    hr: Float32Array
    tl: TypedArray
    tr: TypedArray
}

/** `calculate_bezier_handles_bezier_mode` (:256). */
function bezierHandlesBezierMode(src: Handles, s: number, n: number, angles: number[], radii: number[], directions: V3[], offsets: ArrayLike<number>,
    dstPositions: Float32Array, dst: Handles, d: number, dstN: number): void {
    const iSrcLast = n - 1
    const iDstLast = dstN - 1
    const P = (i: number) => get3(dstPositions, d + i)
    for (let iSrc = 0; iSrc < n; iSrc++) {
        const arcStart = offsets[iSrc], arcSize = offsets[iSrc + 1] - offsets[iSrc]
        if (arcSize === 1) {
            dst.hl.set(get3(src.hl, s + iSrc), (d + arcStart) * 3)
            dst.hr.set(get3(src.hr, s + iSrc), (d + arcStart) * 3)
            dst.tl[d + arcStart] = src.tl[s + iSrc]
            dst.tr[d + arcStart] = src.tr[s + iSrc]
            continue
        }
        const a = arcStart, b = arcStart + arcSize - 1
        const iSrcPrev = iSrc === 0 ? iSrcLast : iSrc - 1
        const angle = angles[iSrc]
        const radius = radii[iSrc]
        const prevDir = neg(directions[iSrcPrev])
        const nextDir = directions[iSrc]
        const arcStartPos = P(a), arcEndPos = P(b)
        const iDstPrev = a === 0 ? iDstLast : a - 1
        const iDstNext = b === iDstLast ? 0 : b + 1
        dst.hl.set(bezierVectorHandle(P(a), P(iDstPrev)), (d + a) * 3)
        dst.hr.set(bezierVectorHandle(P(b), P(iDstNext)), (d + b) * 3)
        dst.tl[d + a] = BEZIER_HANDLE_VECTOR
        dst.tr[d + b] = BEZIER_HANDLE_VECTOR
        // `(4.0f / 3.0f) * radius * std::tan(angle / 4.0f)`.
        const handleLength = f32(f32(f32(4 / 3) * radius) * tanf(f32(angle / 4)))
        dst.hr.set(sub3(arcStartPos, mul(prevDir, handleLength)), (d + a) * 3)
        dst.hl.set(sub3(arcEndPos, mul(nextDir, handleLength)), (d + b) * 3)
        dst.tr[d + a] = BEZIER_HANDLE_ALIGN
        dst.tl[d + b] = BEZIER_HANDLE_ALIGN
    }
}

/** `calculate_bezier_handles_poly_mode` (:321). */
function bezierHandlesPolyMode(src: Handles, s: number, n: number, offsets: ArrayLike<number>, dstPositions: Float32Array, dst: Handles, d: number, dstN: number): void {
    const iDstLast = dstN - 1
    const P = (i: number) => get3(dstPositions, d + i)
    for (let iSrc = 0; iSrc < n; iSrc++) {
        const arcStart = offsets[iSrc], arcSize = offsets[iSrc + 1] - offsets[iSrc]
        if (arcSize === 1) {
            dst.hl.set(get3(src.hl, s + iSrc), (d + arcStart) * 3)
            dst.hr.set(get3(src.hr, s + iSrc), (d + arcStart) * 3)
            dst.tl[d + arcStart] = src.tl[s + iSrc]
            dst.tr[d + arcStart] = src.tr[s + iSrc]
            continue
        }
        const first = arcStart, last = arcStart + arcSize - 1
        dst.tl.fill(BEZIER_HANDLE_VECTOR, d + first, d + last + 1)
        dst.tr.fill(BEZIER_HANDLE_VECTOR, d + first, d + last + 1)
        const iDstPrev = first === 0 ? iDstLast : first - 1
        const iDstNext = last === iDstLast ? 0 : last + 1
        dst.hl.set(bezierVectorHandle(P(first), P(iDstPrev)), (d + first) * 3)
        dst.hr.set(bezierVectorHandle(P(last), P(iDstNext)), (d + last) * 3)
        for (let i = first + 1; i < last; i++) {
            dst.hr.set(bezierVectorHandle(P(i), P(i - 1)), (d + i) * 3)
            dst.hl.set(bezierVectorHandle(P(i), P(i + 1)), (d + i) * 3)
        }
    }
}

/** `fillet_curves` (:370) on every curve. `radiusInput` / `counts` hold a value per point. */
export function filletCurves(src: CurvesGeometry, radiusInput: ArrayLike<number>, counts: ArrayLike<number>, limitRadiusOn: boolean, useBezierMode: boolean): CurvesGeometry {
    if (src.pointsNum === 0) return src.clone()
    const nc = src.curvesNum
    const cyclic = curvesAttributeOr(src, 'cyclic', nc, 0)
    const types = curveTypes(src)
    const knots = curvesAttributeOr(src, 'knots_mode', nc, 0)
    for (let c = 0; c < nc; c++) if (types[c] === CURVE_TYPE_NURBS && knots[c] === NURBS_KNOT_MODE_CUSTOM) throw new Error('fillet_curves: NURBS custom knots (update_custom_knot_modes) are not ported')
    // `calculate_result_offsets` (:37).
    const all = new Int32Array(src.pointsNum + nc)
    const sizes: number[] = []
    for (let c = 0; c < nc; c++) {
        const [s, e] = src.pointsRange(c)
        const n = e - s
        const o = all.subarray(s + c, e + c + 1)
        for (let i = 0; i < n; i++) o[i] = Math.max(counts[s + i], 0) + 1
        if (!cyclic[c]) {
            o[0] = 1
            o[n - 1] = 1
        }
        for (let i = 0; i < n; i++) if (radiusInput[s + i] === 0) o[i] = 1
        let acc = 0
        for (let i = 0; i < n; i++) {
            const k = o[i]
            o[i] = acc
            acc += k
        }
        o[n] = acc
        sizes.push(acc)
    }
    const offsets = new Int32Array(nc + 1)
    for (let c = 0; c < nc; c++) offsets[c + 1] = offsets[c] + sizes[c]
    const dst = copyOnlyCurveDomain(src, offsets)
    const positions = src.positions
    const dstPositions = dst.positions
    const hasBezier = Array.prototype.some.call(types, (t: number) => t === CURVE_TYPE_BEZIER)
    let srcH: Handles | undefined, dstH: Handles | undefined
    if (hasBezier) {
        const hl = src.attributes.get('handle_left')?.data, hr = src.attributes.get('handle_right')?.data
        if (!hl || !hr) throw new Error('fillet_curves: Bezier curves without handle positions (dereferences an empty optional in Blender)')
        srcH = {hl: hl as Float32Array, hr: hr as Float32Array,
            tl: curvesAttributeOr(src, 'handle_type_left', src.pointsNum, 0) as TypedArray, tr: curvesAttributeOr(src, 'handle_type_right', src.pointsNum, 0) as TypedArray}
        dstH = {
            tl: curvesAttributeForWrite(dst, 'handle_type_left', [0]) as TypedArray,
            tr: curvesAttributeForWrite(dst, 'handle_type_right', [0]) as TypedArray,
            hl: curvesAttributeForWrite(dst, 'handle_left', [0, 0, 0]) as Float32Array,
            hr: curvesAttributeForWrite(dst, 'handle_right', [0, 0, 0]) as Float32Array,
        }
    }
    for (let c = 0; c < nc; c++) {
        const [s, e] = src.pointsRange(c)
        const n = e - s
        const o = all.subarray(s + c, e + c + 1)
        const d = dst.curveOffsets[c]
        const p: V3[] = []
        for (let i = s; i < e; i++) p.push(get3(positions, i))
        const directions = calculateDirections(p)
        const angles = calculateAngles(directions)
        const input = Array.from({length: n}, (_, i) => radiusInput[s + i])
        const radii = limitRadiusOn ? limitRadii(p, angles, input, !!cyclic[c]) : input
        calculateFilletPositions(p, angles, radii, directions, o, dstPositions.subarray(d * 3, (d + sizes[c]) * 3))
        if (hasBezier) {
            if (useBezierMode) bezierHandlesBezierMode(srcH!, s, n, angles, radii, directions, o, dstPositions, dstH!, d, sizes[c])
            else bezierHandlesPolyMode(srcH!, s, n, o, dstPositions, dstH!, d, sizes[c])
        }
    }
    // `retrieve_attributes_for_transfer` without the positions and handles, `duplicate_fillet_point_data` (:16).
    const skip = new Set(['position', 'handle_type_left', 'handle_type_right', 'handle_right', 'handle_left'])
    const acc = dst.accessor()
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point || skip.has(layer.name)) continue
        const type = layer.type as DataType
        if (!dst.attributes.get(layer.name)) acc.add(layer.name, AttrDomain.Point, type)
        const out = dst.attributes.get(layer.name)!.data
        const cc = DATA_TYPES[type].components
        for (let c = 0; c < nc; c++) {
            const [s, e] = src.pointsRange(c)
            const o = all.subarray(s + c, e + c + 1)
            const d = dst.curveOffsets[c]
            for (let i = 0; i < e - s; i++) {
                for (let j = o[i]; j < o[i + 1]; j++) for (let k = 0; k < cc; k++) out[(d + j) * cc + k] = layer.data[(s + i) * cc + k]
            }
        }
    }
    calculateBezierAutoHandles(dst)
    return dst
}
