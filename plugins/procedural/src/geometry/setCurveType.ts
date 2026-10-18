/**
 * `geometry::convert_curves` (Blender 5.2.2 `geometry/intern/set_curve_type.cc`) with the default
 * `ConvertCurvesOptions` (`GEO_set_curve_type.hh:13`: no handle points for poly / Catmull Rom, Bezier and Catmull Rom
 * shapes kept as NURBS) - the options Set Spline Type uses.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../blender/f32'
import {interpolate3, V3} from '../blender/math/vec'
import {CurvesGeometry} from './components'
import {
    BEZIER_HANDLE_ALIGN, BEZIER_HANDLE_VECTOR, CURVE_TYPE_BEZIER, CURVE_TYPE_CATMULL_ROM, CURVE_TYPE_NURBS, CURVE_TYPE_POLY, curvesAttributeOr,
    curveTypes, NURBS_KNOT_MODE_BEZIER, NURBS_KNOT_MODE_CUSTOM, NURBS_KNOT_MODE_ENDPOINT, NURBS_KNOT_MODE_NORMAL,
} from './curvesEval'
import {calculateBezierAutoHandles, curvesAttributeForWrite, fillCurveTypesSelection} from './curvesEdit'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {copyOnlyCurveDomain} from './resampleCurves'
import {removeAttributesBasedOnTypes} from './trimCurves'

interface Transfer {
    name: string
    c: number
    src: TypedArray
    dst: TypedArray
}

const get3 = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
const sub = (a: V3, b: V3): V3 => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])]
const add = (a: V3, b: V3): V3 => [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2])]
const mul = (a: V3, s: number): V3 => [f32(a[0] * s), f32(a[1] * s), f32(a[2] * s)]
const div = (a: V3, s: number): V3 => [f32(a[0] / s), f32(a[1] / s), f32(a[2] / s)]
const twiceMinus = (a: V3, b: V3): V3 => sub(mul(a, 2), b)

/** `is_nurbs_to_bezier_one_to_one` (:15). */
const isNurbsToBezierOneToOne = (mode: number) => mode === NURBS_KNOT_MODE_NORMAL || mode === NURBS_KNOT_MODE_ENDPOINT

/** `catmull_rom_to_bezier_handles` (:45). */
function catmullRomToBezierHandles(p: V3[], cyclic: boolean): {l: V3[], r: V3[]} {
    const n = p.length
    const s = f32(1 / 6)
    const l: V3[] = new Array(n), r: V3[] = new Array(n)
    if (n === 1) {
        l[0] = p[0]
        r[0] = p[0]
        return {l, r}
    }
    const firstOffset = cyclic ? sub(p[1], p[n - 1]) : sub(p[1], p[0])
    r[0] = add(p[0], mul(firstOffset, s))
    l[0] = sub(p[0], mul(firstOffset, s))
    const lastOffset = cyclic ? sub(p[0], p[n - 2]) : sub(p[n - 1], p[n - 2])
    l[n - 1] = sub(p[n - 1], mul(lastOffset, s))
    r[n - 1] = add(p[n - 1], mul(lastOffset, s))
    for (let i = 1; i < n - 1; i++) {
        l[i] = add(p[i], mul(sub(p[i - 1], p[i + 1]), s))
        r[i] = add(p[i], mul(sub(p[i + 1], p[i - 1]), s))
    }
    return {l, r}
}

/** `create_nurbs_to_bezier_handles` (:89). */
function createNurbsToBezierHandles(p: V3[], knotsMode: number): V3[] {
    const n = p.length
    const out: V3[] = []
    if (isNurbsToBezierOneToOne(knotsMode)) {
        const periodic = knotsMode === NURBS_KNOT_MODE_NORMAL
        if (periodic) out.push(add(p[1], div(sub(p[0], p[1]), 3)))
        else out.push(twiceMinus(p[0], p[1]), p[1])
        const segmentsNum = n - 1
        const ignoreInteriorSegment = segmentsNum === 3 && !periodic
        if (!ignoreInteriorSegment) {
            const midOffset = f32((segmentsNum - 1) / 2)
            for (let i = 1; i < 1 + segmentsNum - 2; i++) {
                const divisor = periodic ? 3 : Math.min(3, Math.trunc(f32(f32(-Math.abs(f32(i - midOffset)) + midOffset) + 1)))
                const displacement = div(sub(p[i + 1], p[i]), divisor)
                const numHandles = divisor < 3 ? 1 : 2
                for (let j = 1; j <= numHandles; j++) out.push(add(p[i], mul(displacement, j)))
            }
        }
        const last = n - 1
        if (periodic) out.push(add(p[last - 1], div(sub(p[last], p[last - 1]), 3)))
        else out.push(p[last - 1], twiceMinus(p[last], p[last - 1]))
    } else {
        for (let i = 0; i < n; i++) if (i % 3 !== 1) out.push(p[i])
        if (n % 3 === 1) out.pop()
        else if (n % 3 === 2) out.push(twiceMinus(p[n - 1], p[n - 2]))
    }
    return out
}

