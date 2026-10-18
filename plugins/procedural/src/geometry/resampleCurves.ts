/**
 * `geometry::resample_to_count` / `resample_to_length` / `resample_to_evaluated` (`geometry/intern/resample_curves.cc`)
 * with `length_parameterize::sample_uniform`, `sample_at_length` and `interpolate` (`blenlib/BLI_length_parameterize.hh`,
 * `blenlib/intern/length_parameterize.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {CurvesGeometry} from './components'
import {CURVE_TYPE_BEZIER, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, CurvesEvaluator, curveTypes} from './curvesEval'
import {fillCurveTypesSelection} from './curvesEdit'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {isAnonymousAttributeName} from './attributeAccessor'
import {mix2} from './mixers'

// region length_parameterize

interface SampleSegmentHint {
    segmentIndex: number
    segmentStart: number
    segmentLengthInv: number
}

/** `sample_at_length` (`BLI_length_parameterize.hh:103`). Writes `indices[o]`, `factors[o]`. */
export function sampleAtLength(lengths: ArrayLike<number>, sampleLength: number, indices: Int32Array, factors: Float32Array, o: number,
    hint?: SampleSegmentHint): void {
    if (hint && hint.segmentIndex >= 0) {
        const lengthInSegment = f32(sampleLength - hint.segmentStart)
        const factor = f32(lengthInSegment * hint.segmentLengthInv)
        if (factor >= 0 && factor < 1) {
            indices[o] = hint.segmentIndex
            factors[o] = factor
            return
        }
    }
    const totalLength = lengths[lengths.length - 1]
    if (sampleLength >= totalLength) {
        indices[o] = lengths.length - 1
        factors[o] = 1
        return
    }
    // `std::upper_bound`: the first length greater than the sample length.
    let lo = 0, hi = lengths.length
    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (sampleLength < lengths[mid]) hi = mid
        else lo = mid + 1
    }
    const prev = lo
    const segmentStart = prev === 0 ? 0 : lengths[prev - 1]
    const segmentEnd = lengths[prev]
    const segmentLength = f32(segmentEnd - segmentStart)
    // `math::safe_divide(1.0f, segment_length)`.
    const segmentLengthInv = segmentLength === 0 ? 0 : f32(1 / segmentLength)
    const lengthInSegment = f32(sampleLength - segmentStart)
    indices[o] = prev
    factors[o] = f32(lengthInSegment * segmentLengthInv)
    if (hint) {
        hint.segmentIndex = prev
        hint.segmentStart = segmentStart
        hint.segmentLengthInv = segmentLengthInv
    }
}

/** `threading::parallel_for(IndexRange(count), 512, ...)`: a new hint per task range. */
const HINT_GRAIN = 512

/** `sample_uniform` (`length_parameterize.cc:15`) into `indices/factors[start .. start + count)`. */
export function sampleUniform(lengths: ArrayLike<number>, includeLastPoint: boolean, indices: Int32Array, factors: Float32Array,
    start: number, count: number): void {
    if (count === 1) {
        indices[start] = 0
        factors[start] = 0
        return
    }
    const totalLength = lengths[lengths.length - 1]
    const stepLength = f32(totalLength / (count - (includeLastPoint ? 1 : 0)))
    let hint: SampleSegmentHint = {segmentIndex: -1, segmentStart: 0, segmentLengthInv: 0}
    for (let i = 0; i < count; i++) {
        if (i % HINT_GRAIN === 0) hint = {segmentIndex: -1, segmentStart: 0, segmentLengthInv: 0}
        const v = f32(i * stepLength)
        const sampleLength = v < totalLength ? v : totalLength
        sampleAtLength(lengths, sampleLength, indices, factors, start + i, hint)
    }
}

/**
 * `length_parameterize::interpolate` (`BLI_length_parameterize.hh:76` via `interpolate_to_masked`): `src` elements
 * `[srcStart, srcStart + srcSize)` sampled at `indices/factors[dstStart ..)`, `math::interpolate` (= `mix2`).
 */
function interpolateSamples(type: DataType, src: ArrayLike<number>, srcStart: number, srcSize: number, indices: Int32Array, factors: Float32Array,
    dst: TypedArray, dstStart: number, dstSize: number): void {
    const last = srcSize - 1
    for (let i = 0; i < dstSize; i++) {
        const prev = indices[dstStart + i]
        const factor = factors[dstStart + i]
        if (prev === last) mix2(type, factor, src, srcStart + last, src, srcStart, dst, dstStart + i)
        else mix2(type, factor, src, srcStart + prev, src, srcStart + prev + 1, dst, dstStart + i)
    }
}
// endregion

