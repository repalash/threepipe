/**
 * Displacement and erosion operations for terrain generation.
 *
 * References:
 * - Hydraulic erosion: Hans Theobald Beyer (2015)
 *   "Implementation of a method for hydraulic erosion"
 *   https://www.firespark.de/resources/downloads/implementation%20of%20a%20method%20for%20hydraulic%20erosion.pdf
 * - Sebastian Lague's implementation (widely referenced in game dev)
 *   https://github.com/SebLague/Hydraulic-Erosion
 * - Thermal erosion: standard talus-angle method
 *   Musgrave, F.K. et al. (1989) "Texturing and Modeling: A Procedural Approach"
 * - Terracing: Leyh, E. (2019) "Procedural Terrain Height Modification"
 *   https://www.gamedeveloper.com/design/procedural-generation-of-terrain
 */

import {BufferAttribute, BufferGeometry, Vector3} from 'threepipe'
import * as HeightmapOps from './HeightmapOps'

/**
 * Displace geometry vertices along their normals by a noise function.
 * Modifies the geometry in-place.
 *
 * @param geo The geometry to displace (must have position and normal attributes)
 * @param displaceFn Function returning displacement amount per vertex position
 * @param scale Multiplier for the displacement
 * @param selection Optional boolean array — only displace selected vertices
 */
export function withNoise(
    geo: BufferGeometry,
    displaceFn: (pos: Vector3) => number,
    scale: number,
    selection?: boolean[] | null,
): void {
    const positions = geo.getAttribute('position') as BufferAttribute
    const normals = geo.getAttribute('normal') as BufferAttribute
    if (!positions || !normals) throw new Error('Displace.withNoise: geometry needs position and normal attributes')

    const pos = new Vector3()
    const normal = new Vector3()

    for (let i = 0; i < positions.count; i++) {
        if (selection && !selection[i]) continue
        pos.set(positions.getX(i), positions.getY(i), positions.getZ(i))
        normal.set(normals.getX(i), normals.getY(i), normals.getZ(i))
        const d = displaceFn(pos) * scale
        positions.setXYZ(i, pos.x + normal.x * d, pos.y + normal.y * d, pos.z + normal.z * d)
    }
    positions.needsUpdate = true
}

/**
 * Extract a heightmap (Y values) from grid geometry.
 * The geometry must have been created by PrimGen.grid() (row-major vertex layout on XZ plane).
 *
 * @param geo The grid geometry
 * @param vertsX Number of vertices along X axis (segsX + 1)
 * @param vertsZ Number of vertices along Z axis (segsZ + 1)
 */
export function extractHeightmap(geo: BufferGeometry, vertsX: number, vertsZ: number): Float32Array {
    const positions = geo.getAttribute('position') as BufferAttribute
    return HeightmapOps.extractFromPositions(positions, vertsX, vertsZ)
}

/**
 * Write heightmap Y values back to grid geometry.
 * Inverse of extractHeightmap.
 */
export function applyHeightmap(geo: BufferGeometry, heightmap: Float32Array): void {
    const positions = geo.getAttribute('position') as BufferAttribute
    HeightmapOps.applyToPositions(heightmap, positions)
    positions.needsUpdate = true
}

/**
 * Terrace a heightmap — create stepped, mesa-like terrain.
 * Quantizes height values to discrete levels with optional smooth blending at edges.
 *
 * Formula: terraced = floor(h * levels) / levels
 * With linear blending: result = terraced * sharpness + original * (1 - sharpness)
 *
 * Reference: Common terrain generation technique, used in World Machine "Terrace" device
 * https://www.world-machine.com/
 *
 * @param heightmap The heightmap to terrace (modified in-place)
 * @param w Width of the heightmap
 * @param h Height of the heightmap
 * @param levels Number of terrace levels (more = finer steps)
 * @param sharpness 0 = smooth blend between levels, 1 = hard steps. Default 0.5.
 */
