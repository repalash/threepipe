/**
 * Procedural surface textures as RGBA bytes: tileable height fields turned into tangent-space normal maps. Pure,
 * Node-safe and seeded, so a transcript rebuilds the same texture everywhere. The PRNG, hash and tileable value
 * noise and the height-to-normal step follow `riad/mosaic.ts` of the webgi SSGI worlds (threepipe-webgi PR #12,
 * `rng`, `hash2`, `tiledNoise`, and its central-difference normal); the cellular bumps are new here.
 */

export type SurfacePattern = 'leather' | 'grain' | 'rubber'

export interface SurfaceMaps {
    size: number
    /** Tangent-space normal map, RGBA bytes, rows along +v. */
    normal: Uint8Array
    height: Float32Array
}

const hash2 = (x: number, y: number, s: number) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Value noise with `freq` lattice cells across a texture of `period` px: tiles seamlessly. */
export function tiledNoise(period: number, freq: number, seed: number) {
    const k = freq / period
    return (x: number, y: number) => {
        const fx = x * k, fy = y * k
        const ix = Math.floor(fx), iy = Math.floor(fy)
        const tx = fx - ix, ty = fy - iy
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
        const w = (i: number) => ((i % freq) + freq) % freq
        const a = hash2(w(ix), w(iy), seed), b = hash2(w(ix + 1), w(iy), seed)
        const c = hash2(w(ix), w(iy + 1), seed), d = hash2(w(ix + 1), w(iy + 1), seed)
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    }
}

/**
 * Tileable cellular field: `cells` jittered points per side, returns the distance to the nearest (F1) and second
 * nearest (F2) point, in cell units.
 */
export function tiledCells(period: number, cells: number, seed: number, jitter = 0.85) {
    const k = cells / period
    return (x: number, y: number): [number, number] => {
        const fx = x * k, fy = y * k
        const ix = Math.floor(fx), iy = Math.floor(fy)
        let f1 = 1e9, f2 = 1e9
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const cx = ix + i, cy = iy + j
            const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells
            const px = cx + 0.5 + jitter * (hash2(wx, wy, seed) - 0.5), py = cy + 0.5 + jitter * (hash2(wx, wy, seed + 7) - 0.5)
            const d = Math.hypot(fx - px, fy - py)
            if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
        }
        return [f1, f2]
    }
}

/**
 * A height field (in units of one texture tile) for a pattern:
 * - `leather`: pebbled grain - rounded cells (F2 - F1 ridges sink into creases) with fine noise on top. Tile 14 mm.
 * - `grain`: the fine stipple of moulded plastic - two octaves of value noise. Tile about 8 mm.
 * - `rubber`: a softer, coarser stipple. Tile about 6 mm.
 */
export function surfaceHeight(pattern: SurfacePattern, size: number, seed: number): Float32Array {
    const h = new Float32Array(size * size)
    if (pattern === 'leather') {
        // 10 pebbles across a tile: at the 14 mm tile `uv` should use, about 1.4 mm each, which is what reads as
        // grain at product-shot distance (finer cells average out under mipmapping and the leather looks smooth)
        const cells = tiledCells(size, 10, seed), n = tiledNoise(size, 40, seed + 3)
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const [f1, f2] = cells(x, y)
            const crease = Math.min(1, (f2 - f1) * 3.2) // 0 on the cell borders
            h[y * size + x] = Math.sqrt(crease) * 0.9 + 0.1 * n(x, y)
        }
    } else if (pattern === 'grain') {
        const a = tiledNoise(size, 40, seed), b = tiledNoise(size, 80, seed + 1)
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = 0.65 * a(x, y) + 0.35 * b(x, y)
    } else {
        const a = tiledNoise(size, 24, seed), b = tiledNoise(size, 64, seed + 1)
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = 0.7 * a(x, y) + 0.3 * b(x, y)
    }
    return h
}

/** Central-difference normals of a tileable height field; `depth` is the relief height in tile units x size. */
export function heightToNormal(height: Float32Array, size: number, depth: number): Uint8Array {
    const normal = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const hx = height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size]
        const hy = height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]
        let nx = -hx * depth / 2, ny = -hy * depth / 2, nz = 1
        const L = Math.sqrt(nx * nx + ny * ny + nz * nz)
        nx /= L; ny /= L; nz /= L
        const k = 4 * (y * size + x)
        normal[k] = Math.round((nx * 0.5 + 0.5) * 255)
        normal[k + 1] = Math.round((ny * 0.5 + 0.5) * 255)
        normal[k + 2] = Math.round((nz * 0.5 + 0.5) * 255)
        normal[k + 3] = 255
    }
    return normal
}

const RELIEF: Record<SurfacePattern, number> = {leather: 8, grain: 3, rubber: 4}

export function surfaceMaps(pattern: SurfacePattern, size = 256, seed = 1): SurfaceMaps {
    const height = surfaceHeight(pattern, size, seed)
    return {size, height, normal: heightToNormal(height, size, RELIEF[pattern])}
}
