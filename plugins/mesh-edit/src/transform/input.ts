/**
 * Mouse input for the modal transform, ported from `editors/transform/transform_input.cc`.
 *
 * Each mode turns the cursor position into the value a transform mode consumes:
 * - `vector`: the screen delta from the start as a world-space vector (translate);
 * - `spring` / `springFlip`: the ratio of the cursor's distance to the pivot against the distance
 *   at the start (scale), flipped when the cursor crosses the pivot;
 * - `angle`: the angle swept about the pivot's screen position, accumulated per move so it is
 *   continuous past 180 degrees (rotate).
 *
 * Precision (Shift) works through a "virtual" cursor that advances at a tenth of the real one
 * (`applyMouseInput`), so letting go of Shift never jumps.
 */

import {angleNormalizedV2V2, crossV2, normalizeV2, Vec2, Vec3} from './math'

export type MouseInputMode = 'none' | 'vector' | 'spring' | 'springFlip' | 'springDelta' | 'angle'

/** What the input needs from the transform: Blender's `convertViewVec`. */
export interface MouseInputContext {
    convertViewVec(dx: number, dy: number): Vec3
}

/** The `MouseInput` struct (`transform.hh`). */
export class MouseInput {
    /** Initial mouse position. */
    imval: Vec2 = [0, 0]
    /** The pivot on screen, for `spring` and `angle`. */
    center: Vec2 = [0, 0]
    factor = 0
    precision = false
    precisionFactor = 1 / 10
    useVirtualMval = true
    virtualPrev: Vec2 = [0, 0]
    virtualAccum: Vec2 = [0, 0]
    mode: MouseInputMode = 'none'
    /** `InputAngle_Data`. */
    angle = 0
    mvalPrev: Vec2 = [0, 0]
    post: ((values: Vec3) => void) | null = null
}

/** `InputVector` (`transform_input.cc:39`). */
function inputVector(ctx: MouseInputContext, mi: MouseInput, mval: Vec2): Vec3 {
    return ctx.convertViewVec(mval[0] - mi.imval[0], mval[1] - mi.imval[1])
}

/** `InputSpring` (`transform_input.cc:45`). */
function inputSpring(mi: MouseInput, mval: Vec2): Vec3 {
    const dx = mi.center[0] - mval[0]
    const dy = mi.center[1] - mval[1]
    const ratio = Math.hypot(dx, dy) / mi.factor
    return [ratio, 0, 0]
}

/** `InputSpringFlip` (`transform_input.cc:58`): negative past the pivot. */
function inputSpringFlip(mi: MouseInput, mval: Vec2): Vec3 {
    const out = inputSpring(mi, mval)
    const cx = Math.trunc(mi.center[0]), cy = Math.trunc(mi.center[1])
    if ((cx - mval[0]) * (cx - mi.imval[0]) + (cy - mval[1]) * (cy - mi.imval[1]) < 0) {
        out[0] *= -1
    }
    return out
}

/** `InputSpringDelta` (`transform_input.cc:72`). */
function inputSpringDelta(mi: MouseInput, mval: Vec2): Vec3 {
    const out = inputSpring(mi, mval)
    out[0] -= 1
    return out
}

/** `InputAngle` (`transform_input.cc:179`): accumulate the signed angle swept since the previous move. */
function inputAngle(mi: MouseInput, mval: Vec2): Vec3 {
    const dirPrev: Vec2 = [mi.mvalPrev[0] - mi.center[0], mi.mvalPrev[1] - mi.center[1]]
    const dirCurr: Vec2 = [mval[0] - mi.center[0], mval[1] - mi.center[1]]

    if (normalizeV2(dirPrev) && normalizeV2(dirCurr)) {
        let dphi = angleNormalizedV2V2(dirPrev, dirCurr)
        if (crossV2(dirPrev, dirCurr) > 0) dphi = -dphi

        mi.angle += dphi * (mi.precision ? mi.precisionFactor : 1)
        mi.mvalPrev = [mval[0], mval[1]]
    }
    return [mi.angle, 0, 0]
}

/** `transform_input_reset` (`transform_input.cc:257`). */
export function transformInputReset(mi: MouseInput, mval: Vec2): void {
    mi.imval = [mval[0], mval[1]]
    if (mi.mode === 'angle') {
        mi.mvalPrev = [mi.imval[0], mi.imval[1]]
        mi.angle = 0
    }
}

