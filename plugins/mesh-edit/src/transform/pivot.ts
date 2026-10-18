/**
 * Pivot points and per-island centres, ported from `transform_generics.cc` (`calculateCenter*`)
 * and `transform_convert_mesh.cc` (`transform_convert_mesh_islands_calc`).
 *
 * The pivot is where rotation and scaling happen about: the median of the selection, the active
 * element, the bounding-box centre, the 3D cursor, or - with individual origins - each connected
 * island's own centre, which is what `td.center` carries.
 */

import {BMesh, BMVert, ElemFlag, SelectMode} from '@threepipe/mesh-kernel'
import {
    addV3,
    axisDominantV3ToM3,
    invertM3,
    isZeroV3,
    Mat3,
    mulM4V3,
    mulV3Fl,
    normalizeV3,
    unitM3,
    Vec3,
} from './math'
import {
    BMEditElem,
    editselectionCenter,
    editselectionNormal,
    editselectionPlane,
    meshCalcEdgeGroups,
    meshCalcFaceGroups,
    vertCo,
    vertNo,
} from './bmeshQuery'
import {createSpaceNormalTangentOrFallback, selectHistoryActiveGet} from './orientation'
import {PivotType, TD_NOCENTER, TD_SELECTED, TransData, TransDataContainer} from './types'

/** `transdata_center_global_get` (`transform_generics.cc:1028`). */
function transdataCenterGlobalGet(tc: TransDataContainer, td: TransData): Vec3 | null {
    if (td.flag & TD_SELECTED && !(td.flag & TD_NOCENTER)) {
        return tc.useLocalMat ? mulM4V3(tc.mat, td.center) : td.center
    }
    return null
}

/** `calculateCenterMedian` (`transform_generics.cc:1046`). */
export function calculateCenterMedian(containers: TransDataContainer[]): Vec3 {
    let partial: Vec3 = [0, 0, 0]
    let total = 0
    for (const tc of containers) {
        for (const td of tc.data) {
            const c = transdataCenterGlobalGet(tc, td)
            if (c) {
                partial = addV3(partial, c)
                total++
            }
        }
    }
    if (total) partial = mulV3Fl(partial, 1 / total)
    return partial
}

