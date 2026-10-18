/**
 * Float inverse trigonometry as the reference platform's libm returns it.
 *
 * Blender is compiled against the platform libm, and the Blender 5.2.2 ground truth comes from macOS arm64
 * (macOS 15.5, libSystem). Measured there (`porting/blender/libm_probe.py`, run on the Blender worker on 2026-10-18):
 * - `acosf(-1) = 3.1415925` (0x40490fda), not the correctly rounded `float(pi) = 3.1415927` (0x40490fdb);
 * - `asinf(+-1) = +-1.5707962` (0x3fc90fda), not `float(pi / 2) = 1.5707964` (`acosf(0)` is 1.5707964);
 * - `atan2f(y, x)` is `+-3.1415925` wherever the correctly rounded result is `+-float(pi)`
 *   (`y = +-0` or tiny with `x < 0`, including `x = -0`).
 * These boundary values matter beyond an ulp: a quaternion built from `acosf(-1)` or `atan2f(0, x < 0)` flips the
 * sign of a near-zero cosine, and code that branches on that sign (`vec_to_quat`) then returns a different rotation.
 * Elsewhere `f32(Math.xxx(...))` (correctly rounded) is used, which is not always what Apple's libm returns: its
 * `atan2f` is 1 ulp off on some inputs (7 of 128 measured), and `sinf`/`cosf` of one angle come from
 * `__sincosf_stret` (issue `procedural-libm-atan2f-sincos.md`). Those stay ulp-level differences (plan 2.6).
 *
 * `blenderSystem.libm = 'correctly-rounded'` reproduces a platform whose libm rounds these correctly.
 */

import {f32} from './f32'
import {blenderSystem} from './system'

const F_PI = f32(Math.PI)
const F_HALF_PI = f32(Math.PI / 2)
/** The float just below pi (0x40490fda) and just below pi / 2 (0x3fc90fda). */
const PI_BELOW = 3.1415925025939941
const HALF_PI_BELOW = 1.5707962512969971

const apple = () => blenderSystem.libm === 'apple-arm64'

/**
 * Platform results to substitute, and recorded inputs, for proving that a difference from Blender is libm only
 * (`tests/parity/libmProof.test.ts`): `record` collects every float argument of the functions below; `table` maps
 * `name -> argument key -> result(s)` measured on the reference platform (`porting/blender/libm_eval.py`). Both are
 * unset in normal use.
 */
export const libmProof: {
    record?: Record<LibmName, Set<string>>
    table?: Partial<Record<LibmName, Record<string, number[]>>>
} = {}

export type LibmName = 'acosf' | 'asinf' | 'atan2f' | 'sincosf' | 'sinf' | 'cosf' | 'tanf' | 'powf'

/** `String(x)`, keeping the sign of zero. */
const key = (x: number) => (Object.is(x, -0) ? '-0' : String(x))

function substituted(name: LibmName, k: string): number[] | undefined {
    libmProof.record?.[name].add(k)
    return libmProof.table?.[name]?.[k]
}

export function acosf(a: number): number {
    const t = substituted('acosf', key(a))
    if (t) return t[0]
    const r = f32(Math.acos(a))
    return r === F_PI && apple() ? PI_BELOW : r
}

export function asinf(a: number): number {
    const t = substituted('asinf', key(a))
    if (t) return t[0]
    const r = f32(Math.asin(a))
    if (Math.abs(r) === F_HALF_PI && apple()) return r > 0 ? HALF_PI_BELOW : -HALF_PI_BELOW
    return r
}

export function atan2f(y: number, x: number): number {
    const t = substituted('atan2f', `${key(y)},${key(x)}`)
    if (t) return t[0]
    const r = f32(Math.atan2(y, x))
    if (Math.abs(r) === F_PI && apple()) return r > 0 ? PI_BELOW : -PI_BELOW
    return r
}

/**
 * `sinf(x)` and `cosf(x)` of one value, which clang combines into one `__sincosf_stret(x)` call on Darwin; that
 * function is not always correctly rounded (`procedural-libm-atan2f-sincos.md`). Correctly rounded here.
 */
export function sincosf(x: number): [number, number] {
    const t = substituted('sincosf', key(x))
    if (t) return [t[0], t[1]]
    return [f32(Math.sin(x)), f32(Math.cos(x))]
}

/** `sinf` called alone (no `cosf` of the same value in the block, see `sincosf`). Correctly rounded here. */
export function sinf(x: number): number {
    const t = substituted('sinf', key(x))
    return t ? t[0] : f32(Math.sin(x))
}

/** `cosf` called alone (see `sincosf`). Correctly rounded here. */
export function cosf(x: number): number {
    const t = substituted('cosf', key(x))
    return t ? t[0] : f32(Math.cos(x))
}

/** `tanf`. Correctly rounded here. */
export function tanf(x: number): number {
    const t = substituted('tanf', key(x))
    return t ? t[0] : f32(Math.tan(x))
}

/**
 * `powf`: `Math.pow` then rounded, except where C99 Annex F and JS disagree - `pow(1, y)` is 1 for every
 * `y` (also NaN and infinities) and `pow(-1, +-inf)` is 1 in C, NaN in JS.
 */
export function powf(a: number, b: number): number {
    if (a === 1 || (a === -1 && (b === Infinity || b === -Infinity))) return 1
    const t = substituted('powf', `${key(a)},${key(b)}`)
    return t ? t[0] : f32(Math.pow(a, b))
}
