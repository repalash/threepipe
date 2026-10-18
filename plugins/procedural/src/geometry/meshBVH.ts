/**
 * BVH trees of meshes and point clouds as Blender builds them (`blenkernel/intern/bvhutils.cc`): every tree is
 * `BLI_bvhtree_new(n, 0.0f, 2, 6)` (`bvhtree_new_common` :431, a binary AABB tree inflated by FLT_EPSILON), with
 * the nearest-point callbacks `mesh_edges_nearest_point` (:221) and `mesh_corner_tris_nearest_point` (:115); vertex
 * and point trees have no callback (a point is as near as its inflated box). Trees are cached per mesh, like
 * `Mesh::runtime->bvh_cache_*` (meshes in a geometry set are immutable values).
 */

import {cornerTriFaces, cornerTrisCalc, MeshData} from '@threepipe/mesh-kernel'
import {BVHTree, BVHTreeNearest, BVHTreeRayHit, isectRayTriWatertight, NearestPointCallback, RayCastCallback} from '../blender/kdopbvh'
import {closestOnTriToPointV3, closestToLineSegmentV3, lenSquaredV3V3, normalTriV3} from '../blender/math/geom'
import {f32} from '../blender/f32'
import type {PointCloud} from './components'
import {meshRuntime} from './meshRuntime'

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

/** Point cloud trees (`PointCloud::runtime->bvh_cache`); mesh trees live in the mesh runtime (`meshRuntime.ts`). */
const caches = new WeakMap<object, Cache>()

function cache(owner: object): Cache {
    if (owner instanceof MeshData) return meshRuntime(owner).bvh as Cache
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
    if (owner instanceof MeshData) {
        const r = meshRuntime(owner)
        r.bvh = {}
        return
    }
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

/** `bvhtree_from_mesh_verts_init(mesh, verts_mask)` (:788): the cached full tree when every vertex is in the mask. */
export function meshBVHVertsForMask(mesh: MeshData, verts: readonly number[]): BVHTreeFromMesh {
    if (verts.length === mesh.vertsNum) return meshBVHVerts(mesh)
    return {tree: treeFromVerts(mesh.positions, verts, verts.length)}
}

/** `bvhtree_from_mesh_edges_init(mesh, edges_mask)` (:780) with `create_tree_from_edges` (:459). */
export function meshBVHEdgesForMask(mesh: MeshData, edges: readonly number[]): BVHTreeFromMesh {
    if (edges.length === mesh.edgesNum) return meshBVHEdges(mesh)
    const positions = mesh.positions, ev = mesh.edgeVerts
    const tree = newTree(edges.length)
    if (tree) {
        for (const e of edges) tree.insert(e, [...pos3(positions, ev[e * 2]), ...pos3(positions, ev[e * 2 + 1])], 2)
        tree.balance()
    }
    return {tree, callback: edgesNearestCallback(mesh)}
}

/** `bvhtree_from_pointcloud_get(pointcloud, points_mask)` (:829). */
export function pointCloudBVHForMask(pc: PointCloud, points: readonly number[]): BVHTreeFromMesh {
    if (points.length === pc.pointsNum) return pointCloudBVH(pc)
    return {tree: treeFromVerts(pc.positions, points, points.length)}
}

/**
 * `mesh_corner_tris_spherecast` (:184) for rays without a radius: `bvhtree_ray_tri_intersection` (:30, watertight)
 * and, for a nearer hit, the hit point `origin + direction * dist` and the triangle's normal (`normal_tri_v3`).
 */
export function trisRayCastCallback(mesh: MeshData): RayCastCallback {
    const tris = meshCornerTris(mesh)
    const positions = mesh.positions, cv = mesh.cornerVerts
    return (index, ray, hit: BVHTreeRayHit) => {
        const a = pos3(positions, cv[tris[index * 3]]), b = pos3(positions, cv[tris[index * 3 + 1]]), c = pos3(positions, cv[tris[index * 3 + 2]])
        const dist = isectRayTriWatertight(ray.origin, ray.isectPrecalc, a, b, c) ?? FLT_MAX
        if (dist >= 0 && dist < hit.dist) {
            hit.index = index
            hit.dist = dist
            const o = ray.origin, d = ray.direction
            hit.co = [f32(o[0] + f32(d[0] * dist)), f32(o[1] + f32(d[1] * dist)), f32(o[2] + f32(d[2] * dist))]
            hit.no = normalTriV3(a, b, c)
        }
    }
}

const FLT_MAX = 3.4028234663852886e38