/** `calculateCenterBound` (`transform_generics.cc:1074`). */
export function calculateCenterBound(containers: TransDataContainer[]): Vec3 {
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    let changed = false
    for (const tc of containers) {
        for (const td of tc.data) {
            const c = transdataCenterGlobalGet(tc, td)
            if (!c) continue
            for (let i = 0; i < 3; i++) {
                if (c[i] < min[i]) min[i] = c[i]
                if (c[i] > max[i]) max[i] = c[i]
            }
            changed = true
        }
    }
    if (!changed) return [0, 0, 0]
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/**
 * `calculateCenterActive` for an edit mesh (`transform_generics.cc:1101` via
 * `calc_active_center_for_editmode`, `object_utils.cc:64`): the active element's centre in world space.
 */
export function calculateCenterActiveMesh(bm: BMesh, objectMatrix: number[]): Vec3 | null {
    const active = selectHistoryActiveGet(bm)
    if (!active) return null
    return mulM4V3(objectMatrix, editselectionCenter(active))
}

export interface CenterContext {
    containers: TransDataContainer[]
    around: PivotType
    /** The 3D cursor in world space. */
    cursor: Vec3
    /** For `active` in edit mode. */
    bm?: BMesh | null
    /** The active object's world position, for `active` in object mode. */
    activeObjectCenter?: Vec3 | null
}

/** `calculateCenter_FromAround` (`transform_generics.cc:1150`). */
export function calculateCenterFromAround(ctx: CenterContext): Vec3 {
    switch (ctx.around) {
    case 'bounds':
        return calculateCenterBound(ctx.containers)
    case 'cursor':
        return [ctx.cursor[0], ctx.cursor[1], ctx.cursor[2]]
    case 'individual':
        // Individual element centres use the median for the helpline and such.
        return calculateCenterMedian(ctx.containers)
    case 'active': {
        if (ctx.bm) {
            const tc = ctx.containers[0]
            const c = tc ? calculateCenterActiveMesh(ctx.bm, tc.mat) : null
            if (c) return c
        } else if (ctx.activeObjectCenter) {
            return [ctx.activeObjectCenter[0], ctx.activeObjectCenter[1], ctx.activeObjectCenter[2]]
        }
        return calculateCenterMedian(ctx.containers)
    }
    case 'median':
    default:
        return calculateCenterMedian(ctx.containers)
    }
}

/**
 * The pivot of an edit-mesh selection in world space, for the gizmo (`calc_gizmo_stats` with
 * `transform_pivot_point`): the median or the bounds of the selected vertices, the active element,
 * or the cursor. Individual origins show the median, as the transform's helpline does.
 */
export function selectionPivotWorld(bm: BMesh, around: PivotType, objectMatrix: number[], cursor: Vec3): Vec3 | null {
    if (around === 'cursor') return [cursor[0], cursor[1], cursor[2]]
    if (around === 'active') {
        const c = calculateCenterActiveMesh(bm, objectMatrix)
        if (c) return c
    }
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    let sum: Vec3 = [0, 0, 0]
    let n = 0
    for (const v of bm.verts) {
        if (!(v.hflag & ElemFlag.Select) || v.hflag & ElemFlag.Hidden) continue
        const p = mulM4V3(objectMatrix, vertCo(v))
        sum = addV3(sum, p)
        for (let i = 0; i < 3; i++) {
            if (p[i] < min[i]) min[i] = p[i]
            if (p[i] > max[i]) max[i] = p[i]
        }
        n++
    }
    if (!n) return null
    if (around === 'bounds') return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
    return mulV3Fl(sum, 1 / n)
}

/** The pivot of a set of object positions in world space, for the object-mode gizmo. */
export function objectsPivotWorld(positions: Vec3[], around: PivotType, active: Vec3 | null, cursor: Vec3): Vec3 | null {
    if (around === 'cursor') return [cursor[0], cursor[1], cursor[2]]
    if (!positions.length) return null
    if (around === 'active' && active) return [active[0], active[1], active[2]]
    if (around === 'bounds') {
        const min: Vec3 = [Infinity, Infinity, Infinity]
        const max: Vec3 = [-Infinity, -Infinity, -Infinity]
        for (const p of positions) for (let i = 0; i < 3; i++) {
            if (p[i] < min[i]) min[i] = p[i]
            if (p[i] > max[i]) max[i] = p[i]
        }
        return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
    }
    let sum: Vec3 = [0, 0, 0]
    for (const p of positions) sum = addV3(sum, p)
    return mulV3Fl(sum, 1 / positions.length)
}

/** `TransIslandData`. */
export interface TransIslandData {
    /** Island index per vertex; -1 for vertices that are not in any island. */
    islandVertMap: Map<BMVert, number>
    center: Vec3[] | null
    axismtx: Mat3[] | null
    islandTot: number
}

/**
 * `transform_convert_mesh_islands_calc` (`transform_convert_mesh.cc:738`): group the selection
 * into connected islands (edge groups in vertex/edge mode, face groups in face mode), each with its
 * centre and normal frame. With `calcSingleIslands`, every selected vertex outside the groups
 * becomes an island of its own.
 */
export function meshIslandsCalc(bm: BMesh, calcSingleIslands: boolean, calcIslandCenter: boolean, calcIslandAxismtx: boolean): TransIslandData {
    const data: TransIslandData = {islandVertMap: new Map(), center: null, axismtx: null, islandTot: 0}

    const hasOnlySingleIslands = bm.totedgesel === 0 && bm.totfacesel === 0
    if (hasOnlySingleIslands && !calcSingleIslands) return data

    for (const v of bm.verts) data.islandVertMap.set(v, -1)

    if (!hasOnlySingleIslands) {
        let groups: BMEditElem[][]
        if (bm.selectMode & (SelectMode.Vertex | SelectMode.Edge)) {
            groups = meshCalcEdgeGroups(bm)
        } else {
            groups = meshCalcFaceGroups(bm)
        }
        data.islandTot = groups.length
        if (calcIslandCenter) data.center = []
        if (calcIslandAxismtx) data.axismtx = []

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i]
            let co: Vec3 = [0, 0, 0]
            let no: Vec3 = [0, 0, 0]
            let tangent: Vec3 = [0, 0, 0]
            for (const ele of group) {
                if (data.center) co = addV3(co, editselectionCenter(ele))
                if (data.axismtx) {
                    no = addV3(no, editselectionNormal(ele))
                    tangent = addV3(tangent, editselectionPlane(ele))
                }
                // Setup the vertex map: connected edge/face verts.
                if ('v1' in ele) {
                    data.islandVertMap.set(ele.v1, i)
                    data.islandVertMap.set(ele.v2, i)
                } else if ('lFirst' in ele) {
                    for (const l of ele.eachLoop()) data.islandVertMap.set(l.v, i)
                }
            }
            if (data.center) data.center.push(mulV3Fl(co, 1 / group.length))
            if (data.axismtx) {
                normalizeV3(no)
                normalizeV3(tangent)
                data.axismtx.push(createSpaceNormalTangentOrFallback(no, tangent))
            }
        }
    }

    // For proportional editing we need islands of 1 so connected vertices can use it with
    // individual origins.
    if (calcSingleIslands) {
        for (const v of bm.verts) {
            if (v.hflag & ElemFlag.Select && data.islandVertMap.get(v) === -1) {
                data.islandVertMap.set(v, data.islandTot)
                if (calcIslandCenter) {
                    data.center ??= []
                    data.center.push(vertCo(v))
                }
                if (calcIslandAxismtx) {
                    data.axismtx ??= []
                    const no = vertNo(v)
                    data.axismtx.push(!isZeroV3(no) ? invertM3(axisDominantV3ToM3(no)) : unitM3())
                }
                data.islandTot++
            }
        }
    }
    return data
}
