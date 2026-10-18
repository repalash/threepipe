/**
 * Procedural noise of the texture nodes - port of `blenlib/intern/noise.cc` (Blender 5.2.2):
 * Perlin noise and its fractal variants (`:365-1124`) and Voronoi noise with its fractal form
 * (`:1126-2200`). The hashes are in `./noise.ts`.
 *
 * Every float operation is rounded to float32 in C's order (Blender builds with `-ffp-contract=off`).
 * Where C promotes to `double` (a `1.0`/`6.0` literal, `M_PI`) the expression is evaluated in double
 * and rounded once when C stores it into a `float`, exactly as written in the C++.
 *
 * Positions are passed as plain arrays: length 1 (`float`), 2 (`float2`), 3 (`float3`) or 4 (`float4`).
 */

import {f32} from './f32'
import {
    hash1, hash2, hash3, hash4, hashFloatToFloat1, hashFloatToFloat2, hashFloatToFloat3From1,
    hashInt2ToFloat2, hashInt2ToFloat3, hashInt3ToFloat3, hashInt4ToFloat3, hashInt4ToFloat4,
} from './noise'

/** `FLT_MAX`. */
export const FLT_MAX = 3.4028234663852886e38

/** `std::min<float>` (`(b < a) ? b : a`). */
const stdMin = (a: number, b: number) => (b < a ? b : a)
/** `std::max<float>` (`(a < b) ? b : a`). */
const stdMax = (a: number, b: number) => (a < b ? b : a)
/** `std::clamp` (libstdc++: `v < lo ? lo : hi < v ? hi : v`). */
export const stdClamp = (v: number, lo: number, hi: number) => (v < lo ? lo : hi < v ? hi : v)

/**
 * `powf`: `Math.pow` then rounded, except where C99 Annex F and JS disagree - `pow(1, y)` is 1 for every
 * `y` (also NaN and infinities) and `pow(-1, +-inf)` is 1 in C, NaN in JS.
 */
export function powf(a: number, b: number): number {
    if (a === 1 || (a === -1 && (b === Infinity || b === -Infinity))) return 1
    return f32(Math.pow(a, b))
}

/** C `int(x)` of a floored float (UB out of range in C; callers stay in range). */
const toInt = (x: number) => Math.trunc(x) | 0

/* -------------------------------------------------------------------- */
/* Perlin noise (`noise.cc:365-685`). */

/** `mix(T v0, T v1, float x)` with `T = float` (`noise.cc:376`): `(1 - x) * v0 + x * v1`. */
export function mix1(v0: number, v1: number, x: number): number {
    return f32(f32(f32(1 - x) * v0) + f32(x * v1))
}

/** `mix(T v0, T v1, float x)` for vectors (`noise.cc:376`), into `out` (may alias `v0`). */
export function mixN(v0: ArrayLike<number>, v1: ArrayLike<number>, x: number, out: number[]): number[] {
    const a = f32(1 - x)
    for (let k = 0; k < out.length; k++) out[k] = f32(f32(a * v0[k]) + f32(x * v1[k]))
    return out
}

/**
 * Bilinear `mix` (`noise.cc:391`): `float x1 = 1.0 - x;` then
 * `(1.0 - y) * (v0 * x1 + v1 * x) + y * (v2 * x1 + v3 * x)` - the `1.0 - y` product and the final sum
 * are in double.
 */
function mix2(v0: number, v1: number, v2: number, v3: number, x: number, y: number): number {
    const x1 = f32(1.0 - x)
    const a = f32(f32(v0 * x1) + f32(v1 * x))
    const b = f32(f32(v2 * x1) + f32(v3 * x))
    return f32((1.0 - y) * a + f32(y * b))
}

/** Trilinear `mix` (`noise.cc:415`), all in float after `x1`, `y1`, `z1` are stored. */
function mix3(v0: number, v1: number, v2: number, v3: number, v4: number, v5: number, v6: number, v7: number,
    x: number, y: number, z: number): number {
    const x1 = f32(1.0 - x)
    const y1 = f32(1.0 - y)
    const z1 = f32(1.0 - z)
    const c0 = f32(f32(y1 * f32(f32(v0 * x1) + f32(v1 * x))) + f32(y * f32(f32(v2 * x1) + f32(v3 * x))))
    const c1 = f32(f32(y1 * f32(f32(v4 * x1) + f32(v5 * x))) + f32(y * f32(f32(v6 * x1) + f32(v7 * x))))
    return f32(f32(z1 * c0) + f32(z * c1))
}

/** `fade` (`noise.cc:461`): `t * t * t * (t * (t * 6.0 - 15.0) + 10.0)`, the second factor in double. */
export function fade(t: number): number {
    return f32(f32(f32(t * t) * t) * (t * (t * 6.0 - 15.0) + 10.0))
}

/** `negate_if` (`noise.cc:466`). */
const negateIf = (value: number, condition: number) => (condition !== 0 ? -value : value)

/** `noise_grad(uint32_t hash, float x)` (`noise.cc:471`). */
function noiseGrad1(hash: number, x: number): number {
    const h = hash & 15
    const g = 1 + (h & 7)
    return f32(negateIf(g, h & 8) * x)
}

/** `noise_grad(hash, x, y)` (`noise.cc:478`). */
function noiseGrad2(hash: number, x: number, y: number): number {
    const h = hash & 7
    const u = h < 4 ? x : y
    const v = f32(2.0 * (h < 4 ? y : x))
    return f32(negateIf(u, h & 1) + negateIf(v, h & 2))
}

/** `noise_grad(hash, x, y, z)` (`noise.cc:486`). */
function noiseGrad3(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15
    const u = h < 8 ? x : y
    const vt = h === 12 || h === 14 ? x : z
    const v = h < 4 ? y : vt
    return f32(negateIf(u, h & 1) + negateIf(v, h & 2))
}

/** `noise_grad(hash, x, y, z, w)` (`noise.cc:495`). */
function noiseGrad4(hash: number, x: number, y: number, z: number, w: number): number {
    const h = hash & 31
    const u = h < 24 ? x : y
    const v = h < 16 ? y : z
    const s = h < 8 ? z : w
    return f32(f32(negateIf(u, h & 1) + negateIf(v, h & 2)) + negateIf(s, h & 4))
}

/** `perlin_noise(float)` (`noise.cc:511`), with `floor_fraction` (`:504`) inlined. */
function perlinNoise1(px: number): number {
    const xf = Math.floor(px)
    const X = toInt(xf)
    const fx = f32(px - xf)
    const u = fade(fx)
    return mix1(noiseGrad1(hash1(X), fx), noiseGrad1(hash1(X + 1), f32(fx - 1.0)), u)
}

