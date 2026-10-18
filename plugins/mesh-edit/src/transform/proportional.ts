/**
 * Proportional editing, ported from `transform_generics.cc` (`calculatePropRatio`),
 * `transform_convert.cc` (`set_prop_dist`) and `transform_convert_mesh.cc`
 * (`transform_convert_mesh_connectivity_distance`).
 *
 * Every vertex within `prop_size` of the selection gets a factor from the falloff curve; the
 * transform scales its delta by that factor. "Connected" measures the distance along the surface
 * (a geodesic propagation over edges and across faces), otherwise it is the straight-line distance
 * to the nearest selected vertex.
 */

import {BMesh, BMEdge, BMLoop, BMVert, ElemFlag, ElemType} from '@threepipe/mesh-kernel'
import {
    FLT_MAX,
    geodesicDistancePropagateAcrossTriangle,
    lenSquaredV3,
    lenV3,
    Mat3,
    mulM3V3,
    mulM4V3,
    normalizedV3,
    projectPlaneNormalizedV3V3V3,
    subV3,
    Vec3,
} from './math'
import {vertCo} from './bmeshQuery'
import {PropFalloff, T_PROP_CONNECTED, T_PROP_EDIT, T_PROP_PROJECTED, TD_SELECTED, TransData, TransDataContainer} from './types'
import type {TransInfo} from './TransInfo'

/** `restoreElement` (`transform_generics.cc:855`): put an element back where it started. */
export function restoreElement(td: TransData): void {
    td.loc[0] = td.iloc[0]
    td.loc[1] = td.iloc[1]
    td.loc[2] = td.iloc[2]
}

/** `(Smooth)` etc., Blender's `proptext`. */
export function propFalloffText(mode: PropFalloff): string {
    switch (mode) {
    case 'sharp': return '(Sharp)'
    case 'smooth': return '(Smooth)'
    case 'root': return '(Root)'
    case 'linear': return '(Linear)'
    case 'constant': return '(Constant)'
    case 'sphere': return '(Sphere)'
    case 'random': return '(Random)'
    case 'inverseSquare': return '(InvSquare)'
    }
}

/** The order `Shift+O` cycles through (`PROP_MODE_MAX`, `DNA_scene_types.h:2004`). */
export const PROP_FALLOFF_ORDER: PropFalloff[] = ['smooth', 'sphere', 'root', 'sharp', 'linear', 'constant', 'random', 'inverseSquare']

/** `calculatePropRatio` (`transform_generics.cc:1290`). */
export function calculatePropRatio(t: TransInfo): void {
    const connected = (t.flag & T_PROP_CONNECTED) !== 0
    t.proptext = ''

    if (t.flag & T_PROP_EDIT) {
        for (const tc of t.containers) {
            for (const td of tc.data) {
                if (td.flag & TD_SELECTED) {
                    td.factor = 1
                } else if ((connected ? td.dist : td.rdist) > t.propSize) {
                    td.factor = 0
                    restoreElement(td)
                } else {
                    // Use `rdist` for falloff calculations, it is the real distance.
                    let dist = connected ? (t.propSize - td.dist) / t.propSize : (t.propSize - td.rdist) / t.propSize
                    // Clamp to positive numbers: corner cases with connectivity and individual
                    // centres can give values of rdist larger than propsize.
                    dist = Math.max(dist, 0)

                    switch (t.propMode) {
                    case 'sharp':
                        td.factor = dist * dist
                        break
                    case 'smooth':
                        // Float imprecision can cause a `dist` approaching 1.0 to exceed 1.0 (#147530).
                        td.factor = Math.min(1, 3 * dist * dist - 2 * dist * dist * dist)
                        break
                    case 'root':
                        td.factor = Math.sqrt(dist)
                        break
                    case 'linear':
                        td.factor = dist
                        break
                    case 'constant':
                        td.factor = 1
                        break
                    case 'sphere':
                        td.factor = Math.sqrt(2 * dist - dist * dist)
                        break
                    case 'random':
                        td.factor = t.rng() * dist
                        break
                    case 'inverseSquare':
                        td.factor = dist * (2 - dist)
                        break
                    default:
                        td.factor = 1
                        break
                    }
                }
            }
        }
        t.proptext = propFalloffText(t.propMode)
    } else {
        for (const tc of t.containers) for (const td of tc.data) td.factor = 1
    }
}

