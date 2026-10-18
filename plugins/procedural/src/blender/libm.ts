/**
 * Float inverse trigonometry as the reference platform's libm returns it.
 *
 * Blender is compiled against the platform libm, and the Blender 5.2.2 ground truth comes from macOS arm64
 * (macOS 15.5, libSystem). Measured there (`porting/blender/libm_probe.py`, run on the Blender worker on 2026-10-18):
 * - `acosf(-1) = 3.1415925` (0x40490fda), not the correctly rounded `float(pi) = 3.1415927` (0x40490fdb);
 * - `asinf(+-1) = +-1.5707962` (0x3fc90fda), not `float(pi / 2) = 1.5707964` (`acosf(0)` is 1.5707964);
 * - `atan2f(y, x)` is `+-3.1415925` wherever the correctly rounded result is `+-float(pi)`
 *   (`y = +-0` or tiny with `x < 0`, including `x = -0`).
 * Everywhere else these agree with the correctly rounded value, which is what `f32(Math.xxx(...))` gives. The
 * difference matters: a quaternion built from `acosf(-1)` or `atan2f(0, x < 0)` flips the sign of a near-zero
 * cosine, and code that branches on that sign (`vec_to_quat`) then returns a different rotation.
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

export function acosf(a: number): number {
    const r = f32(Math.acos(a))
    return r === F_PI && apple() ? PI_BELOW : r
}

export function asinf(a: number): number {
    const r = f32(Math.asin(a))
    if (Math.abs(r) === F_HALF_PI && apple()) return r > 0 ? HALF_PI_BELOW : -HALF_PI_BELOW
    return r
}

export function atan2f(y: number, x: number): number {
    const r = f32(Math.atan2(y, x))
    if (Math.abs(r) === F_PI && apple()) return r > 0 ? PI_BELOW : -PI_BELOW
    return r
}