/** `to_bezier_size` (:179). */
function toBezierSize(type: number, cyclic: boolean, knotsMode: number, size: number): number {
    if (type !== CURVE_TYPE_NURBS) return size
    if (isNurbsToBezierOneToOne(knotsMode)) return cyclic ? size : Math.max(1, size - 2)
    return Math.trunc((size + 1) / 3)
}

/** Accumulated offsets from per-curve sizes (`accumulate_counts_to_offsets`). */
function offsetsFrom(sizes: number[]): Int32Array {
    const o = new Int32Array(sizes.length + 1)
    for (let i = 0; i < sizes.length; i++) o[i + 1] = o[i] + sizes[i]
    return o
}

/** `retrieve_attributes_for_transfer(src, dst, {Point})`: every point attribute, created on `dst` when missing. */
function transfers(src: CurvesGeometry, dst: CurvesGeometry): Transfer[] {
    const acc = dst.accessor()
    const out: Transfer[] = []
    for (const layer of src.attributes.layers()) {
        if (layer.domain !== AttrDomain.Point) continue
        const type = layer.type as DataType
        if (!dst.attributes.get(layer.name)) acc.add(layer.name, AttrDomain.Point, type)
        out.push({name: layer.name, c: DATA_TYPES[type].components, src: layer.data as TypedArray, dst: dst.attributes.get(layer.name)!.data as TypedArray})
    }
    return out
}

/** `copy_group_to_group` of one curve. */
function copyCurve(t: {c: number, src: ArrayLike<number>, dst: TypedArray}, src: CurvesGeometry, dst: CurvesGeometry, curve: number): void {
    const [s, e] = src.pointsRange(curve)
    const d = dst.curveOffsets[curve]
    for (let i = 0; i < (e - s) * t.c; i++) t.dst[d * t.c + i] = t.src[s * t.c + i]
}

const HANDLE_NAMES = ['position', 'handle_type_left', 'handle_type_right', 'handle_right', 'handle_left']

function checkCustomKnots(src: CurvesGeometry): void {
    const types = curveTypes(src)
    const knots = curvesAttributeOr(src, 'knots_mode', src.curvesNum, 0)
    for (let c = 0; c < src.curvesNum; c++) {
        if (types[c] === CURVE_TYPE_NURBS && knots[c] === NURBS_KNOT_MODE_CUSTOM) throw new Error('convert_curves: NURBS custom knots (copy_custom_knots) are not ported')
    }
}

