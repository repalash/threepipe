/**
 * `CurveMapping` evaluation - `blenkernel/intern/colortools.cc`: defaults (`BKE_curvemapping_set_defaults`
 * :47, `BKE_curvemapping_add` :99), the lookup table (`curvemap_make_table` :732 with `calchandle_curvemap`
 * :572, `curvemap_calc_extend` :687, `curve_eval_bezier_point` :722) and `BKE_curvemap_evaluateF` :1153 /
 * `BKE_curvemapping_evaluateF` :1177. Bezier helpers from `blenkernel/intern/curve.cc`
 * (`BKE_curve_forward_diff_bezier` :1695, `BKE_curve_correct_bezpart` :5458). Constants `CM_RESOL`,
 * `CM_TABLE`, `CM_TABLEDIV` (`makesdna/DNA_color_types.h:19`).
 *
 * The points are used in their stored order, as `curvemap_make_table` does (Blender keeps them sorted when
 * they are edited, `BKE_curvemapping_changed`). Handle types are the RNA names of `CurveMapPoint.handle_type`
 * (`makesrna/intern/rna_color.cc:879`): `AUTO` (HD_AUTO), `AUTO_CLAMPED` (HD_AUTO_ANIM), `VECTOR` (HD_VECT) -
 * the key is `handleType` (see `issues/open/audit-procgen-float-curve-handle-type-naming-mismatch.md`).
 */

import {f32} from '../f32'

const CM_RESOL = 32
const CM_TABLE = 256
const CM_TABLEDIV = f32(1 / 256)
const FLT_EPSILON = 1.1920928955078125e-7

/** The serialised form (`porting/blender/dump_blend.py` `curveMapping`). */
export interface CurveMappingJSON {
    clipMinX?: number
    clipMinY?: number
    clipMaxX?: number
    clipMaxY?: number
    useClip?: boolean
    extend?: 'HORIZONTAL' | 'EXTRAPOLATED'
    /** `CUMA_USE_WRAPPING` (not exposed in RNA; hue-correct curves). */
    useWrapping?: boolean
    curves?: {points: {location: number[], handleType?: string}[]}[]
}

type HandleType = 'AUTO' | 'AUTO_ANIM' | 'VECT'

/** `BezTriple` in 2D: `vec[0]` left handle, `vec[1]` key, `vec[2]` right handle (the z components are 0). */
interface Bezt {
    vec: [number, number][]
    h1: HandleType
    h2: HandleType
}

/** A built `CurveMap`: its table and the extrapolation data. */
export interface CurveMapTable {
    mintable: number
    maxtable: number
    range: number
    extIn: [number, number]
    extOut: [number, number]
    /** `CM_TABLE + 1` points `(x, y)`. */
    table: Float32Array
}

export interface CurveMappingEval {
    doClip: boolean
    extrapolate: boolean
    clipMinY: number
    clipMaxY: number
    curves: CurveMapTable[]
}

const lenV2 = (x: number, y: number) => f32(Math.sqrt(f32(f32(x * x) + f32(y * y))))

