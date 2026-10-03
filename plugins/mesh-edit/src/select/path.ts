/**
 * Shortest path select: Ctrl+click an element to select the path from the active element to it.
 *
 * Two layers, both ported:
 * - the graph search, `BM_mesh_calc_path_vert` / `_edge` / `_face` (`bmesh/tools/bmesh_path.cc`):
 *   Dijkstra over vertices, edges or faces, with a cost that is the edge length biased against
 *   sharp turns (`step_cost_3_v3_ex`), or 1 per step with "topology distance";
 * - the operator, `mouse_mesh_shortest_path_vert` / `_edge` / `_face` and
 *   `edbm_shortest_path_pick_ex` (`editors/mesh/editmesh_path.cc`): toggle the path's flag - all
 *   set means clear it - then flush, and make the far end active.
 *
 * Edge paths can tag seams or sharp edges instead of selecting, as Blender's "Edge Tag" option
 * does; crease and bevel weights need attribute layers this plugin does not expose yet. Fill region
 * (`BM_mesh_calc_path_region_*`, Shift+Ctrl+click) is not ported.
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMLoop,
    BMVert,
    diskEdges,
    edgeSelectSet,
    ElemFlag,
    faceSelectSet,
    radialLoops,
    selectHistoryRemove,
    selectHistoryStore,
    selectModeFlush,
    vertSelectSet,
} from '@threepipe/mesh-kernel'

// region heap - `BLI_heap_simple`

/** A binary min-heap of (cost, value): `BLI_heapsimple_*`. */
class SimpleHeap<T> {
    private readonly cost: number[] = []
    private readonly value: T[] = []

    get isEmpty(): boolean {
        return this.cost.length === 0
    }

    insert(cost: number, value: T): void {
        const c = this.cost
        const v = this.value
        c.push(cost)
        v.push(value)
        let i = c.length - 1
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (c[parent] <= c[i]) break
            ;[c[parent], c[i]] = [c[i], c[parent]]
            ;[v[parent], v[i]] = [v[i], v[parent]]
            i = parent
        }
    }

    popMin(): T {
        const c = this.cost
        const v = this.value
        const top = v[0]
        const lastC = c.pop()!
        const lastV = v.pop()!
        if (c.length) {
            c[0] = lastC
            v[0] = lastV
            let i = 0
            for (;;) {
                const l = 2 * i + 1
                const r = l + 1
                let m = i
                if (l < c.length && c[l] < c[m]) m = l
                if (r < c.length && c[r] < c[m]) m = r
                if (m === i) break
                ;[c[m], c[i]] = [c[i], c[m]]
                ;[v[m], v[i]] = [v[i], v[m]]
                i = m
            }
        }
        return top
    }
}

// endregion

// region costs - `bmesh_path.cc:36`

export interface CalcPathParams {
    /** Find the minimum number of steps, ignoring spatial distance. */
    useTopologyDistance?: boolean
    /** Traverse connected faces too (includes diagonals and edge rings). */
    useStepFace?: boolean
}

type Vec = {x: number, y: number, z: number}

/**
 * `step_cost_3_v3_ex`: the sum of the two edge lengths, biased to give higher values to sharp
 * turns, so paths with fewer turns win between equal-length candidates.
 */
function stepCost3(v1: Vec, v2: Vec, v3: Vec, skip12: boolean, skip23: boolean): number {
    let d1x = v2.x - v1.x, d1y = v2.y - v1.y, d1z = v2.z - v1.z
    let d2x = v3.x - v2.x, d2y = v3.y - v2.y, d2z = v3.z - v2.z
    const cost12 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z)
    const cost23 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z)
    if (cost12 > 0) {
        d1x /= cost12
        d1y /= cost12
        d1z /= cost12
    }
    if (cost23 > 0) {
        d2x /= cost23
        d2y /= cost23
        d2z /= cost23
    }
    const cost = (skip12 ? 0 : cost12) + (skip23 ? 0 : cost23)
    const dot = d1x * d2x + d1y * d2y + d1z * d2z
    return cost * (1 + 0.5 * (2 - Math.sqrt(Math.abs(dot))))
}

function len3(a: Vec, b: Vec): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

/** `BM_edge_calc_length`. */
function edgeLength(e: BMEdge): number {
    return len3(e.v1, e.v2)
}