/** `convert_curves_to_bezier` (:205). */
function convertCurvesToBezier(src: CurvesGeometry, selection: number[]): CurvesGeometry {
    const srcTypes = curveTypes(src)
    const srcKnots = curvesAttributeOr(src, 'knots_mode', src.curvesNum, 0)
    const srcCyclic = curvesAttributeOr(src, 'cyclic', src.curvesNum, 0)
    const selected = new Uint8Array(src.curvesNum)
    for (const c of selection) selected[c] = 1
    const sizes: number[] = []
    for (let c = 0; c < src.curvesNum; c++) {
        const [s, e] = src.pointsRange(c)
        sizes.push(selected[c] ? toBezierSize(srcTypes[c], !!srcCyclic[c], srcKnots[c], e - s) : e - s)
    }
    const dst = copyOnlyCurveDomain(src, offsetsFrom(sizes))
    fillCurveTypesSelection(dst, selection, CURVE_TYPE_BEZIER)
    const dstPos = dst.positions
    const hl = curvesAttributeForWrite(dst, 'handle_left', [0, 0, 0]) as Float32Array
    const hr = curvesAttributeForWrite(dst, 'handle_right', [0, 0, 0]) as Float32Array
    const tl = curvesAttributeForWrite(dst, 'handle_type_left', [0]) as TypedArray
    const tr = curvesAttributeForWrite(dst, 'handle_type_right', [0]) as TypedArray
    const generic = transfers(src, dst)
    const skip = new Set(HANDLE_NAMES)
    if (!Array.prototype.some.call(curveTypes(dst), (t: number) => t === CURVE_TYPE_NURBS)) skip.add('nurbs_weight')
    const srcPos = src.positions
    const byType = (type: number) => selection.filter(c => srcTypes[c] === type)
    const copyGeneric = (curves: number[]) => {
        for (const t of generic) if (!skip.has(t.name)) for (const c of curves) copyCurve(t, src, dst, c)
    }
    const fill = (curves: number[], value: number, data: TypedArray) => {
        for (const c of curves) data.fill(value, dst.curveOffsets[c], dst.curveOffsets[c + 1])
    }
    // `foreach_curve_by_type`: Catmull Rom, poly, Bezier, NURBS.
    const catmull = byType(CURVE_TYPE_CATMULL_ROM)
    if (catmull.length) {
        fill(catmull, BEZIER_HANDLE_ALIGN, tl)
        fill(catmull, BEZIER_HANDLE_ALIGN, tr)
        for (const c of catmull) copyCurve({c: 3, src: srcPos, dst: dstPos}, src, dst, c)
        for (const c of catmull) {
            const [s, e] = src.pointsRange(c)
            const p: V3[] = []
            for (let i = s; i < e; i++) p.push(get3(srcPos, i))
            const {l, r} = catmullRomToBezierHandles(p, !!srcCyclic[c])
            const d = dst.curveOffsets[c]
            l.forEach((v, i) => hl.set(v, (d + i) * 3))
            r.forEach((v, i) => hr.set(v, (d + i) * 3))
        }
        copyGeneric(catmull)
    }
    const poly = byType(CURVE_TYPE_POLY)
    if (poly.length) {
        for (const c of poly) copyCurve({c: 3, src: srcPos, dst: dstPos}, src, dst, c)
        fill(poly, BEZIER_HANDLE_VECTOR, tl)
        fill(poly, BEZIER_HANDLE_VECTOR, tr)
        calculateBezierAutoHandles(dst)
        copyGeneric(poly)
    }
    const bezier = byType(CURVE_TYPE_BEZIER)
    if (bezier.length) {
        const sl = src.attributes.get('handle_left')?.data, sr = src.attributes.get('handle_right')?.data
        if (!sl || !sr) throw new Error('convert_curves: Bezier curves without handle positions (dereferences an empty optional in Blender)')
        const stl = curvesAttributeOr(src, 'handle_type_left', src.pointsNum, 0)
        const str = curvesAttributeOr(src, 'handle_type_right', src.pointsNum, 0)
        for (const c of bezier) {
            copyCurve({c: 3, src: srcPos, dst: dstPos}, src, dst, c)
            copyCurve({c: 3, src: sl, dst: hl}, src, dst, c)
            copyCurve({c: 3, src: sr, dst: hr}, src, dst, c)
            copyCurve({c: 1, src: stl, dst: tl}, src, dst, c)
            copyCurve({c: 1, src: str, dst: tr}, src, dst, c)
        }
        calculateBezierAutoHandles(dst)
        copyGeneric(bezier)
    }
    const nurbs = byType(CURVE_TYPE_NURBS)
    if (nurbs.length) {
        fill(nurbs, BEZIER_HANDLE_ALIGN, tl)
        fill(nurbs, BEZIER_HANDLE_ALIGN, tr)
        for (const c of nurbs) {
            const [s, e] = src.pointsRange(c)
            const ds = dst.curveOffsets[c], de = dst.curveOffsets[c + 1]
            if (de - ds === 1) {
                const position = get3(srcPos, s)
                dstPos.set(position, ds * 3)
                hl.set(position, ds * 3)
                hr.set(position, ds * 3)
                continue
            }
            let knotsMode = srcKnots[c]
            let p: V3[] = []
            for (let i = s; i < e; i++) p.push(get3(srcPos, i))
            if (srcCyclic[c] && isNurbsToBezierOneToOne(knotsMode)) {
                p = [...p, p[0], p[1]]
                knotsMode = NURBS_KNOT_MODE_NORMAL
            }
            const handles = createNurbsToBezierHandles(p, knotsMode)
            for (let i = 0; i < de - ds; i++) {
                hl.set(handles[i * 2], (ds + i) * 3)
                hr.set(handles[i * 2 + 1], (ds + i) * 3)
                // `create_nurbs_to_bezier_positions` (:160).
                dstPos.set(isNurbsToBezierOneToOne(knotsMode) ? interpolate3(handles[i * 2], handles[i * 2 + 1], 0.5) : p[i * 3 + 1], (ds + i) * 3)
            }
        }
        // `src_point_by_dst_point` (:305) and `attribute_math::gather`.
        for (const t of generic) {
            if (skip.has(t.name)) continue
            for (const c of nurbs) {
                const [s, e] = src.pointsRange(c)
                const ds = dst.curveOffsets[c], de = dst.curveOffsets[c + 1]
                const n = de - ds
                const map = new Array<number>(n)
                switch (srcKnots[c]) {
                case NURBS_KNOT_MODE_NORMAL:
                    for (let i = 0; i < n; i++) map[i] = s + (i + 1) % (e - s)
                    break
                case NURBS_KNOT_MODE_ENDPOINT:
                    for (let i = 1; i < n - 1; i++) map[i] = s + i + 1
                    map[0] = s
                    map[n - 1] = e - 1
                    break
                default:
                    for (let i = 0; i < n; i++) map[i] = s + i * 3 + 1
                }
                for (let i = 0; i < n; i++) for (let k = 0; k < t.c; k++) t.dst[(ds + i) * t.c + k] = t.src[map[i] * t.c + k]
            }
        }
    }
    for (let c = 0; c < src.curvesNum; c++) if (!selected[c]) for (const t of generic) copyCurve(t, src, dst, c)
    return dst
}

