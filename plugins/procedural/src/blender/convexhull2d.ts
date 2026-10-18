/**
 * `BLI_convexhull_2d` and `BLI_convexhull_aabb_fit_points_2d` (`blenlib/intern/convexhull_2d.cc`, Blender 5.2.2), with
 * `USE_CONVEX_CROSS_PRODUCT_ENSURE`, in float32. Points are `[x, y]` pairs.
 */

import {f32} from './f32'
import {atan2f} from './libm'

type P = ArrayLike<number>

/** `is_left` (:108). */
const isLeft = (p0: P, p1: P, p2: P) => f32(f32(f32(p1[0] - p0[0]) * f32(p2[1] - p0[1])) - f32(f32(p2[0] - p0[0]) * f32(p1[1] - p0[1])))

/** `convexhull_2d_stack_push` (:167). */
function stackPush(points: P[], rPoints: number[], top: {v: number}, index: number): void {
    while (top.v > 0 && isLeft(points[rPoints[top.v - 1]], points[index], points[rPoints[top.v]]) >= 0) top.v--
    rPoints[++top.v] = index
}

/** `convexhull_2d_sorted_impl` (:191): returns `top`. */
function sortedImpl(points: P[], pointsNum: number, rPoints: number[]): number {
    const top = {v: -1}
    const minmin = 0, maxmax = pointsNum - 1
    let i: number
    const xmin = points[0][0]
    for (i = 1; i <= maxmax; i++) if (points[i][0] !== xmin) break
    const minmax = i - 1
    if (minmax === maxmax) {
        stackPush(points, rPoints, top, minmin)
        if (points[minmax][1] !== points[minmin][1]) stackPush(points, rPoints, top, minmax)
        return top.v
    }
    const xmax = points[maxmax][0]
    for (i = maxmax - 1; i >= 0; i--) if (points[i][0] !== xmax) break
    const maxmin = i + 1
    stackPush(points, rPoints, top, minmin)
    i = minmax
    while (++i <= maxmin) {
        if (i < maxmin && isLeft(points[minmin], points[maxmin], points[i]) >= 0) continue
        while (top.v > 0) {
            if (isLeft(points[rPoints[top.v - 1]], points[rPoints[top.v]], points[i]) > 0) break
            top.v--
        }
        stackPush(points, rPoints, top, i)
    }
    if (maxmax !== maxmin) stackPush(points, rPoints, top, maxmax)
    const bot = top.v
    i = maxmin
    while (--i >= minmax) {
        if (i > minmax && isLeft(points[maxmax], points[minmax], points[i]) >= 0) continue
        while (top.v > bot) {
            if (isLeft(points[rPoints[top.v - 1]], points[rPoints[top.v]], points[i]) > 0) break
            top.v--
        }
        if (points[i][0] === points[rPoints[0]][0] && points[i][1] === points[rPoints[0]][1]) return top.v
        stackPush(points, rPoints, top, i)
    }
    if (minmax !== minmin && rPoints[0] !== minmin) stackPush(points, rPoints, top, minmin)
    return top.v
}

/** `convexhull_2d_sorted` (:302) with `convexhull_2d_stack_finalize` (:116): the inclusive range of `rPoints`. */
function sorted(points: P[], pointsNum: number, rPoints: number[]): [number, number] {
    let top = sortedImpl(points, pointsNum, rPoints)
    let bot = 0
    while (top - bot >= 2) {
        if (isLeft(points[rPoints[top - 1]], points[rPoints[bot]], points[rPoints[top]]) >= 0) {
            top--
            continue
        }
        if (isLeft(points[rPoints[top]], points[rPoints[bot + 1]], points[rPoints[bot]]) >= 0) {
            bot++
            continue
        }
        break
    }
    return [bot, top]
}

/**
 * `BLI_convexhull_2d` (:310): writes hull indices into `rPoints` and returns their count. Like Blender, the caller reads
 * `rPoints[0 .. count)` although the finalized range may start later (only `range[0] .. range[1]` is mapped back).
 * Blender's `std::sort` order of exactly equal points is unspecified; equal points have equal coordinates, so the
 * index tie-break used here yields the same coordinates.
 */
