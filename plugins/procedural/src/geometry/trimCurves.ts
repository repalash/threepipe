/**
 * `geometry::trim_curves` (`geometry/intern/trim_curves.cc`) with `bke::curves::CurvePoint` / `IndexRangeCyclic`
 * (`blenkernel/BKE_curves_utils.hh`) and `bke::curves::bezier::insert` (`blenkernel/intern/curve_bezier.cc:68`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {interpolate3, V3} from '../blender/math/vec'
import {CurvesGeometry} from './components'
import {
    BEZIER_HANDLE_FREE, catmullRomBasis, CURVE_TYPE_BEZIER, CURVE_TYPE_CATMULL_ROM, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, CurvesEvaluator,
    curveTypes, mix4, segmentsNum,
} from './curvesEval'
import {curvesAttributeForWrite, fillCurveTypesSelection} from './curvesEdit'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {mix2} from './mixers'
import {copyOnlyCurveDomain, sampleAtLength} from './resampleCurves'

// region CurvePoint, IndexRangeCyclic (`BKE_curves_utils.hh`)

/** `CurvePoint` (:45). */
interface CurvePoint {
    index: number
    nextIndex: number
    parameter: number
}

const cp = (index: number, nextIndex: number, parameter: number): CurvePoint => ({index, nextIndex, parameter})

/** `CurvePoint::is_controlpoint` (:617). */
const isControlPoint = (p: CurvePoint) => p.parameter === 0 || p.parameter === 1

/** `CurvePoint::operator<` (:633). */
function pointLess(a: CurvePoint, b: CurvePoint): boolean {
    if (a.index === b.index) return a.parameter < b.parameter
    return a.nextIndex < b.nextIndex && !(a.nextIndex === b.index && a.parameter === 1 && b.parameter === 0)
}

/** `IndexRangeCyclic` (:83). */
class IndexRangeCyclic {
    constructor(readonly start: number, readonly end: number, readonly rangeSize: number, readonly cycles: number) {}

    /** `get_range_from_size` (:110). */
    static fromSize(startIndex: number, iteratorSize: number, rangeSize: number): IndexRangeCyclic {
        const numUntilLoop = rangeSize - startIndex
        if (iteratorSize < numUntilLoop) return new IndexRangeCyclic(startIndex, startIndex + iteratorSize, rangeSize, 0)
        const numRemaining = iteratorSize - numUntilLoop
        const numFullCycles = Math.trunc(numRemaining / rangeSize)
        const endIndex = numRemaining - numFullCycles * rangeSize
        return new IndexRangeCyclic(startIndex, endIndex, rangeSize, numFullCycles + 1)
    }

    /** `get_range_between_endpoints` (:131). */
    static betweenEndpoints(startPoint: CurvePoint, endPoint: CurvePoint, rangeSize: number): IndexRangeCyclic {
        const startIndex = startPoint.parameter === 0 ? startPoint.index : startPoint.nextIndex
        let endIndex = endPoint.parameter === 0 ? endPoint.index : endPoint.nextIndex
        let cycles: boolean
        if (isControlPoint(endPoint)) {
            ++endIndex
            if (endIndex === rangeSize) endIndex = 0
            cycles = endIndex <= startIndex
        } else {
            cycles = pointLess(endPoint, startPoint) || endIndex < startIndex
        }
        return new IndexRangeCyclic(startIndex, endIndex, rangeSize, cycles ? 1 : 0)
    }

    /** `push_loop` (:180). */
    pushLoop(n = 1): IndexRangeCyclic {
        return new IndexRangeCyclic(this.start, this.end, this.rangeSize, this.cycles + n)
    }

    /** `drop_front` (:223). */
    dropFront(n = 1): IndexRangeCyclic {
        let newStart = this.start + n
        let numCycles = this.cycles
        if (this.rangeSize <= newStart) {
            const droppedCycles = Math.trunc(n / this.rangeSize)
            const remainder = newStart - this.rangeSize * droppedCycles
            const overflow = remainder >= this.rangeSize
            newStart = remainder - (overflow ? this.rangeSize : 0)
            numCycles -= droppedCycles + (overflow ? 1 : 0)
        }
        return new IndexRangeCyclic(newStart, this.end, this.rangeSize, numCycles)
    }