/** `calchandle_curvemap` (`colortools.cc:572`). Writes `bezt.vec[0]` / `vec[2]`. */
function calchandleCurvemap(bezt: Bezt, prev: Bezt | null, next: Bezt | null): void {
    const p2 = bezt.vec[1]
    let p1: [number, number], p3: [number, number]
    if (prev === null) {
        p3 = next!.vec[1]
        p1 = [f32(f32(2 * p2[0]) - p3[0]), f32(f32(2 * p2[1]) - p3[1])]
    } else {
        p1 = prev.vec[1]
    }
    if (next === null) {
        p1 = prev!.vec[1]
        p3 = [f32(f32(2 * p2[0]) - p1[0]), f32(f32(2 * p2[1]) - p1[1])]
    } else {
        p3 = next.vec[1]
    }
    const dvecA: [number, number] = [f32(p2[0] - p1[0]), f32(p2[1] - p1[1])]
    const dvecB: [number, number] = [f32(p3[0] - p2[0]), f32(p3[1] - p2[1])]
    let lenA = lenV2(dvecA[0], dvecA[1])
    let lenB = lenV2(dvecB[0], dvecB[1])
    if (lenA === 0) lenA = 1
    if (lenB === 0) lenB = 1
    const isAuto = (h: HandleType) => h === 'AUTO' || h === 'AUTO_ANIM'
    if (isAuto(bezt.h1) || isAuto(bezt.h2)) {
        const tvec: [number, number] = [
            f32(f32(dvecB[0] / lenB) + f32(dvecA[0] / lenA)),
            f32(f32(dvecB[1] / lenB) + f32(dvecA[1] / lenA)),
        ]
        const len = f32(lenV2(tvec[0], tvec[1]) * f32(2.5614))
        if (len !== 0) {
            if (isAuto(bezt.h1)) {
                lenA = f32(lenA / len)
                // `madd_v2_v2v2fl(p2_h1, p2, tvec, -len_a)`.
                bezt.vec[0] = [f32(p2[0] + f32(tvec[0] * -lenA)), f32(p2[1] + f32(tvec[1] * -lenA))]
                if (bezt.h1 === 'AUTO_ANIM' && next && prev) {
                    const ydiff1 = f32(prev.vec[1][1] - bezt.vec[1][1])
                    const ydiff2 = f32(next.vec[1][1] - bezt.vec[1][1])
                    if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
                        bezt.vec[0][1] = bezt.vec[1][1]
                    } else if (ydiff1 <= 0) {
                        // `std::max(prev, h)`: `prev < h ? h : prev`.
                        bezt.vec[0][1] = prev.vec[1][1] < bezt.vec[0][1] ? bezt.vec[0][1] : prev.vec[1][1]
                    } else {
                        // `std::min(prev, h)`: `h < prev ? h : prev`.
                        bezt.vec[0][1] = bezt.vec[0][1] < prev.vec[1][1] ? bezt.vec[0][1] : prev.vec[1][1]
                    }
                }
            }
            if (isAuto(bezt.h2)) {
                lenB = f32(lenB / len)
                bezt.vec[2] = [f32(p2[0] + f32(tvec[0] * lenB)), f32(p2[1] + f32(tvec[1] * lenB))]
                if (bezt.h2 === 'AUTO_ANIM' && next && prev) {
                    const ydiff1 = f32(prev.vec[1][1] - bezt.vec[1][1])
                    const ydiff2 = f32(next.vec[1][1] - bezt.vec[1][1])
                    if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
                        bezt.vec[2][1] = bezt.vec[1][1]
                    } else if (ydiff1 <= 0) {
                        bezt.vec[2][1] = bezt.vec[2][1] < next.vec[1][1] ? bezt.vec[2][1] : next.vec[1][1]
                    } else {
                        bezt.vec[2][1] = next.vec[1][1] < bezt.vec[2][1] ? bezt.vec[2][1] : next.vec[1][1]
                    }
                }
            }
        }
    }
    const third = f32(1 / 3)
    if (bezt.h1 === 'VECT') bezt.vec[0] = [f32(p2[0] + f32(dvecA[0] * -third)), f32(p2[1] + f32(dvecA[1] * -third))]
    if (bezt.h2 === 'VECT') bezt.vec[2] = [f32(p2[0] + f32(dvecB[0] * third)), f32(p2[1] + f32(dvecB[1] * third))]
}

/** `BKE_curve_correct_bezpart` (`curve.cc:5458`): shortens crossing handles. Modifies `v2` and `v3`. */
function correctBezpart(v1: [number, number], v2: [number, number], v3: [number, number], v4: [number, number]): void {
    const h1 = [f32(v1[0] - v2[0]), f32(v1[1] - v2[1])]
    const h2 = [f32(v4[0] - v3[0]), f32(v4[1] - v3[1])]
    const len = f32(v4[0] - v1[0])
    const len1 = Math.abs(h1[0])
    const len2 = Math.abs(h2[0])
    const sum = f32(len1 + len2)
    if (sum === 0) return
    if (sum > len) {
        const fac = f32(len / sum)
        v2[0] = f32(v1[0] - f32(fac * h1[0]))
        v2[1] = f32(v1[1] - f32(fac * h1[1]))
        v3[0] = f32(v4[0] - f32(fac * h2[0]))
        v3[1] = f32(v4[1] - f32(fac * h2[1]))
    }
}

