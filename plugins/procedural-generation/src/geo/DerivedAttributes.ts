/**
 * Compute derived per-vertex attributes from geometry.
 * These are the attributes that terrain/building generators use for
 * classification and material blending: slope, curvature, height.
 *
 * All functions operate on standard Three.js BufferGeometry.
 * Results are stored as named BufferAttributes via store().
 *
 * Slope calculation reference:
 *   slope = acos(dot(vertexNormal, upVector)) converted to degrees
 *   Standard technique used in GIS and terrain rendering.
 *   https://pro.arcgis.com/en/pro-app/latest/tool-reference/3d-analyst/how-slope-works.htm
 *
 * Curvature approximation reference:
 *   Discrete Laplacian curvature via difference of vertex position from neighbor average.
 *   Meyer, M. et al. (2003) "Discrete Differential-Geometry Operators for Triangulated 2-Manifolds"
 *   https://ddg.math.uni-goettingen.de/pub/Meyer_2003_DDG.pdf
 */

import {BufferAttribute, BufferGeometry, Vector3} from 'threepipe'

const _normal = new Vector3()
const _up = new Vector3(0, 1, 0)

/**
 * Compute per-vertex slope angle from the UP vector, in degrees.
 * 0 = flat (normal points straight up), 90 = vertical cliff.
 * Requires vertex normals to be computed (call geo.computeVertexNormals() first).
 */
export function slope(geo: BufferGeometry): Float32Array {
    const normals = geo.getAttribute('normal') as BufferAttribute
    if (!normals) throw new Error('DerivedAttributes.slope: geometry has no normals. Call computeVertexNormals() first.')
    const result = new Float32Array(normals.count)
    for (let i = 0; i < normals.count; i++) {
        _normal.set(normals.getX(i), normals.getY(i), normals.getZ(i))
        const dot = Math.min(1, Math.max(-1, _normal.dot(_up)))
        result[i] = Math.acos(dot) * (180 / Math.PI)
    }
    return result
}

/**
 * Compute per-vertex approximate mean curvature via the umbrella operator.
 * Positive = concave (valley/pit), negative = convex (hilltop/ridge), zero = flat.
 * Computed as (avg_neighbor_position - vertex_position) projected onto vertex normal.
 *
 * Uses uniform weights (umbrella operator), not cotangent weights.
 * Reference: Taubin, G. (1995) "A Signal Processing Approach to Fair Surface Design"
 * https://doi.org/10.1145/218380.218473
 * Only works on indexed geometry.
 */
export function curvature(geo: BufferGeometry): Float32Array {
    const positions = geo.getAttribute('position') as BufferAttribute
    const index = geo.getIndex()
    if (!index) throw new Error('DerivedAttributes.curvature: geometry must be indexed.')
    if (!positions) throw new Error('DerivedAttributes.curvature: geometry has no positions.')

    const count = positions.count
    const result = new Float32Array(count)

    // Build adjacency: for each vertex, collect its connected neighbors
    const neighbors: Set<number>[] = new Array(count)
    for (let i = 0; i < count; i++) neighbors[i] = new Set()

    const indices = index.array
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2]
        neighbors[a].add(b); neighbors[a].add(c)
        neighbors[b].add(a); neighbors[b].add(c)
        neighbors[c].add(a); neighbors[c].add(b)
    }

    const pos = new Vector3()
    const avg = new Vector3()

    for (let i = 0; i < count; i++) {
        const nbrs = neighbors[i]
        if (nbrs.size === 0) { result[i] = 0; continue }

        pos.set(positions.getX(i), positions.getY(i), positions.getZ(i))
        avg.set(0, 0, 0)
        for (const n of nbrs) {
            avg.x += positions.getX(n)
            avg.y += positions.getY(n)
            avg.z += positions.getZ(n)
        }
        avg.divideScalar(nbrs.size)

        // Curvature ≈ signed distance from vertex to neighbor centroid, projected onto normal
        const normals = geo.getAttribute('normal') as BufferAttribute
        if (normals) {
            _normal.set(normals.getX(i), normals.getY(i), normals.getZ(i))
            result[i] = avg.sub(pos).dot(_normal)
        } else {
            result[i] = avg.sub(pos).length()
        }
    }

    return result
}

/**
 * Compute per-vertex normalized height.
 * 0 = lowest vertex Y in the geometry, 1 = highest vertex Y.
 */
