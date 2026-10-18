/**
 * Edge loops as ordered vertex chains: what bridge, grid fill and loop-based tools walk.
 *
 * Port of `source/blender/bmesh/intern/bmesh_edgeloop.cc`. Blender's `BMEdgeLoopStore` is a
 * `ListBase` of `LinkData` nodes pointing at vertices plus a closed flag, a centre and a normal;
 * {@link BMEdgeLoopStore} holds the same as an array. Where Blender scribbles `BM_ELEM_INTERNAL_TAG`
 * on elements and, in `BM_mesh_edgeloops_find_path`, repoints `v->e` and `head.index` to carry the
 * search state (`vs_add`, `:187`: "Setting the edge is not common practice but currently harmless"),
 * this port keeps that state in sets and maps beside the mesh. The walks are the same; nothing on
 * the elements is touched.
 */

import {BMEdge, BMVert} from './types'
import {BMesh} from './BMesh'
import {diskEdgeExists, diskEdges} from './structure'
import {Vec3, v3cross, v3dot, v3sub} from '../math'
import {addNewellCrossV3V3V3, foreachSparseRange, lenSquaredV3V3, lenV3V3, normalizeV3Len} from '../math/geom'
import {edgeSplit} from './mods'

/** Use a small value since we need normals even for very small loops. */
const EDGELOOP_EPS = 1e-10

export type EdgeTestFn = (e: BMEdge) => boolean

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/** Blender's `BMEdgeLoopStore`. */
export class BMEdgeLoopStore {
    /** The vertices in chain order. For a closed loop the last joins back to the first. */
    verts: BMVert[] = []
    /** `BM_EDGELOOP_IS_CLOSED`. */
    closed = false
    /** Optional values to calculate: centre and normal. */
    co: Vec3 = [0, 0, 0]
    no: Vec3 = [0, 0, 0]

    /** `BM_edgeloop_length_get`. */
    get len(): number {
        return this.verts.length
    }

    get first(): BMVert {
        return this.verts[0]
    }

    get last(): BMVert {
        return this.verts[this.verts.length - 1]
    }
}

/**
 * `BM_EDGELINK_NEXT(el_store, el)`: the index after `i`, wrapping for a closed loop, or -1 at the
 * open end.
 */
export function edgelinkNext(store: BMEdgeLoopStore, i: number): number {
    if (i + 1 < store.verts.length) return i + 1
    return store.closed ? 0 : -1
}

// region BM_mesh_edgeloops_find

/** `bm_vert_other_tag` (`bmesh_edgeloop.cc:43`): tagged edges at `v` not leading back to `vPrev`. */
function vertOtherTag(v: BMVert, vPrev: BMVert | null, tagged: Set<BMEdge>): {count: number, e: BMEdge | null} {
    let eNext: BMEdge | null = null
    let count = 0
    for (const e of diskEdges(v)) {
        if (tagged.has(e)) {
            const vOther = e.otherVert(v)
            if (vOther !== vPrev) {
                eNext = e
                count++
            }
        }
    }
    return {count, e: eNext}
}

/** `bm_loop_build` (`bmesh_edgeloop.cc:66`). `dir` 1 prepends, -1 appends. Returns success. */
function loopBuild(
    store: BMEdgeLoopStore, vPrev: BMVert | null, v: BMVert | null, dir: 1 | -1,
    taggedE: Set<BMEdge>, taggedV: Set<BMVert>,
): boolean {
    const vFirst = v
    if (!v || !taggedV.has(v)) return true

    while (v) {
        if (dir === 1) store.verts.unshift(v)
        else store.verts.push(v)
        taggedV.delete(v)

        const {count, e: eNext} = vertOtherTag(v, vPrev, taggedE)
        let vNext: BMVert | null
        if (count === 1) {
            vNext = eNext!.otherVert(v)
            taggedE.delete(eNext!)
            if (vNext === vFirst) {
                store.closed = true
                vNext = null
            }
        } else if (count === 0) {
            vNext = null
        } else {
            return false
        }

        vPrev = v
        v = vNext
    }
    return true
}

