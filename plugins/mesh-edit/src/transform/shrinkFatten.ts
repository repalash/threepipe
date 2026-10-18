/**
 * Shrink/Fatten: `TFM_SHRINKFATTEN`, ported from `editors/transform/transform_mode_shrink_fatten.cc`,
 * with the per-vertex data `VertsToTransData` gives it (`transform_convert_mesh.cc:1453`, `:1479`) and
 * the bmesh queries that data needs (`BM_vert_calc_shell_factor_ex`, `bmesh_query.cc:1453`).
 *
 * Each vertex moves along `td->axismtx[2]` - its normal, or in face select mode the normal of its
 * selected faces - by the distance the cursor's vertical travel gives (`INPUT_VERTICAL_ABSOLUTE`).
 * "Even thickness" (`use_even_offset`, Alt held or S toggled) scales each by its shell factor so the
 * offset surface keeps an even distance from the original.
 */

import {BMVert, ElemFlag, SelectMode, vertCalcNormalEx} from '@threepipe/mesh-kernel'
import {initMouseInputMode} from './input'
import {applyNumInput, hasNumInput, outputNumInput} from './numinput'
import {T_INPUT_IS_VALUES_FINAL, T_NO_CONSTRAINT, TD_SKIP} from './types'
import {transformSnapIncrement} from '../snap/transformSnap'
import {loopCalcFaceAngle} from './bmeshQuery'
import type {TransformModeInfo, TransInfo} from './TransInfo'
import type {SlideEvent} from './slide'
import type {Vec3} from './math'

/** The operator's own property (`TRANSFORM_OT_shrink_fatten`, `transform_ops.cc:1138`). */
export interface ShrinkFattenProps {
    useEvenOffset?: boolean
}

/** `ShrinkFattenCustomData` (`transform_mode_shrink_fatten.cc:34`). */
export interface ShrinkFattenCustomData {
    /** `EVEN_THICKNESS_ON`. */
    even: boolean
    useAltPressToDisable: boolean
}

/** `shell_v3v3_normalized_to_dist` (`math_geom_inline.cc:133`). */
function shellV3V3NormalizedToDist(a: Vec3, b: Vec3): number {
    const angleCos = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
    return angleCos < 1e-8 ? 1 : 1 / angleCos
}

/** Blender's `BM_LOOPS_OF_VERT` order: each disk edge, each radial loop at `v`. */
function* loopsOfVert(v: BMVert) {
    if (!v.e) return
    let e = v.e
    do {
        let l = e.l
        if (l) {
            do {
                if (l.v === v) yield l
            } while ((l = l.radialNext!) !== e.l)
        }
        e = e.diskNext(v)!
    } while (e !== v.e)
}

/** `BM_vert_calc_shell_factor` (`bmesh_query.cc:1435`): every face, against `v->no`. */
function vertCalcShellFactor(v: BMVert): number {
    let accumShell = 0, accumAngle = 0
    const no: Vec3 = [v.nx, v.ny, v.nz]
    for (const l of loopsOfVert(v)) {
        const faceAngle = loopCalcFaceAngle(l)
        accumShell += shellV3V3NormalizedToDist(no, [l.f.nx, l.f.ny, l.f.nz]) * faceAngle
        accumAngle += faceAngle
    }
    return accumAngle !== 0 ? accumShell / accumAngle : 1
}

/** `BM_vert_calc_shell_factor_ex` (`bmesh_query.cc:1453`): the faces with `hflag`, against `no`. */
export function vertCalcShellFactorEx(v: BMVert, no: Vec3, hflag: number): number {
    let accumShell = 0, accumAngle = 0
    let totSel = 0, tot = 0
    for (const l of loopsOfVert(v)) {
        if (l.f.hflag & hflag) { // <-- main difference to BM_vert_calc_shell_factor!
            const faceAngle = loopCalcFaceAngle(l)
            accumShell += shellV3V3NormalizedToDist(no, [l.f.nx, l.f.ny, l.f.nz]) * faceAngle
            accumAngle += faceAngle
            totSel++
        }
        tot++
    }
    if (accumAngle !== 0) return accumShell / accumAngle
    // other main difference from BM_vert_calc_shell_factor!
    if (tot !== 0 && totSel === 0) return vertCalcShellFactor(v) // none selected, so use all
    return 1
}

/**
 * The normal `VertsToTransData` gives a vertex for shrink/fatten (`transform_convert_mesh.cc:1453`):
 * in face select mode a selected vertex uses its selected faces' normal (`BM_vert_calc_normal_ex`),
 * otherwise `v->no`. Null when the vertex normal applies.
 */
