/**
 * Noise utilities for procedural generation.
 *
 * Simplex noise implementation based on Stefan Gustavson's public domain code.
 * Reference: "Simplex noise demystified" by Stefan Gustavson (2005)
 * https://weber.itn.liu.se/~stegu/simplexnoise/simplexnoise.pdf
 * Original Java source: https://weber.itn.liu.se/~stegu/simplexnoise/SimplexNoise.java
 *
 * FBM reference: "The Book of Shaders - Fractal Brownian Motion"
 * https://thebookofshaders.com/13/
 *
 * Ridged multifractal reference: Musgrave, F. Kenton (1989)
 * "The Synthesis and Rendering of Eroded Fractal Terrains"
 * https://engineering.purdue.edu/~ebertd/texture/1stEdition/musgrave/musgrave.c
 *
 * Voronoi noise reference: Worley, Steven (1996) "A Cellular Texture Basis Function"
 * https://en.wikipedia.org/wiki/Worley_noise
 *
 * All noise functions are seeded and deterministic.
 */

import {SeededRandom} from './SeededRandom'

// --- Simplex noise internals ---

// Permutation table + gradient vectors
const GRAD3: [number, number, number][] = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
]

function buildPermTable(seed: number): Uint8Array {
    const perm = new Uint8Array(512)
    const rng = new SeededRandom(seed)
    // Fill 0-255 then shuffle
    const source = new Array(256)
    for (let i = 0; i < 256; i++) source[i] = i
    rng.shuffle(source)
    for (let i = 0; i < 256; i++) {
        perm[i] = source[i]
        perm[i + 256] = source[i]
    }
    return perm
}

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0)
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0
const F3 = 1.0 / 3.0
const G3 = 1.0 / 6.0

function dot2(g: [number, number, number], x: number, y: number): number {
    return g[0] * x + g[1] * y
}

function dot3(g: [number, number, number], x: number, y: number, z: number): number {
    return g[0] * x + g[1] * y + g[2] * z
}

/**
 * Create a 2D simplex noise function seeded with the given value.
 * Returns values in [-1, 1].
 */
export function createNoise2D(seed: number): (x: number, y: number) => number {
    const perm = buildPermTable(seed)
    const permMod12 = new Uint8Array(512)
    for (let i = 0; i < 512; i++) permMod12[i] = perm[i] % 12

    return function noise2D(xin: number, yin: number): number {
        const s = (xin + yin) * F2
        const i = Math.floor(xin + s)
        const j = Math.floor(yin + s)
        const t = (i + j) * G2
        const X0 = i - t
        const Y0 = j - t
        const x0 = xin - X0
        const y0 = yin - Y0

        let i1: number, j1: number
        if (x0 > y0) { i1 = 1; j1 = 0 }
        else { i1 = 0; j1 = 1 }

        const x1 = x0 - i1 + G2
        const y1 = y0 - j1 + G2
        const x2 = x0 - 1.0 + 2.0 * G2
        const y2 = y0 - 1.0 + 2.0 * G2

        const ii = i & 255
        const jj = j & 255

        let n0 = 0, n1 = 0, n2 = 0

        let t0 = 0.5 - x0 * x0 - y0 * y0
        if (t0 >= 0) {
            t0 *= t0
            n0 = t0 * t0 * dot2(GRAD3[permMod12[ii + perm[jj]]], x0, y0)
        }

        let t1 = 0.5 - x1 * x1 - y1 * y1
        if (t1 >= 0) {
            t1 *= t1
            n1 = t1 * t1 * dot2(GRAD3[permMod12[ii + i1 + perm[jj + j1]]], x1, y1)
        }

        let t2 = 0.5 - x2 * x2 - y2 * y2
        if (t2 >= 0) {
            t2 *= t2
            n2 = t2 * t2 * dot2(GRAD3[permMod12[ii + 1 + perm[jj + 1]]], x2, y2)
        }

        return 70.0 * (n0 + n1 + n2)
    }
}

/**
 * Create a 3D simplex noise function seeded with the given value.
 * Returns values in [-1, 1].
 */