/** `perlin_noise(float2)` (`noise.cc:524`). */
function perlinNoise2(px: number, py: number): number {
    const xf = Math.floor(px), yf = Math.floor(py)
    const X = toInt(xf), Y = toInt(yf)
    const fx = f32(px - xf), fy = f32(py - yf)
    const u = fade(fx), v = fade(fy)
    const fx1 = f32(fx - 1.0), fy1 = f32(fy - 1.0)
    return mix2(
        noiseGrad2(hash2(X, Y), fx, fy),
        noiseGrad2(hash2(X + 1, Y), fx1, fy),
        noiseGrad2(hash2(X, Y + 1), fx, fy1),
        noiseGrad2(hash2(X + 1, Y + 1), fx1, fy1),
        u, v)
}

/** `perlin_noise(float3)` (`noise.cc:544`). */
function perlinNoise3(px: number, py: number, pz: number): number {
    const xf = Math.floor(px), yf = Math.floor(py), zf = Math.floor(pz)
    const X = toInt(xf), Y = toInt(yf), Z = toInt(zf)
    const fx = f32(px - xf), fy = f32(py - yf), fz = f32(pz - zf)
    const u = fade(fx), v = fade(fy), w = fade(fz)
    const fx1 = f32(fx - 1), fy1 = f32(fy - 1), fz1 = f32(fz - 1)
    return mix3(
        noiseGrad3(hash3(X, Y, Z), fx, fy, fz),
        noiseGrad3(hash3(X + 1, Y, Z), fx1, fy, fz),
        noiseGrad3(hash3(X, Y + 1, Z), fx, fy1, fz),
        noiseGrad3(hash3(X + 1, Y + 1, Z), fx1, fy1, fz),
        noiseGrad3(hash3(X, Y, Z + 1), fx, fy, fz1),
        noiseGrad3(hash3(X + 1, Y, Z + 1), fx1, fy, fz1),
        noiseGrad3(hash3(X, Y + 1, Z + 1), fx, fy1, fz1),
        noiseGrad3(hash3(X + 1, Y + 1, Z + 1), fx1, fy1, fz1),
        u, v, w)
}

/** `perlin_noise(float4)` (`noise.cc:571`): quadrilinear `mix` (`:435`) = `mix(mix3(..), mix3(..), w)`. */
function perlinNoise4(px: number, py: number, pz: number, pw: number): number {
    const xf = Math.floor(px), yf = Math.floor(py), zf = Math.floor(pz), wf = Math.floor(pw)
    const X = toInt(xf), Y = toInt(yf), Z = toInt(zf), W = toInt(wf)
    const fx = f32(px - xf), fy = f32(py - yf), fz = f32(pz - zf), fw = f32(pw - wf)
    const u = fade(fx), v = fade(fy), t = fade(fz), s = fade(fw)
    const fx1 = f32(fx - 1.0), fy1 = f32(fy - 1.0), fz1 = f32(fz - 1.0), fw1 = f32(fw - 1.0)
    const a = mix3(
        noiseGrad4(hash4(X, Y, Z, W), fx, fy, fz, fw),
        noiseGrad4(hash4(X + 1, Y, Z, W), fx1, fy, fz, fw),
        noiseGrad4(hash4(X, Y + 1, Z, W), fx, fy1, fz, fw),
        noiseGrad4(hash4(X + 1, Y + 1, Z, W), fx1, fy1, fz, fw),
        noiseGrad4(hash4(X, Y, Z + 1, W), fx, fy, fz1, fw),
        noiseGrad4(hash4(X + 1, Y, Z + 1, W), fx1, fy, fz1, fw),
        noiseGrad4(hash4(X, Y + 1, Z + 1, W), fx, fy1, fz1, fw),
        noiseGrad4(hash4(X + 1, Y + 1, Z + 1, W), fx1, fy1, fz1, fw),
        u, v, t)
    const b = mix3(
        noiseGrad4(hash4(X, Y, Z, W + 1), fx, fy, fz, fw1),
        noiseGrad4(hash4(X + 1, Y, Z, W + 1), fx1, fy, fz, fw1),
        noiseGrad4(hash4(X, Y + 1, Z, W + 1), fx, fy1, fz, fw1),
        noiseGrad4(hash4(X + 1, Y + 1, Z, W + 1), fx1, fy1, fz, fw1),
        noiseGrad4(hash4(X, Y, Z + 1, W + 1), fx, fy, fz1, fw1),
        noiseGrad4(hash4(X + 1, Y, Z + 1, W + 1), fx1, fy, fz1, fw1),
        noiseGrad4(hash4(X, Y + 1, Z + 1, W + 1), fx, fy1, fz1, fw1),
        noiseGrad4(hash4(X + 1, Y + 1, Z + 1, W + 1), fx1, fy1, fz1, fw1),
        u, v, t)
    return mix1(a, b, s)
}

/**
 * `perlin_signed` precision handling (`noise.cc:613-660`): add 0.5 to components with
 * `|p| >= 1000000`, after `math::mod(p, 100000.0f)` (`std::fmod`, exact, JS `%`).
 */
const precisionWrap = (p: number) => f32(f32(p % 100000.0) + (Math.abs(p) >= 1000000.0 ? 0.5 : 0))

const SCALE_2D = f32(0.6616)
const SCALE_3D = f32(0.9820)
const SCALE_4D = f32(0.8344)

/** `perlin_signed(float)` .. `perlin_signed(float4)` (`noise.cc:613`, `:623`, `:635`, `:648`): range [-1, 1]. */
export function perlinSigned(p: ArrayLike<number>): number {
    switch (p.length) {
    case 1: return f32(perlinNoise1(precisionWrap(p[0])) * 0.25)
    case 2: return f32(perlinNoise2(precisionWrap(p[0]), precisionWrap(p[1])) * SCALE_2D)
    case 3: return f32(perlinNoise3(precisionWrap(p[0]), precisionWrap(p[1]), precisionWrap(p[2])) * SCALE_3D)
    case 4: return f32(perlinNoise4(precisionWrap(p[0]), precisionWrap(p[1]), precisionWrap(p[2]), precisionWrap(p[3])) * SCALE_4D)
    default: throw new Error(`procedural: perlin noise of dimension ${p.length}`)
    }
}

