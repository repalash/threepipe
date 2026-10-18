/**
 * Derived-data caches of a `MeshData`, modelled on Blender's `bke::MeshRuntime` (`blenkernel/BKE_mesh_types.hh`):
 * each cache is computed on demand, shared by copies of the mesh (`mesh_copy_data`, `blenkernel/intern/mesh.cc:144-170`
 * shares the `SharedCache`s), and dropped by the mesh's tag functions (`blenkernel/intern/mesh_runtime.cc:301-425`)
 * when the data it derives from changes.
 *
 * The kernel's `MeshData` has no runtime slot, so the runtime lives in a `WeakMap` here (see
 * `issues/open/modelling-tools/procedural-mesh-runtime-caches.md`). Every copy of a `MeshData` in this package goes
 * through {@link copyMesh}, and every in-place edit of positions or topology calls the matching tag function.
 *
 * Caches here are values computed from the mesh, or assigned by the code that built it (eager bounds,
 * `mesh_vert_normals_assign`); arrays stored in a cache are never written after they are stored, so copies share them.
 */

import {MeshData} from '@threepipe/mesh-kernel'
import type {Bounds3} from './meshBounds'

export interface MeshRuntime {
    /** `bounds_cache`. */
    bounds?: Bounds3
    /** `vert_normals_true_cache` / `face_normals_true_cache` (`meshNormals.ts`; custom normals are not supported, so these are the normals). */
    normals: {vert?: Float32Array, face?: Float32Array}
    /** `corner_tris_cache`, `corner_tri_faces_cache` and the `bvh_cache_*` trees (`meshBVH.ts`). */
    bvh: {verts?: unknown, edges?: unknown, tris?: unknown, cornerTris?: Int32Array, triFaces?: Int32Array}
    /** `vert_to_face_map_cache`, `vert_to_corner_map_cache`, `corner_to_face_map_cache`, loose element caches (`meshTopology.ts`). */
    topology: Record<string, unknown>
}

const runtimes = new WeakMap<MeshData, MeshRuntime>()

/** The mesh's runtime caches (created empty). */
export function meshRuntime(mesh: MeshData): MeshRuntime {
    let r = runtimes.get(mesh)
    if (!r) runtimes.set(mesh, r = {normals: {}, bvh: {}, topology: {}})
    return r
}

/**
 * A copy of `src` (`BKE_id_copy` / `mesh_copy_data`, `mesh.cc:105`): the data is copied and the derived caches are
 * shared (`mesh.cc:144-170`); later tags on either mesh only drop that mesh's caches.
 */
export function copyMesh(src: MeshData): MeshData {
    const dst = src.clone()
    const r = runtimes.get(src)
    if (r) {
        runtimes.set(dst, {
            bounds: r.bounds && {min: [...r.bounds.min], max: [...r.bounds.max]},
            normals: {...r.normals},
            bvh: {...r.bvh},
            topology: {...r.topology},
        })
    }
    return dst
}

/** `free_bvh_caches` (`mesh_runtime.cc:47`). */
function freeBVHCaches(r: MeshRuntime): void {
    delete r.bvh.verts
    delete r.bvh.edges
    delete r.bvh.tris
}

/** `Mesh::tag_positions_changed` (`mesh_runtime.cc:384`) with `tag_positions_changed_no_normals` (:395). */
export function meshTagPositionsChanged(mesh: MeshData): void {
    const r = runtimes.get(mesh)
    if (!r) return
    r.normals = {}
    freeBVHCaches(r)
    delete r.bvh.cornerTris
    delete r.bounds
}

/** `Mesh::tag_positions_changed_uniformly` (`mesh_runtime.cc:403`): every vertex moved by the same offset. */
export function meshTagPositionsChangedUniformly(mesh: MeshData): void {
    const r = runtimes.get(mesh)
    if (!r) return
    freeBVHCaches(r)
    delete r.bounds
}

/** `Mesh::tag_topology_changed` (`mesh_runtime.cc:410`) via `BKE_mesh_runtime_clear_geometry` (:301): every cache. */
export function meshTagTopologyChanged(mesh: MeshData): void {
    runtimes.delete(mesh)
}

/**
 * The built-in attribute change tags (`changed_tags`, `blenkernel/intern/mesh_attributes.cc:694`), run when an
 * attribute is written, added with data, or removed through the accessor. Of them only `position` drops caches kept
 * here: sharpness and custom normal tags drop `vert_normals_cache` / `face_normals_cache` / `corner_normals_cache`,
 * not the true normals (`mesh_runtime.cc:359-371`), and the material index and visibility caches are not modelled.
 */
export function meshAttributeChanged(mesh: MeshData, name: string): void {
    if (name === 'position') meshTagPositionsChanged(mesh)
}