/**
 * `BM_mesh_edgeloops_find` (`bmesh_edgeloop.cc:112`): every chain of edges passing `testFn` whose
 * vertices use at most two of them. Edges that branch (three or more passing edges at a vertex)
 * produce no loop. Loops come back in the order of the first edge of each, as Blender's do.
 */
export function edgeloopsFind(bm: BMesh, testFn: EdgeTestFn): BMEdgeLoopStore[] {
    const taggedE = new Set<BMEdge>()
    const taggedV = new Set<BMVert>()
    const edges: BMEdge[] = []
    for (const e of bm.edges) {
        if (testFn(e)) {
            taggedE.add(e)
            taggedV.add(e.v1)
            taggedV.add(e.v2)
            edges.push(e)
        }
    }

    const out: BMEdgeLoopStore[] = []
    for (const e of edges) {
        if (!taggedE.has(e)) continue
        const store = new BMEdgeLoopStore()
        // add both directions
        if (loopBuild(store, e.v1, e.v2, 1, taggedE, taggedV)
            && loopBuild(store, e.v2, e.v1, -1, taggedE, taggedV)
            && store.len > 1) {
            out.push(store)
        }
    }
    return out
}

// endregion

// region BM_mesh_edgeloops_find_path

/**
 * `BM_mesh_edgeloops_find_path` (`bmesh_edgeloop.cc:264`): the shortest chain of edges passing
 * `testFn` (every edge when null) from `vSrc` to `vDst`, as one open loop, or null. A breadth-first
 * search grown from both ends until the fronts meet (`bm_loop_path_build_step`); the step count is
 * Blender's `head.index` and the back-pointer its `v->e`, kept in maps here.
 */
export function edgeloopsFindPath(bm: BMesh, testFn: EdgeTestFn | null, vSrc: BMVert, vDst: BMVert): BMEdgeLoopStore | null {
    if (vSrc === vDst) throw new Error('mesh-kernel: edgeloopsFindPath needs two different vertices')

    const taggedE = new Set<BMEdge>()
    for (const e of bm.edges) if (!testFn || testFn(e)) taggedE.add(e)

    /** `BM_elem_index_get(v)`: 0 untouched, +n steps from the source, -n steps from the target. */
    const iter = new Map<BMVert, number>()
    /** `v->e`: the edge back towards the end this vertex was reached from. */
    const back = new Map<BMVert, BMEdge>()

    const add = (lb: BMVert[], v: BMVert, ePrev: BMEdge | null, iterTot: number) => {
        iter.set(v, iterTot)
        if (ePrev) back.set(v, ePrev)
        lb.push(v)
    }

    let match: [BMVert, BMVert] | null = null

    /** `bm_loop_path_build_step` (`:205`): grow one front by one step. Returns whether it is still alive. */
    const step = (lb: BMVert[], dir: 1 | -1): BMVert[] | null => {
        const lbTmp: BMVert[] = []
        for (const vs of lb) {
            const vsIterTot = iter.get(vs) ?? 0
            const vsIterNext = vsIterTot + dir
            for (const e of diskEdges(vs)) {
                if (!taggedE.has(e)) continue
                const vNext = e.otherVert(vs)
                const vNextIndex = iter.get(vNext) ?? 0
                // not essential to clear but prevents more checking next time round
                taggedE.delete(e)
                if (vNextIndex === 0) {
                    add(lbTmp, vNext, e, vsIterNext)
                } else if ((dir < 0) === (vNextIndex < 0)) {
                    // on the same side - do nothing
                } else {
                    // the fronts from the two ends have met
                    match = dir === 1 ? [vs, vNext] : [vNext, vs]
                    return lbTmp
                }
            }
        }
        return lbTmp.length ? lbTmp : null
    }

    let lbSrc: BMVert[] | null = []
    let lbDst: BMVert[] | null = []
    add(lbSrc, vSrc, null, 1)
    add(lbDst, vDst, null, -1)

    while (true) {
        lbSrc = step(lbSrc!, 1)
        if (!lbSrc || match) break
        lbDst = step(lbDst!, -1)
        if (!lbDst || match) break
    }

    if (!match) return null
    const [mA, mB] = match as [BMVert, BMVert]
    const store = new BMEdgeLoopStore()

    // build loop from edge pointers
    let v: BMVert = mA
    while (true) {
        store.verts.unshift(v)
        if (v === vSrc) break
        v = back.get(v)!.otherVert(v)
    }
    v = mB
    while (true) {
        store.verts.push(v)
        if (v === vDst) break
        v = back.get(v)!.otherVert(v)
    }
    return store
}