/** `perlin(float..float4)` (`noise.cc:664-682`): `perlin_signed(p) / 2.0f + 0.5f`, range [0, 1]. */
export function perlin(p: ArrayLike<number>): number {
    return f32(f32(perlinSigned(p) / 2) + 0.5)
}

/** `s * p` for a float times a vector, rounded per component. */
function scaled(p: ArrayLike<number>, s: number): number[] {
    const out = new Array<number>(p.length)
    for (let k = 0; k < p.length; k++) out[k] = f32(s * p[k])
    return out
}

function scaleInPlace(p: number[], s: number): void {
    for (let k = 0; k < p.length; k++) p[k] = f32(p[k] * s)
}

/** `perlin_fbm` (`noise.cc:687`). */
export function perlinFbm(p: ArrayLike<number>, detail: number, roughness: number, lacunarity: number, normalize: boolean): number {
    let fscale = 1
    let amp = 1
    let maxamp = 0
    let sum = 0
    const n = toInt(detail)
    for (let i = 0; i <= n; i++) {
        const t = perlinSigned(scaled(p, fscale))
        sum = f32(sum + f32(t * amp))
        maxamp = f32(maxamp + amp)
        amp = f32(amp * roughness)
        fscale = f32(fscale * lacunarity)
    }
    const rmd = f32(detail - Math.floor(detail))
    if (rmd !== 0) {
        const t = perlinSigned(scaled(p, fscale))
        const sum2 = f32(sum + f32(t * amp))
        return normalize
            ? mix1(f32(f32(f32(0.5 * sum) / maxamp) + 0.5), f32(f32(f32(0.5 * sum2) / f32(maxamp + amp)) + 0.5), rmd)
            : mix1(sum, sum2, rmd)
    }
    return normalize ? f32(f32(f32(0.5 * sum) / maxamp) + 0.5) : sum
}

/** `perlin_multi_fractal` (`noise.cc:736`). */
export function perlinMultiFractal(pIn: ArrayLike<number>, detail: number, roughness: number, lacunarity: number): number {
    const p = Array.from(pIn)
    let value = 1
    let pwr = 1
    const n = toInt(detail)
    for (let i = 0; i <= n; i++) {
        value = f32(value * f32(f32(pwr * perlinSigned(p)) + 1))
        pwr = f32(pwr * roughness)
        scaleInPlace(p, lacunarity)
    }
    const rmd = f32(detail - Math.floor(detail))
    if (rmd !== 0) {
        value = f32(value * f32(f32(f32(rmd * pwr) * perlinSigned(p)) + 1))
    }
    return value
}

/** `perlin_hetero_terrain` (`noise.cc:756`). */
export function perlinHeteroTerrain(pIn: ArrayLike<number>, detail: number, roughness: number, lacunarity: number, offset: number): number {
    const p = Array.from(pIn)
    let pwr = roughness
    let value = f32(offset + perlinSigned(p))
    scaleInPlace(p, lacunarity)
    const n = toInt(detail)
    for (let i = 1; i <= n; i++) {
        const increment = f32(f32(f32(perlinSigned(p) + offset) * pwr) * value)
        value = f32(value + increment)
        pwr = f32(pwr * roughness)
        scaleInPlace(p, lacunarity)
    }
    const rmd = f32(detail - Math.floor(detail))
    if (rmd !== 0) {
        const increment = f32(f32(f32(perlinSigned(p) + offset) * pwr) * value)
        value = f32(value + f32(rmd * increment))
    }
    return value
}

const F_0_001 = f32(0.001)

/** `perlin_hybrid_multi_fractal` (`noise.cc:782`). */
export function perlinHybridMultiFractal(pIn: ArrayLike<number>, detail: number, roughness: number, lacunarity: number, offset: number, gain: number): number {
    const p = Array.from(pIn)
    let pwr = 1
    let value = 0
    let weight = 1
    const n = toInt(detail)
    for (let i = 0; weight > F_0_001 && i <= n; i++) {
        weight = stdMin(weight, 1)
        const signal = f32(f32(perlinSigned(p) + offset) * pwr)
        pwr = f32(pwr * roughness)
        value = f32(value + f32(weight * signal))
        weight = f32(weight * f32(gain * signal))
        scaleInPlace(p, lacunarity)
    }
    const rmd = f32(detail - Math.floor(detail))
    if (rmd !== 0 && weight > F_0_001) {
        weight = stdMin(weight, 1)
        const signal = f32(f32(perlinSigned(p) + offset) * pwr)
        value = f32(value + f32(f32(rmd * weight) * signal))
    }
    return value
}

/** `perlin_ridged_multi_fractal` (`noise.cc:814`). */
export function perlinRidgedMultiFractal(pIn: ArrayLike<number>, detail: number, roughness: number, lacunarity: number, offset: number, gain: number): number {
    const p = Array.from(pIn)
    let pwr = roughness
    let signal = f32(offset - Math.abs(perlinSigned(p)))
    signal = f32(signal * signal)
    let value = signal
    let weight = 1
    const n = toInt(detail)
    for (let i = 1; i <= n; i++) {
        scaleInPlace(p, lacunarity)
        weight = stdClamp(f32(signal * gain), 0, 1)
        signal = f32(offset - Math.abs(perlinSigned(p)))
        signal = f32(signal * signal)
        signal = f32(signal * weight)
        value = f32(value + f32(signal * pwr))
        pwr = f32(pwr * roughness)
    }
    return value
}

/** `NOISE_SHD_PERLIN_*` (`noise.cc:843`), equal to `SHD_NOISE_*` (`DNA_node_types.h:587`). */
export const NOISE_TYPE = {MULTIFRACTAL: 0, FBM: 1, HYBRID_MULTIFRACTAL: 2, RIDGED_MULTIFRACTAL: 3, HETERO_TERRAIN: 4} as const

/** `perlin_select` (`noise.cc:850`). */
export function perlinSelect(p: ArrayLike<number>, detail: number, roughness: number, lacunarity: number, offset: number,
    gain: number, type: number, normalize: boolean): number {
    switch (type) {
    case NOISE_TYPE.MULTIFRACTAL: return perlinMultiFractal(p, detail, roughness, lacunarity)
    case NOISE_TYPE.FBM: return perlinFbm(p, detail, roughness, lacunarity, normalize)
    case NOISE_TYPE.HYBRID_MULTIFRACTAL: return perlinHybridMultiFractal(p, detail, roughness, lacunarity, offset, gain)
    case NOISE_TYPE.RIDGED_MULTIFRACTAL: return perlinRidgedMultiFractal(p, detail, roughness, lacunarity, offset, gain)
    case NOISE_TYPE.HETERO_TERRAIN: return perlinHeteroTerrain(p, detail, roughness, lacunarity, offset)
    default: return 0
    }
}