    get sizeBeforeLoop(): number {
        return this.rangeSize - this.start
    }

    get sizeAfterLoop(): number {
        return this.end
    }

    /** `size` (:341). */
    get size(): number {
        if (this.cycles > 0) return this.sizeBeforeLoop + this.end + (this.cycles - 1) * this.rangeSize
        return this.end - this.start
    }
}
// endregion

// region lookup (`trim_curves.cc:24-190`)

/** `lookup_point_uniform_spacing` (:36). */
function lookupPointUniformSpacing(lengths: Float32Array, sampleLength: number, cyclic: boolean, resolution: number, numCurvePoints: number): CurvePoint {
    const lastIndex = numCurvePoints - 1
    if (sampleLength <= 0) return cp(0, 1, 0)
    if (sampleLength >= lengths[lengths.length - 1]) return cyclic ? cp(lastIndex, 0, 1) : cp(lastIndex - 1, lastIndex, 1)
    const idx = new Int32Array(1), fac = new Float32Array(1)
    sampleAtLength(lengths, sampleLength, idx, fac, 0)
    const evalIndex = idx[0], evalFactor = fac[0]
    const index = Math.trunc(evalIndex / resolution)
    const nextIndex = index === lastIndex ? 0 : index + 1
    const parameter = f32(f32(f32(evalFactor + evalIndex) / resolution) - index)
    return cp(index, nextIndex, parameter)
}

/** `lookup_point_polygonal` (:64). */
function lookupPointPolygonal(lengths: Float32Array, sampleLength: number, cyclic: boolean, evaluatedSize: number): CurvePoint {
    const lastIndex = evaluatedSize - 1
    if (sampleLength <= 0) return cp(0, 1, 0)
    if (sampleLength >= lengths[lengths.length - 1]) return cyclic ? cp(lastIndex, 0, 1) : cp(lastIndex - 1, lastIndex, 1)
    const idx = new Int32Array(1), fac = new Float32Array(1)
    sampleAtLength(lengths, sampleLength, idx, fac, 0)
    const nextEvalIndex = idx[0] === lastIndex ? 0 : idx[0] + 1
    return cp(idx[0], nextEvalIndex, fac[0])
}

/** `lookup_point_bezier(bezier_offsets, ...)` (:87). */
function lookupPointBezierOffsets(bezierOffsets: Int32Array, lengths: Float32Array, sampleLength: number, cyclic: boolean, numCurvePoints: number): CurvePoint {
    const lastIndex = numCurvePoints - 1
    if (sampleLength <= 0) return cp(0, 1, 0)
    if (sampleLength >= lengths[lengths.length - 1]) return cyclic ? cp(lastIndex, 0, 1) : cp(lastIndex - 1, lastIndex, 1)
    const idx = new Int32Array(1), fac = new Float32Array(1)
    sampleAtLength(lengths, sampleLength, idx, fac, 0)
    const evalIndex = idx[0], evalFactor = fac[0]
    // `std::upper_bound(bezier_offsets, eval_index)`.
    let lo = 0, hi = bezierOffsets.length
    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (evalIndex < bezierOffsets[mid]) hi = mid
        else lo = mid + 1
    }
    const left = lo - 1
    const right = left === lastIndex ? 0 : left + 1
    const prevOffset = bezierOffsets[left]
    const offsetInSegment = f32(evalFactor + (evalIndex - prevOffset))
    const segmentResolution = bezierOffsets[left + 1] - prevOffset
    const p = f32(offsetInSegment / segmentResolution)
    return cp(left, right, p < 0 ? 0 : p > 1 ? 1 : p)
}