/**
 * `BM_face_calc_center_median_weighted` (`bmesh_polygon.cc:667`): corners weighted by the lengths of
 * their two edges.
 */
export function faceCenterMedianWeighted(f: BMFace): Vec {
    const c = {x: 0, y: 0, z: 0}
    let totw = 0
    let wPrev = edgeLength(f.lFirst.prev.e!)
    for (const l of f.eachLoop()) {
        const wCurr = edgeLength(l.e!)
        const w = wCurr + wPrev
        c.x += l.v.x * w
        c.y += l.v.y * w
        c.z += l.v.z * w
        totw += w
        wPrev = wCurr
    }
    if (totw !== 0) {
        c.x /= totw
        c.y /= totw
        c.z /= totw
    }
    return c
}

/**
 * `isect_line_line_epsilon_v3` (`math_geom.cc:2993`): the nearest points of two lines. Returns 0 for
 * a zero-length line, 1 when they intersect (one point), 2 for the two nearest points.
 */
function isectLineLineV3(v1: Vec, v2: Vec, v3: Vec, v4: Vec, r1: Vec, r2: Vec, epsilon = 0.000001): number {
    let c = sub(v3, v1)
    let a = sub(v2, v1)
    let b = sub(v4, v3)
    let ab = cross(a, b)
    const d = dot(c, ab)
    const div = dot(ab, ab)
    if (div === 0) return 0
    if (Math.abs(d) <= epsilon) {
        const cb = cross(c, b)
        const s = dot(cb, ab) / div
        r1.x = v1.x + a.x * s
        r1.y = v1.y + a.y * s
        r1.z = v1.z + a.z * s
        r2.x = r1.x
        r2.y = r1.y
        r2.z = r1.z
        return 1
    }
    // Offset between both planes where the lines lie.
    const t0 = sub(v1, v3)
    const n = cross(a, b)
    const t = project(t0, n)
    // For the first line, offset the second line until it is coplanar.
    const v3t = add(v3, t)
    const v4t = add(v4, t)
    c = sub(v3t, v1)
    a = sub(v2, v1)
    b = sub(v4t, v3t)
    ab = cross(a, b)
    const cb = cross(c, b)
    const s = dot(cb, ab) / dot(ab, ab)
    r1.x = v1.x + a.x * s
    r1.y = v1.y + a.y * s
    r1.z = v1.z + a.z * s
    // For the second line, just subtract the offset from the first intersection point.
    r2.x = r1.x - t.x
    r2.y = r1.y - t.y
    r2.z = r1.z - t.z
    return 2
}

function sub(a: Vec, b: Vec): Vec {
    return {x: a.x - b.x, y: a.y - b.y, z: a.z - b.z}
}
function add(a: Vec, b: Vec): Vec {
    return {x: a.x + b.x, y: a.y + b.y, z: a.z + b.z}
}
function dot(a: Vec, b: Vec): number {
    return a.x * b.x + a.y * b.y + a.z * b.z
}
function cross(a: Vec, b: Vec): Vec {
    return {x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x}
}
/** `project_v3_v3v3`: the projection of `p` onto `n`. */
function project(p: Vec, n: Vec): Vec {
    const mul = dot(p, n) / dot(n, n)
    return {x: n.x * mul, y: n.y * mul, z: n.z * mul}
}

/** `line_point_factor_v3`. */
function linePointFactorV3(p: Vec, l1: Vec, l2: Vec): number {
    const u = sub(l2, l1)
    const h = sub(p, l1)
    const d = dot(u, u)
    return d !== 0 ? dot(u, h) / d : 0
}

// endregion

// region vertex path - `BM_mesh_calc_path_vert` (`bmesh_path.cc:63`)

/**
 * The shortest path of vertices from `vSrc` to `vDst`, inclusive, or null if none. `filter` says
 * which vertices may be walked (Blender's `filter_fn`; the selection operator passes "not hidden").
 */