/** `random_float_offset` (`noise.cc:889`): `100.0f + hash_float_to_float(seed) * 100.0f`. */
export function randomFloatOffset(seed: number): number {
    return f32(100 + f32(hashFloatToFloat1(seed) * 100))
}

/**
 * `random_float2_offset` .. `random_float4_offset` (`noise.cc:894-915`): component `k` is
 * `100.0f + hash_float_to_float(float2(seed, k)) * 100.0f`.
 */
export function randomFloatNOffset(seed: number, n: number): number[] {
    const out = new Array<number>(n)
    for (let k = 0; k < n; k++) out[k] = f32(100 + f32(hashFloatToFloat2(seed, k) * 100))
    return out
}

/** The seeds are constants in the C++; the offsets are computed once. */
const OFFSETS: number[][][] = [[], [], [], [], []]
function offsetFor(n: number, seed: number): number[] {
    const table = OFFSETS[n]
    let o = table[seed]
    if (!o) table[seed] = o = n === 1 ? [randomFloatOffset(seed)] : randomFloatNOffset(seed, n)
    return o
}

function added(p: ArrayLike<number>, o: ArrayLike<number>): number[] {
    const out = new Array<number>(p.length)
    for (let k = 0; k < p.length; k++) out[k] = f32(p[k] + o[k])
    return out
}

/**
 * `perlin_distortion` (`noise.cc:917-943`): component `k` is
 * `perlin_signed(position + random_floatN_offset(k)) * strength` (1D: `random_float_offset(0.0)`).
 */
export function perlinDistortion(p: ArrayLike<number>, strength: number): number[] {
    const n = p.length
    const out = new Array<number>(n)
    for (let k = 0; k < n; k++) out[k] = f32(perlinSigned(added(p, offsetFor(n, k))) * strength)
    return out
}

/** `perlin_fractal_distorted` (`noise.cc:945`). */
export function perlinFractalDistorted(position: ArrayLike<number>, detail: number, roughness: number, lacunarity: number,
    offset: number, gain: number, distortion: number, type: number, normalize: boolean): number {
    const p = added(position, perlinDistortion(position, distortion))
    return perlinSelect(p, detail, roughness, lacunarity, offset, gain, type, normalize)
}

/** Seeds of the second and third channel of `perlin_float3_fractal_distorted` per dimension (`noise.cc:1000-1124`). */
const COLOR_SEEDS: Record<number, [number, number]> = {1: [1, 2], 2: [2, 3], 3: [3, 4], 4: [4, 5]}

/** `perlin_float3_fractal_distorted` (`noise.cc:1000`, `:1031`, `:1062`, `:1093`). */
export function perlinFloat3FractalDistorted(position: ArrayLike<number>, detail: number, roughness: number, lacunarity: number,
    offset: number, gain: number, distortion: number, type: number, normalize: boolean): [number, number, number] {
    const n = position.length
    const p = added(position, perlinDistortion(position, distortion))
    const [s1, s2] = COLOR_SEEDS[n]
    return [
        perlinSelect(p, detail, roughness, lacunarity, offset, gain, type, normalize),
        perlinSelect(added(p, offsetFor(n, s1)), detail, roughness, lacunarity, offset, gain, type, normalize),
        perlinSelect(added(p, offsetFor(n, s2)), detail, roughness, lacunarity, offset, gain, type, normalize),
    ]
}

/* -------------------------------------------------------------------- */
/* Voronoi noise (`noise.cc:1126-2200`). */

/** `NOISE_SHD_VORONOI_*` metrics (`noise.cc:1148`), equal to `SHD_VORONOI_*` (`DNA_node_types.h:562`). */
export const VORONOI_METRIC = {EUCLIDEAN: 0, MANHATTAN: 1, CHEBYCHEV: 2, MINKOWSKI: 3} as const
/** `NOISE_SHD_VORONOI_*` features (`noise.cc:1155`), equal to `SHD_VORONOI_*` (`DNA_node_types.h:569`). */
export const VORONOI_FEATURE = {F1: 0, F2: 1, SMOOTH_F1: 2, DISTANCE_TO_EDGE: 3, N_SPHERE_RADIUS: 4} as const

/** `VoronoiParams` (`BLI_noise.hh:146`). */
export interface VoronoiParams {
    scale: number
    detail: number
    roughness: number
    lacunarity: number
    smoothness: number
    exponent: number
    randomness: number
    max_distance: number
    normalize: boolean
    feature: number
    metric: number
}

/** `VoronoiOutput` (`BLI_noise.hh:160`). */
export interface VoronoiOutput {
    distance: number
    color: number[]
    position: number[]
}

const newOutput = (): VoronoiOutput => ({distance: 0, color: [0, 0, 0], position: [0, 0, 0, 0]})

/** `math::dot` (`BLI_math_vector.hh:425`): `a[0]*b[0]`, then `+= a[i]*b[i]`. */
function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let r = f32(a[0] * b[0])
    for (let i = 1; i < a.length; i++) r = f32(r + f32(a[i] * b[i]))
    return r
}

/** `math::length_squared(a - b)`. */
function distanceSquared(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let d = f32(a[0] - b[0])
    let r = f32(d * d)
    for (let i = 1; i < a.length; i++) {
        d = f32(a[i] - b[i])
        r = f32(r + f32(d * d))
    }
    return r
}

/** `voronoi_distance(float, float)` (`noise.cc:1165`). */
export function voronoiDistance1(a: number, b: number): number {
    return Math.abs(f32(b - a))
}

