/**
 * Baking a {@link MeshData} into renderable buffers.
 *
 * One-way and derived: the mesh is the source of truth and the buffers are a cache. Never read edits
 * back out of them.
 *
 * This module emits **plain typed arrays**, not `BufferGeometry`. The kernel imports nothing, not even
 * three: in this repo three's module scope constructs a `Texture`, which touches `ImageData` and so
 * fails to even load under Node. Keeping the bake dependency-free is what lets the kernel run headless.
 * Use {@link geometryDataToBufferGeometry} on the render side, passing the three module in.
 *
 * Follows Blender's draw path (`draw/intern/mesh_extractors/`): every buffer is **corner-indexed**,
 * so each face-vertex incidence gets its own vertex in the output. That is what makes per-corner data
 * such as UV seams and split normals representable without welding decisions, and it means the
 * triangle index buffer is just the tessellation.
 *
 * n-gons are tessellated by projecting to the face's dominant plane and ear-clipping, the same
 * approach as `bmesh_calc_tessellation_for_face_impl` with `BLI_polyfill_calc`. Triangles and convex
 * quads take fast paths.
 */

import {MeshData} from './MeshData'
import {AttrDomain, AttrName, ATTR_TYPE_INFO} from './constants'
import {AttributeLayer} from './attributes'
import {meshCornerNormals} from './normals'

export interface BakeOptions {
    /**
     * Corner attribute to write as `uv`. Defaults to the first float2 corner layer found.
     * Pass null to skip UVs entirely.
     */
    uvLayer?: string | null
    /** Also emit a `faceIndex` attribute per vertex, so picking can map a hit back to a face. */
    includeFaceIndex?: boolean
    /** Emit normals. Face normals are used for flat faces, smoothed ones otherwise. */
    includeNormals?: boolean
    /**
     * Leave hidden faces (`.hide_poly`) out of the index buffer, as Blender's edit-mode draw does. The
     * positions and corner attributes are still emitted for every corner, so `triangleToFace` and
     * `vertexToCorner` keep their meaning; only the triangles are missing.
     */
    skipHidden?: boolean
}

/** Plain-array geometry, ready to be handed to any renderer. */
export interface GeometryData {
    /** Corner-indexed positions, `cornersNum * 3`. */
    position: Float32Array
    normal?: Float32Array
    uv?: Float32Array
    /** Per-vertex source face index, when requested. */
    faceIndex?: Float32Array
    index: Uint32Array
    /** Material runs over the index buffer, matching three's `addGroup` arguments. */
    groups: {start: number, count: number, materialIndex: number}[]
}

export interface BakeResult {
    data: GeometryData
    /** Source face index for each output triangle; length is the triangle count. */
    triangleToFace: Int32Array
    /** Source corner index for each output vertex; length is `cornersNum`. */
    vertexToCorner: Int32Array
}

/** Index of the largest component, used to pick the projection plane. */
function dominantAxis(n: readonly number[]): number {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2])
    return ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2)
}

function triangleArea2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function pointInTriangle(
    px: number, py: number,
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
    const d1 = triangleArea2(px, py, ax, ay, bx, by)
    const d2 = triangleArea2(px, py, bx, by, cx, cy)
    const d3 = triangleArea2(px, py, cx, cy, ax, ay)
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
}

/**
 * Ear-clip a simple polygon given as 2D coordinates, emitting local index triples.
 * Falls back to a fan if the polygon is degenerate, so a bad face costs quality rather than crashing.
 */
function earClip(xs: number[], ys: number[], out: number[]): void {
    const n = xs.length
    if (n < 3) return
    if (n === 3) {
        out.push(0, 1, 2)
        return
    }

    // Work on a doubly linked ring so clipping is O(1) per removal.
    const prev: number[] = new Array(n)
    const next: number[] = new Array(n)
    for (let i = 0; i < n; i++) {
        prev[i] = (i + n - 1) % n
        next[i] = (i + 1) % n
    }

    // Orientation decides which turn direction counts as convex.
    let area = 0
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        area += xs[i] * ys[j] - xs[j] * ys[i]
    }
    const sign = area >= 0 ? 1 : -1

    let remaining = n
    let current = 0
    let guard = 0
    const guardLimit = n * n + 16

    while (remaining > 3 && guard++ < guardLimit) {
        const p = prev[current]
        const q = current
        const r = next[current]

        const convex = sign * triangleArea2(xs[p], ys[p], xs[q], ys[q], xs[r], ys[r]) > 0
        let isEar = convex
        if (isEar) {
            // No other vertex may lie inside the candidate ear.
            for (let k = next[r]; k !== p; k = next[k]) {
                if (pointInTriangle(xs[k], ys[k], xs[p], ys[p], xs[q], ys[q], xs[r], ys[r])) {
                    isEar = false
                    break
                }
            }
        }

        if (isEar) {
            out.push(p, q, r)
            next[p] = r
            prev[r] = p
            remaining--
            current = p
        } else {
            current = r
        }
    }

    if (remaining === 3) {
        const p = prev[current]
        out.push(p, current, next[current])
    } else {
        // Degenerate or self-intersecting: a fan still covers the face.
        out.length = 0
        for (let i = 1; i < n - 1; i++) out.push(0, i, i + 1)
    }
}