export function terrace(
    heightmap: Float32Array, w: number, h: number,
    levels: number, sharpness = 0.5,
): Float32Array {
    levels = Math.max(2, Math.floor(levels))
    sharpness = Math.max(0, Math.min(1, sharpness))

    // Find range for normalization
    const stats = HeightmapOps.statistics(heightmap)
    const range = stats.range || 1

    for (let i = 0; i < w * h; i++) {
        // Normalize to [0, 1]
        const normalized = (heightmap[i] - stats.min) / range
        // Quantize
        const terraced = Math.floor(normalized * levels) / levels
        // Blend between terraced and original based on sharpness
        // Higher sharpness = more step-like
        heightmap[i] = stats.min + (terraced * sharpness + normalized * (1 - sharpness)) * range
    }

    return heightmap
}

/**
 * Thermal erosion — material crumbles from steep slopes to lower neighbors.
 * Simpler and faster than hydraulic erosion. Produces natural talus/scree at cliff bases.
 *
 * Algorithm per iteration:
 *   For each cell:
 *     Find maximum height difference to neighbors (dMax)
 *     If dMax > talusAngle * cellSize:
 *       Move amount = dt * erosionRate * (dMax - talusAngle * cellSize) from this cell to lowest neighbor
 *
 * The talus angle (angle of repose) is typically 30-45 degrees for loose rock.
 * tan(35°) ≈ 0.7, so talusThreshold = 0.7 * cellSize.
 *
 * Reference: Musgrave, F.K. (1989) "The Synthesis and Rendering of Eroded Fractal Terrains"
 * Also: Olsen, J. (2004) "Realtime Procedural Terrain Generation"
 * http://web.mit.edu/cesium/Public/terrain.pdf
 *
 * @param heightmap The heightmap to erode (modified in-place)
 * @param w Width
 * @param h Height
 * @param options Erosion parameters
 */
export function thermalErode(
    heightmap: Float32Array, w: number, h: number,
    options?: {
        /** Number of erosion iterations. Default 50. */
        iterations?: number,
        /** Tangent of the maximum stable slope angle. tan(35°) ≈ 0.7. Default 0.7. */
        talusThreshold?: number,
        /** How much material moves per iteration. Default 0.5. */
        erosionRate?: number,
        /** Grid cell size. Default 1. */
        cellSize?: number,
    },
): Float32Array {
    const iterations = options?.iterations ?? 50
    const talus = (options?.talusThreshold ?? 0.7) * (options?.cellSize ?? 1)
    const rate = options?.erosionRate ?? 0.5

    // Neighbor offsets: 4-connected (von Neumann neighborhood)
    const dx = [0, 0, -1, 1]
    const dz = [-1, 1, 0, 0]

    for (let iter = 0; iter < iterations; iter++) {
        for (let z = 0; z < h; z++) {
            for (let x = 0; x < w; x++) {
                const idx = z * w + x
                const centerH = heightmap[idx]

                // Collect ALL neighbors exceeding talus threshold
                // and distribute material proportionally (Musgrave/Olsen algorithm)
                let maxDiff = 0
                let totalDiff = 0
                const diffs: {nIdx: number, diff: number}[] = []

                for (let d = 0; d < 4; d++) {
                    const nx = x + dx[d]
                    const nz = z + dz[d]
                    if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue
                    const nIdx = nz * w + nx
                    const diff = centerH - heightmap[nIdx]
                    if (diff > talus) {
                        diffs.push({nIdx, diff})
                        totalDiff += diff
                        if (diff > maxDiff) maxDiff = diff
                    }
                }

                if (diffs.length === 0) continue

                // Distribute material proportionally to all qualifying neighbors
                // Formula: amount_i = rate * (maxDiff - talus) * (diff_i / totalDiff)
                // Reference: Olsen (2004) "Realtime Procedural Terrain Generation" Section 3.1
                const moveAmount = rate * (maxDiff - talus) * 0.5
                for (const {nIdx, diff} of diffs) {
                    const share = moveAmount * (diff / totalDiff)
                    heightmap[idx] -= share
                    heightmap[nIdx] += share
                }
            }
        }
    }

    return heightmap
}

