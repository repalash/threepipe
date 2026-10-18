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

/** `hash_float_to_float2(float2)` (`noise.cc:274`). */
export function hashFloatToFloat2From2(x: number, y: number): [number, number] {
    return [hashFloatToFloat2(x, y), hashFloatToFloat3(x, y, 1)]
}

/** `hash_float_to_float2(float3)` (`noise.cc:279`). */
export function hashFloatToFloat2From3(x: number, y: number, z: number): [number, number] {
    return [hashFloatToFloat3(x, y, z), hashFloatToFloat3(z, x, y)]
}

/** `hash_float_to_float2(float4)` (`noise.cc:285`). */
export function hashFloatToFloat2From4(x: number, y: number, z: number, w: number): [number, number] {
    return [hashFloatToFloat4(x, y, z, w), hashFloatToFloat4(z, x, w, y)]
}

/** `hash_float_to_float3(float)` (`noise.cc:291`). */
export function hashFloatToFloat3From1(k: number): [number, number, number] {
    return [hashFloatToFloat1(k), hashFloatToFloat2(k, 1), hashFloatToFloat2(k, 2)]
}

/** `hash_float_to_float3(float2)` (`noise.cc:298`). */
export function hashFloatToFloat3From2(x: number, y: number): [number, number, number] {
    return [hashFloatToFloat2(x, y), hashFloatToFloat3(x, y, 1), hashFloatToFloat3(x, y, 2)]
}

/** `hash_float_to_float3(float3)` (`noise.cc:305`). */
export function hashFloatToFloat3From3(x: number, y: number, z: number): [number, number, number] {
    return [hashFloatToFloat3(x, y, z), hashFloatToFloat4(x, y, z, 1), hashFloatToFloat4(x, y, z, 2)]
}

/** `hash_float_to_float3(float4)` (`noise.cc:312`). */
export function hashFloatToFloat3From4(x: number, y: number, z: number, w: number): [number, number, number] {
    return [hashFloatToFloat4(x, y, z, w), hashFloatToFloat4(z, x, w, y), hashFloatToFloat4(w, z, y, x)]
}

/** `hash_float_to_float4(float4)` (`noise.cc:319`). */
export function hashFloatToFloat4From4(x: number, y: number, z: number, w: number): [number, number, number, number] {
    return [hashFloatToFloat4(x, y, z, w), hashFloatToFloat4(w, x, y, z), hashFloatToFloat4(z, w, x, y), hashFloatToFloat4(y, z, w, x)]
}

/*
 * PCG 2D/3D/4D integer hashes (`noise.cc:151-198`, "Hash Functions for GPU Rendering", JCGT 2020), signed
 * 32-bit arithmetic that wraps (`ATTR_NO_SIGNED_INT_OVERFLOW`): `Math.imul` and `| 0`. `v >> 16` on a
 * signed int is an arithmetic shift, as JS `>>` is.
 */

/** `hash_pcg2d_i` (`noise.cc:159`). Writes into and returns `out`. */
export function hashPcg2dI(x: number, y: number, out: number[] = [0, 0]): number[] {
    x = (Math.imul(x, 1664525) + 1013904223) | 0
    y = (Math.imul(y, 1664525) + 1013904223) | 0
    x = (x + Math.imul(y, 1664525)) | 0
    y = (y + Math.imul(x, 1664525)) | 0
    x ^= x >> 16
    y ^= y >> 16
    x = (x + Math.imul(y, 1664525)) | 0
    y = (y + Math.imul(x, 1664525)) | 0
    out[0] = x
    out[1] = y
    return out
}