/** `initMouseInput` (`transform_input.cc:271`). */
export function initMouseInput(mi: MouseInput, center: Vec2, mval: Vec2, precision: boolean): void {
    mi.factor = 0
    mi.precision = precision
    mi.center = [center[0], center[1]]
    mi.post = null
    transformInputReset(mi, mval)
}

/** `calcSpringFactor` (`transform_input.cc:284`): the start distance to the pivot, never zero. */
function calcSpringFactor(mi: MouseInput): void {
    mi.factor = Math.hypot(mi.center[1] - mi.imval[1], mi.center[0] - mi.imval[0])
    if (mi.factor === 0) mi.factor = 1
}

/** `initMouseInputMode` (`transform_input.cc:341`). */
export function initMouseInputMode(mi: MouseInput, mode: MouseInputMode): void {
    mi.useVirtualMval = true
    mi.precisionFactor = 1 / 10
    mi.mode = mode
    switch (mode) {
    case 'vector':
        break
    case 'spring':
    case 'springFlip':
    case 'springDelta':
        calcSpringFactor(mi)
        break
    case 'angle':
        mi.useVirtualMval = false
        mi.precisionFactor = 1 / 30
        mi.mvalPrev = [mi.imval[0], mi.imval[1]]
        mi.angle = 0
        break
    default:
        break
    }
}

/** `applyMouseInput` (`transform_input.cc:489`). */
export function applyMouseInput(ctx: MouseInputContext, mi: MouseInput, mval: Vec2): Vec3 {
    let mvalDb: Vec2
    if (mi.useVirtualMval) {
        // Update the accumulator.
        const dx = mval[0] - mi.imval[0] - mi.virtualPrev[0]
        const dy = mval[1] - mi.imval[1] - mi.virtualPrev[1]
        mi.virtualPrev[0] += dx
        mi.virtualPrev[1] += dy
        const f = mi.precision ? mi.precisionFactor : 1
        mi.virtualAccum[0] += dx * f
        mi.virtualAccum[1] += dy * f
        mvalDb = [mi.imval[0] + mi.virtualAccum[0], mi.imval[1] + mi.virtualAccum[1]]
    } else {
        mvalDb = [mval[0], mval[1]]
    }

    let output: Vec3 = [0, 0, 0]
    switch (mi.mode) {
    case 'vector':
        output = inputVector(ctx, mi, mvalDb)
        break
    case 'spring':
        output = inputSpring(mi, mvalDb)
        break
    case 'springFlip':
        output = inputSpringFlip(mi, mvalDb)
        break
    case 'springDelta':
        output = inputSpringDelta(mi, mvalDb)
        break
    case 'angle':
        output = inputAngle(mi, mvalDb)
        break
    default:
        break
    }
    if (mi.post) mi.post(output)
    return output
}

/** `transform_input_virtual_mval_reset` (`transform_input.cc:565`). */
export function transformInputVirtualMvalReset(mi: MouseInput): void {
    if (mi.mode === 'angle') {
        mi.angle = 0
        mi.mvalPrev = [mi.imval[0], mi.imval[1]]
    } else {
        mi.virtualPrev = [0, 0]
        mi.virtualAccum = [0, 0]
    }
}

/**
 * `transform_input_update` (`transform_input.cc:528`): keep the input continuous when the view
 * changes mid-transform (zoom `fac` and a new pivot position on screen).
 */
export function transformInputUpdate(mi: MouseInput, fac: number, center2d: Vec2): void {
    const offset: Vec2 = [fac * (mi.imval[0] - mi.center[0]), fac * (mi.imval[1] - mi.center[1])]
    mi.imval = [center2d[0] + offset[0], center2d[1] + offset[1]]
    mi.factor *= fac

    const centerOld: Vec2 = [mi.center[0], mi.center[1]]
    mi.center = [center2d[0], center2d[1]]

    if (mi.useVirtualMval) {
        const dx = (mi.virtualAccum[0] - mi.virtualPrev[0]) * fac
        const dy = (mi.virtualAccum[1] - mi.virtualPrev[1]) * fac
        mi.virtualAccum = [mi.virtualPrev[0] + dx, mi.virtualPrev[1] + dy]
    }

    if (mi.mode === 'angle') {
        mi.mvalPrev[0] += mi.center[0] - centerOld[0]
        mi.mvalPrev[1] += mi.center[1] - centerOld[1]
    }
}