/** `lookup_curve_point` (:142) with `lookup_point_bezier` (:121). */
function lookupCurvePoint(ev: CurvesEvaluator, curveType: number, curve: number, lengths: Float32Array, sampleLength: number, cyclic: boolean,
    resolution: number, numCurvePoints: number): CurvePoint {
    if (numCurvePoints === 1) return cp(0, 0, 0)
    if (curveType === CURVE_TYPE_CATMULL_ROM) return lookupPointUniformSpacing(lengths, sampleLength, cyclic, resolution, numCurvePoints)
    if (curveType === CURVE_TYPE_BEZIER) {
        const [es, ee] = ev.evaluatedRange(curve)
        // `bezier::has_vector_handles` (`BKE_curves.hh:1133`).
        if ((ee - es) - (cyclic ? 0 : 1) !== segmentsNum(numCurvePoints, cyclic) * resolution) {
            return lookupPointBezierOffsets(ev.bezierOffsets(curve), lengths, sampleLength, cyclic, numCurvePoints)
        }
        return lookupPointUniformSpacing(lengths, sampleLength, cyclic, resolution, numCurvePoints)
    }
    if (curveType === CURVE_TYPE_POLY) return lookupPointPolygonal(lengths, sampleLength, cyclic, numCurvePoints)
    const [es, ee] = ev.evaluatedRange(curve)
    return lookupPointPolygonal(lengths, sampleLength, cyclic, ee - es)
}
// endregion

// region sampling (`trim_curves.cc:227-600`)

/** A typed view of one curve's values: element `i` is `data[(base + i) * c ..]`. */
interface Slice {
    type: DataType
    data: ArrayLike<number>
    base: number
}

function copyElement(c: number, src: ArrayLike<number>, s: number, dst: TypedArray, d: number): void {
    for (let k = 0; k < c; k++) dst[d * c + k] = src[s * c + k]
}

/** `copy_point_data_between_endpoints` (:227). */
function copyBetweenEndpoints(src: Slice, dst: TypedArray, range: IndexRangeCyclic, dstIndex: number): number {
    const c = DATA_TYPES[src.type].components
    if (range.cycles) {
        let inc = range.sizeBeforeLoop
        for (let i = 0; i < inc; i++) copyElement(c, src.data, src.base + range.start + i, dst, dstIndex + i)
        dstIndex += inc
        inc = range.sizeAfterLoop
        for (let i = 0; i < inc; i++) copyElement(c, src.data, src.base + i, dst, dstIndex + i)
        dstIndex += inc
    } else {
        const inc = range.end - range.start
        for (let i = 0; i < inc; i++) copyElement(c, src.data, src.base + range.start + i, dst, dstIndex + i)
        dstIndex += inc
    }
    return dstIndex
}

/** `sample_interval_linear<T, true>` (:300). `dstRange` is `[start, size]`. */
function sampleIntervalLinear(src: Slice, dst: TypedArray, range: IndexRangeCyclic, dstStart: number, dstSize: number, startPoint: CurvePoint,
    endPoint: CurvePoint): void {
    let dstIndex = dstStart
    if (!isControlPoint(startPoint)) {
        mix2(src.type, startPoint.parameter, src.data, src.base + startPoint.index, src.data, src.base + startPoint.nextIndex, dst, dstIndex)
        ++dstIndex
    }
    dstIndex = copyBetweenEndpoints(src, dst, range, dstIndex)
    if (dstSize === 1) return
    if (!isControlPoint(endPoint)) {
        mix2(src.type, endPoint.parameter, src.data, src.base + endPoint.index, src.data, src.base + endPoint.nextIndex, dst, dstIndex)
    }
}

/** `interpolate_catmull_rom` (:254). `size` is the curve's point count. */
function interpolateCatmullRom(src: Slice, size: number, point: CurvePoint, cyclic: boolean, dst: TypedArray, d: number): void {
    let i0: number
    if (point.index === 0) i0 = cyclic ? size - 1 : point.index
    else i0 = point.index - 1
    let i3 = point.nextIndex + 1
    if (i3 === size) i3 = cyclic ? 0 : point.nextIndex
    // `catmull_rom::interpolate<T>` (`BKE_curves.hh:842`).
    const weights = catmullRomBasis(point.parameter)
    const b = src.base
    if (src.type === 'float' || src.type === 'float2' || src.type === 'float3') {
        mix4(src.type, weights, src.data, b + i0, b + point.index, b + point.nextIndex, b + i3, dst, d)
        const c = DATA_TYPES[src.type].components
        for (let k = 0; k < c; k++) dst[d * c + k] = f32(0.5 * dst[d * c + k])
    } else {
        mix4(src.type, weights.map(x => f32(x * 0.5)), src.data, b + i0, b + point.index, b + point.nextIndex, b + i3, dst, d)
    }
}