/** `bke::curves::copy_only_curve_domain` (`curves_utils.cc:71`) with the point offsets already known. */
export function copyOnlyCurveDomain(src: CurvesGeometry, offsets: Int32Array): CurvesGeometry {
    const dst = new CurvesGeometry(offsets[offsets.length - 1], src.curvesNum)
    dst.curveOffsets.set(offsets)
    const acc = dst.accessor()
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Curve) continue
        acc.add(layer.name, AttrDomain.Curve, layer.type as DataType, layer.data.slice() as TypedArray)
    }
    dst.materials = src.materials.slice()
    return dst
}

/** `interpolate_attribute_to_curves` (:62). */
function interpolateAttributeToCurves(name: string, types: ArrayLike<number>): boolean {
    if (isAnonymousAttributeName(name)) return true
    const has = (t: number) => Array.prototype.some.call(types, (x: number) => x === t)
    if (name === 'handle_type_left' || name === 'handle_type_right' || name === 'handle_left' || name === 'handle_right') return has(CURVE_TYPE_BEZIER)
    if (name === 'nurbs_weight') return has(CURVE_TYPE_NURBS)
    return true
}

const NO_INTERPOLATION = new Set(['handle_type_left', 'handle_type_right', 'handle_right', 'handle_left', 'nurbs_weight'])

interface PointAttribute {
    type: DataType
    src: TypedArray
    dst: TypedArray
}

/** `gather_point_attributes_to_interpolate` (:149) with `retrieve_attribute_spans` (:94). */
function gatherPointAttributes(src: CurvesGeometry, dst: CurvesGeometry): {interp: PointAttribute[], noInterp: PointAttribute[]} {
    const dstTypes = curveTypes(dst)
    const interp: PointAttribute[] = [], noInterp: PointAttribute[] = []
    const acc = dst.accessor()
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point) continue
        if (!interpolateAttributeToCurves(layer.name, dstTypes)) continue
        if (layer.name === 'position') continue
        const type = layer.type as DataType
        // `lookup_or_add_for_write_only_span(name, Point, type)`.
        const meta = acc.lookupMeta(layer.name)
        if (meta) {
            if (meta.domain !== AttrDomain.Point || meta.type !== type) continue
        } else if (!acc.add(layer.name, AttrDomain.Point, type)) continue
        const entry = {type, src: layer.data as TypedArray, dst: dst.attributes.get(layer.name)!.data as TypedArray}
        if (NO_INTERPOLATION.has(layer.name)) noInterp.push(entry)
        else interp.push(entry)
    }
    return {interp, noInterp}
}

/** `copy_or_defaults_for_unselected_curves` (:211). */
function copyUnselected(src: CurvesGeometry, dst: CurvesGeometry, unselected: number[], attributes: PointAttribute[]): void {
    const copy = (type: DataType, from: ArrayLike<number>, to: TypedArray) => {
        const c = DATA_TYPES[type].components
        for (const curve of unselected) {
            const [s, e] = src.pointsRange(curve)
            const d = dst.curveOffsets[curve]
            for (let i = 0; i < (e - s) * c; i++) to[d * c + i] = from[s * c + i]
        }
    }
    copy('float3', src.positions, dst.positions)
    for (const a of attributes) copy(a.type, a.src, a.dst)
}

/** The selected and unselected curves of `selection` (a per-curve boolean). */
function splitSelection(selection: ArrayLike<number>, size: number): [number[], number[]] {
    const sel: number[] = [], unsel: number[] = []
    for (let i = 0; i < size; i++) (selection[i] ? sel : unsel).push(i)
    return [sel, unsel]
}

/**
 * `resample_to_uniform` (:299 with the field-evaluated counts of :430): `counts[i]` is the point count of selected
 * curve `i` (already `max(1, count)` or `get_count_from_length`).
 */