export function normalizedHeight(geo: BufferGeometry): Float32Array {
    const positions = geo.getAttribute('position') as BufferAttribute
    if (!positions) throw new Error('DerivedAttributes.normalizedHeight: geometry has no positions.')

    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i)
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }

    const range = maxY - minY || 1
    const result = new Float32Array(positions.count)
    for (let i = 0; i < positions.count; i++) {
        result[i] = (positions.getY(i) - minY) / range
    }
    return result
}

/**
 * Store a computed attribute as a named BufferAttribute on the geometry.
 * Wraps BufferGeometry.setAttribute with proper BufferAttribute creation.
 */
export function store(geo: BufferGeometry, name: string, data: Float32Array, itemSize = 1): void {
    geo.setAttribute(name, new BufferAttribute(data, itemSize))
}

/**
 * Read a previously stored named attribute from the geometry.
 * Returns null if the attribute doesn't exist.
 */
export function read(geo: BufferGeometry, name: string): Float32Array | null {
    const attr = geo.getAttribute(name) as BufferAttribute | undefined
    if (!attr) return null
    return attr.array as Float32Array
}

/**
 * Smooth a per-vertex attribute using iterative topology-based neighbor averaging.
 * Analog of Blender's Blur Attribute node.
 *
 * Uses double-buffered iteration to avoid read-while-write artifacts.
 * Builds vertex adjacency from the index buffer, then for each vertex,
 * blends its value with the average of its connected neighbors.
 *
 * Reference: Blender node_geo_blur_attribute.cc
 * https://projects.blender.org/blender/blender/src/branch/main/source/blender/nodes/geometry/nodes/node_geo_blur_attribute.cc
 *
 * @param geo The geometry (must be indexed)
 * @param attrName Name of the attribute to smooth (must be stored via store())
 * @param iterations Number of smoothing passes
 * @param weight Blend factor 0-1 (0=no smoothing, 1=full neighbor average). Default 1.
 */
export function smoothAttribute(
    geo: BufferGeometry,
    attrName: string,
    iterations: number,
    weight = 1.0,
): void {
    const attr = geo.getAttribute(attrName) as BufferAttribute
    const index = geo.getIndex()
    if (!attr || !index) return

    const count = attr.count
    const itemSize = attr.itemSize

    // Build vertex adjacency from index buffer
    const neighbors: Set<number>[] = new Array(count)
    for (let i = 0; i < count; i++) neighbors[i] = new Set()
    const indices = index.array
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2]
        neighbors[a].add(b); neighbors[a].add(c)
        neighbors[b].add(a); neighbors[b].add(c)
        neighbors[c].add(a); neighbors[c].add(b)
    }

    // Double-buffered smoothing
    let src = new Float32Array(attr.array as Float32Array)
    let dst = new Float32Array(count * itemSize)

    for (let iter = 0; iter < iterations; iter++) {
        for (let v = 0; v < count; v++) {
            const nbrs = neighbors[v]
            if (nbrs.size === 0) {
                for (let c = 0; c < itemSize; c++) dst[v * itemSize + c] = src[v * itemSize + c]
                continue
            }
            for (let c = 0; c < itemSize; c++) {
                let avg = 0
                for (const n of nbrs) avg += src[n * itemSize + c]
                avg /= nbrs.size
                // Blend between original value and neighbor average
                dst[v * itemSize + c] = src[v * itemSize + c] * (1 - weight) + avg * weight
            }
        }
        const tmp = src; src = dst; dst = tmp
    }

    // Write result back
    attr.set(src)
    attr.needsUpdate = true
}

/**
 * Compute per-vertex aspect — compass direction each vertex faces (0-360 degrees).
 * 0/360 = North (+Z), 90 = East (+X), 180 = South (-Z), 270 = West (-X).
 * Useful for biome rules: north-facing slopes get more snow/shade,
 * south-facing slopes are drier.
 *
 * Formula: atan2(normal.x, normal.z) converted to 0-360 range.
 * Reference: standard GIS aspect calculation
 * https://pro.arcgis.com/en/pro-app/latest/tool-reference/3d-analyst/how-aspect-works.htm
 */
export function aspect(geo: BufferGeometry): Float32Array {
    const normals = geo.getAttribute('normal') as BufferAttribute
    if (!normals) throw new Error('DerivedAttributes.aspect: geometry has no normals')
    const result = new Float32Array(normals.count)
    for (let i = 0; i < normals.count; i++) {
        let angle = Math.atan2(normals.getX(i), normals.getZ(i)) * (180 / Math.PI)
        if (angle < 0) angle += 360
        result[i] = angle
    }
    return result
}