/** `sample_interval_catmull_rom` (:351). */
function sampleIntervalCatmullRom(src: Slice, size: number, dst: TypedArray, range: IndexRangeCyclic, dstStart: number, dstSize: number,
    startPoint: CurvePoint, endPoint: CurvePoint, cyclic: boolean): void {
    let dstIndex = dstStart
    if (!isControlPoint(startPoint)) {
        interpolateCatmullRom(src, size, startPoint, cyclic, dst, dstIndex)
        ++dstIndex
    }
    dstIndex = copyBetweenEndpoints(src, dst, range, dstIndex)
    if (dstSize === 1) return
    if (!isControlPoint(endPoint)) interpolateCatmullRom(src, size, endPoint, cyclic, dst, dstIndex)
}

/** `bezier::Insertion` (`BKE_curves.hh:691`). */
interface Insertion {
    handlePrev: V3
    leftHandle: V3
    position: V3
    rightHandle: V3
    handleNext: V3
}

/** `bezier::insert` (`curve_bezier.cc:68`): De Casteljau subdivision. */
function bezierInsert(pointPrev: ArrayLike<number>, handlePrev: ArrayLike<number>, handleNext: ArrayLike<number>, pointNext: ArrayLike<number>,
    parameter: number): Insertion {
    const centerPoint = interpolate3(handlePrev, handleNext, parameter)
    const hp = interpolate3(pointPrev, handlePrev, parameter)
    const hn = interpolate3(handleNext, pointNext, parameter)
    const lh = interpolate3(hp, centerPoint, parameter)
    const rh = interpolate3(centerPoint, hn, parameter)
    return {handlePrev: hp, handleNext: hn, leftHandle: lh, rightHandle: rh, position: interpolate3(lh, rh, parameter)}
}

interface BezierData {
    positions: Float32Array
    handlesL: Float32Array
    handlesR: Float32Array
    typesL: ArrayLike<number> & {[i: number]: number}
    typesR: ArrayLike<number> & {[i: number]: number}
}

