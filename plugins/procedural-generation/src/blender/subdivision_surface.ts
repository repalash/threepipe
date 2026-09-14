/**
 * Catmull-Clark subdivision surface.
 *
 * Ported from gl-catmull-clark (MIT license):
 *   https://github.com/Erkaman/gl-catmull-clark
 *
 * Blender node source reference:
 *   source/blender/nodes/geometry/nodes/node_geo_subdivision_surface.cc
 *   (Blender uses OpenSubdiv internally; this is a standalone Catmull-Clark implementation)
 *
 * Takes positions as number[][] and faces as number[][] (triangles or quads).
 * Returns subdivided positions and faces (as quads, optionally converted to triangles).
 */

import type {BufferGeometry} from 'threepipe'

// ─── Internal types ──────────────────────────────────────────────────

interface PointObj {
    point: [number, number, number]
    faces: FaceObj[]
    edges: Set<EdgeObj>
    newPoint?: [number, number, number]
}

interface FaceObj {
    points: PointObj[]
    edges: EdgeObj[]
    facePoint: [number, number, number]
}

interface EdgeObj {
    points: [PointObj, PointObj]
    faces: FaceObj[]
    edgePoint?: [number, number, number]
    midPoint?: [number, number, number]
}

// ─── Vector helpers (replace gl-vec3) ────────────────────────────────

function vec3Add(out: number[], a: number[], b: number[]): number[] {
    out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]
    return out
}

function vec3Scale(out: number[], a: number[], s: number): number[] {
    out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s
    return out
}

function mad(out: number[], a: number[], b: number[], s: number): number[] {
    out[0] = a[0] + s * b[0]; out[1] = a[1] + s * b[1]; out[2] = a[2] + s * b[2]
    return out
}

// ─── Core Catmull-Clark ──────────────────────────────────────────────

function sortEdge(e: [number, number]): [number, number] {
    return e[0] < e[1] ? e : [e[1], e[0]]
}