export function shrinkFattenVertNormal(v: BMVert, selectMode: number): Vec3 | null {
    if ((selectMode & SelectMode.Face) && (v.hflag & ElemFlag.Select)) {
        const r = vertCalcNormalEx(v, ElemFlag.Select)
        if (r.ok) return r.no
    }
    return null
}

/** `transdata_elem_shrink_fatten` (`:41`). */
function elemShrinkFatten(t: TransInfo, td: TransInfo['containers'][number]['data'][number], distance: number): void {
    const custom = t.customMode as ShrinkFattenCustomData
    // Get the final offset.
    let tdistance = distance * td.factor
    if (custom.even) tdistance *= td.shellFactor ?? 1 // Shell factor.
    const n = td.axismtx[2]
    td.loc = [td.iloc[0] + n[0] * tdistance, td.iloc[1] + n[1] * tdistance, td.iloc[2] + n[2] * tdistance]
}

/** `shrinkfatten_handleEvent` (`:56`): Alt inverts "even thickness" while held, S toggles it. */
function handleEventShrinkFatten(t: TransInfo, ev: SlideEvent): boolean {
    if (ev.type !== 'key') return false
    const custom = t.customMode as ShrinkFattenCustomData | null
    if (!custom) return false
    const e = ev.event
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
        const useEven = custom.useAltPressToDisable !== e.press
        custom.even = useEven
        return true
    }
    // `kmi` is the modal keymap's `TFM_MODAL_RESIZE` key, S, which shrink/fatten cannot switch to.
    if (e.code === 'KeyS' && e.press && !e.repeat) {
        // Allows the "Even Thickness" effect to be enabled as a toggle.
        custom.even = !custom.even
        // Also toggle the Alt press state.
        custom.useAltPressToDisable = !custom.useAltPressToDisable
        return true
    }
    return false
}

/** `applyShrinkFatten` (`:79`). */
function applyShrinkFatten(t: TransInfo): void {
    let distance: number
    if (t.flag & T_INPUT_IS_VALUES_FINAL) {
        distance = t.values[0]
    } else {
        const v = [t.values[0] + t.valuesModalOffset[0]]
        transformSnapIncrement(t, v)
        applyNumInput(t.num, v)
        distance = v[0]
    }
    t.valuesFinal = [distance, 0, 0]

    // Header print for NumInput.
    const custom = t.customMode as ShrinkFattenCustomData
    let str = 'Shrink/Fatten: ' + (hasNumInput(t.num) ? outputNumInput(t.num)[0] : distance.toFixed(4))
    if (t.proptext) str += ` ${t.proptext}`
    str += ` (S or Alt: even thickness ${custom.even ? 'on' : 'off'})`
    t.header = str

    for (const tc of t.containers) {
        for (const td of tc.data) {
            if (td.flag & TD_SKIP) continue
            elemShrinkFatten(t, td, distance)
        }
    }
}

/** `initShrinkFatten` (`:154`). */
function initShrinkFatten(t: TransInfo, op: ShrinkFattenProps | null): void {
    if (!t.bm) {
        // "'Shrink/Fatten' meshes is only supported in edit mode"
        t.state = 'cancel'
        return
    }
    initMouseInputMode(t.mouse, 'verticalAbsolute')
    t.idxMax = 0
    t.num.idxMax = 0
    t.increment = [1, 1, 1]
    t.incrementPrecision = 0.1
    t.num.valInc = [1, 1, 1]
    t.num.unitType = ['length', 'none', 'none']
    const custom: ShrinkFattenCustomData = {even: false, useAltPressToDisable: false}
    t.customMode = custom
    if (op?.useEvenOffset) {
        custom.even = true
        custom.useAltPressToDisable = true
    }
}

export const TransModeShrinkFatten: TransformModeInfo = {
    flags: T_NO_CONSTRAINT,
    init: initShrinkFatten as TransformModeInfo['init'],
    transform: applyShrinkFatten,
    handleEvent: handleEventShrinkFatten,
    snapDistance: () => 0,
    snapApply: () => undefined,
}

/** `saveTransform`'s `use_even_offset` (the `T_ALT_TRANSFORM` workaround of `free_cb`, `:174`). */
export function shrinkFattenSavedEven(t: TransInfo): boolean {
    return !!(t.customMode as ShrinkFattenCustomData | null)?.even
}