// endregion

// region BM_mesh_edgeloops_* utilities

/** `BM_mesh_edgeloops_calc_center` (`:400`). */
export function edgeloopsCalcCenter(eloops: readonly BMEdgeLoopStore[]): void {
    for (const s of eloops) edgeloopCalcCenter(s)
}

/** `BM_mesh_edgeloops_calc_normal` (`:407`). */
export function edgeloopsCalcNormal(eloops: readonly BMEdgeLoopStore[]): void {
    for (const s of eloops) edgeloopCalcNormal(s)
}

/** `BM_mesh_edgeloops_calc_normal_aligned` (`:414`). */
export function edgeloopsCalcNormalAligned(eloops: readonly BMEdgeLoopStore[], noAlign: Vec3): void {
    for (const s of eloops) edgeloopCalcNormalAligned(s, noAlign)
}

/**
 * `BM_mesh_edgeloops_calc_order` (`:423`): chain the loops by proximity, starting from the one
 * furthest from the mean centre, each next loop being the nearest to the last (scaled, with
 * `useNormals`, by how well the two face each other). Centres must have been calculated. Returns
 * the reordered list.
 */
export function edgeloopsCalcOrder(eloops: readonly BMEdgeLoopStore[], useNormals: boolean): BMEdgeLoopStore[] {
    const remaining = [...eloops]
    const ordered: BMEdgeLoopStore[] = []
    const cent: Vec3 = [0, 0, 0]
    for (const s of remaining) {
        cent[0] += s.co[0]
        cent[1] += s.co[1]
        cent[2] += s.co[2]
    }
    const inv = 1 / remaining.length
    cent[0] *= inv
    cent[1] *= inv
    cent[2] *= inv

    // Find the furthest out loop.
    {
        let best: BMEdgeLoopStore | null = null
        let lenBestSq = -1
        for (const s of remaining) {
            const lenSq = lenSquaredV3V3(cent, s.co)
            if (lenSq > lenBestSq) {
                lenBestSq = lenSq
                best = s
            }
        }
        remaining.splice(remaining.indexOf(best!), 1)
        ordered.push(best!)
    }

    // not so efficient re-ordering
    while (remaining.length) {
        const last = ordered[ordered.length - 1]
        let best: BMEdgeLoopStore | null = null
        let lenBestSq = Infinity
        for (const s of remaining) {
            let lenSq: number
            if (useNormals) {
                // Scale the length by how close the loops are to pointing at each other.
                const dir = v3sub(last.co, s.co)
                lenSq = normalizeV3Len(dir)
                lenSq = lenSq * ((1 - Math.abs(v3dot(dir, last.no))) + (1 - Math.abs(v3dot(dir, s.no))))
            } else {
                lenSq = lenSquaredV3V3(last.co, s.co)
            }
            if (lenSq < lenBestSq) {
                lenBestSq = lenSq
                best = s
            }
        }
        remaining.splice(remaining.indexOf(best!), 1)
        ordered.push(best!)
    }
    return ordered
}

// endregion

// region BM_edgeloop_*

/** `BM_edgeloop_copy` (`:497`). */
export function edgeloopCopy(store: BMEdgeLoopStore): BMEdgeLoopStore {
    const c = new BMEdgeLoopStore()
    c.verts = [...store.verts]
    c.closed = store.closed
    c.co = [...store.co] as Vec3
    c.no = [...store.no] as Vec3
    return c
}