export function createNoise3D(seed: number): (x: number, y: number, z: number) => number {
    const perm = buildPermTable(seed)
    const permMod12 = new Uint8Array(512)
    for (let i = 0; i < 512; i++) permMod12[i] = perm[i] % 12

    return function noise3D(xin: number, yin: number, zin: number): number {
        const s = (xin + yin + zin) * F3
        const i = Math.floor(xin + s)
        const j = Math.floor(yin + s)
        const k = Math.floor(zin + s)
        const t = (i + j + k) * G3
        const X0 = i - t
        const Y0 = j - t
        const Z0 = k - t
        const x0 = xin - X0
        const y0 = yin - Y0
        const z0 = zin - Z0

        let i1: number, j1: number, k1: number
        let i2: number, j2: number, k2: number

        if (x0 >= y0) {
            if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
            else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
            else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
        } else {
            if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
            else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
            else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
        }

        const x1 = x0 - i1 + G3
        const y1 = y0 - j1 + G3
        const z1 = z0 - k1 + G3
        const x2 = x0 - i2 + 2.0 * G3
        const y2 = y0 - j2 + 2.0 * G3
        const z2 = z0 - k2 + 2.0 * G3
        const x3 = x0 - 1.0 + 3.0 * G3
        const y3 = y0 - 1.0 + 3.0 * G3
        const z3 = z0 - 1.0 + 3.0 * G3

        const ii = i & 255
        const jj = j & 255
        const kk = k & 255

        let n0 = 0, n1 = 0, n2 = 0, n3 = 0

        let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0
        if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * dot3(GRAD3[permMod12[ii + perm[jj + perm[kk]]]], x0, y0, z0) }

        let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1
        if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * dot3(GRAD3[permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]], x1, y1, z1) }

        let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2
        if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * dot3(GRAD3[permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]], x2, y2, z2) }

        let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3
        if (t3 >= 0) { t3 *= t3; n3 = t3 * t3 * dot3(GRAD3[permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]], x3, y3, z3) }

        return 32.0 * (n0 + n1 + n2 + n3)
    }
}

// --- FBM and derived noise ---

export interface FBMOptions {
    /** Number of noise layers. Default: 4 */
    octaves?: number
    /** Frequency multiplier per octave. Default: 2.0 */
    lacunarity?: number
    /** Amplitude multiplier per octave. Default: 0.5 */
    persistence?: number
    /** Base frequency (inverse of feature size). Default: 1.0 */
    scale?: number
}

/**
 * Fractional Brownian Motion — layered noise.
 * The most common noise pattern in terrain generation.
 * Returns a value roughly in [-1, 1] (may slightly exceed due to summation).
 */
export function fbm(
    noiseFn: (x: number, y: number) => number,
    x: number, y: number,
    options?: FBMOptions,
): number {
    const octaves = options?.octaves ?? 4
    const lacunarity = options?.lacunarity ?? 2.0
    const persistence = options?.persistence ?? 0.5
    const scale = options?.scale ?? 1.0

    let value = 0
    let amplitude = 1.0
    let frequency = scale
    let maxAmplitude = 0

    for (let i = 0; i < octaves; i++) {
        value += amplitude * noiseFn(x * frequency, y * frequency)
        maxAmplitude += amplitude
        amplitude *= persistence
        frequency *= lacunarity
    }

    return value / maxAmplitude
}

/**
 * Ridged multifractal noise — produces mountain ridge patterns.
 * Takes the absolute value and inverts it, creating sharp ridges.
 *
 * Based on Musgrave's algorithm from "Texturing and Modeling: A Procedural Approach" (3rd ed.)
 * Reference: https://engineering.purdue.edu/~ebertd/texture/1stEdition/musgrave/musgrave.c
 * The key operations per octave:
 *   signal = offset - |noise|    (invert absolute value to create ridges)
 *   signal = signal^2            (sharpen ridges)
 *   signal *= weight             (weight by previous octave to create detail in valleys)
 *   weight = clamp(signal * gain, 0, 1)
 *
 * Returns values normalized to roughly [-1, 1] for compatibility with fbm.
 */