/** `voronoi_distance(float2..float4, params)` (`noise.cc:1170`, `:1190`, `:1211`). */
export function voronoiDistance(a: ArrayLike<number>, b: ArrayLike<number>, metric: number, exponent: number): number {
    const n = a.length
    switch (metric) {
    case VORONOI_METRIC.EUCLIDEAN:
        // `math::distance` = `math::sqrt(length_squared(a - b))` (`BLI_math_vector.hh:451`, `:480`).
        return f32(Math.sqrt(distanceSquared(a, b)))
    case VORONOI_METRIC.MANHATTAN: {
        let r = Math.abs(f32(a[0] - b[0]))
        for (let i = 1; i < n; i++) r = f32(r + Math.abs(f32(a[i] - b[i])))
        return r
    }
    case VORONOI_METRIC.CHEBYCHEV: {
        // `std::max(a, b)` and `std::max({...})` keep the first of equal values (`a < b ? b : a`).
        let r = Math.abs(f32(a[0] - b[0]))
        for (let i = 1; i < n; i++) r = stdMax(r, Math.abs(f32(a[i] - b[i])))
        return r
    }
    case VORONOI_METRIC.MINKOWSKI: {
        // `std::pow(float, float)` is `powf`.
        let r = powf(Math.abs(f32(a[0] - b[0])), exponent)
        for (let i = 1; i < n; i++) r = f32(r + powf(Math.abs(f32(a[i] - b[i])), exponent))
        return powf(r, f32(1 / exponent))
    }
    default:
        return 0
    }
}

/** `voronoi_distance_bound` (`noise.cc:1236`). */
function voronoiDistanceBound(a: ArrayLike<number>, b: ArrayLike<number>, params: VoronoiParams): number {
    if (params.metric === VORONOI_METRIC.EUCLIDEAN) return distanceSquared(a, b)
    return voronoiDistance(a, b, params.metric, params.exponent)
}

/* ---- 1D Voronoi (`noise.cc:1245-1405`) ---- */

/** `voronoi_position(float)` (`noise.cc:1247`). */
const position1 = (coord: number) => [0, 0, 0, coord]

/** `cellOffset + hash_float_to_float(cellPosition + cellOffset) * params.randomness`. */
const point1 = (cellPosition: number, cellOffset: number, randomness: number) =>
    f32(cellOffset + f32(hashFloatToFloat1(f32(cellPosition + cellOffset)) * randomness))

/** `voronoi_f1(params, float)` (`noise.cc:1252`). */
export function voronoiF1_1(params: VoronoiParams, coord: number): VoronoiOutput {
    const cellPosition = Math.floor(coord)
    const localPosition = f32(coord - cellPosition)
    let minDistance = FLT_MAX
    let targetOffset = 0
    let targetPosition = 0
    for (let i = -1; i <= 1; i++) {
        const cellOffset = i
        const pointPosition = point1(cellPosition, cellOffset, params.randomness)
        const distanceToPoint = voronoiDistance1(pointPosition, localPosition)
        if (distanceToPoint < minDistance) {
            targetOffset = cellOffset
            minDistance = distanceToPoint
            targetPosition = pointPosition
        }
    }
    return {
        distance: minDistance,
        color: hashFloatToFloat3From1(f32(cellPosition + targetOffset)),
        position: position1(f32(targetPosition + cellPosition)),
    }
}

/** `smoothstep` (`math_base_inline.cc:339`) with `edge0 = 0`, `edge1 = 1`. */
function smoothstep01(x: number): number {
    if (x < 0) return 0
    if (x >= 1) return 1
    const t = x // `(x - 0.0f) / (1.0f - 0.0f)` is exact.
    return f32(f32(3 - f32(2 * t)) * f32(t * t))
}

/**
 * The smooth weight of `voronoi_smooth_f1` (`noise.cc:1296`):
 * `h == -1 ? 1 : smoothstep(0, 1, 0.5f + 0.5f * (smoothDistance - distanceToPoint) / smoothness)`.
 */
function smoothH(h: number, smoothDistance: number, distanceToPoint: number, smoothness: number): number {
    return h === -1 ? 1 : smoothstep01(f32(0.5 + f32(f32(0.5 * f32(smoothDistance - distanceToPoint)) / smoothness)))
}

/** `voronoi_smooth_f1(params, float, calc_color)` (`noise.cc:1279`). */
export function voronoiSmoothF1_1(params: VoronoiParams, coord: number, calcColor: boolean): VoronoiOutput {
    const cellPosition = Math.floor(coord)
    const localPosition = f32(coord - cellPosition)
    const s = params.smoothness
    let smoothDistance = 0
    let smoothPosition = 0
    const smoothColor = [0, 0, 0]
    let h = -1
    for (let i = -2; i <= 2; i++) {
        const cellOffset = i
        const pointPosition = point1(cellPosition, cellOffset, params.randomness)
        const distanceToPoint = voronoiDistance1(pointPosition, localPosition)
        h = smoothH(h, smoothDistance, distanceToPoint, s)
        let correctionFactor = f32(f32(s * h) * f32(1 - h))
        smoothDistance = f32(mix1(smoothDistance, distanceToPoint, h) - correctionFactor)
        correctionFactor = f32(correctionFactor / f32(1 + f32(3 * s)))
        if (calcColor) {
            const cellColor = hashFloatToFloat3From1(f32(cellPosition + cellOffset))
            mixN(smoothColor, cellColor, h, smoothColor)
            for (let k = 0; k < 3; k++) smoothColor[k] = f32(smoothColor[k] - correctionFactor)
        }
        smoothPosition = f32(mix1(smoothPosition, pointPosition, h) - correctionFactor)
    }
    return {distance: smoothDistance, color: smoothColor, position: position1(f32(cellPosition + smoothPosition))}
}

/** `voronoi_f2(params, float)` (`noise.cc:1317`). */
export function voronoiF2_1(params: VoronoiParams, coord: number): VoronoiOutput {
    const cellPosition = Math.floor(coord)
    const localPosition = f32(coord - cellPosition)
    let distanceF1 = FLT_MAX
    let distanceF2 = FLT_MAX
    let offsetF1 = 0
    let positionF1 = 0
    let offsetF2 = 0
    let positionF2 = 0
    for (let i = -1; i <= 1; i++) {
        const cellOffset = i
        const pointPosition = point1(cellPosition, cellOffset, params.randomness)
        const distanceToPoint = voronoiDistance1(pointPosition, localPosition)
        if (distanceToPoint < distanceF1) {
            distanceF2 = distanceF1
            distanceF1 = distanceToPoint
            offsetF2 = offsetF1
            offsetF1 = cellOffset
            positionF2 = positionF1
            positionF1 = pointPosition
        } else if (distanceToPoint < distanceF2) {
            distanceF2 = distanceToPoint
            offsetF2 = cellOffset
            positionF2 = pointPosition
        }
    }
    return {
        distance: distanceF2,
        color: hashFloatToFloat3From1(f32(cellPosition + offsetF2)),
        position: position1(f32(positionF2 + cellPosition)),
    }
}

