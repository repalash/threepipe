/**
 * `geometry::subdivide_curves` (Blender 5.2.2 `geometry/intern/subdivide_curves.cc`) with `bezier::insert`
 * (`blenkernel/intern/curve_bezier.cc:69`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {interpolate3, V3} from '../blender/math/vec'
import {CurvesGeometry} from './components'
import {
    BEZIER_HANDLE_ALIGN, BEZIER_HANDLE_AUTO, BEZIER_HANDLE_FREE, BEZIER_HANDLE_VECTOR, bezierCalculateAutoHandles, CURVE_TYPE_BEZIER,
    CURVE_TYPE_CATMULL_ROM, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, catmullRomInterpolateToEvaluatedOffsets, curvesAttributeOr, curveTypes,
    NURBS_KNOT_MODE_CUSTOM,
} from './curvesEval'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {mix2} from './mixers'

interface Transfer {
    name: string
    type: DataType
    c: number
    src: TypedArray
    dst: TypedArray
}

/** `linear_interpolation` (:57): `dst` elements `[start, start + size)` of `out` from element `a` to `b` of `src`. */
function linearInterpolation(type: DataType, srcA: ArrayLike<number>, a: number, srcB: ArrayLike<number>, b: number, out: TypedArray, start: number, size: number): void {
    const c = DATA_TYPES[type].components
    for (let k = 0; k < c; k++) out[start * c + k] = srcA[a * c + k]
    const step = f32(1 / size)
    for (let i = 1; i < size; i++) mix2(type, f32(i * step), srcA, a, srcB, b, out, start + i)
}

/** `subdivide_attribute_linear` (:68) for one curve: `offsets` are the curve's per-segment point offsets. */
function subdivideLinear(t: Transfer, srcStart: number, n: number, dstStart: number, offsets: Int32Array): void {
    for (let i = 0; i < n - 1; i++) {
        linearInterpolation(t.type, t.src, srcStart + i, t.src, srcStart + i + 1, t.dst, dstStart + offsets[i], offsets[i + 1] - offsets[i])
    }
    linearInterpolation(t.type, t.src, srcStart + n - 1, t.src, srcStart, t.dst, dstStart + offsets[n - 1], offsets[n] - offsets[n - 1])
}

/** `aligned_or_free_handle_type` (:136). */
function alignedOrFreeHandleType(type: number): number {
    switch (type) {
    case BEZIER_HANDLE_AUTO: case BEZIER_HANDLE_ALIGN: return BEZIER_HANDLE_ALIGN
    default: return BEZIER_HANDLE_FREE
    }
}

interface BezierDst {
    positions: Float32Array
    handlesL: Float32Array
    handlesR: Float32Array
    typesL: TypedArray
    typesR: TypedArray
}

const get3 = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]