export function ridged(
    noiseFn: (x: number, y: number) => number,
    x: number, y: number,
    options?: FBMOptions,
): number {
    const octaves = options?.octaves ?? 4
    const lacunarity = options?.lacunarity ?? 2.0
    const persistence = options?.persistence ?? 0.5
    const scale = options?.scale ?? 1.0
    const offset = 1.0
    const gain = 2.0

    let value = 0
    let amplitude = 1.0
    let frequency = scale
    let weight = 1.0
    let maxAmplitude = 0

    for (let i = 0; i < octaves; i++) {
        let signal = noiseFn(x * frequency, y * frequency)
        signal = offset - Math.abs(signal)
        signal *= signal
        signal *= weight
        weight = Math.min(1.0, Math.max(0.0, signal * gain))

        value += signal * amplitude
        maxAmplitude += amplitude
        amplitude *= persistence
        frequency *= lacunarity
    }

    // Normalize to [-1, 1] range: raw output is in [0, maxAmplitude], map to [-1, 1]
    return (value / maxAmplitude) * 2.0 - 1.0
}

/**
 * Integer hash for Voronoi cell jitter — avoids precomputed table and tiling.
 * Uses a multiply-accumulate hash with large primes followed by xorshift mixing.
 * Primes from the Hugo Elias / integer hashing tradition.
 * Reference: https://www.cs.ubc.ca/~rbridson/docs/schechter-sca08-turbulence.pdf (Section 3)
 * Returns a value in [0, 1).
 */
function hashFloat(x: number, y: number, seed: number): number {
    let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = h ^ (h >>> 16)
    return (h >>> 0) / 4294967296
}

/**
 * 2D Voronoi (cellular) noise.
 * Returns the distance to the nearest cell center and the cell ID.
 * Useful for city blocks, organic patterns, stone textures.
 *
 * Uses hash-based jitter instead of a precomputed lookup table to avoid
 * tiling artifacts on large terrains. Each cell's jitter is computed on-the-fly
 * from a hash of (cellX, cellY, seed), so there is no repetition period.
 *
 * Reference: Worley, Steven (1996) "A Cellular Texture Basis Function"
 * https://en.wikipedia.org/wiki/Worley_noise
 */
export function createVoronoi2D(seed: number): (x: number, y: number) => { distance: number, cellId: number } {
    return function voronoi2D(x: number, y: number): { distance: number, cellId: number } {
        const ix = Math.floor(x)
        const iy = Math.floor(y)
        const fx = x - ix
        const fy = y - iy

        let minDist = Infinity
        let closestId = 0

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const cx = ix + dx
                const cy = iy + dy
                // Hash-based jitter per cell — no table, no tiling
                const jx = hashFloat(cx, cy, seed)
                const jy = hashFloat(cx, cy, seed + 7919) // different seed for Y to decorrelate
                const px = dx + jx - fx
                const py = dy + jy - fy
                const dist = px * px + py * py

                if (dist < minDist) {
                    minDist = dist
                    // Unique cell ID from coordinates (works for any integer range)
                    closestId = ((cx * 73856093) ^ (cy * 19349663)) | 0
                }
            }
        }

        return {distance: Math.sqrt(minDist), cellId: closestId}
    }
}

/**
 * Create a domain-warped version of any 2D noise function.
 * Domain warping distorts sampling coordinates using another noise field,
 * producing swirling, organic shapes much more natural than straight FBM.
 *
 * The technique: instead of noise(x, y), compute noise(x + warpNoise(x,y), y + warpNoise(x,y)).
 * The warp noise displaces the sampling coordinates, creating distorted patterns.
 *
 * Reference: Inigo Quilez (2002) "Domain Warping"
 * https://iquilezles.org/articles/warp/
 *
 * @param noiseFn The base noise function to warp
 * @param warpSeed Seed for the warp noise (should differ from the base noise seed)
 * @param warpAmount How much to displace (larger = more distortion). Try 5-20 for terrain.
 * @param warpScale Frequency of the warp noise. Try 0.01-0.05 for terrain.
 * @returns A new function (x, y) => number that samples the warped noise
 */
export function createDomainWarp(
    noiseFn: (x: number, y: number) => number,
    warpSeed: number,
    warpAmount: number,
    warpScale: number,
): (x: number, y: number) => number {
    const warpNoise = createNoise2D(warpSeed)
    // Use two different coordinate offsets to get independent warp in X and Y.
    // The magic numbers 31.7 and 47.3 are arbitrary offsets to decorrelate the two warp axes.
    // Same technique used by Inigo Quilez in his domain warping article.
    return (x: number, y: number): number => {
        const wx = warpNoise(x * warpScale, y * warpScale) * warpAmount
        const wy = warpNoise((x + 31.7) * warpScale, (y + 47.3) * warpScale) * warpAmount
        return noiseFn(x + wx, y + wy)
    }
}