/** `bmesh_test_dist_add` (`transform_convert_mesh.cc:933`): propagate from `v1` (and `v2`) to `v0`. */
function bmeshTestDistAdd(v0: BMVert, v1: BMVert, v2: BMVert | null, dists: Float32Array, index: Int32Array | null, mtx: Mat3): boolean {
    if (v0.hflag & ElemFlag.Select || v0.hflag & ElemFlag.Hidden) return false
    const i0 = v0.index
    const i1 = v1.index
    if (dists[i0] <= dists[i1]) return false

    let dist0: number
    if (v2) {
        // Distance across the triangle.
        const i2 = v2.index
        if (dists[i0] <= dists[i2]) return false
        const vm0 = mulM3V3(mtx, vertCo(v0))
        const vm1 = mulM3V3(mtx, vertCo(v1))
        const vm2 = mulM3V3(mtx, vertCo(v2))
        dist0 = geodesicDistancePropagateAcrossTriangle(vm0, vm1, vm2, dists[i1], dists[i2])
    } else {
        // Distance along the edge.
        const vec = mulM3V3(mtx, subV3(vertCo(v1), vertCo(v0)))
        dist0 = dists[i1] + lenV3(vec)
    }

    if (dist0 < dists[i0]) {
        dists[i0] = dist0
        if (index) index[i0] = index[i1]
        return true
    }
    return false
}

/** `bmesh_test_loose_edge` (`transform_convert_mesh.cc:988`): wire, or every adjacent face hidden. */
function bmeshTestLooseEdge(e: BMEdge): boolean {
    if (!e.l) return true
    let l: BMLoop = e.l
    do {
        if (!(l.f.hflag & ElemFlag.Hidden)) return false
        l = l.radialNext!
    } while (l !== e.l)
    return true
}

function* edgesOfVert(v: BMVert): Generator<BMEdge> {
    const first = v.e
    if (!first) return
    let e: BMEdge | null = first
    do {
        yield e
        e = e.diskNext(v)
    } while (e && e !== first)
}

/**
 * `transform_convert_mesh_connectivity_distance` (`transform_convert_mesh.cc:1006`): geodesic
 * distance from the selection for every vertex, `FLT_MAX` where unreachable. `index` receives the
 * index of the selected vertex each distance came from.
 */