/**
 * Triangulate one polygon given as a flat list of 3D points, appending local index triples to `out`.
 *
 * The polygon is projected onto the axis plane its Newell normal faces most, then ear-clipped - the
 * same path {@link bakeGeometry} takes for every face, exported so anything else that has to draw or
 * hit-test faces (edit-mode overlays, selection buffers) triangulates them identically.
 */
export function tessellatePolygon(points: ArrayLike<number>, out: number[]): void {
    const n = points.length / 3
    if (n < 3) return
    if (n === 3) {
        out.push(0, 1, 2)
        return
    }
    let nx = 0, ny = 0, nz = 0
    for (let i = 0; i < n; i++) {
        const a = i * 3
        const b = ((i + 1) % n) * 3
        nx += (points[a + 1] - points[b + 1]) * (points[a + 2] + points[b + 2])
        ny += (points[a + 2] - points[b + 2]) * (points[a] + points[b])
        nz += (points[a] - points[b]) * (points[a + 1] + points[b + 1])
    }
    const len = Math.hypot(nx, ny, nz)
    const normal = len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1]
    const axis = dominantAxis(normal)
    // Project onto the plane most facing the normal, dropping the dominant axis.
    const ia = axis === 0 ? 1 : 0
    const ib = axis === 2 ? 1 : 2
    // Flip one axis for negative-facing normals so the winding survives projection.
    const flip = normal[axis] < 0
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < n; i++) {
        xs.push(points[i * 3 + ia])
        ys.push(flip ? -points[i * 3 + ib] : points[i * 3 + ib])
    }
    earClip(xs, ys, out)
}

/** Pick a sensible default UV layer: the first float2 layer on the corner domain. */
function defaultUvLayer(mesh: MeshData): AttributeLayer | undefined {
    return mesh.attributes.layersOnDomain(AttrDomain.Corner)
        .find(l => l.type === 'float2' && !l.name.startsWith('.'))
}

/**
 * Tessellate and flatten a mesh into renderable buffers.
 *
 * The result is corner-indexed: one output vertex per corner, so per-corner UVs and split normals
 * survive without welding. {@link BakeResult.triangleToFace} maps each output triangle back to its
 * source face, which is what element picking needs.
 */
