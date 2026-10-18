/** `invert_m4_m4_safe` (`blenlib/intern/math_matrix_c.cc:2902`) on Eigen's inverse (`invert_m4_m4` = `EIG_invert_m4_m4`). */

import {f32} from '../f32'
import {invertMat4} from './eigen'

export function invertM4M4Safe(m: ArrayLike<number>): Float32Array {
    const first = invertMat4(m)
    if (first.success) return first.m
    // Degenerate (e.g. zero scale on an axis): try again with a tweak on the diagonal.
    const tmp = Float32Array.from(m)
    tmp[0] = f32(tmp[0] + f32(1e-8))
    tmp[5] = f32(tmp[5] + f32(1e-8))
    tmp[10] = f32(tmp[10] + f32(1e-8))
    const second = invertMat4(tmp)
    if (second.success) return second.m
    return Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}