export function resampleToUniform(src: CurvesGeometry, selection: ArrayLike<number>, counts: ArrayLike<number>): CurvesGeometry {
    if (src.curvesNum === 0) return new CurvesGeometry(0, 0)
    const [selected, unselected] = splitSelection(selection, src.curvesNum)
    const offsets = new Int32Array(src.curvesNum + 1)
    for (const c of selected) offsets[c] = counts[c]
    for (const c of unselected) offsets[c] = src.curveOffsets[c + 1] - src.curveOffsets[c]
    // `accumulate_counts_to_offsets`.
    let total = 0
    for (let c = 0; c < src.curvesNum; c++) {
        const n = offsets[c]
        offsets[c] = total
        total += n
    }
    offsets[src.curvesNum] = total
    const dst = copyOnlyCurveDomain(src, offsets)

    const ev = new CurvesEvaluator(src)
    fillCurveTypesSelection(dst, selected, CURVE_TYPE_POLY)
    const {interp, noInterp} = gatherPointAttributes(src, dst)
    const types = ev.types
    const sampleIndices = new Int32Array(dst.pointsNum)
    const sampleFactors = new Float32Array(dst.pointsNum)
    for (const c of selected) {
        const lengths = ev.lengthsForCurve(c)
        const [ds, de] = dst.pointsRange(c)
        if (lengths.length === 0) {
            sampleIndices.fill(0, ds, de)
            sampleFactors.fill(0, ds, de)
        } else {
            sampleUniform(lengths, !ev.cyclic[c], sampleIndices, sampleFactors, ds, de - ds)
        }
    }
    for (const a of interp) {
        const comps = DATA_TYPES[a.type].components
        for (const c of selected) {
            const [s, e] = src.pointsRange(c)
            const [ds, de] = dst.pointsRange(c)
            if (types[c] === CURVE_TYPE_POLY) {
                interpolateSamples(a.type, a.src, s, e - s, sampleIndices, sampleFactors, a.dst, ds, de - ds)
            } else {
                const [es, ee] = ev.evaluatedRange(c)
                const evaluated = new DATA_TYPES[a.type].array((ee - es) * comps)
                ev.interpolateToEvaluated(c, a.type, a.src.subarray(s * comps, e * comps), evaluated)
                interpolateSamples(a.type, evaluated, 0, ee - es, sampleIndices, sampleFactors, a.dst, ds, de - ds)
            }
        }
    }
    const evaluatedPositions = ev.positions
    for (const c of selected) {
        const [es, ee] = ev.evaluatedRange(c)
        const [ds, de] = dst.pointsRange(c)
        interpolateSamples('float3', evaluatedPositions, es, ee - es, sampleIndices, sampleFactors, dst.positions, ds, de - ds)
    }
    for (const a of noInterp) {
        const comps = DATA_TYPES[a.type].components
        for (const c of selected) {
            const [ds, de] = dst.pointsRange(c)
            a.dst.fill(0, ds * comps, de * comps)
        }
    }
    copyUnselected(src, dst, unselected, [...interp, ...noInterp])
    return dst
}

/** `get_count_from_length` (:34). */
export function countFromLength(curveLength: number, sampleLength: number, keepLastSegment: boolean): number {
    if (sampleLength === 0) return 1
    const count = Math.trunc(f32(curveLength / sampleLength)) + 1
    return Math.max(keepLastSegment ? 2 : 1, count)
}

/** `resample_to_evaluated` (:531). */
export function resampleToEvaluated(src: CurvesGeometry, selection: ArrayLike<number>): CurvesGeometry {
    if (src.curvesNum === 0) return new CurvesGeometry(0, 0)
    const ev = new CurvesEvaluator(src)
    const [selected, unselected] = splitSelection(selection, src.curvesNum)
    const offsets = new Int32Array(src.curvesNum + 1)
    for (const c of selected) offsets[c] = ev.evaluatedOffsets[c + 1] - ev.evaluatedOffsets[c]
    for (const c of unselected) offsets[c] = src.curveOffsets[c + 1] - src.curveOffsets[c]
    let total = 0
    for (let c = 0; c < src.curvesNum; c++) {
        const n = offsets[c]
        offsets[c] = total
        total += n
    }
    offsets[src.curvesNum] = total
    const dst = copyOnlyCurveDomain(src, offsets)
    fillCurveTypesSelection(dst, selected, CURVE_TYPE_POLY)
    const {interp, noInterp} = gatherPointAttributes(src, dst)
    for (const a of interp) {
        const comps = DATA_TYPES[a.type].components
        for (const c of selected) {
            const [s, e] = src.pointsRange(c)
            const [ds, de] = dst.pointsRange(c)
            ev.interpolateToEvaluated(c, a.type, a.src.subarray(s * comps, e * comps), a.dst.subarray(ds * comps, de * comps))
        }
    }
    const evaluatedPositions = ev.positions
    for (const c of selected) {
        const [es, ee] = ev.evaluatedRange(c)
        dst.positions.set(evaluatedPositions.subarray(es * 3, ee * 3), dst.curveOffsets[c] * 3)
    }
    for (const a of noInterp) {
        const comps = DATA_TYPES[a.type].components
        for (const c of selected) {
            const [ds, de] = dst.pointsRange(c)
            a.dst.fill(0, ds * comps, de * comps)
        }
    }
    copyUnselected(src, dst, unselected, [...interp, ...noInterp])
    return dst
}