/**
 * Hydraulic erosion via particle-based droplet simulation.
 * Each droplet flows downhill, eroding material from steep areas
 * and depositing it in flat areas. Produces realistic river channels.
 *
 * Algorithm per droplet (from Beyer 2015 / Lague implementation):
 *   1. Spawn at random position
 *   2. Loop until water evaporates or max steps reached:
 *      a. Compute surface gradient (bilinear interpolated)
 *      b. Update velocity: vel = vel * inertia + gradient * (1 - inertia)
 *      c. Move position by velocity (normalized)
 *      d. Compute sediment capacity: max(minSlope, |gradient|) * speed * water * capacityFactor
 *      e. If carrying more sediment than capacity → deposit excess
 *         If carrying less → erode up to capacity (limited by erodeSpeed)
 *      f. Evaporate water: water *= (1 - evaporationRate)
 *
 * Erosion/deposition uses a brush radius for smooth terrain modification.
 *
 * Reference: Hans Theobald Beyer (2015)
 * "Implementation of a method for hydraulic erosion"
 * https://www.firespark.de/resources/downloads/implementation%20of%20a%20method%20for%20hydraulic%20erosion.pdf
 * Also: Sebastian Lague's implementation
 * https://github.com/SebLague/Hydraulic-Erosion
 *
 * @param heightmap The heightmap to erode (modified in-place)
 * @param w Width
 * @param h Height
 * @param options Erosion parameters
 */