/** `BKE_curve_forward_diff_bezier` (`curve.cc:1695`) with `it` steps, writing `it + 1` values at `p[o + k * 2]`. */
function forwardDiffBezier(q0: number, q1: number, q2: number, q3: number, p: Float32Array, o: number, it: number): void {
    let f = it
    const rt0 = q0
    const rt1 = f32(f32(3 * f32(q1 - q0)) / f)
    f = f32(f * f)
    const rt2 = f32(f32(3 * f32(f32(q0 - f32(2 * q1)) + q2)) / f)
    f = f32(f * it)
    const rt3 = f32(f32(f32(q3 - q0) + f32(3 * f32(q1 - q2))) / f)
    q0 = rt0
    q1 = f32(f32(rt1 + rt2) + rt3)
    q2 = f32(f32(2 * rt2) + f32(6 * rt3))
    q3 = f32(6 * rt3)
    for (let a = 0; a <= it; a++) {
        p[o + a * 2] = q0
        q0 = f32(q0 + q1)
        q1 = f32(q1 + q2)
        q2 = f32(q2 + q3)
    }
}

/** `curve_eval_bezier_point` (`colortools.cc:722`). */
function evalBezierSegment(start: Bezt, end: Bezt, out: Float32Array, o: number): void {
    correctBezpart(start.vec[1], start.vec[2], end.vec[0], end.vec[1])
    forwardDiffBezier(start.vec[1][0], start.vec[2][0], end.vec[0][0], end.vec[1][0], out, o, CM_RESOL - 1)
    forwardDiffBezier(start.vec[1][1], start.vec[2][1], end.vec[0][1], end.vec[1][1], out, o + 1, CM_RESOL - 1)
}

/** `curvemap_calc_extend` (`colortools.cc:687`). */
function calcExtend(extrapolate: boolean, extIn: [number, number], extOut: [number, number], x: number, first: ArrayLike<number>, last: ArrayLike<number>): number {
    if (x <= first[0]) {
        if (!extrapolate) return first[1]
        if (extIn[0] === 0) return f32(first[1] + f32(extIn[1] * 10000))
        return f32(first[1] + f32(f32(extIn[1] * f32(x - first[0])) / extIn[0]))
    }
    if (x >= last[0]) {
        if (!extrapolate) return last[1]
        if (extOut[0] === 0) return f32(last[1] - f32(extOut[1] * 10000))
        return f32(last[1] + f32(f32(extOut[1] * f32(x - last[0])) / extOut[0]))
    }
    return 0
}

const copyBezt = (b: Bezt): Bezt => ({vec: b.vec.map(v => [v[0], v[1]] as [number, number]), h1: b.h1, h2: b.h2})