function catmullClarkStep(positions: number[][], cells: number[][]): {positions: number[][], cells: number[][]} {
    const originalPoints: PointObj[] = []
    const faces: FaceObj[] = []
    const edges: Record<string, EdgeObj> = {}

    // Build adjacency data
    for (let iCell = 0; iCell < cells.length; iCell++) {
        const cellVerts = cells[iCell]
        const facePoints: PointObj[] = []
        const face: FaceObj = {points: [], edges: [], facePoint: [0, 0, 0]}
        faces[iCell] = face

        // Create/get point objects
        for (const vi of cellVerts) {
            if (!originalPoints[vi]) {
                const v = positions[vi]
                originalPoints[vi] = {
                    point: [v[0], v[1], v[2]],
                    faces: [],
                    edges: new Set(),
                }
            }
            originalPoints[vi].faces.push(face)
            facePoints.push(originalPoints[vi])
        }
        face.points = facePoints

        // Compute face point (average of face vertices)
        const avg: [number, number, number] = [0, 0, 0]
        for (const p of face.points) vec3Add(avg, avg, p.point)
        vec3Scale(avg, avg, 1.0 / face.points.length)
        face.facePoint = avg

        // Create/get edge objects
        const faceEdges: EdgeObj[] = []
        for (let iEdge = 0; iEdge < cellVerts.length; iEdge++) {
            const a = cellVerts[iEdge]
            const b = cellVerts[(iEdge + 1) % cellVerts.length]
            const key = sortEdge([a, b]).join(',')

            if (!edges[key]) {
                edges[key] = {
                    points: [originalPoints[a], originalPoints[b]],
                    faces: [],
                }
            }
            const edgeObj = edges[key]
            edgeObj.faces.push(face)
            edgeObj.points[0].edges.add(edgeObj)
            edgeObj.points[1].edges.add(edgeObj)
            faceEdges.push(edgeObj)
        }
        face.edges = faceEdges
    }

    // Compute edge points and midpoints
    // Boundary edges have exactly 1 adjacent face
    for (const key in edges) {
        const edge = edges[key]
        const isBoundary = edge.faces.length === 1

        if (isBoundary) {
            // Boundary edge point = midpoint of the two endpoints
            const mid: [number, number, number] = [0, 0, 0]
            for (const p of edge.points) vec3Add(mid, mid, p.point)
            vec3Scale(mid, mid, 0.5)
            edge.edgePoint = mid
        } else {
            // Interior edge point = average of face points + endpoints
            const avg: [number, number, number] = [0, 0, 0]
            let count = 0
            for (const f of edge.faces) { vec3Add(avg, avg, f.facePoint); count++ }
            for (const p of edge.points) { vec3Add(avg, avg, p.point); count++ }
            vec3Scale(avg, avg, 1.0 / count)
            edge.edgePoint = avg
        }

        const mid: [number, number, number] = [0, 0, 0]
        for (const p of edge.points) vec3Add(mid, mid, p.point)
        vec3Scale(mid, mid, 0.5)
        edge.midPoint = mid
    }

    // Move original points
    for (let i = 0; i < positions.length; i++) {
        const point = originalPoints[i]
        if (!point) continue

        // Check if this is a boundary vertex (has any boundary edge)
        const boundaryEdges: EdgeObj[] = []
        for (const e of point.edges) {
            if (e.faces.length === 1) boundaryEdges.push(e)
        }

        if (boundaryEdges.length >= 2) {
            // Boundary vertex: average of adjacent boundary edge midpoints and original point
            // new_point = (sum of boundary midpoints + original) / (count + 1)
            // Standard Catmull-Clark boundary rule: (M1 + M2 + 6*P) / 8 for valence-2 boundary
            const np: [number, number, number] = [0, 0, 0]
            for (const e of boundaryEdges) vec3Add(np, np, e.midPoint!)
            mad(np, np, point.point, 6)
            vec3Scale(np, np, 1.0 / 8)
            point.newPoint = np
        } else {
            // Interior vertex: (F + 2R + (n-3)P) / n
            const n = point.faces.length
            const np: [number, number, number] = [0, 0, 0]
            for (const f of point.faces) vec3Add(np, np, f.facePoint)
            for (const e of point.edges) mad(np, np, e.midPoint!, 2)
            vec3Scale(np, np, 1.0 / n)
            mad(np, np, point.point, n - 3)
            vec3Scale(np, np, 1.0 / n)
            point.newPoint = np
        }
    }

    // Generate new topology
    const newPositions: number[][] = []
    const newCells: number[][] = []
    let index = 0

    const indexCache = new Map<object, number>()
    function getIndex(p: number[]): number {
        if (!indexCache.has(p)) {
            indexCache.set(p, index++)
            newPositions.push([p[0], p[1], p[2]])
        }
        return indexCache.get(p)!
    }

    for (const face of faces) {
        for (let iPoint = 0; iPoint < face.points.length; iPoint++) {
            const a = face.points[iPoint].newPoint!
            const b = face.edges[iPoint % face.edges.length].edgePoint!
            const c = face.facePoint
            const d = face.edges[(iPoint + face.edges.length - 1) % face.edges.length].edgePoint!

            newCells.push([getIndex(d), getIndex(a), getIndex(b), getIndex(c)])
        }
    }

    return {positions: newPositions, cells: newCells}
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Catmull-Clark subdivision surface.
 *
 * @param positions - vertex positions as [[x,y,z], ...]
 * @param cells - faces as [[i,j,k], ...] (triangles) or [[i,j,k,l], ...] (quads/n-gons)
 * @param levels - number of subdivision iterations (1-6)
 * @param toTriangles - if true, convert output quads to triangles (default true)
 */
export function catmullClark(
    positions: number[][],
    cells: number[][],
    levels: number,
    toTriangles = true,
): {positions: number[][], cells: number[][]} {
    if (levels < 1) return {positions, cells}

    let result = {positions, cells}
    for (let i = 0; i < Math.min(levels, 6); i++) {
        result = catmullClarkStep(result.positions, result.cells)
    }

    if (toTriangles) {
        const triCells: number[][] = []
        for (const cell of result.cells) {
            if (cell.length === 4) {
                triCells.push([cell[0], cell[1], cell[2]])
                triCells.push([cell[0], cell[2], cell[3]])
            } else if (cell.length === 3) {
                triCells.push(cell)
            } else {
                // n-gon fan triangulation
                for (let i = 1; i < cell.length - 1; i++) {
                    triCells.push([cell[0], cell[i], cell[i + 1]])
                }
            }
        }
        result.cells = triCells
    }

    return result
}

/**
 * Apply Catmull-Clark subdivision to a three.js BufferGeometry.
 * Returns a new BufferGeometry with subdivided vertices and faces.
 *
 * source: node_geo_subdivision_surface.cc (uses OpenSubdiv internally;
 *         this uses the Wikipedia Catmull-Clark algorithm via gl-catmull-clark)
 */
export function subdivisionSurface(geometry: BufferGeometry, level: number): BufferGeometry {
    if (level < 1) return geometry

    // Extract positions and cells from BufferGeometry
    const posAttr = geometry.getAttribute('position')
    const positions: number[][] = []
    for (let i = 0; i < posAttr.count; i++) {
        positions.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)])
    }

    const indexAttr = geometry.getIndex()
    const cells: number[][] = []
    if (indexAttr) {
        // Try to detect quads vs triangles from the mesh
        // For now, always treat as triangles (GLB is always triangulated)
        for (let i = 0; i < indexAttr.count; i += 3) {
            cells.push([indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2)])
        }
    } else {
        for (let i = 0; i < posAttr.count; i += 3) {
            cells.push([i, i + 1, i + 2])
        }
    }

    // Run Catmull-Clark
    const result = catmullClark(positions, cells, level, true)

    // Build new BufferGeometry using the same constructor as the input
    const indices: number[] = []
    for (const cell of result.cells) {
        for (const idx of cell) indices.push(idx)
    }
    const Ctor = geometry.constructor as any
    const newGeom = new Ctor() as BufferGeometry
    // Use dynamic import-free approach: create typed arrays and set via geometry methods
    const posArray = new Float32Array(result.positions.length * 3)
    for (let i = 0; i < result.positions.length; i++) {
        posArray[i * 3] = result.positions[i][0]
        posArray[i * 3 + 1] = result.positions[i][1]
        posArray[i * 3 + 2] = result.positions[i][2]
    }
    // Access the BufferAttribute constructor from the existing geometry's position attribute
    const AttrCtor = geometry.getAttribute('position').constructor as any
    newGeom.setAttribute('position', new AttrCtor(posArray, 3))
    newGeom.setIndex(Array.from(indices))
    newGeom.computeVertexNormals()

    return newGeom
}