/** `subdivide_bezier_segment` (:151): curve-local indices into `dst`. */
function subdivideBezierSegment(positionPrev: V3, handlePrev: V3, handleNext: V3, positionNext: V3, typePrev: number, typeNext: number,
    segStart: number, segSize: number, nextSegmentStart: number, d: BezierDst): void {
    if (typePrev === BEZIER_HANDLE_VECTOR && typeNext === BEZIER_HANDLE_VECTOR) {
        linearInterpolation('float3', positionPrev, 0, positionNext, 0, d.positions, segStart, segSize)
        d.typesR[segStart] = BEZIER_HANDLE_VECTOR
        d.typesL[nextSegmentStart] = BEZIER_HANDLE_VECTOR
        d.typesL.fill(BEZIER_HANDLE_VECTOR, segStart + 1, segStart + segSize)
        d.typesR.fill(BEZIER_HANDLE_VECTOR, segStart + 1, segStart + segSize)
        return
    }
    d.positions.set(positionPrev, segStart * 3)
    let segmentStart = positionPrev
    let segmentHandlePrev = handlePrev
    let segmentHandleNext = handleNext
    const segmentEnd = positionNext
    for (let i = 0; i < segSize - 1; i++) {
        const parameter = f32(1 / (segSize - i))
        const point = segStart + i
        // `bezier::insert` (`curve_bezier.cc:69`): De Casteljau.
        const center = interpolate3(segmentHandlePrev, segmentHandleNext, parameter)
        const insHandlePrev = interpolate3(segmentStart, segmentHandlePrev, parameter)
        const insHandleNext = interpolate3(segmentHandleNext, segmentEnd, parameter)
        const leftHandle = interpolate3(insHandlePrev, center, parameter)
        const rightHandle = interpolate3(center, insHandleNext, parameter)
        const position = interpolate3(leftHandle, rightHandle, parameter)
        d.handlesR.set(insHandlePrev, point * 3)
        d.handlesL.set(leftHandle, (point + 1) * 3)
        d.positions.set(position, (point + 1) * 3)
        segmentStart = position
        segmentHandlePrev = rightHandle
        segmentHandleNext = insHandleNext
    }
    d.handlesR.set(segmentHandlePrev, (segStart + segSize - 1) * 3)
    d.handlesL.set(segmentHandleNext, nextSegmentStart * 3)
    d.typesR[segStart] = alignedOrFreeHandleType(typePrev)
    d.typesL[nextSegmentStart] = alignedOrFreeHandleType(typeNext)
    d.typesL.fill(BEZIER_HANDLE_ALIGN, segStart + 1, segStart + segSize)
    d.typesR.fill(BEZIER_HANDLE_ALIGN, segStart + 1, segStart + segSize)
}

/**
 * `subdivide_curves` (:262) of every curve. `cuts` holds a value per point (`cuts[0]` everywhere when single).
 * Attributes are transferred to the new points in source order (`retrieve_attributes_for_transfer`).
 */