export function calcPathVert(
    bm: BMesh, vSrc: BMVert, vDst: BMVert, params: CalcPathParams, filter: (v: BMVert) => boolean,
): BMVert[] | null {
    // `BM_ELEM_TAG` is used to store visited vertices; a set here, so no flags are disturbed.
    const visited = new Set<BMVert>()
    for (const v of bm.verts) if (!filter(v)) visited.add(v)

    const cost = new Map<BMVert, number>()
    const prev = new Map<BMVert, BMVert>()
    const costOf = (v: BMVert) => cost.get(v) ?? Infinity

    const addAdjacent = (vA: BMVert) => {
        const costA = costOf(vA)
        for (const e of diskEdges(vA)) {
            const vB = e.otherVert(vA)
            if (visited.has(vB)) continue
            const costCut = params.useTopologyDistance ? 1 : len3(vA, vB)
            const costNew = costA + costCut
            if (costOf(vB) > costNew) {
                cost.set(vB, costNew)
                prev.set(vB, vA)
                heap.insert(costNew, vB)
            }
        }
        if (params.useStepFace) {
            // Loop over the faces of the vertex, through its loops.
            for (const e of diskEdges(vA)) {
                for (const l of radialLoops(e)) {
                    if (l.v !== vA) continue
                    if (l.f.len > 3) {
                        // Skip loops on adjacent edges.
                        let lIter = l.next.next
                        do {
                            const vB = lIter.v
                            if (!visited.has(vB)) {
                                const costCut = params.useTopologyDistance ? 1 : len3(vA, vB)
                                const costNew = costA + costCut
                                if (costOf(vB) > costNew) {
                                    cost.set(vB, costNew)
                                    prev.set(vB, vA)
                                    heap.insert(costNew, vB)
                                }
                            }
                        } while ((lIter = lIter.next) !== l.prev)
                    }
                }
            }
        }
    }

    // Regular Dijkstra shortest path.
    const heap = new SimpleHeap<BMVert>()
    heap.insert(0, vSrc)
    cost.set(vSrc, 0)

    let v: BMVert | null = null
    while (!heap.isEmpty) {
        v = heap.popMin()
        if (v === vDst) break
        if (!visited.has(v)) {
            visited.add(v)
            addAdjacent(v)
        }
    }

    if (v !== vDst) return null
    const path: BMVert[] = []
    let cur: BMVert | undefined = v
    do {
        path.unshift(cur)
    } while ((cur = prev.get(cur)))
    return path
}

// endregion

// region edge path - `BM_mesh_calc_path_edge` (`bmesh_path.cc:200`)

/** `edgetag_cut_cost_vert`. */
function edgetagCutCostVert(eA: BMEdge, eB: BMEdge, v: BMVert): number {
    const v1 = eA.otherVert(v)
    const v2 = eB.otherVert(v)
    return stepCost3(v1, v, v2, false, false)
}

/**
 * `edgetag_cut_cost_face`. Blender's code takes the mid-point of `v1` with itself for both edges -
 * that is, the edges' first vertices - which is kept as is.
 */
function edgetagCutCostFace(eA: BMEdge, eB: BMEdge, f: BMFace): number {
    const eACent = {x: eA.v1.x, y: eA.v1.y, z: eA.v1.z}
    const eBCent = {x: eB.v1.x, y: eB.v1.y, z: eB.v1.z}
    const fCent = faceCenterMedianWeighted(f)
    return stepCost3(eACent, eBCent, fCent, false, false)
}

/** `BM_vert_in_edge`. */
function vertInEdge(e: BMEdge, v: BMVert): boolean {
    return e.v1 === v || e.v2 === v
}

