/**
 * The transform side of snapping, ported from `editors/transform/transform_snap.cc`: the snap
 * source (which point of the selection snaps), the target search through {@link SnapContext}, the
 * increment and absolute-grid rounding, and the modifier handling (Ctrl inverts, Shift+Tab toggles).
 */

import {
    copyV3,
    lenSquaredV3V3,
    mulM3V3,
    mulM4V3,
    mulV3Fl,
    Vec3,
} from '../transform/math'
import {
    MOD_PRECISION,
    MOD_SNAP,
    MOD_SNAP_INVERT,
    SNAP_RESETTED,
    SNAP_SOURCE_FOUND,
    SNAP_TARGET_FOUND,
    SnapSourceType,
    SnapTargetType,
    TD_SELECTED,
} from '../transform/types'
import type {TransInfo} from '../transform/TransInfo'
import {SNAP_MIN_DISTANCE, SnapContext} from './snap'
import {calculateCenterActiveMesh} from '../transform/pivot'

/** `TRANSFORM_DIST_INVALID`. */
export const TRANSFORM_DIST_INVALID = -Number.MAX_VALUE

/** `TransSnap` (`transform.hh`). */
export interface TransSnap {
    /** `SCE_SNAP`: snapping is on for this transform (after the modifiers). */
    active: boolean
    /** `SCE_SNAP_TO_*` targets. */
    mode: Set<SnapTargetType>
    status: number
    sourceOperation: SnapSourceType
    targetType: SnapTargetType | 'none' | 'point'
    sourceType: 'none' | 'point'
    snapSource: Vec3
    snapTarget: Vec3
    snapNormal: Vec3
    /** `SCE_SNAP_ABS_GRID`: increments are absolute, from the world origin. */
    absGrid: boolean
    context: SnapContext | null
    /** `SCE_SNAP_TRANSFORM_MODE_*`: which modes geometry snapping affects. */
    affect: {translate: boolean, rotate: boolean, resize: boolean}
    backfaceCulling: boolean
    /** Only what is visible can be snapped to (no X-ray). */
    occlusion: boolean
    /** `TranslateCustomData.snap_target_grid`. */
    snapTargetGrid: Vec3
    /** The last search result, for drawing. */
    lastResult: {loc: Vec3, type: SnapTargetType} | null
}

export function newTransSnap(): TransSnap {
    return {
        active: false,
        mode: new Set(['increment']),
        status: SNAP_RESETTED,
        sourceOperation: 'closest',
        targetType: 'none',
        sourceType: 'none',
        snapSource: [0, 0, 0],
        snapTarget: [0, 0, 0],
        snapNormal: [0, 0, 0],
        absGrid: false,
        context: null,
        affect: {translate: true, rotate: false, resize: false},
        backfaceCulling: false,
        occlusion: true,
        snapTargetGrid: [0, 0, 0],
        lastResult: null,
    }
}

/** `resetSnapping` (`transform_snap.cc:622`). */
export function resetSnapping(t: TransInfo): void {
    t.tsnap.status = SNAP_RESETTED
    t.tsnap.sourceType = 'none'
    t.tsnap.targetType = 'none'
    t.tsnap.snapNormal = [0, 0, 0]
    t.tsnap.lastResult = null
}

/** `validSnap` (`transform_snap.cc:112`). */
export function validSnap(t: TransInfo): boolean {
    return (t.tsnap.status & (SNAP_TARGET_FOUND | SNAP_SOURCE_FOUND)) === (SNAP_TARGET_FOUND | SNAP_SOURCE_FOUND)
}

/** `transform_snap_flag_from_modifiers_set` (`transform_snap.cc:120`): Ctrl inverts the setting. */
export function transformSnapFlagFromModifiersSet(t: TransInfo): void {
    const m = t.modifiers & (MOD_SNAP | MOD_SNAP_INVERT)
    t.tsnap.active = m === MOD_SNAP || m === MOD_SNAP_INVERT
}

/** `transformModeUseSnap` (`transform_snap.cc:155`). */
export function transformModeUseSnap(t: TransInfo): boolean {
    const a = t.tsnap.affect
    // Edge and vertex slide always snap.
    if (t.mode === 'edgeSlide' || t.mode === 'vertSlide') return true
    return t.mode === 'translate' ? a.translate : t.mode === 'rotate' ? a.rotate : a.resize
}

/**
 * `initSnappingMode` (`transform_snap.cc:886`): modes the transform is not affected by fall back
 * to increment snapping, so Ctrl during a rotation still steps by the angle increment.
 */