/** `voronoi_distance_to_edge(params, float)` (`noise.cc:1355`). */
export function voronoiDistanceToEdge1(params: VoronoiParams, coord: number): number {
    const cellPosition = Math.floor(coord)
    const localPosition = f32(coord - cellPosition)
    const r = params.randomness
    const midPointPosition = f32(hashFloatToFloat1(cellPosition) * r)
    const leftPointPosition = f32(-1 + f32(hashFloatToFloat1(f32(cellPosition - 1)) * r))
    const rightPointPosition = f32(1 + f32(hashFloatToFloat1(f32(cellPosition + 1)) * r))
    const distanceToMidLeft = Math.abs(f32(f32(f32(midPointPosition + leftPointPosition) / 2) - localPosition))
    const distanceToMidRight = Math.abs(f32(f32(f32(midPointPosition + rightPointPosition) / 2) - localPosition))
    return stdMin(distanceToMidLeft, distanceToMidRight)
}

/** `voronoi_n_sphere_radius(params, float)` (`noise.cc:1369`). */
export function voronoiNSphereRadius1(params: VoronoiParams, coord: number): number {
    const cellPosition = Math.floor(coord)
    const localPosition = f32(coord - cellPosition)
    let closestPoint = 0
    let closestPointOffset = 0
    let minDistance = FLT_MAX
    for (let i = -1; i <= 1; i++) {
        const cellOffset = i
        const pointPosition = point1(cellPosition, cellOffset, params.randomness)
        const distanceToPoint = Math.abs(f32(pointPosition - localPosition))
        if (distanceToPoint < minDistance) {
            minDistance = distanceToPoint
            closestPoint = pointPosition
            closestPointOffset = cellOffset
        }
    }
    minDistance = FLT_MAX
    let closestPointToClosestPoint = 0
    for (let i = -1; i <= 1; i++) {
        if (i === 0) continue
        const cellOffset = f32(i + closestPointOffset)
        const pointPosition = point1(cellPosition, cellOffset, params.randomness)
        const distanceToPoint = Math.abs(f32(closestPoint - pointPosition))
        if (distanceToPoint < minDistance) {
            minDistance = distanceToPoint
            closestPointToClosestPoint = pointPosition
        }
    }
    return f32(Math.abs(f32(closestPointToClosestPoint - closestPoint)) / 2)
}

/* ---- 2D-4D Voronoi (`noise.cc:1408-2074`) ----
 * The 2D, 3D and 4D functions are the same code over `int2/float2` .. `int4/float4`, with the loops
 * nested so that `i` (x) is innermost, then `j`, `k`, `u`. They are written once over the dimension. */

/** `hash_int{2,3,4}_to_float{2,3,4}` of the cell `c` (`noise.cc:334-350`), into `out`. */
function hashCellPoint(c: ArrayLike<number>, out: number[]): number[] {
    switch (c.length) {
    case 2: return hashInt2ToFloat2(c[0], c[1], out)
    case 3: return hashInt3ToFloat3(c[0], c[1], c[2], out)
    default: return hashInt4ToFloat4(c[0], c[1], c[2], c[3], out)
    }
}

/** The cell colour: `hash_int2_to_float3` / `hash_int3_to_float3` / `hash_int4_to_float3` (`noise.cc:340-361`). */
function hashCellColor(c: ArrayLike<number>): number[] {
    switch (c.length) {
    case 2: return hashInt2ToFloat3(c[0], c[1])
    case 3: return hashInt3ToFloat3(c[0], c[1], c[2])
    default: return hashInt4ToFloat3(c[0], c[1], c[2], c[3])
    }
}

/** `voronoi_position(float2..float4)` (`noise.cc:1410`, `:1615`, `:1834`). */
function positionN(coord: ArrayLike<number>): number[] {
    const out = [0, 0, 0, 0]
    for (let k = 0; k < coord.length; k++) out[k] = coord[k]
    return out
}

/** Iterate the `(2 r + 1)^n` cell offsets in C's loop order (x innermost). */
function forEachOffset(n: number, r: number, f: (off: number[]) => void): void {
    const off = new Array<number>(n).fill(-r)
    for (;;) {
        f(off)
        let k = 0
        while (k < n && off[k] === r) off[k++] = -r
        if (k === n) return
        off[k]++
    }
}

/** Shared prologue: `cellPosition_f = math::floor(coord)`, `localPosition`, `int(cellPosition_f)`. */
function cellOf(coord: ArrayLike<number>) {
    const n = coord.length
    const cellPositionF = new Array<number>(n)
    const localPosition = new Array<number>(n)
    const cellPosition = new Array<number>(n)
    for (let k = 0; k < n; k++) {
        cellPositionF[k] = Math.floor(coord[k])
        localPosition[k] = f32(coord[k] - cellPositionF[k])
        cellPosition[k] = toInt(cellPositionF[k])
    }
    return {cellPositionF, localPosition, cellPosition}
}

/**
 * `float(cellOffset) + hash_intN_to_floatN(cellPosition + cellOffset) * params.randomness` into
 * `point`. `cell` is scratch for the summed integer cell.
 */
function pointAt(cellPosition: number[], cellOffset: ArrayLike<number>, randomness: number, cell: number[], hashed: number[], point: number[]): number[] {
    for (let k = 0; k < cell.length; k++) cell[k] = (cellPosition[k] + cellOffset[k]) | 0
    hashCellPoint(cell, hashed)
    for (let k = 0; k < cell.length; k++) point[k] = f32(cellOffset[k] + f32(hashed[k] * randomness))
    return point
}

function cellSum(cellPosition: number[], offset: ArrayLike<number>): number[] {
    return cellPosition.map((c, k) => (c + offset[k]) | 0)
}

function addVec(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
    const out = new Array<number>(a.length)
    for (let k = 0; k < a.length; k++) out[k] = f32(a[k] + b[k])
    return out
}

/** `voronoi_f1(params, float2..float4)` (`noise.cc:1415`, `:1620`, `:1839`). */
export function voronoiF1N(params: VoronoiParams, coord: ArrayLike<number>): VoronoiOutput {
    const n = coord.length
    const {cellPositionF, localPosition, cellPosition} = cellOf(coord)
    let minDistance = FLT_MAX
    let targetOffset = new Array<number>(n).fill(0)
    let targetPosition = new Array<number>(n).fill(0)
    const cell = new Array<number>(n), hashed = new Array<number>(n), point = new Array<number>(n)
    forEachOffset(n, 1, off => {
        pointAt(cellPosition, off, params.randomness, cell, hashed, point)
        const distanceToPoint = voronoiDistanceBound(point, localPosition, params)
        if (distanceToPoint < minDistance) {
            targetOffset = off.slice()
            minDistance = distanceToPoint
            targetPosition = point.slice()
        }
    })
    return {
        distance: voronoiDistance(targetPosition, localPosition, params.metric, params.exponent),
        color: hashCellColor(cellSum(cellPosition, targetOffset)),
        position: positionN(addVec(targetPosition, cellPositionF)),
    }
}