export function calcPathEdge(
    bm: BMesh, eSrc: BMEdge, eDst: BMEdge, params: CalcPathParams, filter: (e: BMEdge) => boolean,
): BMEdge[] | null {
    const visitedV = new Set<BMVert>()
    const visited = new Set<BMEdge>()
    for (const e of bm.edges) if (!filter(e)) visited.add(e)

    const cost = new Map<BMEdge, number>()
    const prev = new Map<BMEdge, BMEdge>()
    const costOf = (e: BMEdge) => cost.get(e) ?? Infinity

    const addAdjacent = (eA: BMEdge) => {
        const costA = costOf(eA)
        // Unlike vert/face, stepping faces disables scanning connected edges and only steps over
        // faces (selecting a ring of edges instead of a loop).
        if (!params.useStepFace || eA.l === null) {
            const ePrev = prev.get(eA)
            for (const v of [eA.v1, eA.v2]) {
                // Don't walk over the previous vertex.
                if (ePrev && vertInEdge(ePrev, v)) continue
                for (const eB of diskEdges(v)) {
                    // Prevent the path overlapping itself in rare cases, see Blender #137456.
                    if (visited.has(eB) || visitedV.has(eB.otherVert(v))) continue
                    const costCut = params.useTopologyDistance ? 1 : edgetagCutCostVert(eA, eB, v)
                    const costNew = costA + costCut
                    if (costOf(eB) > costNew) {
                        cost.set(eB, costNew)
                        prev.set(eB, eA)
                        heap.insert(costNew, eB)
                    }
                }
            }
        } else {
            for (const lIter of radialLoops(eA)) {
                let lCycleIter = lIter.next
                const lCycleEnd = lIter
                do {
                    const eB = lCycleIter.e!
                    if (!visited.has(eB)) {
                        const costCut = params.useTopologyDistance ? 1 : edgetagCutCostFace(eA, eB, lIter.f)
                        const costNew = costA + costCut
                        if (costOf(eB) > costNew) {
                            cost.set(eB, costNew)
                            prev.set(eB, eA)
                            heap.insert(costNew, eB)
                        }
                    }
                } while ((lCycleIter = lCycleIter.next) !== lCycleEnd)
            }
        }
    }

    const heap = new SimpleHeap<BMEdge>()
    heap.insert(0, eSrc)
    cost.set(eSrc, 0)

    let e: BMEdge | null = null
    while (!heap.isEmpty) {
        e = heap.popMin()
        if (e === eDst) break
        if (!visited.has(e)) {
            visited.add(e)
            // Prevent the path overlapping itself in rare cases.
            visitedV.add(e.v1)
            visitedV.add(e.v2)
            addAdjacent(e)
        }
    }

    if (e !== eDst) return null
    const path: BMEdge[] = []
    let cur: BMEdge | undefined = e
    do {
        path.unshift(cur)
    } while ((cur = prev.get(cur)))
    return path
}

// endregion

// region face path - `BM_mesh_calc_path_face` (`bmesh_path.cc:378`)

/** `facetag_cut_cost_edge`: measured through a point on the shared edge, which suits triangle fans. */
function facetagCutCostEdge(fA: BMFace, fB: BMFace, e: BMEdge, endpoints: readonly [BMFace, BMFace]): number {
    const fACent = faceCenterMedianWeighted(fA)
    const fBCent = faceCenterMedianWeighted(fB)
    const ixE = {x: 0, y: 0, z: 0}
    const ixF = {x: 0, y: 0, z: 0}
    isectLineLineV3(e.v1, e.v2, fACent, fBCent, ixE, ixF)
    const factor = linePointFactorV3(ixE, e.v1, e.v2)
    const eCent = factor < 0 ? e.v1 : factor > 1 ? e.v2 : ixE
    return stepCost3(fACent, eCent, fBCent, fA === endpoints[0], fB === endpoints[1])
}

/** `facetag_cut_cost_vert`. */
function facetagCutCostVert(fA: BMFace, fB: BMFace, v: BMVert, endpoints: readonly [BMFace, BMFace]): number {
    return stepCost3(faceCenterMedianWeighted(fA), v, faceCenterMedianWeighted(fB), fA === endpoints[0], fB === endpoints[1])
}

/** `BM_loop_share_edge_check` (`bmesh_query.cc:1044`): two loops at one vertex sharing an edge. */
function loopShareEdgeCheck(lA: BMLoop, lB: BMLoop): boolean {
    return lA.e === lB.e || lA.e === lB.prev.e || lB.e === lA.e || lB.e === lA.prev.e
}