export function initSnappingMode(t: TransInfo, wanted: Set<SnapTargetType>): void {
    if (!transformModeUseSnap(t)) {
        t.tsnap.mode = new Set(['increment'])
        return
    }
    t.tsnap.mode = new Set(wanted)
    if (t.tsnap.mode.size === 0) t.tsnap.mode.add('increment')
}

/** `transform_snap_mixed_is_active` (`transform_snap.cc:582`). */
function transformSnapMixedIsActive(t: TransInfo): boolean {
    if (!t.tsnap.active) return false
    for (const m of t.tsnap.mode) if (m !== 'increment') return true
    return false
}

/** `tranform_snap_target_median_calc` (`transform_snap.cc:1444`). */
export function snapTargetMedianCalc(t: TransInfo): Vec3 {
    let median: Vec3 = [0, 0, 0]
    let accum = 0
    for (const tc of t.containers) {
        let v: Vec3 = [0, 0, 0]
        let n = 0
        for (const td of tc.data) {
            if (!(td.flag & TD_SELECTED)) continue
            v = [v[0] + td.center[0], v[1] + td.center[1], v[2] + td.center[2]]
            n++
        }
        if (n === 0) continue
        v = mulV3Fl(v, 1 / n)
        if (tc.useLocalMat) v = mulM4V3(tc.mat, v)
        median = [median[0] + v[0], median[1] + v[1], median[2] + v[2]]
        accum++
    }
    return accum ? mulV3Fl(median, 1 / accum) : median
}

/** `snap_source_center_fn` (`transform_snap.cc:1478`). */
function snapSourceCenterFn(t: TransInfo): void {
    if (!(t.tsnap.status & SNAP_SOURCE_FOUND)) {
        t.tsnap.snapSource = copyV3(t.centerGlobal)
        t.tsnap.status |= SNAP_SOURCE_FOUND
        t.tsnap.sourceType = 'none'
    }
}

/** `snap_source_median_fn` (`transform_snap.cc:1506`). */
function snapSourceMedianFn(t: TransInfo): void {
    if (!(t.tsnap.status & SNAP_SOURCE_FOUND)) {
        t.tsnap.snapSource = snapTargetMedianCalc(t)
        t.tsnap.status |= SNAP_SOURCE_FOUND
        t.tsnap.sourceType = 'none'
    }
}

/** `snap_source_active_fn` (`transform_snap.cc:1489`). */
function snapSourceActiveFn(t: TransInfo): void {
    if (!(t.tsnap.status & SNAP_SOURCE_FOUND)) {
        const tc = t.containers[0]
        const active = t.bm && tc ? calculateCenterActiveMesh(t.bm, tc.mat) : t.activeObjectCenter
        if (active) {
            t.tsnap.snapSource = copyV3(active)
            t.tsnap.status |= SNAP_SOURCE_FOUND
            t.tsnap.sourceType = 'none'
        } else {
            // No active, default to median.
            t.tsnap.sourceOperation = 'median'
            snapSourceMedianFn(t)
        }
    }
}

/** `snap_source_closest_fn` (`transform_snap.cc:1516`): the selected element nearest the target. */
function snapSourceClosestFn(t: TransInfo): void {
    if (!(t.tsnap.status & SNAP_TARGET_FOUND)) return

    if (t.tsnap.targetType === 'grid') {
        // Snap to Grid uses the transform pivot as the source when 'Closest' is set.
        if (t.tsnap.sourceType !== 'point') {
            t.tsnap.snapSource = snapTargetMedianCalc(t)
            t.tsnap.sourceType = 'point'
        }
    } else {
        let distClosest = 0
        let closest = false
        for (const tc of t.containers) {
            for (const td of tc.data) {
                if (!(td.flag & TD_SELECTED)) continue
                let loc = copyV3(td.center)
                if (tc.useLocalMat) loc = mulM4V3(tc.mat, loc)
                const dist = t.modeInfo.snapDistance(t, loc, t.tsnap.snapTarget)
                if (dist !== TRANSFORM_DIST_INVALID && (!closest || Math.abs(dist) < Math.abs(distClosest))) {
                    t.tsnap.snapSource = loc
                    closest = true
                    distClosest = dist
                }
            }
        }
    }
    t.tsnap.status |= SNAP_SOURCE_FOUND
}

function snapSourceFn(t: TransInfo): void {
    switch (t.tsnap.sourceOperation) {
    case 'center': return snapSourceCenterFn(t)
    case 'median': return snapSourceMedianFn(t)
    case 'active': return snapSourceActiveFn(t)
    case 'closest':
    default: return snapSourceClosestFn(t)
    }
}

