/**
 * Terrain erosion for the `ThreepipeErosion` extension node. This is not a Blender node: Blender has no erosion node.
 * The code is copied, unchanged, from the webgi-worlds kit (`examples/ssgi-demo/worlds/kit/erosion.ts`, and `rng`
 * from `kit/noise.ts`), as decided in issues/open/modelling-tools/research-webgi-worlds-reuse.md (decision 5).
 *
 * Erosion of a terrain height grid, so landforms read as weathered rather than as noise: droplet (particle)
 * hydraulic erosion carves gullies and lays fans and filled valley floors, and thermal erosion slumps slopes
 * steeper than the material's angle of repose into talus aprons. Both also record where they acted; the masks drive
 * the splat and the scatter, so the ground textures and the props agree with the landform.
 *
 * Hydraulic: H. T. Beyer, "Implementation of a method for hydraulic erosion" (TU München, 2015), with the parameter
 * defaults of S. Lague's implementation (https://github.com/SebLague/Hydraulic-Erosion, MIT). It runs on heights
 * normalised to 0..1, the scale those defaults are tuned for. Thermal: J. Olsen, "Realtime Procedural Terrain
 * Generation" (2004), the fast variant that moves material to the lowest neighbour only.
 */

/** `kit/noise.ts` `rng`: mulberry32. */
export function rng(seed: number) {
    let a = seed >>> 0
    return () => {
        a = a + 0x6D2B79F5 >>> 0
        let t = a
        t = Math.imul(t ^ t >>> 15, t | 1)
        t ^= t + Math.imul(t ^ t >>> 7, t | 61)
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

export interface ErosionOptions {
    /** Droplet hydraulic erosion. `droplets` per grid cell is the main strength control (1 to 4). */
    hydraulic?: {
        dropletsPerCell?: number
        seed?: number
        /** Brush radius in cells. */
        radius?: number
        inertia?: number
        capacity?: number
        minCapacity?: number
        erodeSpeed?: number
        depositSpeed?: number
        evaporateSpeed?: number
        gravity?: number
        lifetime?: number
    }
    /** Thermal erosion: slopes steeper than `angle` (degrees; dry sand 30-34, scree 35-38) slump. */
    thermal?: {angle: number, iterations?: number}
    /** 0..1 per cell: how much erosion may act there (1 everywhere by default), e.g. to keep a flat camp site. */
    weight?: (x: number, z: number) => number
}

export interface ErosionMasks {
    /** Water that passed through each cell, log-scaled, 0..1. */
    flow: Float32Array
    /** Sediment laid down, 0..1. */
    deposit: Float32Array
    /** Material removed by water, 0..1. */
    eroded: Float32Array
    /** Material that slumped into the cell (talus, scree), 0..1. */
    talus: Float32Array
}

/** Erodes `hs` (n1 x n1 heights in meters, cells `step` meters apart, origin at -size/2) in place. */
export function erode(hs: Float32Array, n1: number, step: number, o: ErosionOptions): ErosionMasks {
    const count = n1 * n1
    const flow = new Float32Array(count), deposit = new Float32Array(count), eroded = new Float32Array(count), talus = new Float32Array(count)
    const half = (n1 - 1) * step / 2
    const weight = new Float32Array(count).fill(1)
    if (o.weight) for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) weight[j * n1 + i] = Math.max(0, Math.min(1, o.weight(-half + i * step, -half + j * step)))
    if (o.hydraulic) hydraulic(hs, n1, o.hydraulic, weight, flow, deposit, eroded)
    if (o.thermal) thermal(hs, n1, step, o.thermal, weight, talus)
    normalise(flow, true)
    normalise(deposit)
    normalise(eroded)
    normalise(talus)
    return {flow, deposit, eroded, talus}
}

/** Scales to 0..1 by the 98th percentile (one spike does not flatten the rest), optionally log first. */
function normalise(a: Float32Array, log = false) {
    if (log) for (let i = 0; i < a.length; i++) a[i] = Math.log1p(a[i])
    const sorted = Float32Array.from(a).sort()
    const top = sorted[Math.floor(sorted.length * 0.98)] || 1
    for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] / top)
}