export function calcPathFace(
    bm: BMesh, fSrc: BMFace, fDst: BMFace, params: CalcPathParams, filter: (f: BMFace) => boolean,
): BMFace[] | null {
    const visited = new Set<BMFace>()
    for (const f of bm.faces) if (!filter(f)) visited.add(f)

    const cost = new Map<BMFace, number>()
    const prev = new Map<BMFace, BMFace>()
    const costOf = (f: BMFace) => cost.get(f) ?? Infinity
    // Start measuring the face path at the face edges, ignoring their centres.
    const endpoints: [BMFace, BMFace] = [fSrc, fDst]

    const addAdjacent = (fA: BMFace) => {
        const costA = costOf(fA)
        for (const lA of fA.eachLoop()) {
            if (!lA.e) continue
            for (const lIter of radialLoops(lA.e)) {
                const fB = lIter.f
                if (visited.has(fB)) continue
                const costCut = params.useTopologyDistance ? 1 : facetagCutCostEdge(fA, fB, lIter.e!, endpoints)
                const costNew = costA + costCut
                if (costOf(fB) > costNew) {
                    cost.set(fB, costNew)
                    prev.set(fB, fA)
                    heap.insert(costNew, fB)
                }
            }
        }
        if (params.useStepFace) {
            for (const lA of fA.eachLoop()) {
                for (const e of diskEdges(lA.v)) {
                    for (const lB of radialLoops(e)) {
                        if (lB.v !== lA.v) continue
                        if (lA !== lB && !loopShareEdgeCheck(lA, lB)) {
                            const fB = lB.f
                            if (visited.has(fB)) continue
                            const costCut = params.useTopologyDistance ? 1 : facetagCutCostVert(fA, fB, lA.v, endpoints)
                            const costNew = costA + costCut
                            if (costOf(fB) > costNew) {
                                cost.set(fB, costNew)
                                prev.set(fB, fA)
                                heap.insert(costNew, fB)
                            }
                        }
                    }
                }
            }
        }
    }

    const heap = new SimpleHeap<BMFace>()
    heap.insert(0, fSrc)
    cost.set(fSrc, 0)

    let f: BMFace | null = null
    while (!heap.isEmpty) {
        f = heap.popMin()
        if (f === fDst) break
        if (!visited.has(f)) {
            visited.add(f)
            addAdjacent(f)
        }
    }

    if (f !== fDst) return null
    const path: BMFace[] = []
    let cur: BMFace | undefined = f
    do {
        path.unshift(cur)
    } while ((cur = prev.get(cur)))
    return path
}

// endregion

// region the operator - `editmesh_path.cc`

/** Blender's `edge_mode`: what an edge path sets. Crease, bevel and freestyle need layers not exposed. */
export type PathEdgeMode = 'select' | 'seam' | 'sharp'

/** `CheckerIntervalParams`: select every `nth` elements of the path, skipping `skip`, from `offset`. */
export interface CheckerInterval {
    nth: number
    skip: number
    offset: number
}

export interface PathSelectParams extends CalcPathParams {
    /** Make the far end of the path the active element. True when picking with the mouse. */
    trackActive?: boolean
    edgeMode?: PathEdgeMode
    interval?: CheckerInterval
}

/** `WM_operator_properties_checker_interval_test` (`wm_operator_props.cc:698`). */
export function checkerIntervalTest(p: CheckerInterval | undefined, depth: number): boolean {
    if (!p || p.skip === 0) return true
    const m = (p.offset + depth) % (p.skip + p.nth)
    // C's remainder keeps the sign of the dividend.
    return m >= p.skip
}

function edgetagTest(e: BMEdge, mode: PathEdgeMode): boolean {
    switch (mode) {
    case 'select': return (e.hflag & ElemFlag.Select) !== 0
    case 'seam': return (e.hflag & ElemFlag.Seam) !== 0
    case 'sharp': return (e.hflag & ElemFlag.Smooth) === 0
    }
}

function edgetagSet(bm: BMesh, e: BMEdge, val: boolean, mode: PathEdgeMode): void {
    switch (mode) {
    case 'select':
        edgeSelectSet(bm, e, val)
        break
    case 'seam':
        e.setFlag(ElemFlag.Seam, val)
        break
    case 'sharp':
        e.setFlag(ElemFlag.Smooth, !val)
        break
    }
}

const notHidden = (ele: {hflag: number}) => !(ele.hflag & ElemFlag.Hidden)

/** `mouse_mesh_shortest_path_vert` (`editmesh_path.cc:176`). */
export function shortestPathVert(bm: BMesh, vAct: BMVert | null, vDst: BMVert, params: PathSelectParams): void {
    let path: BMVert[] | null = null
    if (vAct && vAct !== vDst) {
        path = calcPathVert(bm, vAct, vDst, params, notHidden)
        if (path && params.trackActive) selectHistoryRemove(bm, vAct)
    }

    let vDstLast = vDst
    if (path) {
        // Toggle the flag: when every element of the path is set, clear them all.
        const allSet = path.every(v => (v.hflag & ElemFlag.Select) !== 0)
        let depth = -1
        for (const v of path) {
            if (checkerIntervalTest(params.interval, depth)) {
                vertSelectSet(bm, v, !allSet)
                vDstLast = v
            }
            depth++
        }
    } else {
        // Switch the vertex.
        vertSelectSet(bm, vDst, !(vDst.hflag & ElemFlag.Select))
    }

    selectModeFlush(bm)

    if (params.trackActive) {
        // Even if this is selected it may not be in the selection list.
        if (!(vDstLast.hflag & ElemFlag.Select)) selectHistoryRemove(bm, vDstLast)
        else selectHistoryStore(bm, vDstLast)
    }
}