export function convexhull2d(points: P[], rPoints: number[]): number {
    const n = points.length
    if (n < 2) {
        if (n === 1) rPoints[0] = 0
        return n
    }
    const map = Array.from({length: n}, (_, i) => i)
    map.sort((a, b) => {
        const pa = points[a], pb = points[b]
        if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1
        if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1
        return a - b
    })
    const sortedPoints = map.map(i => points[i])
    const [lo, hi] = sorted(sortedPoints, n, rPoints)
    for (let i = lo; i <= hi; i++) rPoints[i] = map[rPoints[i]]
    return hi - lo + 1
}

/** `math::normalize_and_get_length` for float2: `[x, y, length]`. */
function normalizeAndGetLength(x: number, y: number): [number, number, number] {
    let len = f32(f32(x * x) + f32(y * y))
    if (len > f32(1.0e-35)) {
        len = f32(Math.sqrt(len))
        return [f32(x / len), f32(y / len), len]
    }
    return [0, 0, 0]
}

/** `sincos_canonical` (:434). */
function sincosCanonical(s: number, c: number): [number, number] {
    if (s < 0) {
        if (c < 0) return [-s, -c]
        if (s === -1 && c === 0) return [-s, c]
        return [c, -s]
    }
    if (c < 0) return [-c, s]
    if (s === 0 && c === 1) return [c, s]
    return [s, c]
}

interface AngleCanonical {
    sincos: [number, number]
    canonical: [number, number]
    index: number
}

/** `hull_angle_canonical_cmp` (:487). */
function angleCmp(a: AngleCanonical, b: AngleCanonical): number {
    if (a.canonical[0] < b.canonical[0]) return -1
    if (a.canonical[0] > b.canonical[0]) return 1
    if (a.canonical[1] > b.canonical[1]) return -1
    if (a.canonical[1] < b.canonical[1]) return 1
    if (a.index > b.index) return -1
    if (a.index < b.index) return 1
    return 0
}

interface HullAngleStep {
    next: HullAngleStep | null
    angle: AngleCanonical
    index: number
    indexMax: number
}

interface HullAngleIter {
    axisOrdered: HullAngleStep | null
    axis: HullAngleStep[][]
    hull: P[]
    num: number
}

/** `hull_angle_insert_ordered` (:542). */
function insertOrdered(it: HullAngleIter, insert: HullAngleStep): void {
    let prev: HullAngleStep | null = null
    let iter = it.axisOrdered
    while (iter && angleCmp(iter.angle, insert.angle) > 0) {
        prev = iter
        iter = iter.next
    }
    if (prev) prev.next = insert
    else it.axisOrdered = insert
    insert.next = iter
}

/** `convexhull_2d_angle_iter_step_on_axis` (:554). */
function stepOnAxis(it: HullAngleIter, h: HullAngleStep): boolean {
    while (h.index !== h.indexMax) {
        const iCurr = h.index
        const iNext = (h.index + 1) % it.num
        const [s, c, len] = normalizeAndGetLength(f32(it.hull[iNext][0] - it.hull[iCurr][0]), f32(it.hull[iNext][1] - it.hull[iCurr][1]))
        h.index = iNext
        if (len !== 0) {
            h.angle = {sincos: [s, c], canonical: sincosCanonical(s, c), index: iCurr}
            return true
        }
    }
    h.index = -1
    return false
}