function hydraulic(hs: Float32Array, n1: number, p: NonNullable<ErosionOptions['hydraulic']>, weight: Float32Array,
    flow: Float32Array, deposit: Float32Array, eroded: Float32Array) {
    const radius = p.radius ?? 3, inertia = p.inertia ?? 0.05, capacityFactor = p.capacity ?? 4, minCapacity = p.minCapacity ?? 0.01
    const erodeSpeed = p.erodeSpeed ?? 0.3, depositSpeed = p.depositSpeed ?? 0.3, evaporate = p.evaporateSpeed ?? 0.01
    const gravity = p.gravity ?? 4, lifetime = p.lifetime ?? 30
    const rand = rng(p.seed ?? 1)
    // normalised heights: the defaults above are tuned for a 0..1 map about 256 cells across
    let lo = Infinity, hi = -Infinity
    for (const h of hs) { lo = Math.min(lo, h); hi = Math.max(hi, h) }
    const relief = Math.max(1e-6, hi - lo)
    const map = new Float32Array(hs.length)
    for (let i = 0; i < hs.length; i++) map[i] = (hs[i] - lo) / relief
    // erosion brush: cells within the radius, weighted by distance
    const bx: number[] = [], by: number[] = [], bw: number[] = []
    let wsum = 0
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
        const d = Math.hypot(x, y)
        if (d >= radius) continue
        bx.push(x); by.push(y); bw.push(1 - d / radius); wsum += 1 - d / radius
    }
    for (let i = 0; i < bw.length; i++) bw[i] /= wsum
    const hg = {h: 0, gx: 0, gy: 0}
    const sampleHG = (x: number, y: number) => {
        const cx = Math.floor(x), cy = Math.floor(y), u = x - cx, v = y - cy, k = cy * n1 + cx
        const a = map[k], b = map[k + 1], c = map[k + n1], d = map[k + n1 + 1]
        hg.gx = (b - a) * (1 - v) + (d - c) * v
        hg.gy = (c - a) * (1 - u) + (d - b) * u
        hg.h = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    }
    const droplets = Math.round((p.dropletsPerCell ?? 2) * n1 * n1)
    const max = n1 - 1
    for (let n = 0; n < droplets; n++) {
        let x = rand() * (max - 1), y = rand() * (max - 1), dx = 0, dy = 0, speed = 1, water = 1, sediment = 0
        for (let life = 0; life < lifetime; life++) {
            const cx = Math.floor(x), cy = Math.floor(y), u = x - cx, v = y - cy, k = cy * n1 + cx
            sampleHG(x, y)
            const h = hg.h
            dx = dx * inertia - hg.gx * (1 - inertia)
            dy = dy * inertia - hg.gy * (1 - inertia)
            const len = Math.hypot(dx, dy)
            if (len < 1e-9) break
            dx /= len; dy /= len
            x += dx; y += dy
            if (x < 0 || y < 0 || x >= max - 1 || y >= max - 1) break
            sampleHG(x, y)
            const dh = hg.h - h
            const capacity = Math.max(-dh * speed * water * capacityFactor, minCapacity)
            const w = weight[k]
            if (sediment > capacity || dh > 0) {
                const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositSpeed
                sediment -= amount
                const a = amount * (1 - u) * (1 - v), b = amount * u * (1 - v), c = amount * (1 - u) * v, d = amount * u * v
                map[k] += a; map[k + 1] += b; map[k + n1] += c; map[k + n1 + 1] += d
                deposit[k] += a; deposit[k + 1] += b; deposit[k + n1] += c; deposit[k + n1 + 1] += d
            } else {
                const amount = Math.min((capacity - sediment) * erodeSpeed, -dh) * w
                for (let i = 0; i < bw.length; i++) {
                    const ex = cx + bx[i], ey = cy + by[i]
                    if (ex < 0 || ey < 0 || ex > max || ey > max) continue
                    const e = ey * n1 + ex
                    const take = Math.min(map[e], amount * bw[i])
                    map[e] -= take
                    eroded[e] += take
                    sediment += take
                }
            }
            flow[k] += water
            speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity))
            water *= 1 - evaporate
        }
    }
    for (let i = 0; i < hs.length; i++) hs[i] = lo + map[i] * relief
}

function thermal(hs: Float32Array, n1: number, step: number, p: NonNullable<ErosionOptions['thermal']>, weight: Float32Array, talus: Float32Array) {
    const T = Math.tan(p.angle * Math.PI / 180) * step, Td = T * Math.SQRT2
    const iterations = p.iterations ?? 80
    const nx = [1, -1, 0, 0, 1, 1, -1, -1], ny = [0, 0, 1, -1, 1, -1, 1, -1]
    for (let it = 0; it < iterations; it++) {
        for (let j = 1; j < n1 - 1; j++) for (let i = 1; i < n1 - 1; i++) {
            const k = j * n1 + i, h = hs[k]
            let best = 0, bk = -1, bt = T
            for (let q = 0; q < 8; q++) {
                const kk = (j + ny[q]) * n1 + i + nx[q]
                const t = q < 4 ? T : Td
                const d = h - hs[kk] - t
                if (d > best) { best = d; bk = kk; bt = t }
            }
            if (bk < 0) continue
            const move = 0.5 * best * weight[k]
            hs[k] -= move
            hs[bk] += move
            talus[bk] += move
            void bt
        }
    }
}
