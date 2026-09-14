/**
 * 2D heightmap operations — the equivalent of Blender's OpenVDB grid nodes
 * adapted for regular-grid heightmaps stored as Float32Array.
 *
 * All functions operate on row-major Float32Array of size w*h.
 * Index convention: index = z * w + x (z = row, x = column).
 *
 * References:
 * - Gradient (finite difference): standard central difference
 *   https://en.wikipedia.org/wiki/Finite_difference#Central_difference
 * - Laplacian (discrete 2D): sum of neighbors minus 4*center
 *   https://en.wikipedia.org/wiki/Discrete_Laplace_operator#Mesh_Laplacian
 * - Smoothing (box filter / median filter): standard image processing
 *   https://en.wikipedia.org/wiki/Box_blur
 */

/**
 * Compute the 2D gradient of a heightmap using central finite differences.
 * Returns slope direction (gx, gz) at each cell — the direction of steepest ascent.
 * Essential for erosion (water flows opposite to gradient) and slope computation.
 *
 * Formula: gx[i] = (h[x+1,z] - h[x-1,z]) / (2 * cellSize)
 *          gz[i] = (h[x,z+1] - h[x,z-1]) / (2 * cellSize)
 * Boundary cells use forward/backward differences.
 */
export function gradient(heightmap: Float32Array, w: number, h: number, cellSize = 1): {gx: Float32Array, gz: Float32Array} {
    const gx = new Float32Array(w * h)
    const gz = new Float32Array(w * h)
    const inv2Cell = 1 / (2 * cellSize)

    for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
            const idx = z * w + x

            // X gradient (central, forward, or backward difference at boundaries)
            if (x === 0) gx[idx] = (heightmap[idx + 1] - heightmap[idx]) / cellSize
            else if (x === w - 1) gx[idx] = (heightmap[idx] - heightmap[idx - 1]) / cellSize
            else gx[idx] = (heightmap[idx + 1] - heightmap[idx - 1]) * inv2Cell

            // Z gradient
            if (z === 0) gz[idx] = (heightmap[idx + w] - heightmap[idx]) / cellSize
            else if (z === h - 1) gz[idx] = (heightmap[idx] - heightmap[idx - w]) / cellSize
            else gz[idx] = (heightmap[idx + w] - heightmap[idx - w]) * inv2Cell
        }
    }

    return {gx, gz}
}

/**
 * Compute the discrete 2D Laplacian of a heightmap.
 * Positive = concave (valley/pit), negative = convex (ridge/peak).
 * Foundation for thermal erosion — material moves from high to low curvature.
 *
 * Formula: L[x,z] = (h[x-1,z] + h[x+1,z] + h[x,z-1] + h[x,z+1] - 4*h[x,z]) / (cellSize^2)
 * Boundary cells clamp to edge values (Neumann boundary condition).
 *
 * Reference: https://en.wikipedia.org/wiki/Discrete_Laplace_operator
 */
export function laplacian(heightmap: Float32Array, w: number, h: number, cellSize = 1): Float32Array {
    const result = new Float32Array(w * h)
    const invCell2 = 1 / (cellSize * cellSize)

    for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
            const idx = z * w + x
            const center = heightmap[idx]
            const left = x > 0 ? heightmap[idx - 1] : center
            const right = x < w - 1 ? heightmap[idx + 1] : center
            const up = z > 0 ? heightmap[idx - w] : center
            const down = z < h - 1 ? heightmap[idx + w] : center
            result[idx] = (left + right + up + down - 4 * center) * invCell2
        }
    }

    return result
}

/**
 * Smooth a heightmap using iterative box filter (mean) or median filter.
 * Double-buffered to avoid read-while-write artifacts.
 *
 * Mean filter: each cell becomes the average of itself and its 4 neighbors (3x3 cross kernel).
 * Median filter: each cell becomes the median of itself and its 4 neighbors.
 *   Preserves sharp edges better than mean (cliffs stay sharp, noise is removed).
 *
 * Reference: Blender's Blur Attribute uses similar iterative neighbor averaging
 * See: node_geo_blur_attribute.cc in Blender source
 */