export function hydraulicErode(
    heightmap: Float32Array, w: number, h: number,
    options?: {
        /** Number of droplets to simulate. Default: w*h (one per cell). */
        droplets?: number,
        /** Max steps per droplet before it dies. Default 64. */
        maxSteps?: number,
        /** How much the droplet direction follows the gradient vs previous direction. 0-1. Default 0.05. */
        inertia?: number,
        /** Multiplier for sediment capacity. Default 4. */
        sedimentCapacity?: number,
        /** Minimum slope for capacity calculation (prevents zero capacity on flats). Default 0.01. */
        minSlope?: number,
        /** How fast the droplet erodes terrain. Default 0.3. */
        erodeSpeed?: number,
        /** How fast sediment is deposited. Default 0.3. */
        depositSpeed?: number,
        /** How fast water evaporates per step. Default 0.01. */
        evaporationRate?: number,
        /** Gravity constant. Default 4. */
        gravity?: number,
        /** Radius of erosion/deposition brush (in cells). Default 3. */
        brushRadius?: number,
        /** Initial water volume per droplet. Default 1. */
        initialWater?: number,
        /** Random seed. */
        seed?: number,
    },
): {
    heightmap: Float32Array,
    /** Accumulated water flow per cell (for river visualization). */
    flowMap: Float32Array,
    /** Where sediment was deposited. */
    sedimentMap: Float32Array,
    /** How much material was removed per cell. */
    erosionMap: Float32Array,
} {
    const droplets = options?.droplets ?? (w * h)
    const maxSteps = options?.maxSteps ?? 64
    const inertia = options?.inertia ?? 0.05
    const sedimentCap = options?.sedimentCapacity ?? 4
    const minSlope = options?.minSlope ?? 0.01
    const erodeSpeed = options?.erodeSpeed ?? 0.3
    const depositSpeed = options?.depositSpeed ?? 0.3
    const evapRate = options?.evaporationRate ?? 0.01
    const gravity = options?.gravity ?? 4
    const brushRadius = options?.brushRadius ?? 3
    const initialWater = options?.initialWater ?? 1

    const flowMap = new Float32Array(w * h)
    const sedimentMap = new Float32Array(w * h)
    const erosionMap = new Float32Array(w * h)

    // Precompute brush weights (gaussian-like falloff within radius)
    const brushWeights: {dx: number, dz: number, weight: number}[] = []
    let totalBrushWeight = 0
    for (let dz = -brushRadius; dz <= brushRadius; dz++) {
        for (let dx = -brushRadius; dx <= brushRadius; dx++) {
            const dist2 = dx * dx + dz * dz
            if (dist2 <= brushRadius * brushRadius) {
                const weight = Math.max(0, 1 - Math.sqrt(dist2) / brushRadius)
                brushWeights.push({dx, dz, weight})
                totalBrushWeight += weight
            }
        }
    }
    // Normalize
    for (const bw of brushWeights) bw.weight /= totalBrushWeight

    // Simple seeded random (inline to avoid import overhead per droplet)
    let rngState = (options?.seed ?? 42) | 0
    function rngNext(): number {
        let t = rngState += 0x6D2B79F5
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    /**
     * Bilinear interpolation of heightmap at fractional position.
     * Reference: standard bilinear interpolation
     * https://en.wikipedia.org/wiki/Bilinear_interpolation
     */
    function sampleHeight(px: number, pz: number): number {
        const x0 = Math.floor(px)
        const z0 = Math.floor(pz)
        const x1 = Math.min(x0 + 1, w - 1)
        const z1 = Math.min(z0 + 1, h - 1)
        const fx = px - x0
        const fz = pz - z0
        const h00 = heightmap[z0 * w + x0]
        const h10 = heightmap[z0 * w + x1]
        const h01 = heightmap[z1 * w + x0]
        const h11 = heightmap[z1 * w + x1]
        return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
    }

    /** Compute gradient at fractional position via bilinear interpolation of neighbors. */
    function sampleGradient(px: number, pz: number): {gx: number, gz: number} {
        const x0 = Math.floor(px)
        const z0 = Math.floor(pz)
        const x1 = Math.min(x0 + 1, w - 1)
        const z1 = Math.min(z0 + 1, h - 1)
        const fx = px - x0
        const fz = pz - z0
        const h00 = heightmap[z0 * w + x0]
        const h10 = heightmap[z0 * w + x1]
        const h01 = heightmap[z1 * w + x0]
        const h11 = heightmap[z1 * w + x1]
        return {
            gx: (h10 - h00) * (1 - fz) + (h11 - h01) * fz,
            gz: (h01 - h00) * (1 - fx) + (h11 - h10) * fx,
        }
    }

    for (let d = 0; d < droplets; d++) {
        // Spawn at random position (with 1-cell margin from edges)
        let posX = rngNext() * (w - 3) + 1
        let posZ = rngNext() * (h - 3) + 1
        let dirX = 0
        let dirZ = 0
        let speed = 1
        let water = initialWater
        let sediment = 0

        for (let step = 0; step < maxSteps; step++) {
            const cellX = Math.floor(posX)
            const cellZ = Math.floor(posZ)
            if (cellX < 1 || cellX >= w - 2 || cellZ < 1 || cellZ >= h - 2) break

            const oldHeight = sampleHeight(posX, posZ)
            const grad = sampleGradient(posX, posZ)

            // Update direction with inertia
            dirX = dirX * inertia - grad.gx * (1 - inertia)
            dirZ = dirZ * inertia - grad.gz * (1 - inertia)

            // Normalize direction
            const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ)
            if (dirLen < 0.0001) {
                // Random direction if on flat terrain
                const angle = rngNext() * Math.PI * 2
                dirX = Math.cos(angle)
                dirZ = Math.sin(angle)
            } else {
                dirX /= dirLen
                dirZ /= dirLen
            }

            // Move
            posX += dirX
            posZ += dirZ

            // Check bounds
            if (posX < 1 || posX >= w - 2 || posZ < 1 || posZ >= h - 2) break

            const newHeight = sampleHeight(posX, posZ)
            const heightDiff = newHeight - oldHeight

            // Record flow
            const flowIdx = Math.floor(posZ) * w + Math.floor(posX)
            flowMap[flowIdx] += water

            // Speed update: Lague's formula. heightDiff = newHeight - oldHeight,
            // so heightDiff < 0 going downhill, and -heightDiff*gravity adds kinetic energy.
            // Reference: Lague, "Hydraulic Erosion" (2019), GitHub SebLague/Hydraulic-Erosion
            speed = Math.sqrt(Math.max(0, speed * speed - heightDiff * gravity))
            if (!isFinite(speed)) speed = 0

            // Sediment capacity: max(-deltaHeight, minSlope) * speed * water * factor
            // Uses -heightDiff (NOT abs) so uphill gets low capacity (just minSlope).
            // Reference: Beyer (2015) Section 3.2
            const slopeAngle = Math.max(-heightDiff, minSlope)
            const capacity = slopeAngle * speed * water * sedimentCap

            if (sediment > capacity || heightDiff > 0) {
                // Deposit sediment at the OLD position (cellX, cellZ) using bilinear splatting.
                // Per Beyer (2015): when going uphill (heightDiff > 0), deposit min(sediment, heightDiff)
                // to try to fill the gap. When carrying excess (sediment > capacity), deposit the surplus.
                // Deposition happens at the PREVIOUS position to avoid creating height spikes.
                // Reference: Lague implementation deposits at old position
                const depositAmount = Math.max(0, heightDiff > 0
                    ? Math.min(sediment, heightDiff)
                    : (sediment - capacity) * depositSpeed)
                sediment -= depositAmount

                // Use OLD position (cellX, cellZ) for deposition — this is where the droplet WAS
                const oldPosX = posX - dirX  // step back to old position
                const oldPosZ = posZ - dirZ
                const cx = Math.floor(oldPosX)
                const cz = Math.floor(oldPosZ)
                const u = oldPosX - cx
                const v = oldPosZ - cz
                if (cx >= 0 && cx < w - 1 && cz >= 0 && cz < h - 1) {
                    heightmap[cz * w + cx] += depositAmount * (1 - u) * (1 - v)
                    heightmap[cz * w + cx + 1] += depositAmount * u * (1 - v)
                    heightmap[(cz + 1) * w + cx] += depositAmount * (1 - u) * v
                    heightmap[(cz + 1) * w + cx + 1] += depositAmount * u * v
                    sedimentMap[cz * w + cx] += depositAmount * (1 - u) * (1 - v)
                    sedimentMap[cz * w + cx + 1] += depositAmount * u * (1 - v)
                    sedimentMap[(cz + 1) * w + cx] += depositAmount * (1 - u) * v
                    sedimentMap[(cz + 1) * w + cx + 1] += depositAmount * u * v
                }
            } else {
                // Erode terrain using brush — per Lague's implementation,
                // each brush point's erosion is clamped to the terrain height at that point
                // to prevent digging below zero. The actual amount removed is tracked per-point.
                // Reference: Erosion.cs lines 114-119 in SebLague/Hydraulic-Erosion
                const erodeTarget = Math.max(0, Math.min((capacity - sediment) * erodeSpeed, -heightDiff))

                for (const bw of brushWeights) {
                    const bx = cellX + bw.dx
                    const bz = cellZ + bw.dz
                    if (bx >= 0 && bx < w && bz >= 0 && bz < h) {
                        const bIdx = bz * w + bx
                        const weighedAmount = erodeTarget * bw.weight
                        // Clamp to terrain height — never erode below zero
                        const actualRemoved = Math.min(heightmap[bIdx], weighedAmount)
                        heightmap[bIdx] -= actualRemoved
                        sediment += actualRemoved
                        erosionMap[bIdx] += actualRemoved
                    }
                }
            }

            // Evaporate
            water *= (1 - evapRate)
            if (water < 0.001) break
        }
    }

    // Final NaN guard — erosion edge cases can produce non-finite values
    for (let i = 0; i < heightmap.length; i++) {
        if (!isFinite(heightmap[i])) heightmap[i] = 0
    }

    return {heightmap, flowMap, sedimentMap, erosionMap}
}
