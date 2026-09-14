/**
 * Port of Blender's Jenkins Lookup3 hash functions from BLI_noise.hh
 *
 * Source: source/blender/blenlib/intern/noise.cc
 * Reference: https://burtleburtle.net/bob/c/lookup3.c
 *
 * These are the hash functions used by Blender's geometry nodes (Random Value,
 * noise textures, etc.) to produce deterministic pseudo-random values.
 */
// source/blender/blenlib/intern/noise.cc — hash_bit_rotate
function hash_bit_rotate(x, k) {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
}
// source/blender/blenlib/intern/noise.cc — hash_bit_final
function hash_bit_final(a, b, c) {
    c = (c ^ b) >>> 0;
    c = (c - hash_bit_rotate(b, 14)) >>> 0;
    a = (a ^ c) >>> 0;
    a = (a - hash_bit_rotate(c, 11)) >>> 0;
    b = (b ^ a) >>> 0;
    b = (b - hash_bit_rotate(a, 25)) >>> 0;
    c = (c ^ b) >>> 0;
    c = (c - hash_bit_rotate(b, 16)) >>> 0;
    a = (a ^ c) >>> 0;
    a = (a - hash_bit_rotate(c, 4)) >>> 0;
    b = (b ^ a) >>> 0;
    b = (b - hash_bit_rotate(a, 14)) >>> 0;
    c = (c ^ b) >>> 0;
    c = (c - hash_bit_rotate(b, 24)) >>> 0;
    return [a, b, c];
}
// source/blender/blenlib/intern/noise.cc — hash(uint32_t kx)
/** Hash a single uint32 to uint32. */
export function hash1(kx) {
    let a, b, c;
    a = b = c = (0xdeadbeef + (1 << 2) + 13) >>> 0;
    a = (a + (kx >>> 0)) >>> 0;
    [a, b, c] = hash_bit_final(a, b, c);
    return c;
}
// source/blender/blenlib/intern/noise.cc — hash(uint32_t kx, uint32_t ky)
/** Hash two uint32s to uint32. */
export function hash2(kx, ky) {
    let a, b, c;
    a = b = c = (0xdeadbeef + (2 << 2) + 13) >>> 0;
    b = (b + (ky >>> 0)) >>> 0;
    a = (a + (kx >>> 0)) >>> 0;
    [a, b, c] = hash_bit_final(a, b, c);
    return c;
}
// source/blender/blenlib/intern/noise.cc — hash(uint32_t kx, uint32_t ky, uint32_t kz)
/** Hash three uint32s to uint32. */
export function hash3(kx, ky, kz) {
    let a, b, c;
    a = b = c = (0xdeadbeef + (3 << 2) + 13) >>> 0;
    c = (c + (kz >>> 0)) >>> 0;
    b = (b + (ky >>> 0)) >>> 0;
    a = (a + (kx >>> 0)) >>> 0;
    [a, b, c] = hash_bit_final(a, b, c);
    return c;
}
// source/blender/blenlib/intern/noise.cc — hash_to_float(uint32_t kx)
/** Hash a single uint32 to float in [0, 1]. */
export function hash_to_float1(kx) {
    return hash1(kx) / 0xFFFFFFFF;
}
// source/blender/blenlib/intern/noise.cc — hash_to_float(uint32_t kx, uint32_t ky)
/** Hash two uint32s to float in [0, 1]. */
export function hash_to_float2(kx, ky) {
    return hash2(kx, ky) / 0xFFFFFFFF;
}
// source/blender/blenlib/intern/noise.cc — hash_to_float(uint32_t kx, uint32_t ky, uint32_t kz)
/** Hash three uint32s to float in [0, 1]. */
export function hash_to_float3(kx, ky, kz) {
    return hash3(kx, ky, kz) / 0xFFFFFFFF;
}