/** `voronoi_smooth_f1(params, float2..float4, calc_color)` (`noise.cc:1445`, `:1652`, `:1874`). */
export function voronoiSmoothF1N(params: VoronoiParams, coord: ArrayLike<number>, calcColor: boolean): VoronoiOutput {
    const n = coord.length
    const {cellPositionF, localPosition, cellPosition} = cellOf(coord)
    const s = params.smoothness
    let smoothDistance = 0
    const smoothColor = [0, 0, 0]
    const smoothPosition = new Array<number>(n).fill(0)
    let h = -1
    const cell = new Array<number>(n), hashed = new Array<number>(n), point = new Array<number>(n)
    forEachOffset(n, 2, off => {
        pointAt(cellPosition, off, params.randomness, cell, hashed, point)
        const distanceToPoint = voronoiDistance(point, localPosition, params.metric, params.exponent)
        h = smoothH(h, smoothDistance, distanceToPoint, s)
        let correctionFactor = f32(f32(s * h) * f32(1 - h))
        smoothDistance = f32(mix1(smoothDistance, distanceToPoint, h) - correctionFactor)
        correctionFactor = f32(correctionFactor / f32(1 + f32(3 * s)))
        if (calcColor) {
            const cellColor = hashCellColor(cell)
            mixN(smoothColor, cellColor, h, smoothColor)
            for (let k = 0; k < 3; k++) smoothColor[k] = f32(smoothColor[k] - correctionFactor)
        }
        mixN(smoothPosition, point, h, smoothPosition)
        for (let k = 0; k < n; k++) smoothPosition[k] = f32(smoothPosition[k] - correctionFactor)
    })
    return {distance: smoothDistance, color: smoothColor, position: positionN(addVec(cellPositionF, smoothPosition))}
}

/** `voronoi_f2(params, float2..float4)` (`noise.cc:1487`, `:1696`, `:1921`). */
export function voronoiF2N(params: VoronoiParams, coord: ArrayLike<number>): VoronoiOutput {
    const n = coord.length
    const {cellPositionF, localPosition, cellPosition} = cellOf(coord)
    let distanceF1 = FLT_MAX
    let distanceF2 = FLT_MAX
    let offsetF1 = new Array<number>(n).fill(0)
    let positionF1 = new Array<number>(n).fill(0)
    let offsetF2 = new Array<number>(n).fill(0)
    let positionF2 = new Array<number>(n).fill(0)
    const cell = new Array<number>(n), hashed = new Array<number>(n), point = new Array<number>(n)
    forEachOffset(n, 1, off => {
        pointAt(cellPosition, off, params.randomness, cell, hashed, point)
        const distanceToPoint = voronoiDistance(point, localPosition, params.metric, params.exponent)
        if (distanceToPoint < distanceF1) {
            distanceF2 = distanceF1
            distanceF1 = distanceToPoint
            offsetF2 = offsetF1
            offsetF1 = off.slice()
            positionF2 = positionF1
            positionF1 = point.slice()
        } else if (distanceToPoint < distanceF2) {
            distanceF2 = distanceToPoint
            offsetF2 = off.slice()
            positionF2 = point.slice()
        }
    })
    return {
        distance: distanceF2,
        color: hashCellColor(cellSum(cellPosition, offsetF2)),
        position: positionN(addVec(positionF2, cellPositionF)),
    }
}

const F_0_0001 = f32(0.0001)
const F_1E_35 = f32(1.0e-35)

/** `math::normalize` (`BLI_math_vector.hh:521-541`): `v / sqrt(len_sq)` when `len_sq > 1e-35f`, else zero. */
function normalizeN(v: number[]): number[] {
    const lenSq = dot(v, v)
    const out = new Array<number>(v.length).fill(0)
    if (lenSq > F_1E_35) {
        const len = f32(Math.sqrt(lenSq))
        for (let k = 0; k < v.length; k++) out[k] = f32(v[k] / len)
    }
    return out
}

/** `voronoi_distance_to_edge(params, float2..float4)` (`noise.cc:1528`, `:1739`, `:1967`). */
export function voronoiDistanceToEdgeN(params: VoronoiParams, coord: ArrayLike<number>): number {
    const n = coord.length
    const {localPosition, cellPosition} = cellOf(coord)
    let vectorToClosest = new Array<number>(n).fill(0)
    let minDistance = FLT_MAX
    const cell = new Array<number>(n), hashed = new Array<number>(n), point = new Array<number>(n)
    const vectorToPoint = new Array<number>(n)
    const toPoint = (off: number[]) => {
        pointAt(cellPosition, off, params.randomness, cell, hashed, point)
        for (let k = 0; k < n; k++) vectorToPoint[k] = f32(point[k] - localPosition[k])
        return vectorToPoint
    }
    forEachOffset(n, 1, off => {
        const v = toPoint(off)
        const distanceToPoint = dot(v, v)
        if (distanceToPoint < minDistance) {
            minDistance = distanceToPoint
            vectorToClosest = v.slice()
        }
    })
    minDistance = FLT_MAX
    const perpendicularToEdge = new Array<number>(n)
    const mid = new Array<number>(n)
    forEachOffset(n, 1, off => {
        const v = toPoint(off)
        for (let k = 0; k < n; k++) perpendicularToEdge[k] = f32(v[k] - vectorToClosest[k])
        if (dot(perpendicularToEdge, perpendicularToEdge) > F_0_0001) {
            for (let k = 0; k < n; k++) mid[k] = f32(f32(vectorToClosest[k] + v[k]) / 2)
            const distanceToEdge = dot(mid, normalizeN(perpendicularToEdge))
            minDistance = stdMin(minDistance, distanceToEdge)
        }
    })
    return minDistance
}

