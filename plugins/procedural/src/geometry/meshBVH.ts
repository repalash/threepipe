/**
 * BVH trees of meshes and point clouds as Blender builds them (`blenkernel/intern/bvhutils.cc`): every tree is
 * `BLI_bvhtree_new(n, 0.0f, 2, 6)` (`bvhtree_new_common` :431, a binary AABB tree inflated by FLT_EPSILON), with
 * the nearest-point callbacks `mesh_edges_nearest_point` (:221) and `mesh_corner_tris_nearest_point` (:115); vertex
 * and point trees have no callback (a point is as near as its inflated box). Trees are cached per mesh, like
 * `Mesh::runtime->bvh_cache_*` (meshes in a geometry set are immutable values).
 */

import {cornerTriFaces, cornerTrisCalc, MeshData} from '@threepipe/mesh-kernel'
import {BVHTree, BVHTreeNearest, NearestPointCallback} from '../blender/kdopbvh'
import {closestOnTriToPointV3, closestToLineSegmentV3, lenSquaredV3V3} from '../blender/math/geom'
import type {PointCloud} from './components'

export interface BVHTreeFromMesh {
    tree: BVHTree | undefined
    callback?: NearestPointCallback
}

interface Cache {
    verts?: BVHTreeFromMesh
    edges?: BVHTreeFromMesh
    tris?: BVHTreeFromMesh
    cornerTris?: Int32Array
    triFaces?: Int32Array
}

const caches = new WeakMap<object, Cache>()

function cache(owner: object): Cache {
    let c = caches.get(owner)
    if (!c) caches.set(owner, c = {})
    return c
}

const pos3 = (positions: ArrayLike<number>, v: number) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]

/** `bvhtree_new_common` (:431): no tree for zero elements. */
function newTree(n: number): BVHTree | undefined {
    return n === 0 ? undefined : new BVHTree(n, 0, 2, 6)
}

/** `create_tree_from_verts` (:439). */
function treeFromVerts(positions: ArrayLike<number>, indices: Iterable<number>, n: number): BVHTree | undefined {
    const tree = newTree(n)
    if (!tree) return undefined
    for (const i of indices) tree.insert(i, pos3(positions, i), 1)
    tree.balance()
    return tree
}

function range(n: number): number[] {
    return Array.from({length: n}, (_, i) => i)
}

/** `Mesh::corner_tris()` (`bke::mesh::corner_tris_calc`), cached. */
export function meshCornerTris(mesh: MeshData): Int32Array {
    const c = cache(mesh)
    return c.cornerTris ??= cornerTrisCalc(mesh)
}

/** `Mesh::corner_tri_faces()`, cached. */
export function meshCornerTriFaces(mesh: MeshData): Int32Array {
    const c = cache(mesh)
    return c.triFaces ??= cornerTriFaces(mesh)
}

/** Drop the cached trees and triangulation of a geometry edited in place (`BKE_mesh_runtime_clear_cache`). */
export function tagBVHChanged(owner: object): void {
    caches.delete(owner)
}

/** `Mesh::bvh_verts()` (:668). */
export function meshBVHVerts(mesh: MeshData): BVHTreeFromMesh {
    const c = cache(mesh)
    return c.verts ??= {tree: treeFromVerts(mesh.positions, range(mesh.vertsNum), mesh.vertsNum)}
}

/** `mesh_edges_nearest_point` (:221). */
function edgesNearestCallback(mesh: MeshData): NearestPointCallback {
    const positions = mesh.positions, edges = mesh.edgeVerts
    return (index, co, nearest) => {
        const t0 = pos3(positions, edges[index * 2]), t1 = pos3(positions, edges[index * 2 + 1])
        const tmp = closestToLineSegmentV3(co, t0, t1)
        const distSq = lenSquaredV3V3(tmp, co)
        if (distSq < nearest.distSq) {
            nearest.index = index
            nearest.distSq = distSq
            nearest.co = tmp
        }
    }
}