/** `convexhull_2d_angle_iter_init` (:577). */
function iterInit(hull: P[], num: number): HullAngleIter {
    const numMinus1 = num - 1
    const mk = (): HullAngleStep => ({next: null, angle: {sincos: [0, 0], canonical: [0, 0], index: 0}, index: 0, indexMax: 0})
    const it: HullAngleIter = {axisOrdered: null, axis: [[mk(), mk()], [mk(), mk()]], hull, num}
    const range = [[hull[0][0], hull[0][0]], [hull[0][1], hull[0][1]]]
    for (let i = 1; i < num; i++) {
        const p = hull[i]
        for (let axis = 0; axis < 2; axis++) {
            if (range[axis][0] < p[axis]) {
                range[axis][0] = p[axis]
                it.axis[axis][0].index = i
            }
            if (range[axis][1] > p[axis]) {
                range[axis][1] = p[axis]
                it.axis[axis][1].index = i
            }
        }
    }
    for (let axis = 0; axis < 2; axis++) {
        for (let i = 0; i < 2; i++) {
            const iOrig = it.axis[axis][i].index
            let iCurr = iOrig, iPrev: number
            while ((iPrev = (iCurr + numMinus1) % num) !== iOrig) {
                const [s, c, len] = normalizeAndGetLength(f32(hull[iCurr][0] - hull[iPrev][0]), f32(hull[iCurr][1] - hull[iPrev][1]))
                if (len !== 0) {
                    if (Math.abs(axis === 0 ? s : c) > 0.5) break
                    if (sincosCanonical(s, c)[0] !== 1) break
                }
                iCurr = iPrev
                it.axis[axis][i].index = iCurr
            }
        }
    }
    it.axis[0][0].indexMax = it.axis[1][0].index
    it.axis[1][0].indexMax = it.axis[0][1].index
    it.axis[0][1].indexMax = it.axis[1][1].index
    it.axis[1][1].indexMax = it.axis[0][0].index
    for (let axis = 0; axis < 2; axis++) {
        for (let i = 0; i < 2; i++) {
            it.axis[axis][i].angle.index = it.axis[axis][i].index
            if (stepOnAxis(it, it.axis[axis][i])) insertOrdered(it, it.axis[axis][i])
        }
    }
    return it
}

/** `convexhull_2d_angle_iter_step` (:674). */
function iterStep(it: HullAngleIter): void {
    const h = it.axisOrdered!
    it.axisOrdered = h.next
    if (stepOnAxis(it, h)) insertOrdered(it, h)
}

const rotX = (sc: [number, number], p: P) => f32(f32(sc[0] * p[0]) + f32(sc[1] * p[1]))
const rotY = (sc: [number, number], p: P) => f32(f32(sc[1] * p[0]) - f32(sc[0] * p[1]))

/** `convexhull_2d_compute_extent_on_axis<Axis, AxisSign>` (:716). */
function extentOnAxis(hull: P[], num: number, sc: [number, number], axis: 0 | 1, sign: -1 | 1, index: {v: number}): number {
    const init = index.v
    let best = init
    let valueBest = axis === 0 ? rotX(sc, hull[best]) : rotY(sc, hull[best])
    for (let count = 1; count < num; count++) {
        const test = (init + count) % num
        const value = axis === 0 ? rotX(sc, hull[test]) : rotY(sc, hull[test])
        if (sign === -1 ? value > valueBest : value < valueBest) break
        valueBest = value
        best = test
    }
    index.v = best
    return valueBest
}

/** `convexhull_aabb_fit_hull_2d` (:748): `atan2` of two floats is the C++ `float` overload, i.e. `atan2f`. */
function aabbFitHull(hull: P[], num: number): number {
    const FLT_MAX = f32(3.4028234663852886e38)
    let areaBest = FLT_MAX
    let sincosBest: [number, number] = [0, 1]
    let indexBest = 2147483647
    const it = iterInit(hull, num)
    const bx = {min: {v: it.axis[0][1].angle.index}, max: {v: it.axis[0][0].angle.index}}
    const by = {min: {v: it.axis[1][0].angle.index}, max: {v: it.axis[1][1].angle.index}}
    let h: HullAngleStep | null
    while ((h = it.axisOrdered)) {
        const sc = h.angle.canonical
        const x0 = extentOnAxis(hull, num, sc, 0, -1, bx.min)
        const x1 = extentOnAxis(hull, num, sc, 0, 1, bx.max)
        const y0 = extentOnAxis(hull, num, sc, 1, -1, by.min)
        const y1 = extentOnAxis(hull, num, sc, 1, 1, by.max)
        const area = f32(f32(x1 - x0) * f32(y1 - y0))
        if (area < areaBest || (area === areaBest && h.angle.index < indexBest)) {
            areaBest = area
            sincosBest = h.angle.sincos
            indexBest = h.angle.index
        }
        iterStep(it)
    }
    return areaBest !== FLT_MAX ? atan2f(sincosBest[0], sincosBest[1]) : 0
}

/** `BLI_convexhull_aabb_fit_points_2d` (:811). */
export function convexhullAabbFitPoints2d(points: P[]): number {
    const indexMap: number[] = new Array(points.length)
    const hullNum = convexhull2d(points, indexMap)
    if (hullNum > 1) return aabbFitHull(Array.from({length: hullNum}, (_, j) => points[indexMap[j]]), hullNum)
    return 0
}