/** `convert_curves_to_nurbs` (:383). */
function convertCurvesToNurbs(src: CurvesGeometry, selection: number[]): CurvesGeometry {
    const srcTypes = curveTypes(src)
    const srcCyclic = curvesAttributeOr(src, 'cyclic', src.curvesNum, 0)
    const selected = new Uint8Array(src.curvesNum)
    for (const c of selection) selected[c] = 1
    const sizes: number[] = []
    for (let c = 0; c < src.curvesNum; c++) {
        const [s, e] = src.pointsRange(c)
        const t = srcTypes[c]
        sizes.push(selected[c] && (t === CURVE_TYPE_BEZIER || t === CURVE_TYPE_CATMULL_ROM) ? (e - s) * 3 : e - s)
    }
    const dst = copyOnlyCurveDomain(src, offsetsFrom(sizes))
    fillCurveTypesSelection(dst, selection, CURVE_TYPE_NURBS)
    const dstPos = dst.positions
    const generic = transfers(src, dst)
    const skip = new Set([...HANDLE_NAMES, 'nurbs_weight'])
    const srcPos = src.positions
    const srcHasWeight = !!src.attributes.get('nurbs_weight')
    const byType = (type: number) => selection.filter(c => srcTypes[c] === type)
    const orders = () => curvesAttributeForWrite(dst, 'nurbs_order', [4])
    const knots = () => curvesAttributeForWrite(dst, 'knots_mode', [0])
    const fillWeights = (curves: number[]) => {
        if (!srcHasWeight) return
        const w = curvesAttributeForWrite(dst, 'nurbs_weight', [1])
        for (const c of curves) for (let i = dst.curveOffsets[c]; i < dst.curveOffsets[c + 1]; i++) w[i] = 1
    }
    /** `bezier_to_nurbs_copy_attributes` (:417): every source point value three times. */
    const copyTripled = (curves: number[]) => {
        for (const t of generic) {
            if (skip.has(t.name)) continue
            for (const c of curves) {
                const [s, e] = src.pointsRange(c)
                const d = dst.curveOffsets[c]
                for (let i = 0; i < e - s; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < t.c; k++) t.dst[(d + i * 3 + j) * t.c + k] = t.src[(s + i) * t.c + k]
            }
        }
    }
    const writeTriples = (c: number, l: V3[], p: V3[], r: V3[]) => {
        const d = dst.curveOffsets[c]
        for (let i = 0; i < p.length; i++) {
            dstPos.set(l[i], (d + i * 3) * 3)
            dstPos.set(p[i], (d + i * 3 + 1) * 3)
            dstPos.set(r[i], (d + i * 3 + 2) * 3)
        }
    }
    const curvePoints = (c: number, data: ArrayLike<number>) => {
        const [s, e] = src.pointsRange(c)
        const p: V3[] = []
        for (let i = s; i < e; i++) p.push(get3(data, i))
        return p
    }
    const catmull = byType(CURVE_TYPE_CATMULL_ROM)
    if (catmull.length) {
        const o = orders(), k = knots()
        for (const c of catmull) {
            o[c] = 4
            k[c] = NURBS_KNOT_MODE_BEZIER
        }
        fillWeights(catmull)
        for (const c of catmull) {
            const p = curvePoints(c, srcPos)
            const {l, r} = catmullRomToBezierHandles(p, !!srcCyclic[c])
            writeTriples(c, l, p, r)
        }
        copyTripled(catmull)
    }
    const poly = byType(CURVE_TYPE_POLY)
    if (poly.length) {
        const o = orders()
        for (const c of poly) o[c] = 4
        for (const c of poly) copyCurve({c: 3, src: srcPos, dst: dstPos}, src, dst, c)
        fillWeights(poly)
        const k = knots()
        for (const c of poly) k[c] = srcCyclic[c] ? NURBS_KNOT_MODE_NORMAL : NURBS_KNOT_MODE_ENDPOINT
        for (const t of generic) if (!skip.has(t.name)) for (const c of poly) copyCurve(t, src, dst, c)
    }
    const bezier = byType(CURVE_TYPE_BEZIER)
    if (bezier.length) {
        const sl = src.attributes.get('handle_left')?.data, sr = src.attributes.get('handle_right')?.data
        if (!sl || !sr) throw new Error('convert_curves: Bezier curves without handle positions (dereferences an empty optional in Blender)')
        const o = orders(), k = knots()
        for (const c of bezier) {
            o[c] = 4
            k[c] = NURBS_KNOT_MODE_BEZIER
        }
        fillWeights(bezier)
        for (const c of bezier) writeTriples(c, curvePoints(c, sl), curvePoints(c, srcPos), curvePoints(c, sr))
        copyTripled(bezier)
    }
    const nurbs = byType(CURVE_TYPE_NURBS)
    if (nurbs.length) {
        for (const c of nurbs) copyCurve({c: 3, src: srcPos, dst: dstPos}, src, dst, c)
        const sw = src.attributes.get('nurbs_weight')?.data
        if (sw) {
            const w = curvesAttributeForWrite(dst, 'nurbs_weight', [1]) as TypedArray
            for (const c of nurbs) copyCurve({c: 1, src: sw, dst: w}, src, dst, c)
        }
        for (const t of generic) if (!skip.has(t.name)) for (const c of nurbs) copyCurve(t, src, dst, c)
    }
    for (let c = 0; c < src.curvesNum; c++) if (!selected[c]) for (const t of generic) copyCurve(t, src, dst, c)
    return dst
}

/** `convert_curves_trivial` (:663). */
function convertCurvesTrivial(src: CurvesGeometry, selection: number[], dstType: number): CurvesGeometry {
    const dst = src.clone()
    fillCurveTypesSelection(dst, selection, dstType)
    removeAttributesBasedOnTypes(dst)
    return dst
}

/** `convert_curves` (:776) with default options. */
export function convertCurves(src: CurvesGeometry, selection: number[], dstType: number): CurvesGeometry {
    checkCustomKnots(src)
    switch (dstType) {
    case CURVE_TYPE_CATMULL_ROM:
    case CURVE_TYPE_POLY:
        // `convert_curves_to_catmull_rom_or_poly` (:673): no handle points by default.
        return convertCurvesTrivial(src, selection, dstType)
    case CURVE_TYPE_BEZIER:
        return convertCurvesToBezier(src, selection)
    case CURVE_TYPE_NURBS:
        return convertCurvesToNurbs(src, selection)
    }
    throw new Error(`convert_curves: unknown curve type ${dstType}`)
}