export function meshConnectivityDistance(bm: BMesh, mtx: Mat3, dists: Float32Array, index: Int32Array | null): void {
    bm.elemIndexEnsure(ElemType.Vert | ElemType.Edge)

    // Set initial distances for selected vertices.
    for (const v of bm.verts) {
        const i = v.index
        dists[i] = !(v.hflag & ElemFlag.Select) || v.hflag & ElemFlag.Hidden ? FLT_MAX : 0
        if (index) index[i] = i
    }

    const queued = new Set<BMEdge>()
    const loose = new Set<BMEdge>()
    let queue: BMEdge[] = []
    let queueNext: BMEdge[] = []

    // Add edges with at least one selected vertex to the queue.
    for (const e of bm.edges) {
        if (e.hflag & ElemFlag.Hidden) continue
        if (dists[e.v1.index] !== FLT_MAX || dists[e.v2.index] !== FLT_MAX) queue.push(e)
        if (bmeshTestLooseEdge(e)) loose.add(e)
    }

    do {
        let e: BMEdge | undefined
        while ((e = queue.pop())) {
            let v1 = e.v1
            let v2 = e.v2
            let i1 = v1.index
            let i2 = v2.index

            if (loose.has(e) || dists[i1] === FLT_MAX || dists[i2] === FLT_MAX) {
                // Propagate along the edge from the vertex with the smallest to the largest distance.
                if (dists[i1] > dists[i2]) {
                    [i1, i2] = [i2, i1]
                    ;[v1, v2] = [v2, v1]
                }
                if (bmeshTestDistAdd(v2, v1, null, dists, index, mtx)) {
                    const needDirectDistance = loose.has(e) || (v1.hflag & ElemFlag.Select) !== 0 || (v2.hflag & ElemFlag.Select) !== 0
                    for (const eOther of edgesOfVert(v2)) {
                        if (eOther !== e && !queued.has(eOther) && !(eOther.hflag & ElemFlag.Hidden)
                            && (needDirectDistance || loose.has(eOther) || dists[eOther.otherVert(v2).index] !== FLT_MAX)) {
                            queued.add(eOther)
                            queueNext.push(eOther)
                        }
                    }
                }
            }

            if (!loose.has(e)) {
                // Propagate across the edge to vertices in adjacent faces.
                const lFirst = e.l!
                let l: BMLoop = lFirst
                do {
                    if (!(l.f.hflag & ElemFlag.Hidden)) {
                        for (let lOther = l.next.next; lOther !== l; lOther = lOther.next) {
                            const vOther = lOther.v
                            if (bmeshTestDistAdd(vOther, v1, v2, dists, index, mtx)) {
                                for (const eOther of edgesOfVert(vOther)) {
                                    if (eOther !== e && !queued.has(eOther) && !(eOther.hflag & ElemFlag.Hidden)
                                        && (loose.has(eOther) || dists[eOther.otherVert(vOther).index] !== FLT_MAX)) {
                                        queued.add(eOther)
                                        queueNext.push(eOther)
                                    }
                                }
                            }
                        }
                    }
                    l = l.radialNext!
                } while (l !== lFirst)
            }
        }

        for (const q of queueNext) queued.delete(q)
        ;[queue, queueNext] = [queueNext, queue]
    } while (queue.length)
}

/** `prop_dist_loc_get`: the position a distance is measured from, in global space. */
function propDistLocGet(tc: TransDataContainer, td: TransData, useIsland: boolean, projVec: Vec3 | null): Vec3 {
    let vec: Vec3 = useIsland ? [td.center[0], td.center[1], td.center[2]] : [td.iloc[0], td.iloc[1], td.iloc[2]]
    if (tc.useLocalMat) vec = mulM4V3(tc.mat, vec)
    if (projVec) vec = projectPlaneNormalizedV3V3V3(vec, projVec)
    return vec
}

/**
 * `set_prop_dist` (`transform_convert.cc:218`): the straight-line distance from every unselected
 * element to the nearest selected one. Blender uses a KD-tree; the brute-force search here gives
 * the same distances.
 */
export function setPropDist(t: TransInfo, withDist: boolean): void {
    const useIsland = t.around === 'individual' && !!(t.flag & T_PROP_EDIT) && t.isEditMesh
    const projVec = t.flag & T_PROP_PROJECTED ? normalizedV3(t.view.viewinvCol(2)) : null

    const selected: {vec: Vec3, td: TransData}[] = []
    for (const tc of t.containers) {
        for (const td of tc.data) {
            if (!(td.flag & TD_SELECTED)) continue
            td.rdist = 0
            selected.push({vec: propDistLocGet(tc, td, useIsland, projVec), td})
        }
    }

    for (const tc of t.containers) {
        for (const td of tc.data) {
            if (td.flag & TD_SELECTED) continue
            const vec = propDistLocGet(tc, td, useIsland, projVec)
            let best = -1
            let bestSq = Infinity
            for (let i = 0; i < selected.length; i++) {
                const d = lenSquaredV3(subV3(vec, selected[i].vec))
                if (d < bestSq) {
                    bestSq = d
                    best = i
                }
            }
            td.rdist = -1
            if (best !== -1) {
                td.rdist = Math.sqrt(bestSq)
                if (useIsland) {
                    // Use the centre and axismtx of the closest point found.
                    const src = selected[best].td
                    td.center = [src.center[0], src.center[1], src.center[2]]
                    td.axismtx = [[...src.axismtx[0]], [...src.axismtx[1]], [...src.axismtx[2]]] as Mat3
                }
            }
            if (withDist) td.dist = td.rdist
        }
    }
}