export function smooth(
    heightmap: Float32Array, w: number, h: number,
    iterations: number,
    method: 'mean' | 'median' = 'mean',
): Float32Array {
    let src = new Float32Array(heightmap)
    let dst = new Float32Array(w * h)
    const iters = Math.max(0, Math.floor(iterations))

    for (let iter = 0; iter < iters; iter++) {
        for (let z = 0; z < h; z++) {
            for (let x = 0; x < w; x++) {
                const idx = z * w + x
                const center = src[idx]
                const left = x > 0 ? src[idx - 1] : center
                const right = x < w - 1 ? src[idx + 1] : center
                const up = z > 0 ? src[idx - w] : center
                const down = z < h - 1 ? src[idx + w] : center

                if (method === 'mean') {
                    dst[idx] = (center + left + right + up + down) / 5
                } else {
                    // Median of 5 values — sort and take middle
                    const vals = [center, left, right, up, down]
                    vals.sort((a, b) => a - b)
                    dst[idx] = vals[2]
                }
            }
        }
        // Swap buffers
        const tmp = src
        src = dst
        dst = tmp
    }

    return src
}

/**
 * Normalize heightmap values to a target range.
 * Useful after erosion lowers the average height.
 */
export function normalize(heightmap: Float32Array, targetMin = 0, targetMax = 1): Float32Array {
    let min = Infinity, max = -Infinity
    for (let i = 0; i < heightmap.length; i++) {
        if (heightmap[i] < min) min = heightmap[i]
        if (heightmap[i] > max) max = heightmap[i]
    }
    const range = max - min || 1
    const targetRange = targetMax - targetMin
    const result = new Float32Array(heightmap.length)
    for (let i = 0; i < heightmap.length; i++) {
        result[i] = targetMin + ((heightmap[i] - min) / range) * targetRange
    }
    return result
}

/**
 * Compute statistics for an attribute/heightmap array.
 * Follows Blender's Attribute Statistic node pattern.
 */
export function statistics(data: Float32Array): {
    min: number, max: number, range: number,
    mean: number, median: number,
    variance: number, stdDev: number,
} {
    if (data.length === 0) return {min: 0, max: 0, range: 0, mean: 0, median: 0, variance: 0, stdDev: 0}

    let min = Infinity, max = -Infinity, sum = 0
    for (let i = 0; i < data.length; i++) {
        const v = data[i]
        if (v < min) min = v
        if (v > max) max = v
        sum += v
    }
    const mean = sum / data.length

    let varSum = 0
    for (let i = 0; i < data.length; i++) {
        const d = data[i] - mean
        varSum += d * d
    }
    const variance = varSum / data.length

    // Median — sort a copy and take the middle value
    const sorted = new Float32Array(data).sort()
    const mid = data.length >> 1
    const median = data.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

    return {min, max, range: max - min, mean, median, variance, stdDev: Math.sqrt(variance)}
}

/**
 * Extract a heightmap (Y values) from a grid BufferGeometry created by PrimGen.grid().
 * Assumes row-major order matching PrimGen.grid's vertex layout.
 * @param positions The position BufferAttribute from the geometry
 * @param w Number of vertices along X (segsX + 1)
 * @param h Number of vertices along Z (segsZ + 1)
 */
export function extractFromPositions(positions: {getY: (i: number) => number, count: number}, w: number, h: number): Float32Array {
    const heightmap = new Float32Array(w * h)
    const count = Math.min(w * h, positions.count)
    for (let i = 0; i < count; i++) {
        heightmap[i] = positions.getY(i)
    }
    return heightmap
}

/**
 * Write heightmap Y values back to a position BufferAttribute.
 * Inverse of extractFromPositions.
 */
export function applyToPositions(heightmap: Float32Array, positions: {setY: (i: number, y: number) => void, count: number}): void {
    const count = Math.min(heightmap.length, positions.count)
    for (let i = 0; i < count; i++) {
        positions.setY(i, heightmap[i])
    }
}