/** `voronoi_n_sphere_radius(params, float2..float4)` (`noise.cc:1569`, `:1784`, `:2018`). */
export function voronoiNSphereRadiusN(params: VoronoiParams, coord: ArrayLike<number>): number {
    const n = coord.length
    const {localPosition, cellPosition} = cellOf(coord)
    let closestPoint = new Array<number>(n).fill(0)
    let closestPointOffset = new Array<number>(n).fill(0)
    let minDistanceSq = FLT_MAX
    const cell = new Array<number>(n), hashed = new Array<number>(n), point = new Array<number>(n)
    forEachOffset(n, 1, off => {
        pointAt(cellPosition, off, params.randomness, cell, hashed, point)
        const distanceToPointSq = distanceSquared(point, localPosition)
        if (distanceToPointSq < minDistanceSq) {
            minDistanceSq = distanceToPointSq
            closestPoint = point.slice()
            closestPointOffset = off.slice()
        }
    })
    minDistanceSq = FLT_MAX
    let closestPointToClosestPoint = new Array<number>(n).fill(0)
    const cellOffset = new Array<number>(n)
    forEachOffset(n, 1, off => {
        if (off.every(o => o === 0)) return
        for (let k = 0; k < n; k++) cellOffset[k] = (off[k] + closestPointOffset[k]) | 0
        pointAt(cellPosition, cellOffset, params.randomness, cell, hashed, point)
        const distanceToPointSq = distanceSquared(closestPoint, point)
        if (distanceToPointSq < minDistanceSq) {
            minDistanceSq = distanceToPointSq
            closestPointToClosestPoint = point.slice()
        }
    })
    return f32(f32(Math.sqrt(distanceSquared(closestPointToClosestPoint, closestPoint))) / 2)
}

/* ---- Fractal Voronoi (`noise.cc:2076-2177`) ---- */

function octaveAt(params: VoronoiParams, coord: number[], calcColor: boolean): VoronoiOutput {
    if (coord.length === 1) {
        const c = coord[0]
        return params.feature === VORONOI_FEATURE.F2 ? voronoiF2_1(params, c)
            : params.feature === VORONOI_FEATURE.SMOOTH_F1 && params.smoothness !== 0 ? voronoiSmoothF1_1(params, c, calcColor)
                : voronoiF1_1(params, c)
    }
    return params.feature === VORONOI_FEATURE.F2 ? voronoiF2N(params, coord)
        : params.feature === VORONOI_FEATURE.SMOOTH_F1 && params.smoothness !== 0 ? voronoiSmoothF1N(params, coord, calcColor)
            : voronoiF1N(params, coord)
}

function divided(v: ArrayLike<number>, s: number): number[] {
    const out = new Array<number>(v.length)
    for (let k = 0; k < v.length; k++) out[k] = f32(v[k] / s)
    return out
}

/** `fractal_voronoi_x_fx` (`noise.cc:2076`). */
export function fractalVoronoiXFx(params: VoronoiParams, coord: ArrayLike<number>, calcColor: boolean): VoronoiOutput {
    let amplitude = 1
    let maxAmplitude = 0
    let scale = 1
    let output = newOutput()
    const zeroInput = params.detail === 0 || params.roughness === 0
    const octaves = Math.ceil(params.detail)
    for (let i = 0; i <= octaves; ++i) {
        const octave = octaveAt(params, scaled(coord, scale), calcColor)
        if (zeroInput) {
            maxAmplitude = 1
            output = octave
            break
        }
        if (i <= params.detail) {
            maxAmplitude = f32(maxAmplitude + amplitude)
            output.distance = f32(output.distance + f32(octave.distance * amplitude))
            for (let k = 0; k < 3; k++) output.color[k] = f32(output.color[k] + f32(octave.color[k] * amplitude))
            mixN(output.position, divided(octave.position, scale), amplitude, output.position)
            scale = f32(scale * params.lacunarity)
            amplitude = f32(amplitude * params.roughness)
        } else {
            const remainder = f32(params.detail - Math.floor(params.detail))
            if (remainder !== 0) {
                maxAmplitude = mix1(maxAmplitude, f32(maxAmplitude + amplitude), remainder)
                output.distance = mix1(output.distance, f32(output.distance + f32(octave.distance * amplitude)), remainder)
                const color2 = output.color.map((c, k) => f32(c + f32(octave.color[k] * amplitude)))
                mixN(output.color, color2, remainder, output.color)
                const position2 = mixN(output.position, divided(octave.position, scale), amplitude, [0, 0, 0, 0])
                mixN(output.position, position2, remainder, output.position)
            }
        }
    }
    if (params.normalize) {
        output.distance = f32(output.distance / f32(maxAmplitude * params.max_distance))
        for (let k = 0; k < 3; k++) output.color[k] = f32(output.color[k] / maxAmplitude)
    }
    output.position = params.scale !== 0 ? divided(output.position, params.scale) : [0, 0, 0, 0]
    return output
}

/** `fractal_voronoi_distance_to_edge` (`noise.cc:2135`). */
export function fractalVoronoiDistanceToEdge(params: VoronoiParams, coord: ArrayLike<number>): number {
    let amplitude = 1
    let maxAmplitude = params.max_distance
    let scale = 1
    let distance = 8
    const zeroInput = params.detail === 0 || params.roughness === 0
    const octaves = Math.ceil(params.detail)
    for (let i = 0; i <= octaves; ++i) {
        const c = scaled(coord, scale)
        const octaveDistance = c.length === 1 ? voronoiDistanceToEdge1(params, c[0]) : voronoiDistanceToEdgeN(params, c)
        if (zeroInput) {
            distance = octaveDistance
            break
        }
        if (i <= params.detail) {
            maxAmplitude = mix1(maxAmplitude, f32(params.max_distance / scale), amplitude)
            distance = mix1(distance, stdMin(distance, f32(octaveDistance / scale)), amplitude)
            scale = f32(scale * params.lacunarity)
            amplitude = f32(amplitude * params.roughness)
        } else {
            const remainder = f32(params.detail - Math.floor(params.detail))
            if (remainder !== 0) {
                const lerpAmplitude = mix1(maxAmplitude, f32(params.max_distance / scale), amplitude)
                maxAmplitude = mix1(maxAmplitude, lerpAmplitude, remainder)
                const lerpDistance = mix1(distance, stdMin(distance, f32(octaveDistance / scale)), amplitude)
                distance = mix1(distance, stdMin(distance, lerpDistance), remainder)
            }
        }
    }
    if (params.normalize) distance = f32(distance / maxAmplitude)
    return distance
}

/** `voronoi_n_sphere_radius` for any dimension. */
export function voronoiNSphereRadius(params: VoronoiParams, coord: ArrayLike<number>): number {
    return coord.length === 1 ? voronoiNSphereRadius1(params, coord[0]) : voronoiNSphereRadiusN(params, coord)
}