/** `curvemap_make_table` (`colortools.cc:732`). */
export function curvemapMakeTable(
    points: readonly {x: number, y: number, handle: string}[],
    clipMinX: number, clipMaxX: number, extrapolate: boolean, useWrapping: boolean,
): CurveMapTable {
    let mintable = clipMinX
    let maxtable = clipMaxX
    const totpoint = points.length
    const beztTotpoint = Math.max(totpoint, 2)
    const bezt: Bezt[] = []
    for (let a = 0; a < beztTotpoint; a++) bezt.push({vec: [[0, 0], [0, 0], [0, 0]], h1: 'AUTO', h2: 'AUTO'})
    if (totpoint >= 2) {
        for (let a = 0; a < beztTotpoint; a++) {
            const p = points[a]
            // `min_ff` / `max_ff`.
            mintable = mintable < p.x ? mintable : p.x
            maxtable = maxtable > p.x ? maxtable : p.x
            bezt[a].vec[1] = [p.x, p.y]
            const h: HandleType = p.handle === 'VECTOR' ? 'VECT' : p.handle === 'AUTO_CLAMPED' ? 'AUTO_ANIM' : 'AUTO'
            if (p.handle !== 'VECTOR' && p.handle !== 'AUTO_CLAMPED' && p.handle !== 'AUTO') {
                throw new Error(`procedural: curve point handle type ${p.handle} is not a CurveMapPoint handle type`)
            }
            bezt[a].h1 = bezt[a].h2 = h
        }
    } else {
        // Fallback when points are missing.
        mintable = 0
        maxtable = 0
    }

    const last = beztTotpoint - 1
    const tableRange = f32(maxtable - mintable)
    let bezPre = copyBezt(bezt[last])
    let bezPost = copyBezt(bezt[0])
    let prev: Bezt | null = null
    let postPtr: Bezt | null = null
    if (useWrapping) {
        bezPre.h1 = bezPre.h2 = bezt[last].h2
        bezPre.vec[1] = [f32(bezt[last].vec[1][0] - tableRange), bezt[last].vec[1][1]]
        bezPost.h1 = bezPost.h2 = bezt[0].h1
        bezPost.vec[1] = [f32(bezt[0].vec[1][0] + tableRange), bezt[0].vec[1][1]]
        prev = bezPre
        postPtr = bezPost
    }
    for (let a = 0; a < beztTotpoint; a++) {
        const next = a !== last ? bezt[a + 1] : postPtr
        calchandleCurvemap(bezt[a], prev, next)
        prev = bezt[a]
    }
    // Pre and post handles for wrapping curves (computed, used only when wrapping).
    bezPre = {...bezPre, vec: [
        [f32(bezt[last].vec[0][0] - tableRange), bezt[last].vec[0][1]], bezPre.vec[1],
        [f32(bezt[last].vec[2][0] - tableRange), bezt[last].vec[2][1]]]}
    bezPost = {...bezPost, vec: [
        [f32(bezt[0].vec[0][0] + tableRange), bezt[0].vec[0][1]], bezPost.vec[1],
        [f32(bezt[0].vec[2][0] + tableRange), bezt[0].vec[2][1]]]}

    // First and last handle point to the closest handle instead of the next/previous centre.
    if (beztTotpoint > 2 && !useWrapping) {
        if (bezt[0].h2 === 'AUTO') {
            const b = bezt[0]
            const hlen = lenV2(f32(b.vec[2][0] - b.vec[1][0]), f32(b.vec[2][1] - b.vec[1][1]))
            // `vec[0] = std::max(vec[0], key x)`.
            const vx0 = bezt[1].vec[0][0] < b.vec[1][0] ? b.vec[1][0] : bezt[1].vec[0][0]
            const vec = [f32(vx0 - b.vec[1][0]), f32(bezt[1].vec[0][1] - b.vec[1][1])]
            const nlen = lenV2(vec[0], vec[1])
            if (nlen > FLT_EPSILON) {
                const s = f32(hlen / nlen)
                vec[0] = f32(vec[0] * s)
                vec[1] = f32(vec[1] * s)
                b.vec[2] = [f32(vec[0] + b.vec[1][0]), f32(vec[1] + b.vec[1][1])]
                b.vec[0] = [f32(b.vec[1][0] - vec[0]), f32(b.vec[1][1] - vec[1])]
            }
        }
        if (bezt[last].h2 === 'AUTO') {
            const b = bezt[last]
            const hlen = lenV2(f32(b.vec[0][0] - b.vec[1][0]), f32(b.vec[0][1] - b.vec[1][1]))
            // `vec[0] = std::min(vec[0], key x)`.
            const vx0 = b.vec[1][0] < bezt[last - 1].vec[2][0] ? b.vec[1][0] : bezt[last - 1].vec[2][0]
            const vec = [f32(vx0 - b.vec[1][0]), f32(bezt[last - 1].vec[2][1] - b.vec[1][1])]
            const nlen = lenV2(vec[0], vec[1])
            if (nlen > FLT_EPSILON) {
                const s = f32(hlen / nlen)
                vec[0] = f32(vec[0] * s)
                vec[1] = f32(vec[1] * s)
                b.vec[0] = [f32(vec[0] + b.vec[1][0]), f32(vec[1] + b.vec[1][1])]
                b.vec[2] = [f32(b.vec[1][0] - vec[0]), f32(b.vec[1][1] - vec[1])]
            }
        }
    }

    const totTable = useWrapping ? (beztTotpoint + 1) * CM_RESOL : (beztTotpoint - 1) * CM_RESOL
    const allpoints = new Float32Array(totTable * 2)
    let o = 0
    if (useWrapping) {
        evalBezierSegment(bezPre, bezt[0], allpoints, o)
        o += 2 * CM_RESOL
    }
    for (let a = 0; a < beztTotpoint - 1; a++, o += 2 * CM_RESOL) evalBezierSegment(bezt[a], bezt[a + 1], allpoints, o)
    if (useWrapping) evalBezierSegment(bezt[last], bezPost, allpoints, o)

    // Extrapolation directions, unit length (`sqrtf`).
    const extIn: [number, number] = [f32(bezt[0].vec[0][0] - bezt[0].vec[1][0]), f32(bezt[0].vec[0][1] - bezt[0].vec[1][1])]
    const extInRange = lenV2(extIn[0], extIn[1])
    extIn[0] = f32(extIn[0] / extInRange)
    extIn[1] = f32(extIn[1] / extInRange)
    const extOut: [number, number] = [f32(bezt[last].vec[1][0] - bezt[last].vec[2][0]), f32(bezt[last].vec[1][1] - bezt[last].vec[2][1])]
    const extOutRange = lenV2(extOut[0], extOut[1])
    extOut[0] = f32(extOut[0] / extOutRange)
    extOut[1] = f32(extOut[1] / extOutRange)

    const range = f32(CM_TABLEDIV * tableRange)
    const table = new Float32Array((CM_TABLE + 1) * 2)
    const firstpoint = 0
    const lastpoint = 2 * (totTable - 1)
    let point = 0
    for (let a = 0; a <= CM_TABLE; a++) {
        const curX = f32(mintable + f32(range * a))
        table[a * 2] = curX
        while (curX >= allpoints[point] && point !== lastpoint) point += 2
        if ((point === firstpoint || (point === lastpoint && curX >= allpoints[point])) && !useWrapping) {
            // `compare_ff(cur_x, point[0], 1e-6f)`.
            if (Math.abs(f32(curX - allpoints[point])) <= f32(1e-6)) {
                table[a * 2 + 1] = allpoints[point + 1]
            } else {
                table[a * 2 + 1] = calcExtend(extrapolate, extIn, extOut, curX,
                    allpoints.subarray(firstpoint, firstpoint + 2), allpoints.subarray(lastpoint, lastpoint + 2))
            }
        } else {
            let fac1 = f32(allpoints[point] - allpoints[point - 2])
            const fac2 = f32(allpoints[point] - curX)
            fac1 = fac1 > FLT_EPSILON ? f32(fac2 / fac1) : 0
            table[a * 2 + 1] = f32(f32(fac1 * allpoints[point - 1]) + f32(f32(1 - fac1) * allpoints[point + 1]))
        }
    }
    return {mintable, maxtable, range: f32(1 / range), extIn, extOut, table}
}