/** `BM_edgeloop_from_verts` (`:505`). */
export function edgeloopFromVerts(verts: readonly BMVert[], isClosed: boolean): BMEdgeLoopStore {
    const s = new BMEdgeLoopStore()
    s.verts = [...verts]
    s.closed = isClosed
    return s
}

/**
 * `BM_edgeloop_edges_get` (`:555`): the edge between each consecutive pair, plus the closing edge
 * of a closed loop. Every pair must be joined by an edge.
 */
export function edgeloopEdgesGet(store: BMEdgeLoopStore): BMEdge[] {
    const out: BMEdge[] = []
    const vs = store.verts
    for (let i = 0; i + 1 < vs.length; i++) {
        const e = diskEdgeExists(vs[i], vs[i + 1])
        if (!e) throw new Error(`mesh-kernel: edge loop vertices ${vs[i].id} and ${vs[i + 1].id} share no edge`)
        out.push(e)
    }
    if (store.closed) {
        const e = diskEdgeExists(vs[0], vs[vs.length - 1])
        if (!e) throw new Error(`mesh-kernel: closed edge loop does not close: ${vs[0].id} and ${vs[vs.length - 1].id} share no edge`)
        out.push(e)
    }
    return out
}

/**
 * `BM_edgeloop_calc_center` (`:573`): the centre weighted by the length of the two edges at each
 * vertex, so a loop with a dense stretch is not pulled towards it.
 */
export function edgeloopCalcCenter(store: BMEdgeLoopStore): void {
    const vs = store.verts
    const n = vs.length
    let iPrev = n - 2
    let iCurr = n - 1
    let iNext = 0
    let vPrev = co(vs[iPrev < 0 ? n - 1 : iPrev])
    let vCurr = co(vs[iCurr])
    let vNext = co(vs[iNext])
    let totw = 0
    let wPrev = lenV3V3(vPrev, vCurr)
    const out: Vec3 = [0, 0, 0]
    while (true) {
        const wCurr = lenV3V3(vCurr, vNext)
        const w = wCurr + wPrev
        out[0] += vCurr[0] * w
        out[1] += vCurr[1] * w
        out[2] += vCurr[2] * w
        totw += w
        wPrev = wCurr

        iCurr = iNext
        iNext = iNext + 1
        if (iNext >= n) break
        vPrev = vCurr
        vCurr = vNext
        vNext = co(vs[iNext])
    }
    if (totw !== 0) {
        out[0] /= totw
        out[1] /= totw
        out[2] /= totw
    }
    store.co = out
}

/** `BM_edgeloop_calc_normal` (`:614`): Newell's method over the chain. False for a degenerate loop. */
export function edgeloopCalcNormal(store: BMEdgeLoopStore): boolean {
    const vs = store.verts
    const no: Vec3 = [0, 0, 0]
    let vPrev = co(vs[vs.length - 1])
    for (let i = 0; i < vs.length; i++) {
        const vCurr = co(vs[i])
        addNewellCrossV3V3V3(no, vPrev, vCurr)
        vPrev = vCurr
    }
    store.no = no
    if (normalizeV3Len(no) < EDGELOOP_EPS) {
        store.no = [0, 0, 1]
        return false
    }
    return true
}

/**
 * `BM_edgeloop_calc_normal_aligned` (`:642`): a normal for an open chain, built so it points along
 * `noAlign` rather than depending on the chain's (arbitrary) planar winding.
 */
export function edgeloopCalcNormalAligned(store: BMEdgeLoopStore, noAlign: Vec3): boolean {
    const vs = store.verts
    const no: Vec3 = [0, 0, 0]
    let vPrev = co(vs[vs.length - 1])
    for (let i = 0; i < vs.length; i++) {
        const vCurr = co(vs[i])
        const dir = v3sub(vCurr, vPrev)
        const cross = v3cross(noAlign, dir)
        const n = v3cross(dir, cross)
        no[0] += n[0]
        no[1] += n[1]
        no[2] += n[2]
        vPrev = vCurr
    }
    store.no = no
    if (normalizeV3Len(no) < EDGELOOP_EPS) {
        store.no = [0, 0, 1]
        return false
    }
    return true
}