export function subdivideCurves(src: CurvesGeometry, cuts: ArrayLike<number>): CurvesGeometry {
    if (src.pointsNum === 0) return src.clone()
    const nc = src.curvesNum
    const cyclic = curvesAttributeOr(src, 'cyclic', nc, 0)
    const types = curveTypes(src)
    const knots = curvesAttributeOr(src, 'knots_mode', nc, 0)
    for (let c = 0; c < nc; c++) {
        if (types[c] === CURVE_TYPE_NURBS && knots[c] === NURBS_KNOT_MODE_CUSTOM) throw new Error('subdivide_curves: NURBS custom knots (copy_custom_knots) are not ported')
    }
    // `calculate_result_offsets` (:17): per curve `points + 1` offsets of its segments.
    const all = new Int32Array(src.pointsNum + nc)
    const curveOffsets = new Int32Array(nc + 1)
    let total = 0
    for (let c = 0; c < nc; c++) {
        const [s, e] = src.pointsRange(c)
        const n = e - s
        const o = all.subarray(s + c, e + c + 1)
        if (n === 1) {
            o[0] = 1
        } else {
            for (let i = 0; i < n; i++) o[i] = Math.max(cuts[s + i], 0) + 1
            if (!cyclic[c]) o[n - 1] = 1
        }
        let acc = 0
        for (let i = 0; i < n; i++) {
            const k = o[i]
            o[i] = acc
            acc += k
        }
        o[n] = acc
        curveOffsets[c] = total
        total += acc
    }
    curveOffsets[nc] = total
    // `copy_only_curve_domain` + resize.
    const dst = new CurvesGeometry(total, nc)
    dst.curveOffsets.set(curveOffsets)
    const acc = dst.accessor()
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Curve) continue
        acc.add(layer.name, AttrDomain.Curve, layer.type as DataType, layer.data.slice() as TypedArray)
    }
    dst.materials = src.materials.slice()
    const transfers: Transfer[] = []
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point) continue
        const type = layer.type as DataType
        if (!dst.attributes.get(layer.name)) acc.add(layer.name, AttrDomain.Point, type)
        transfers.push({name: layer.name, type, c: DATA_TYPES[type].components, src: layer.data as TypedArray, dst: dst.attributes.get(layer.name)!.data as TypedArray})
    }
    const byName = (name: string) => transfers.find(t => t.name === name)
    const skipBezier = new Set(['position', 'handle_type_left', 'handle_type_right', 'handle_right', 'handle_left'])
    for (let c = 0; c < nc; c++) {
        const [s, e] = src.pointsRange(c)
        const n = e - s
        const offsets = all.subarray(s + c, e + c + 1)
        const ds = dst.curveOffsets[c]
        switch (types[c]) {
        case CURVE_TYPE_CATMULL_ROM:
            for (const t of transfers) {
                catmullRomInterpolateToEvaluatedOffsets(t.type, t.src.subarray(s * t.c, e * t.c), !!cyclic[c], offsets,
                    t.dst.subarray(ds * t.c, (ds + offsets[n]) * t.c))
            }
            break
        case CURVE_TYPE_POLY:
        case CURVE_TYPE_NURBS:
            for (const t of transfers) subdivideLinear(t, s, n, ds, offsets)
            break
        case CURVE_TYPE_BEZIER: {
            const hl = byName('handle_left'), hr = byName('handle_right')
            if (!hl || !hr) throw new Error('subdivide_curves: Bezier curves without handle positions (dereferences an empty optional in Blender)')
            // `handle_types_*_for_write`: created (zeros, FREE) when missing.
            for (const name of ['handle_type_left', 'handle_type_right']) if (!dst.attributes.get(name)) acc.add(name, AttrDomain.Point, 'int8')
            const srcTL = curvesAttributeOr(src, 'handle_type_left', src.pointsNum, 0)
            const srcTR = curvesAttributeOr(src, 'handle_type_right', src.pointsNum, 0)
            const sl = (a: TypedArray, comps: number) => a.subarray(ds * comps, (ds + offsets[n]) * comps)
            const d: BezierDst = {
                positions: sl(dst.positions, 3) as Float32Array,
                handlesL: sl(dst.attributes.get('handle_left')!.data as TypedArray, 3) as Float32Array,
                handlesR: sl(dst.attributes.get('handle_right')!.data as TypedArray, 3) as Float32Array,
                typesL: sl(dst.attributes.get('handle_type_left')!.data as TypedArray, 1),
                typesR: sl(dst.attributes.get('handle_type_right')!.data as TypedArray, 1),
            }
            const pos = src.positions
            // `subdivide_bezier_positions` (:209).
            for (let i = 0; i < n - 1; i++) {
                subdivideBezierSegment(get3(pos, s + i), get3(hr.src, s + i), get3(hl.src, s + i + 1), get3(pos, s + i + 1), srcTR[s + i], srcTL[s + i + 1],
                    offsets[i], offsets[i + 1] - offsets[i], offsets[i + 1], d)
            }
            if (cyclic[c]) {
                subdivideBezierSegment(get3(pos, e - 1), get3(hr.src, e - 1), get3(hl.src, s), get3(pos, s), srcTR[e - 1], srcTL[s],
                    offsets[n - 1], offsets[n] - offsets[n - 1], 0, d)
            } else {
                const last = offsets[n] - 1
                d.positions.set(get3(pos, e - 1), last * 3)
                d.typesL[0] = srcTL[s]
                d.typesR[last] = srcTR[e - 1]
                d.handlesL.set(get3(hl.src, s), 0)
                d.handlesR.set(get3(hr.src, e - 1), last * 3)
            }
            bezierCalculateAutoHandles(!!cyclic[c], d.typesL, d.typesR, d.positions, d.handlesL, d.handlesR)
            for (const t of transfers) if (!skipBezier.has(t.name)) subdivideLinear(t, s, n, ds, offsets)
            break
        }
        }
    }
    return dst
}
