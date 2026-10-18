/**
 * Derived topology of a `MeshData`, cached per mesh like Blender's `Mesh::runtime` caches
 * (`blenkernel/BKE_mesh_types.hh`): vertex-to-face map, corner-to-face map, loose vertices and edges.
 *
 * Meshes inside a geometry set are treated as immutable; a node that edits one in place must call
 * {@link tagTopologyChanged} (Blender: `Mesh::tag_topology_changed`) before reading derived data again.
 */

import type {MeshData} from '@threepipe/mesh-kernel'
import {meshRuntime, meshTagTopologyChanged} from './meshRuntime'

export interface GroupedIndices {
    /** `size + 1` offsets into {@link indices}. */
    offsets: Int32Array
    indices: Int32Array
}

interface TopologyCache {
    vertToFace?: GroupedIndices
    vertToEdge?: GroupedIndices
    vertToCorner?: GroupedIndices
    edgeToFace?: GroupedIndices
    cornerToFace?: Int32Array
    looseVerts?: Uint8Array
    looseVertsCount?: number
    vertsNoFace?: Uint8Array
    vertsNoFaceCount?: number
    looseEdges?: Uint8Array
    looseEdgesCount?: number
}

/** The topology caches in the mesh's runtime (`meshRuntime.ts`, shared by copies). */
function cache(mesh: MeshData): TopologyCache {
    return meshRuntime(mesh).topology as TopologyCache
}

/** Drop every cached topology map of `mesh` - `Mesh::tag_topology_changed`, which clears every runtime cache. */
export function tagTopologyChanged(mesh: MeshData): void {
    meshTagTopologyChanged(mesh)
}

/** `offset_indices::build_reverse_offsets` (`blenlib/intern/offset_indices.cc`). */
function reverseOffsets(indices: ArrayLike<number>, size: number): Int32Array {
    const offsets = new Int32Array(size + 1)
    for (let i = 0; i < indices.length; i++) offsets[indices[i]]++
    let acc = 0
    for (let i = 0; i < size; i++) {
        const n = offsets[i]
        offsets[i] = acc
        acc += n
    }
    offsets[size] = acc
    return offsets
}

/** `offset_indices::sort_groups`: every group ascending. */
function sortGroups(g: GroupedIndices): void {
    for (let i = 0; i + 1 < g.offsets.length; i++) {
        const a = g.offsets[i], b = g.offsets[i + 1]
        if (b - a > 1) g.indices.subarray(a, b).sort()
    }
}

/**
 * `bke::mesh::build_vert_to_face_map` (`blenkernel/intern/mesh_mapping.cc:329`): faces around each
 * vertex, ascending (`reverse_group_indices_in_groups` + `sort_groups`, `:273`).
 */
export function vertToFaceMap(mesh: MeshData): GroupedIndices {
    const c = cache(mesh)
    if (c.vertToFace) return c.vertToFace
    const cornerVerts = mesh.cornerVerts
    const offsets = reverseOffsets(cornerVerts, mesh.vertsNum)
    const indices = new Int32Array(offsets[mesh.vertsNum])
    const counts = new Int32Array(mesh.vertsNum)
    const fo = mesh.faceOffsets
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let k = fo[f]; k < fo[f + 1]; k++) {
            const v = cornerVerts[k]
            indices[offsets[v] + counts[v]++] = f
        }
    }
    c.vertToFace = {offsets, indices}
    sortGroups(c.vertToFace)
    return c.vertToFace
}

/** `bke::mesh::build_vert_to_edge_map` (`mesh_mapping.cc:292`): edges around each vertex, ascending. */
export function vertToEdgeMap(mesh: MeshData): GroupedIndices {
    const c = cache(mesh)
    if (c.vertToEdge) return c.vertToEdge
    const ev = mesh.edgeVerts
    const offsets = reverseOffsets(ev, mesh.vertsNum)
    const indices = new Int32Array(offsets[mesh.vertsNum])
    const counts = new Int32Array(mesh.vertsNum)
    for (let e = 0; e < mesh.edgesNum; e++) {
        for (const v of [ev[e * 2], ev[e * 2 + 1]]) indices[offsets[v] + counts[v]++] = e
    }
    c.vertToEdge = {offsets, indices}
    sortGroups(c.vertToEdge)
    return c.vertToEdge
}