/** `hash_pcg3d_i` (`noise.cc:171`). */
export function hashPcg3dI(x: number, y: number, z: number, out: number[] = [0, 0, 0]): number[] {
    x = (Math.imul(x, 1664525) + 1013904223) | 0
    y = (Math.imul(y, 1664525) + 1013904223) | 0
    z = (Math.imul(z, 1664525) + 1013904223) | 0
    x = (x + Math.imul(y, z)) | 0
    y = (y + Math.imul(z, x)) | 0
    z = (z + Math.imul(x, y)) | 0
    x ^= x >> 16
    y ^= y >> 16
    z ^= z >> 16
    x = (x + Math.imul(y, z)) | 0
    y = (y + Math.imul(z, x)) | 0
    z = (z + Math.imul(x, y)) | 0
    out[0] = x
    out[1] = y
    out[2] = z
    return out
}

/** `hash_pcg4d_i` (`noise.cc:185`). */
export function hashPcg4dI(x: number, y: number, z: number, w: number, out: number[] = [0, 0, 0, 0]): number[] {
    x = (Math.imul(x, 1664525) + 1013904223) | 0
    y = (Math.imul(y, 1664525) + 1013904223) | 0
    z = (Math.imul(z, 1664525) + 1013904223) | 0
    w = (Math.imul(w, 1664525) + 1013904223) | 0
    x = (x + Math.imul(y, w)) | 0
    y = (y + Math.imul(z, x)) | 0
    z = (z + Math.imul(x, y)) | 0
    w = (w + Math.imul(y, z)) | 0
    x ^= x >> 16
    y ^= y >> 16
    z ^= z >> 16
    w ^= w >> 16
    x = (x + Math.imul(y, w)) | 0
    y = (y + Math.imul(z, x)) | 0
    z = (z + Math.imul(x, y)) | 0
    w = (w + Math.imul(y, z)) | 0
    out[0] = x
    out[1] = y
    out[2] = z
    out[3] = w
    return out
}

/**
 * `int_to_float_01` (`noise.cc:329`): `float(k & 0x7fffffff) * (1.0f / float(0x7fffffff))`.
 * `float(0x7fffffff)` is 2^31, so the factor is exactly 2^-31; the integer is rounded to float first.
 */
export function intToFloat01(k: number): number {
    return f32(f32(k & 0x7fffffff) * 4.656612873077393e-10)
}

const pcgOut = [0, 0, 0, 0]

/** `hash_int2_to_float2` (`noise.cc:334`). */
export function hashInt2ToFloat2(x: number, y: number, out: number[] = [0, 0]): number[] {
    const h = hashPcg2dI(x, y, pcgOut)
    out[0] = intToFloat01(h[0])
    out[1] = intToFloat01(h[1])
    return out
}

/** `hash_int3_to_float3` (`noise.cc:340`). */
export function hashInt3ToFloat3(x: number, y: number, z: number, out: number[] = [0, 0, 0]): number[] {
    const h = hashPcg3dI(x, y, z, pcgOut)
    out[0] = intToFloat01(h[0])
    out[1] = intToFloat01(h[1])
    out[2] = intToFloat01(h[2])
    return out
}

/** `hash_int4_to_float4` (`noise.cc:346`). */
export function hashInt4ToFloat4(x: number, y: number, z: number, w: number, out: number[] = [0, 0, 0, 0]): number[] {
    const h = hashPcg4dI(x, y, z, w, pcgOut)
    out[0] = intToFloat01(h[0])
    out[1] = intToFloat01(h[1])
    out[2] = intToFloat01(h[2])
    out[3] = intToFloat01(h[3])
    return out
}

/** `hash_int2_to_float3` (`noise.cc:353`): `hash_int3_to_float3(int3(k.x, k.y, 0))`. */
export function hashInt2ToFloat3(x: number, y: number, out: number[] = [0, 0, 0]): number[] {
    return hashInt3ToFloat3(x, y, 0, out)
}

/** `hash_int4_to_float3` (`noise.cc:358`): `hash_int4_to_float4(k).xyz()`. */
export function hashInt4ToFloat3(x: number, y: number, z: number, w: number, out: number[] = [0, 0, 0]): number[] {
    const h = hashPcg4dI(x, y, z, w, pcgOut)
    out[0] = intToFloat01(h[0])
    out[1] = intToFloat01(h[1])
    out[2] = intToFloat01(h[2])
    return out
}