/** `sample_interval_bezier<true>` (:389). `src` arrays are absolute with the curve starting at `base`; `dst` likewise absolute. */
function sampleIntervalBezier(src: BezierData, base: number, dst: BezierData, range: IndexRangeCyclic, dstStart: number, dstSize: number,
    startPoint: CurvePoint, endPoint: CurvePoint): void {
    const v = (a: Float32Array, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
    const sp = (a: Float32Array, i: number) => v(a, base + i)
    const set = (a: Float32Array, i: number, x: ArrayLike<number>) => { a[i * 3] = x[0]; a[i * 3 + 1] = x[1]; a[i * 3 + 2] = x[2] }
    const zero: V3 = [0, 0, 0]
    let startInsert: Insertion = {handlePrev: zero, leftHandle: zero, position: zero, rightHandle: zero, handleNext: zero}
    let dstIndex = dstStart
    let startTrimmed = false
    const knotInsert = (p: CurvePoint) => bezierInsert(sp(src.positions, p.index), sp(src.handlesR, p.index), sp(src.handlesL, p.nextIndex),
        sp(src.positions, p.nextIndex), p.parameter)
    if (!isControlPoint(startPoint)) {
        startInsert = knotInsert(startPoint)
        set(dst.positions, dstStart, startInsert.position)
        set(dst.handlesL, dstStart, startInsert.leftHandle)
        set(dst.handlesR, dstStart, startInsert.rightHandle)
        dst.typesL[dstStart] = src.typesL[base + startPoint.index]
        dst.typesR[dstStart] = src.typesR[base + startPoint.index]
        startTrimmed = true
        ++dstIndex
    }
    const copyRange = (from: number, n: number) => {
        for (let i = 0; i < n; i++) {
            const s = base + from + i, d = dstIndex + i
            set(dst.positions, d, v(src.positions, s))
            set(dst.handlesL, d, v(src.handlesL, s))
            set(dst.handlesR, d, v(src.handlesR, s))
            dst.typesL[d] = src.typesL[s]
            dst.typesR[d] = src.typesR[s]
        }
        dstIndex += n
    }
    copyRange(range.start, range.cycles ? range.sizeBeforeLoop : range.end - range.start)
    if (dstSize === 1) return
    const after = range.sizeAfterLoop
    if (range.cycles && after > 0) copyRange(0, after)
    if (startTrimmed) set(dst.handlesL, dstStart + 1, startInsert.handleNext)

    const dstLast = dstStart + dstSize - 1
    let endInsert: Insertion
    if (endPoint.parameter === 0) {
        if (endPoint.index === startPoint.index) {
            if (startPoint.parameter === 0) {
                set(dst.handlesL, dstStart, v(dst.positions, dstStart))
                set(dst.handlesR, dstLast, v(dst.positions, dstStart))
            } else if (startPoint.parameter === 1) {
                // Start is the next control point.
            } else {
                set(dst.handlesR, dstLast, startInsert.handlePrev)
            }
        }
    } else if (endPoint.parameter === 1) {
        if (endPoint.nextIndex === startPoint.index) {
            if (startPoint.parameter === 0) {
                set(dst.handlesL, dstStart, v(dst.positions, dstStart))
                set(dst.handlesR, dstLast, v(dst.positions, dstStart))
            } else if (startPoint.parameter === 1) {
                // Start is the next control point.
            } else {
                set(dst.handlesR, dstLast, startInsert.handlePrev)
            }
        }
    } else {
        if (startPoint.index === endPoint.index && startPoint.parameter < 1) {
            if (startPoint.parameter > endPoint.parameter && startPoint.parameter < 1) {
                const parameter = f32(endPoint.parameter / startPoint.parameter)
                endInsert = bezierInsert(v(dst.positions, dstIndex - 1), startInsert.handlePrev, startInsert.leftHandle, startInsert.position, parameter)
                set(dst.handlesL, dstStart, endInsert.handleNext)
            } else {
                const parameter = f32(f32(endPoint.parameter - startPoint.parameter) / f32(1 - startPoint.parameter))
                const handleNext = startPoint.parameter === 0 ? sp(src.handlesL, endPoint.nextIndex) : startInsert.handleNext
                endInsert = bezierInsert(v(dst.positions, dstIndex - 1), v(dst.handlesR, dstIndex - 1), handleNext, sp(src.positions, endPoint.nextIndex), parameter)
            }
        } else {
            endInsert = knotInsert(endPoint)
            if ((startPoint.parameter >= endPoint.parameter && endPoint.index === startPoint.index) ||
                (startPoint.parameter === 0 && endPoint.nextIndex === startPoint.index)) {
                set(dst.handlesL, dstStart, endInsert.handleNext)
            }
        }
        set(dst.handlesR, dstIndex - 1, endInsert.handlePrev)
        dst.typesR[dstIndex - 1] = src.typesL[base + endPoint.index]
        set(dst.handlesL, dstIndex, endInsert.leftHandle)
        set(dst.handlesR, dstIndex, endInsert.rightHandle)
        set(dst.positions, dstIndex, endInsert.position)
        dst.typesL[dstIndex] = src.typesL[base + endPoint.nextIndex]
        dst.typesR[dstIndex] = src.typesR[base + endPoint.nextIndex]
    }
}
// endregion

/** `trim_sample_length` (:810). */
function trimSampleLength(lengths: Float32Array, sampleLength: number, factorMode: boolean): number {
    const last = lengths[lengths.length - 1]
    const length = factorMode ? f32(sampleLength * last) : sampleLength
    // `std::clamp(length, 0, last)`.
    return length < 0 ? 0 : last < length ? last : length
}

const hasType = (types: ArrayLike<number>, t: number) => Array.prototype.some.call(types, (x: number) => x === t)

/**
 * `trim_curves` (:943). `selection` lists the selected curves (non-empty), `starts`/`ends` are per curve,
 * `factorMode` is `GEO_NODE_CURVE_SAMPLE_FACTOR`.
 */
export function trimCurves(src: CurvesGeometry, selection: number[], starts: ArrayLike<number>, ends: ArrayLike<number>, factorMode: boolean): CurvesGeometry {
    const nc = src.curvesNum
    const selected = new Uint8Array(nc)
    for (const c of selection) selected[c] = 1
    const unselected: number[] = []
    for (let c = 0; c < nc; c++) if (!selected[c]) unselected.push(c)
    const ev = new CurvesEvaluator(src)
    const srcTypes = ev.types

    // `compute_curve_trim_parameters` (:823).
    const sizes = new Int32Array(nc)
    const startPoints: CurvePoint[] = new Array(nc), endPoints: CurvePoint[] = new Array(nc)
    const ranges: IndexRangeCyclic[] = new Array(nc)
    for (const c of selection) {
        const curveType = srcTypes[c]
        const [s, e] = src.pointsRange(c)
        const [es, ee] = ev.evaluatedRange(c)
        const pointCount = curveType === CURVE_TYPE_NURBS ? ee - es : e - s
        if (pointCount === 1) {
            sizes[c] = 1
            ranges[c] = new IndexRangeCyclic(0, 0, 1, 1)
            startPoints[c] = cp(0, 0, 0)
            endPoints[c] = cp(0, 0, 0)
            continue
        }
        const cyclic = !!ev.cyclic[c]
        const lengths = ev.lengthsForCurve(c)
        const startLength = trimSampleLength(lengths, starts[c], factorMode)
        let endLength: number
        let equalSamplePoint: boolean
        const last = lengths[lengths.length - 1]
        if (cyclic) {
            endLength = trimSampleLength(lengths, ends[c], factorMode)
            const cyclicStart = startLength === last ? 0 : startLength
            const cyclicEnd = endLength === last ? 0 : endLength
            equalSamplePoint = cyclicStart === cyclicEnd
        } else {
            endLength = ends[c] <= starts[c] ? startLength : trimSampleLength(lengths, ends[c], factorMode)
            equalSamplePoint = startLength === endLength
        }
        const resolution = ev.resolution[c]
        startPoints[c] = lookupCurvePoint(ev, curveType, c, lengths, startLength, cyclic, resolution, pointCount)
        if (equalSamplePoint) {
            endPoints[c] = startPoints[c]
            if (endLength <= startLength) {
                sizes[c] = 1
                if (isControlPoint(startPoints[c])) {
                    const single = startPoints[c].parameter === 1 ? startPoints[c].nextIndex : startPoints[c].index
                    ranges[c] = IndexRangeCyclic.fromSize(single, 1, pointCount)
                } else {
                    // An empty range (`IndexRangeCyclic()`).
                    ranges[c] = new IndexRangeCyclic(0, 0, 0, 0)
                }
            } else {
                ranges[c] = IndexRangeCyclic.betweenEndpoints(startPoints[c], endPoints[c], pointCount).pushLoop()
                sizes[c] = 1 + (isControlPoint(startPoints[c]) ? 0 : 1) + pointCount
            }
        } else {
            endPoints[c] = lookupCurvePoint(ev, curveType, c, lengths, endLength, cyclic, resolution, pointCount)
            ranges[c] = IndexRangeCyclic.betweenEndpoints(startPoints[c], endPoints[c], pointCount)
            sizes[c] = ranges[c].size + (isControlPoint(startPoints[c]) ? 0 : 1) + (isControlPoint(endPoints[c]) ? 0 : 1)
        }
    }
    for (const c of unselected) sizes[c] = src.curveOffsets[c + 1] - src.curveOffsets[c]
    const offsets = new Int32Array(nc + 1)
    for (let c = 0; c < nc; c++) offsets[c + 1] = offsets[c] + sizes[c]
    const dst = copyOnlyCurveDomain(src, offsets)
    const dstAcc = dst.accessor()

    // `retrieve_attributes_for_transfer` (`attribute_access.cc:643`) of the point attributes, skipping the special ones.
    const skip = new Set(['position', 'handle_left', 'handle_right', 'handle_type_left', 'handle_type_right', 'nurbs_weight'])
    const transfer: {type: DataType, src: TypedArray, dst: TypedArray}[] = []
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point || skip.has(layer.name)) continue
        const type = layer.type as DataType
        const meta = dstAcc.lookupMeta(layer.name)
        if (meta) {
            if (meta.domain !== AttrDomain.Point || meta.type !== type) continue
        } else if (!dstAcc.add(layer.name, AttrDomain.Point, type)) continue
        transfer.push({type, src: layer.data as TypedArray, dst: dst.attributes.get(layer.name)!.data as TypedArray})
    }

    const dstHas = (t: number) => hasType(curveTypes(dst), t)
    /** `fill_bezier_data` (:197). */
    const fillBezierData = (curves: number[]) => {
        if (!dstHas(CURVE_TYPE_BEZIER)) return
        const hl = curvesAttributeForWrite(dst, 'handle_left', [0, 0, 0]), hr = curvesAttributeForWrite(dst, 'handle_right', [0, 0, 0])
        const tl = curvesAttributeForWrite(dst, 'handle_type_left', [0]), tr = curvesAttributeForWrite(dst, 'handle_type_right', [0])
        for (const c of curves) {
            for (let p = dst.curveOffsets[c]; p < dst.curveOffsets[c + 1]; p++) {
                tr[p] = BEZIER_HANDLE_FREE
                tl[p] = BEZIER_HANDLE_FREE
                for (let k = 0; k < 3; k++) hl[p * 3 + k] = hr[p * 3 + k] = 0
            }
        }
    }
    /** `fill_nurbs_data` (:218). */
    const fillNurbsData = (curves: number[]) => {
        if (!dstHas(CURVE_TYPE_NURBS)) return
        const w = curvesAttributeForWrite(dst, 'nurbs_weight', [1])
        for (const c of curves) for (let p = dst.curveOffsets[c]; p < dst.curveOffsets[c + 1]; p++) w[p] = 0
    }
    const ofType = (t: number) => selection.filter(c => srcTypes[c] === t)
    const linearTransfer = (curves: number[]) => {
        for (const a of transfer) {
            for (const c of curves) {
                sampleIntervalLinear({type: a.type, data: a.src, base: src.curveOffsets[c]}, a.dst, ranges[c], dst.curveOffsets[c], sizes[c], startPoints[c], endPoints[c])
            }
        }
    }

    // `foreach_curve_by_type` (`curves_utils.cc:100`): Catmull Rom, poly, Bézier, NURBS.
    const catmull = ofType(CURVE_TYPE_CATMULL_ROM)
    if (catmull.length) {
        // `trim_catmull_rom_curves` (:648).
        for (const c of catmull) {
            const [s, e] = src.pointsRange(c)
            sampleIntervalCatmullRom({type: 'float3', data: src.positions, base: s}, e - s, dst.positions, ranges[c], dst.curveOffsets[c], sizes[c],
                startPoints[c], endPoints[c], !!ev.cyclic[c])
        }
        fillBezierData(catmull)
        fillNurbsData(catmull)
        for (const a of transfer) {
            for (const c of catmull) {
                const [s, e] = src.pointsRange(c)
                sampleIntervalCatmullRom({type: a.type, data: a.src, base: s}, e - s, a.dst, ranges[c], dst.curveOffsets[c], sizes[c],
                    startPoints[c], endPoints[c], !!ev.cyclic[c])
            }
        }
    }
    const poly = ofType(CURVE_TYPE_POLY)
    if (poly.length) {
        // `trim_polygonal_curves` (:610).
        for (const c of poly) {
            sampleIntervalLinear({type: 'float3', data: src.positions, base: src.curveOffsets[c]}, dst.positions, ranges[c], dst.curveOffsets[c], sizes[c],
                startPoints[c], endPoints[c])
        }
        fillBezierData(poly)
        fillNurbsData(poly)
        linearTransfer(poly)
    }
    const bezier = ofType(CURVE_TYPE_BEZIER)
    if (bezier.length) {
        // `trim_bezier_curves` (:702).
        const hl = src.attributes.get('handle_left')?.data as Float32Array | undefined
        const hr = src.attributes.get('handle_right')?.data as Float32Array | undefined
        if (!hl || !hr) throw new Error('trim_curves: Bézier curves without handle positions (dereferences an empty optional in Blender)')
        const srcData: BezierData = {
            positions: src.positions, handlesL: hl, handlesR: hr,
            typesL: src.attributes.get('handle_type_left')?.data ?? new Int8Array(src.pointsNum),
            typesR: src.attributes.get('handle_type_right')?.data ?? new Int8Array(src.pointsNum),
        }
        const dstData: BezierData = {
            positions: dst.positions,
            typesL: curvesAttributeForWrite(dst, 'handle_type_left', [0]),
            typesR: curvesAttributeForWrite(dst, 'handle_type_right', [0]),
            handlesL: curvesAttributeForWrite(dst, 'handle_left', [0, 0, 0]) as Float32Array,
            handlesR: curvesAttributeForWrite(dst, 'handle_right', [0, 0, 0]) as Float32Array,
        }
        for (const c of bezier) {
            sampleIntervalBezier(srcData, src.curveOffsets[c], dstData, ranges[c], dst.curveOffsets[c], sizes[c], startPoints[c], endPoints[c])
        }
        fillNurbsData(bezier)
        linearTransfer(bezier)
    }
    const nurbs = ofType(CURVE_TYPE_NURBS)
    if (nurbs.length) {
        // `trim_evaluated_curves` (:752).
        fillCurveTypesSelection(dst, nurbs, CURVE_TYPE_POLY)
        const evaluated = ev.positions
        for (const c of nurbs) {
            sampleIntervalLinear({type: 'float3', data: evaluated, base: ev.evaluatedOffsets[c]}, dst.positions, ranges[c], dst.curveOffsets[c], sizes[c],
                startPoints[c], endPoints[c])
        }
        fillBezierData(nurbs)
        fillNurbsData(nurbs)
        for (const a of transfer) {
            const comps = DATA_TYPES[a.type].components
            for (const c of nurbs) {
                const [s, e] = src.pointsRange(c)
                const [es, ee] = ev.evaluatedRange(c)
                const values = new DATA_TYPES[a.type].array((ee - es) * comps)
                ev.interpolateToEvaluated(c, a.type, a.src.subarray(s * comps, e * comps), values)
                sampleIntervalLinear({type: a.type, data: values, base: 0}, a.dst, ranges[c], dst.curveOffsets[c], sizes[c], startPoints[c], endPoints[c])
            }
        }
    }

    if (unselected.length === 0) {
        dstAcc.remove('cyclic')
    } else {
        const cyclic = dst.attributes.get('cyclic')
        if (cyclic) for (const c of selection) cyclic.data[c] = 0
        const copySkip = new Set<string>()
        if (!dstHas(CURVE_TYPE_NURBS) && hasType(srcTypes, CURVE_TYPE_NURBS)) copySkip.add('nurbs_weight')
        // `copy_attributes_group_to_group` (`attribute_access.cc:883`).
        for (const layer of src.attributes.layers()) {
            if (layer.domain !== AttrDomain.Point || copySkip.has(layer.name)) continue
            const type = layer.type as DataType
            const exists = dstAcc.contains(layer.name)
            const meta = dstAcc.lookupMeta(layer.name)
            if (meta) {
                if (meta.domain !== AttrDomain.Point || meta.type !== type) continue
            } else if (!dstAcc.add(layer.name, AttrDomain.Point, type)) continue
            const out = dst.attributes.get(layer.name)!.data
            const comps = DATA_TYPES[type].components
            if (!exists) {
                // `get_default_for_fill`: the built-in default, else the type's.
                const def = dstAcc.builtinDefault(layer.name) ?? DATA_TYPES[type].defaultValue
                for (let i = 0; i < dst.pointsNum; i++) for (let k = 0; k < comps; k++) out[i * comps + k] = def[k]
            }
            for (const c of unselected) {
                const [s, e] = src.pointsRange(c)
                const d = dst.curveOffsets[c]
                for (let i = 0; i < (e - s) * comps; i++) out[d * comps + i] = layer.data[s * comps + i]
            }
        }
    }
    removeAttributesBasedOnTypes(dst)
    return dst
}

/** `CurvesGeometry::remove_attributes_based_on_types` (`curves_geometry.cc:1762`). */
export function removeAttributesBasedOnTypes(curves: CurvesGeometry): void {
    const types = curveTypes(curves)
    const acc = curves.accessor()
    if (!hasType(types, CURVE_TYPE_BEZIER)) for (const n of ['handle_type_left', 'handle_type_right', 'handle_left', 'handle_right']) acc.remove(n)
    if (!hasType(types, CURVE_TYPE_NURBS)) for (const n of ['nurbs_weight', 'nurbs_order', 'knots_mode']) acc.remove(n)
    if (!hasType(types, CURVE_TYPE_BEZIER) && !hasType(types, CURVE_TYPE_CATMULL_ROM) && !hasType(types, CURVE_TYPE_NURBS)) acc.remove('resolution')
}
