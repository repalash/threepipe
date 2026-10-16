/**
 * Jenkins lookup3 hashes and the hash-to-float helpers - port of `blenlib/intern/noise.cc:31-300`
 * (Blender 5.2.2). Used by Random Value, Distribute Points, Realize Instances ids, the noise textures.
 *
 * Note against the March `proc` port: `uint_to_float_01` (`noise.cc:226`) is
 * `float(k) / float(0xFFFFFFFFu)` - both operands are rounded to float32 first, so the divisor is
 * 2^32 and the numerator loses its low bits. Dividing the exact integer by 0xFFFFFFFF in double, as
 * `proc` did, differs in the last bits.
 */

import {f32, floatAsUint} from './f32'

function rot(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0
}

/** `hash_bit_mix` (`noise.cc:43`) on a 3-element state. */
function mix(s: Uint32Array): void {
    s[0] -= s[2]; s[0] ^= rot(s[2], 4); s[2] += s[1]
    s[1] -= s[0]; s[1] ^= rot(s[0], 6); s[0] += s[2]
    s[2] -= s[1]; s[2] ^= rot(s[1], 8); s[1] += s[0]
    s[0] -= s[2]; s[0] ^= rot(s[2], 16); s[2] += s[1]
    s[1] -= s[0]; s[1] ^= rot(s[0], 19); s[0] += s[2]
    s[2] -= s[1]; s[2] ^= rot(s[1], 4); s[1] += s[0]
}

/** `hash_bit_final` (`noise.cc:63`). */
function final(s: Uint32Array): void {
    s[2] ^= s[1]; s[2] -= rot(s[1], 14)
    s[0] ^= s[2]; s[0] -= rot(s[2], 11)
    s[1] ^= s[0]; s[1] -= rot(s[0], 25)
    s[2] ^= s[1]; s[2] -= rot(s[1], 16)
    s[0] ^= s[2]; s[0] -= rot(s[2], 4)
    s[1] ^= s[0]; s[1] -= rot(s[0], 14)
    s[2] ^= s[1]; s[2] -= rot(s[1], 24)
}

const st = new Uint32Array(3)

/** `noise::hash(uint32_t kx)` (`noise.cc:81`). */
export function hash1(kx: number): number {
    st[0] = st[1] = st[2] = 0xdeadbeef + (1 << 2) + 13
    st[0] += kx >>> 0
    final(st)
    return st[2]
}

/** `noise::hash(uint32_t kx, uint32_t ky)` (`noise.cc:92`). */
export function hash2(kx: number, ky: number): number {
    st[0] = st[1] = st[2] = 0xdeadbeef + (2 << 2) + 13
    st[1] += ky >>> 0
    st[0] += kx >>> 0
    final(st)
    return st[2]
}

/** `noise::hash(uint32_t kx, uint32_t ky, uint32_t kz)` (`noise.cc:104`). */
export function hash3(kx: number, ky: number, kz: number): number {
    st[0] = st[1] = st[2] = 0xdeadbeef + (3 << 2) + 13
    st[2] += kz >>> 0
    st[1] += ky >>> 0
    st[0] += kx >>> 0
    final(st)
    return st[2]
}

/** `noise::hash(uint32_t kx, uint32_t ky, uint32_t kz, uint32_t kw)` (`noise.cc:117`). */
export function hash4(kx: number, ky: number, kz: number, kw: number): number {
    st[0] = st[1] = st[2] = 0xdeadbeef + (4 << 2) + 13
    st[0] += kx >>> 0
    st[1] += ky >>> 0
    st[2] += kz >>> 0
    mix(st)
    st[0] += kw >>> 0
    final(st)
    return st[2]
}

/** `uint_to_float_01` (`noise.cc:226`): `float(k) / float(0xFFFFFFFFu)`. */
export function uintToFloat01(k: number): number {
    return f32(f32(k >>> 0) / 4294967296)
}

export function hashToFloat1(kx: number): number {
    return uintToFloat01(hash1(kx))
}

export function hashToFloat2(kx: number, ky: number): number {
    return uintToFloat01(hash2(kx, ky))
}

export function hashToFloat3(kx: number, ky: number, kz: number): number {
    return uintToFloat01(hash3(kx, ky, kz))
}

export function hashToFloat4(kx: number, ky: number, kz: number, kw: number): number {
    return uintToFloat01(hash4(kx, ky, kz, kw))
}

/** `hash_float(float)` .. `hash_float(float4)` (`noise.cc:198-216`): hashes of the float bits. */
export function hashFloat1(x: number): number {
    return hash1(floatAsUint(x))
}

export function hashFloat2(x: number, y: number): number {
    return hash2(floatAsUint(x), floatAsUint(y))
}

export function hashFloat3(x: number, y: number, z: number): number {
    return hash3(floatAsUint(x), floatAsUint(y), floatAsUint(z))
}

export function hashFloat4(x: number, y: number, z: number, w: number): number {
    return hash4(floatAsUint(x), floatAsUint(y), floatAsUint(z), floatAsUint(w))
}

/** `hash_float_to_float` (`noise.cc:253-271`). */
export function hashFloatToFloat1(x: number): number {
    return uintToFloat01(hashFloat1(x))
}

export function hashFloatToFloat2(x: number, y: number): number {
    return uintToFloat01(hashFloat2(x, y))
}

export function hashFloatToFloat3(x: number, y: number, z: number): number {
    return uintToFloat01(hashFloat3(x, y, z))
}

export function hashFloatToFloat4(x: number, y: number, z: number, w: number): number {
    return uintToFloat01(hashFloat4(x, y, z, w))
}