/** `BM_edgeloop_flip` (`:676`). */
export function edgeloopFlip(store: BMEdgeLoopStore): void {
    store.no = [-store.no[0], -store.no[1], -store.no[2]]
    store.verts.reverse()
}

/**
 * `BM_edgeloop_expand` (`:682`): grow the chain to `storeLen` entries. Without `split` the chosen
 * vertices are simply repeated (bridge then makes triangles there); with it the edge to the
 * neighbour is split and the new vertex takes the copy's place, every split edge recorded in
 * `splitEdges` so grid fill can collapse them afterwards.
 */
export function edgeloopExpand(bm: BMesh, store: BMEdgeLoopStore, storeLen: number, split: boolean, splitEdges: Set<BMEdge> | null): void {
    let splitSwap = true
    const vs = store.verts

    /** `EDGE_SPLIT(node_copy, node_other)`: split the edge from the copy's vertex to `vOther`. */
    const edgeSplitAt = (vCopy: BMVert, vOther: BMVert): BMVert => {
        const eOther = diskEdgeExists(vCopy, vOther)
        if (!eOther) throw new Error(`mesh-kernel: edge loop vertices ${vCopy.id} and ${vOther.id} share no edge`)
        const {vNew, eNew} = edgeSplit(bm, eOther, splitSwap ? vCopy : vOther, 0)
        vNew.e = eNew
        splitEdges!.add(eNew)
        return vNew
    }

    /** One doubling of the node at `i`; returns the index to continue from. */
    const expandAt = (i: number): number => {
        if (!split) {
            vs.splice(i + 1, 0, vs[i])
            return i + 2
        }
        if (i + 1 < vs.length || store.closed) {
            const vSplit = edgeSplitAt(vs[i], i + 1 < vs.length ? vs[i + 1] : vs[0])
            vs.splice(i + 1, 0, vSplit)
            splitSwap = !splitSwap
            return i + 2
        }
        const vSplit = edgeSplitAt(vs[i], vs[i - 1])
        vs.splice(i, 0, vSplit)
        splitSwap = !splitSwap
        return i + 2
    }

    // first double until we are more than half as big
    while (vs.length * 2 < storeLen) {
        let i = 0
        while (i < vs.length) i = expandAt(i)
        splitSwap = !splitSwap
    }

    if (vs.length < storeLen) {
        // Blender walks the list while picking sparse indices; the inserted copies shift the walk
        // along by one each time, which `offset` accounts for.
        let offset = 0
        for (const iter of foreachSparseRange(vs.length, storeLen - vs.length)) {
            const i = iter + offset
            if (!split) {
                vs.splice(i + 1, 0, vs[i])
            } else if (i + 1 < vs.length || store.closed) {
                const vSplit = edgeSplitAt(vs[i], i + 1 < vs.length ? vs[i + 1] : vs[0])
                vs.splice(i + 1, 0, vSplit)
                splitSwap = !splitSwap
            } else {
                const vSplit = edgeSplitAt(vs[i], vs[i - 1])
                vs.splice(i, 0, vSplit)
                splitSwap = !splitSwap
            }
            offset++
        }
    }

    if (vs.length !== storeLen) {
        throw new Error(`mesh-kernel: edgeloopExpand ended with ${vs.length} vertices, wanted ${storeLen}`)
    }
}

/** `BM_edgeloop_overlap_check` (`:773`): do the two chains share a vertex? */
export function edgeloopOverlapCheck(a: BMEdgeLoopStore, b: BMEdgeLoopStore): boolean {
    const inA = new Set(a.verts)
    for (const v of b.verts) if (inA.has(v)) return true
    return false
}

// endregion
