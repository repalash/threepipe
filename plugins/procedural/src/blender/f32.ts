/**
 * Float32 helpers. Blender evaluates geometry nodes in single precision (`float`), so every value that
 * crosses a node boundary, and every intermediate whose rounding can change a discrete decision (a
 * `floor`, an `int()` cast, a comparison, a hash of the float's bits), is rounded the way C rounds it.
 * See `issues/open/modelling-tools/15-procedural-on-kernel.md` §2.6.
 */

/** Round to the nearest float32, as storing into a C `float` does. */
export const f32 = Math.fround

const scratch = new ArrayBuffer(4)
const scratchF = new Float32Array(scratch)
const scratchU = new Uint32Array(scratch)
const scratchI = new Int32Array(scratch)

/** `float_as_uint` (`blenlib/BLI_math_bits.h`): the bits of a float32 as an unsigned 32-bit integer. */
export function floatAsUint(f: number): number {
    scratchF[0] = f
    return scratchU[0]
}

/** `float_as_int` (`blenlib/BLI_math_bits.h`). */
export function floatAsInt(f: number): number {
    scratchF[0] = f
    return scratchI[0]
}

/** `uint_as_float` (`blenlib/BLI_math_bits.h`). */
export function uintAsFloat(u: number): number {
    scratchU[0] = u >>> 0
    return scratchF[0]
}

/**
 * `std::round` / `roundf`: half away from zero. `Math.round` rounds half up (`Math.round(-2.5) === -2`),
 * which is not what C does.
 */
export function roundHalfAway(x: number): number {
    return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** C `int(x)` cast from a floating value: truncation toward zero, saturating like the hardware does not - callers guard the range. */
export function truncToInt(x: number): number {
    return Math.trunc(x) | 0
}

/**
 * Float to `uint8_t` conversion as C++ does it for in-range values (truncation). Out-of-range is
 * undefined behaviour in C++; Blender's callers only convert values in 0..255.
 */
export function floatToUint8(x: number): number {
    return Math.trunc(x) & 0xff
}