/** `mouse_mesh_shortest_path_edge` (`editmesh_path.cc:354`). */
export function shortestPathEdge(bm: BMesh, eAct: BMEdge | null, eDst: BMEdge, params: PathSelectParams): void {
    const mode = params.edgeMode ?? 'select'
    let path: BMEdge[] | null = null
    if (eAct && eAct !== eDst) {
        path = calcPathEdge(bm, eAct, eDst, params, notHidden)
        if (path && params.trackActive) selectHistoryRemove(bm, eAct)
    }

    let eDstLast = eDst
    if (path) {
        const allSet = path.every(e => edgetagTest(e, mode))
        let depth = -1
        for (const e of path) {
            if (checkerIntervalTest(params.interval, depth)) {
                edgetagSet(bm, e, !allSet, mode)
                eDstLast = e
            }
            depth++
        }
    } else {
        edgetagSet(bm, eDst, !edgetagTest(eDst, mode), mode)
    }

    if (mode !== 'select' && params.trackActive) {
        // Simple rule: the last edge is always active and selected.
        if (eAct) edgeSelectSet(bm, eAct, false)
        edgeSelectSet(bm, eDstLast, true)
        selectHistoryStore(bm, eDstLast)
    }

    selectModeFlush(bm)

    if (params.trackActive && mode === 'select') {
        if (!edgetagTest(eDstLast, mode)) selectHistoryRemove(bm, eDstLast)
        else selectHistoryStore(bm, eDstLast)
    }
}

/** `mouse_mesh_shortest_path_face` (`editmesh_path.cc:535`). */
export function shortestPathFace(bm: BMesh, fAct: BMFace | null, fDst: BMFace, params: PathSelectParams): void {
    let path: BMFace[] | null = null
    if (fAct) {
        path = calcPathFace(bm, fAct, fDst, params, notHidden)
        if (fAct !== fDst && path && params.trackActive) selectHistoryRemove(bm, fAct)
    }

    let fDstLast = fDst
    if (path) {
        const allSet = path.every(f => (f.hflag & ElemFlag.Select) !== 0)
        let depth = -1
        for (const f of path) {
            if (checkerIntervalTest(params.interval, depth)) {
                faceSelectSet(bm, f, !allSet)
                fDstLast = f
            }
            depth++
        }
    } else {
        faceSelectSet(bm, fDst, !(fDst.hflag & ElemFlag.Select))
    }

    selectModeFlush(bm)

    if (params.trackActive) {
        if (!(fDstLast.hflag & ElemFlag.Select)) selectHistoryRemove(bm, fDstLast)
        else selectHistoryStore(bm, fDstLast)
        bm.actFace = fDstLast
    }
}

/**
 * `edbm_shortest_path_pick_ex` (`editmesh_path.cc:655`): dispatch on the element type. Both must
 * be of the same type. Returns whether a path operation ran.
 */
export function shortestPathPick(
    bm: BMesh,
    src: BMVert | BMEdge | BMFace | null,
    dst: BMVert | BMEdge | BMFace | null,
    params: PathSelectParams,
): boolean {
    if (!src || !dst || src.htype !== dst.htype) return false
    if (src instanceof BMVert) shortestPathVert(bm, src, dst as BMVert, params)
    else if (src instanceof BMEdge) shortestPathEdge(bm, src, dst as BMEdge, params)
    else shortestPathFace(bm, src, dst as BMFace, params)
    return true
}

/**
 * `edbm_elem_active_elem_or_face_get` (`editmesh_path.cc:723`): the active element, or the active
 * face if it is selected.
 */
export function activeElemOrFace(bm: BMesh): BMVert | BMEdge | BMFace | null {
    const ele = bm.selectHistory.length ? bm.selectHistory[bm.selectHistory.length - 1].elem : null
    if (ele) return ele
    if (bm.actFace && bm.actFace.hflag & ElemFlag.Select) return bm.actFace
    return null
}

// endregion