export function bakeGeometry(mesh: MeshData, options: BakeOptions = {}): BakeResult {
    const problems = mesh.validate()
    if (problems.length) {
        throw new Error(`mesh-kernel: cannot bake an invalid MeshData:\n  ${problems.slice(0, 8).join('\n  ')}`)
    }

    const cornersNum = mesh.cornersNum
    const positions = mesh.positions
    const cornerVerts = mesh.cornerVerts

    const outPos = new Float32Array(cornersNum * 3)
    const vertexToCorner = new Int32Array(cornersNum)
    for (let c = 0; c < cornersNum; c++) {
        const v = cornerVerts[c] * 3
        outPos[c * 3] = positions[v]
        outPos[c * 3 + 1] = positions[v + 1]
        outPos[c * 3 + 2] = positions[v + 2]
        vertexToCorner[c] = c
    }

    // --- tessellate ---
    const indices: number[] = []
    const triangleToFaceList: number[] = []
    const points: number[] = []
    const local: number[] = []

    const hidden = options.skipHidden ? mesh.attributes.get(AttrName.hideFace)?.data : undefined

    for (let f = 0; f < mesh.facesNum; f++) {
        if (hidden && hidden[f]) continue
        const start = mesh.faceOffsets[f]
        const end = mesh.faceOffsets[f + 1]
        const size = end - start

        if (size === 3) {
            indices.push(start, start + 1, start + 2)
            triangleToFaceList.push(f)
            continue
        }

        points.length = 0
        for (let c = start; c < end; c++) {
            const p = cornerVerts[c] * 3
            points.push(positions[p], positions[p + 1], positions[p + 2])
        }

        local.length = 0
        tessellatePolygon(points, local)
        for (let i = 0; i < local.length; i += 3) {
            indices.push(start + local[i], start + local[i + 1], start + local[i + 2])
            triangleToFaceList.push(f)
        }
    }

    const data: GeometryData = {
        position: outPos,
        index: Uint32Array.from(indices),
        groups: [],
    }

    // --- normals ---
    if (options.includeNormals !== false) {
        // the corner-indexed bake takes Blender's corner normals directly (custom normals included)
        data.normal = meshCornerNormals(mesh)
    }

    // --- uvs ---
    if (options.uvLayer !== null) {
        const layer = options.uvLayer
            ? mesh.attributes.require(options.uvLayer, AttrDomain.Corner, 'float2')
            : defaultUvLayer(mesh)
        if (layer) {
            const uv = new Float32Array(cornersNum * 2)
            uv.set(layer.data.subarray(0, cornersNum * 2) as never)
            data.uv = uv
        }
    }

    // --- material groups, one run per contiguous material slot ---
    const materialIndex = mesh.attributes.get(AttrName.materialIndex)
    if (materialIndex && mesh.materials.length > 1) {
        let runStart = 0
        let runMat = triangleToFaceList.length ? materialIndex.data[triangleToFaceList[0]] : 0
        for (let t = 1; t <= triangleToFaceList.length; t++) {
            const mat = t < triangleToFaceList.length ? materialIndex.data[triangleToFaceList[t]] : -1
            if (mat !== runMat) {
                data.groups.push({start: runStart * 3, count: (t - runStart) * 3, materialIndex: runMat})
                runStart = t
                runMat = mat
            }
        }
    }

    if (options.includeFaceIndex) {
        const faceIndexAttr = new Float32Array(cornersNum)
        for (let f = 0; f < mesh.facesNum; f++) {
            for (let c = mesh.faceOffsets[f]; c < mesh.faceOffsets[f + 1]; c++) faceIndexAttr[c] = f
        }
        data.faceIndex = faceIndexAttr
    }

    return {
        data,
        triangleToFace: Int32Array.from(triangleToFaceList),
        vertexToCorner,
    }
}

/**
 * Minimal structural view of the parts of three this module needs, so the kernel can build a
 * `BufferGeometry` without importing three. Pass the real module: `geometryDataToBufferGeometry(data,
 * THREE)`. The same injectable-backend pattern Babylon uses for its WASM CSG.
 */
export interface ThreeGeometryCtors {
    BufferGeometry: new () => {
        setAttribute(name: string, attr: unknown): unknown
        setIndex(index: unknown): unknown
        addGroup(start: number, count: number, materialIndex?: number): unknown
        computeBoundingBox(): void
        computeBoundingSphere(): void
    }
    BufferAttribute: new (array: ArrayLike<number>, itemSize: number) => unknown
}

/** Build a three `BufferGeometry` from baked {@link GeometryData}. Render side only. */
export function geometryDataToBufferGeometry<T>(data: GeometryData, three: ThreeGeometryCtors): T {
    const {BufferGeometry, BufferAttribute} = three
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(data.position, 3))
    if (data.normal) geometry.setAttribute('normal', new BufferAttribute(data.normal, 3))
    if (data.uv) geometry.setAttribute('uv', new BufferAttribute(data.uv, 2))
    if (data.faceIndex) geometry.setAttribute('faceIndex', new BufferAttribute(data.faceIndex, 1))
    geometry.setIndex(new BufferAttribute(data.index, 1))
    for (const g of data.groups) geometry.addGroup(g.start, g.count, g.materialIndex)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry as T
}

/** Number of triangles a face will tessellate into. Useful for sizing buffers ahead of a bake. */
export function faceTriangleCount(mesh: MeshData, face: number): number {
    return Math.max(0, mesh.faceSize(face) - 2)
}

/** Total triangles the mesh will bake into. */
export function totalTriangleCount(mesh: MeshData): number {
    let total = 0
    for (let f = 0; f < mesh.facesNum; f++) total += faceTriangleCount(mesh, f)
    return total
}

/** Re-export so callers can size attribute arrays without importing constants directly. */
export {ATTR_TYPE_INFO}