/** The defaults of `BKE_curvemapping_add(1, 0, 0, 1, 1)` (`colortools.cc:99`) completed by a stored mapping. */
export function buildCurveMapping(json: CurveMappingJSON | undefined): CurveMappingEval {
    const clipMinX = f32(json?.clipMinX ?? 0), clipMaxX = f32(json?.clipMaxX ?? 1)
    const clipMinY = f32(json?.clipMinY ?? 0), clipMaxY = f32(json?.clipMaxY ?? 1)
    // `cumap->flag = CUMA_DO_CLIP | CUMA_EXTEND_EXTRAPOLATE`.
    const doClip = json?.useClip ?? true
    const extrapolate = (json?.extend ?? 'EXTRAPOLATED') === 'EXTRAPOLATED'
    const useWrapping = json?.useWrapping ?? false
    const curves = json?.curves ?? [{points: [{location: [0, 0], handleType: 'AUTO'}, {location: [1, 1], handleType: 'AUTO'}]}]
    return {
        doClip, extrapolate, clipMinY, clipMaxY,
        curves: curves.map(c => curvemapMakeTable(
            c.points.map(p => ({x: f32(p.location[0]), y: f32(p.location[1]), handle: p.handleType ?? 'AUTO'})),
            clipMinX, clipMaxX, extrapolate, useWrapping)),
    }
}

/** `BKE_curvemap_evaluateF` (`colortools.cc:1153`). */
export function curvemapEvaluateF(cumap: CurveMappingEval, cuma: CurveMapTable, value: number): number {
    const fi0 = f32(f32(value - cuma.mintable) * cuma.range)
    const i = Math.trunc(fi0)
    const t = cuma.table
    if (fi0 < 0 || fi0 > CM_TABLE) {
        return calcExtend(cumap.extrapolate, cuma.extIn, cuma.extOut, value, t.subarray(0, 2), t.subarray(CM_TABLE * 2, CM_TABLE * 2 + 2))
    }
    if (i < 0) return t[1]
    if (i >= CM_TABLE) return t[CM_TABLE * 2 + 1]
    const fi = f32(fi0 - i)
    return f32(f32(f32(1 - fi) * t[i * 2 + 1]) + f32(fi * t[(i + 1) * 2 + 1]))
}

/** `BKE_curvemapping_evaluateF` (`colortools.cc:1177`): the curve, then the clip rectangle's Y range. */
export function curvemappingEvaluateF(cumap: CurveMappingEval, cur: number, value: number): number {
    let val = curvemapEvaluateF(cumap, cumap.curves[cur], value)
    if (cumap.doClip) {
        if (val < cumap.clipMinY) val = cumap.clipMinY
        else if (val > cumap.clipMaxY) val = cumap.clipMaxY
    }
    return val
}