/** `Mesh::bvh_edges()` (:705) with `create_tree_from_edges` (:459). */
export function meshBVHEdges(mesh: MeshData): BVHTreeFromMesh {
    const c = cache(mesh)
    if (c.edges) return c.edges
    const positions = mesh.positions, edges = mesh.edgeVerts
    const tree = newTree(mesh.edgesNum)
    if (tree) {
        for (let e = 0; e < mesh.edgesNum; e++) tree.insert(e, [...pos3(positions, edges[e * 2]), ...pos3(positions, edges[e * 2 + 1])], 2)
        tree.balance()
    }
    return c.edges = {tree, callback: edgesNearestCallback(mesh)}
}

/** `mesh_corner_tris_nearest_point` (:115). */
function trisNearestCallback(mesh: MeshData, tris: Int32Array): NearestPointCallback {
    const positions = mesh.positions, cv = mesh.cornerVerts
    return (index, co, nearest) => {
        const a = pos3(positions, cv[tris[index * 3]]), b = pos3(positions, cv[tris[index * 3 + 1]]), d = pos3(positions, cv[tris[index * 3 + 2]])
        const tmp = closestOnTriToPointV3(co, a, b, d)
        const distSq = lenSquaredV3V3(co, tmp)
        if (distSq < nearest.distSq) {
            nearest.index = index
            nearest.distSq = distSq
            nearest.co = tmp
        }
    }
}

/** Insert the corner triangles of `faces` (all faces when omitted) - `create_tree_from_tris` (:506, :525). */
function treeFromTris(mesh: MeshData, tris: Int32Array, faces?: readonly number[]): BVHTree | undefined {
    const positions = mesh.positions, cv = mesh.cornerVerts, fo = mesh.faceOffsets
    const insert = (tree: BVHTree, t: number) => tree.insert(t, [
        ...pos3(positions, cv[tris[t * 3]]), ...pos3(positions, cv[tris[t * 3 + 1]]), ...pos3(positions, cv[tris[t * 3 + 2]])], 3)
    if (!faces) {
        const n = tris.length / 3
        const tree = newTree(n)
        if (!tree) return undefined
        for (let t = 0; t < n; t++) insert(tree, t)
        tree.balance()
        return tree
    }
    let n = 0
    for (const f of faces) n += fo[f + 1] - fo[f] - 2
    const tree = newTree(n)
    if (!tree) return undefined
    for (const f of faces) {
        // `face_triangles_range`: `poly_to_tri_count(face, start)` .. + size - 2.
        const first = fo[f] - 2 * f
        for (let t = first; t < first + (fo[f + 1] - fo[f]) - 2; t++) insert(tree, t)
    }
    tree.balance()
    return tree
}

/** `Mesh::bvh_corner_tris()` (:756). */
export function meshBVHCornerTris(mesh: MeshData): BVHTreeFromMesh {
    const c = cache(mesh)
    if (c.tris) return c.tris
    const tris = meshCornerTris(mesh)
    return c.tris = {tree: treeFromTris(mesh, tris), callback: trisNearestCallback(mesh, tris)}
}

/** `bvhtree_from_mesh_tris_init(mesh, faces_mask)` (:771): the cached full tree when every face is in the mask. */
export function meshBVHTrisForFaces(mesh: MeshData, faces: readonly number[]): BVHTreeFromMesh {
    if (faces.length === mesh.facesNum) return meshBVHCornerTris(mesh)
    const tris = meshCornerTris(mesh)
    return {tree: treeFromTris(mesh, tris, faces), callback: trisNearestCallback(mesh, tris)}
}

/** `PointCloud::bvh_tree()` (:841). */
export function pointCloudBVH(pc: PointCloud): BVHTreeFromMesh {
    const c = cache(pc)
    return c.verts ??= {tree: treeFromVerts(pc.positions, range(pc.pointsNum), pc.pointsNum)}
}

/** `BLI_bvhtree_find_nearest(tree, co, nearest, tree_data.nearest_callback, ...)`. */
export function bvhFindNearest(data: BVHTreeFromMesh, co: readonly number[], nearest: BVHTreeNearest): number {
    if (!data.tree) return nearest.index
    return data.tree.findNearest(co, nearest, data.callback)
}