/** `bke::mesh::build_vert_to_corner_map` (`mesh_mapping.cc:349`): corners of each vertex, ascending. */
export function vertToCornerMap(mesh: MeshData): GroupedIndices {
    const c = cache(mesh)
    if (c.vertToCorner) return c.vertToCorner
    const cv = mesh.cornerVerts
    const offsets = reverseOffsets(cv, mesh.vertsNum)
    const indices = new Int32Array(offsets[mesh.vertsNum])
    const counts = new Int32Array(mesh.vertsNum)
    for (let k = 0; k < cv.length; k++) indices[offsets[cv[k]] + counts[cv[k]]++] = k
    c.vertToCorner = {offsets, indices}
    return c.vertToCorner
}

/** `bke::mesh::build_edge_to_face_map` (`mesh_mapping.cc`): faces around each edge, ascending. */
export function edgeToFaceMap(mesh: MeshData): GroupedIndices {
    const c = cache(mesh)
    if (c.edgeToFace) return c.edgeToFace
    const ce = mesh.cornerEdges
    const offsets = reverseOffsets(ce, mesh.edgesNum)
    const indices = new Int32Array(offsets[mesh.edgesNum])
    const counts = new Int32Array(mesh.edgesNum)
    const fo = mesh.faceOffsets
    for (let f = 0; f < mesh.facesNum; f++) {
        for (let k = fo[f]; k < fo[f + 1]; k++) {
            const e = ce[k]
            indices[offsets[e] + counts[e]++] = f
        }
    }
    c.edgeToFace = {offsets, indices}
    sortGroups(c.edgeToFace)
    return c.edgeToFace
}

/** `bke::mesh::build_corner_to_face_map` (`mesh_mapping.cc:290`). */
export function cornerToFaceMap(mesh: MeshData): Int32Array {
    const c = cache(mesh)
    if (c.cornerToFace) return c.cornerToFace
    const out = new Int32Array(mesh.cornersNum)
    const fo = mesh.faceOffsets
    for (let f = 0; f < mesh.facesNum; f++) out.fill(f, fo[f], fo[f + 1])
    c.cornerToFace = out
    return out
}

/** `Mesh::loose_verts()` (`mesh_runtime.cc`): vertices used by no edge. 1 = loose. */
export function looseVerts(mesh: MeshData): {mask: Uint8Array, count: number} {
    const c = cache(mesh)
    if (!c.looseVerts) {
        const mask = new Uint8Array(mesh.vertsNum).fill(1)
        const ev = mesh.edgeVerts
        for (let i = 0; i < ev.length; i++) mask[ev[i]] = 0
        c.looseVerts = mask
        c.looseVertsCount = mask.reduce((a, b) => a + b, 0)
    }
    return {mask: c.looseVerts, count: c.looseVertsCount!}
}

/** `Mesh::verts_no_face()` (`mesh_runtime.cc`): vertices used by no face. 1 = no face. */
export function vertsNoFace(mesh: MeshData): {mask: Uint8Array, count: number} {
    const c = cache(mesh)
    if (!c.vertsNoFace) {
        const mask = new Uint8Array(mesh.vertsNum).fill(1)
        const cv = mesh.cornerVerts
        for (let i = 0; i < cv.length; i++) mask[cv[i]] = 0
        c.vertsNoFace = mask
        c.vertsNoFaceCount = mask.reduce((a, b) => a + b, 0)
    }
    return {mask: c.vertsNoFace, count: c.vertsNoFaceCount!}
}

/** `Mesh::loose_edges()` (`mesh_runtime.cc`): edges used by no face. 1 = loose. */
export function looseEdges(mesh: MeshData): {mask: Uint8Array, count: number} {
    const c = cache(mesh)
    if (!c.looseEdges) {
        const mask = new Uint8Array(mesh.edgesNum).fill(1)
        const ce = mesh.cornerEdges
        for (let i = 0; i < ce.length; i++) mask[ce[i]] = 0
        c.looseEdges = mask
        c.looseEdgesCount = mask.reduce((a, b) => a + b, 0)
    }
    return {mask: c.looseEdges, count: c.looseEdgesCount!}
}

/** `mesh::face_find_corner_from_vert` (`BKE_mesh.hh`): first corner of the face using `vert`. */
export function faceFindCornerFromVert(mesh: MeshData, face: number, vert: number): number {
    const cv = mesh.cornerVerts
    for (let k = mesh.faceOffsets[face]; k < mesh.faceOffsets[face + 1]; k++) if (cv[k] === vert) return k
    return -1
}

/** `mesh::face_corner_next` / `face_corner_prev` (`BKE_mesh.hh`). */
export function faceCornerNext(start: number, end: number, corner: number): number {
    return corner === end - 1 ? start : corner + 1
}

export function faceCornerPrev(start: number, end: number, corner: number): number {
    return corner === start ? end - 1 : corner - 1
}