/** `snap_target_view3d_fn` (`transform_snap.cc:1343`) over {@link SnapContext}. */
function snapTargetView3dFn(t: TransInfo): void {
    const ctx = t.tsnap.context
    let found = false
    if (ctx) {
        const geom = new Set<SnapTargetType>()
        for (const m of t.tsnap.mode) if (m !== 'increment') geom.add(m)
        if (geom.size) {
            const initCo = t.tsnap.absGrid ? null : t.tsnap.sourceType === 'point' ? t.tsnap.snapSource : null
            const result = ctx.project(t.view, t.mval, geom, SNAP_MIN_DISTANCE, {
                occlusion: t.tsnap.occlusion,
                backfaceCulling: t.tsnap.backfaceCulling,
                initCo,
                currCo: t.tsnap.status & SNAP_SOURCE_FOUND ? t.tsnap.snapSource : t.centerGlobal,
                gridSize: t.snapSpatial[0],
            })
            if (result) {
                t.tsnap.snapTarget = copyV3(result.loc)
                t.tsnap.snapNormal = copyV3(result.no)
                t.tsnap.status |= SNAP_TARGET_FOUND
                t.tsnap.targetType = result.type
                t.tsnap.lastResult = {loc: copyV3(result.loc), type: result.type}
                found = true
                if (result.type === 'grid' && t.mode !== 'translate') {
                    // Change it so the symbol for other modes shows.
                    t.tsnap.targetType = 'point'
                }
            }
        }
    }
    if (!found) {
        t.tsnap.status &= ~SNAP_TARGET_FOUND
        t.tsnap.targetType = 'none'
        t.tsnap.lastResult = null
    }
}

/** `transform_snap_mixed_apply` (`transform_snap.cc:594`): find and apply a geometry or grid snap. */
export function transformSnapMixedApply(t: TransInfo, vec: number[]): void {
    if (!transformSnapMixedIsActive(t)) return
    snapTargetView3dFn(t)
    snapSourceFn(t)
    if (validSnap(t)) t.modeInfo.snapApply(t, vec)
}

/** `snap_increment_apply` (`transform_snap.cc:1759`): relative snapping in fixed increments. */
function snapIncrementApply(t: TransInfo, loc: number[], out: number[]): void {
    const usePrecision = (t.modifiers & MOD_PRECISION) !== 0
    for (let i = 0; i <= t.idxMax; i++) {
        const iterFac = usePrecision ? t.increment[i] * t.incrementPrecision : t.increment[i]
        if (iterFac !== 0) out[i] = iterFac * Math.round(loc[i] / iterFac)
    }
}

/** `transform_snap_increment_ex` (`transform_snap.cc:1773`). Returns true when the value was snapped. */
export function transformSnapIncrementEx(t: TransInfo, useLocalSpace: boolean, val: number[]): boolean {
    if (!t.tsnap.active) return false
    if (!t.tsnap.mode.has('increment')) return false

    if (useLocalSpace) {
        const v = mulM3V3(t.spacemtxInv, [val[0], val[1], val[2]])
        val[0] = v[0]
        val[1] = v[1]
        val[2] = v[2]
    }
    snapIncrementApply(t, val, val)
    if (useLocalSpace) {
        const v = mulM3V3(t.spacemtx, [val[0], val[1], val[2]])
        val[0] = v[0]
        val[1] = v[1]
        val[2] = v[2]
    }
    return true
}

/** `transform_snap_increment` (`transform_snap.cc:1802`). */
export function transformSnapIncrement(t: TransInfo, val: number[]): boolean {
    return transformSnapIncrementEx(t, false, val)
}

/** `transform_snap_increment_get` (`transform_snap.cc:1807`): the step in use, 0 when not snapping. */
export function transformSnapIncrementGet(t: TransInfo): number {
    if (t.tsnap.active && (t.tsnap.mode.has('increment') || t.tsnap.mode.has('grid'))) {
        return t.modifiers & MOD_PRECISION ? t.increment[0] * t.incrementPrecision : t.increment[0]
    }
    return 0
}

/** `transform_snap_distance_len_squared_fn` (`transform_snap.cc:1832`). */
export function transformSnapDistanceLenSquaredFn(_t: TransInfo, p1: Vec3, p2: Vec3): number {
    return lenSquaredV3V3(p1, p2)
}

/** `getSnapPoint` (`transform_snap.cc:1260`), without multi-point averaging. */
export function getSnapPoint(t: TransInfo): Vec3 {
    return copyV3(t.tsnap.snapTarget)
}
