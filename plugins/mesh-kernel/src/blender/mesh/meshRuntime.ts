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

import {MeshData} from '../../MeshData'

export interface MeshRuntime {
    /** `bounds_cache`. */
    bounds?: Bounds3
    /** `vert_normals_true_cache` / `face_normals_true_cache` (`meshNormals.ts`; custom normals are not supported, so these are the normals). */
    normals: {vert?: Float32Array, face?: Float32Array}
    /** `corner_tris_cache`, `corner_tri_faces_cache` and the `bvh_cache_*` trees (`meshBVH.ts`). */
    bvh: {verts?: unknown, edges?: unknown, tris?: unknown, cornerTris?: Int32Array, triFaces?: Int32Array}
    /** `vert_to_face_map_cache`, `vert_to_corner_map_cache`, `corner_to_face_map_cache`, loose element caches (`meshTopology.ts`). */
    topology: Record<string, unknown>
    /**
     * `max_material_index` (`BKE_mesh_types.hh`): only ever filled here by Set Material (`node_geo_set_material.cc:76`,
     * :84), shared by copies (`mesh.cc:174`), dropped when `material_index` changes. Realize Instances reads it.
     */
    maxMaterialIndex?: number
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
            maxMaterialIndex: r.maxMaterialIndex,
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

/**
 * `Mesh::tag_face_winding_changed` (`mesh_runtime.cc:373`): the normals and the vertex-to-corner map (corners swapped
 * places inside their faces).
 */
export function meshTagFaceWindingChanged(mesh: MeshData): void {
    const r = runtimes.get(mesh)
    if (!r) return
    r.normals = {}
    delete (r.topology as Record<string, unknown>).vertToCorner
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
    // `tag_material_index_changed` (`mesh_attributes.cc:676`, `mesh_runtime.cc:422`).
    if (name === 'material_index') {
        const r = runtimes.get(mesh)
        if (r) delete r.maxMaterialIndex
    }
}

/** `max_material_index.ensure([](data) { data = value; })`: fills the cache unless it is already filled. */
export function meshEnsureMaxMaterialIndex(mesh: MeshData, value: number): void {
    const r = meshRuntime(mesh)
    if (r.maxMaterialIndex === undefined) r.maxMaterialIndex = value
}

/** `max_material_index.is_cached() ? data() : nothing`. */
export function meshCachedMaxMaterialIndex(mesh: MeshData): number | undefined {
    return runtimes.get(mesh)?.maxMaterialIndex
}

/** Axis-aligned bounds (`Bounds<float3>`). */
export interface Bounds3 {
    min: [number, number, number]
    max: [number, number, number]
}

/** The bounds of `count` float3 positions; undefined for none. */
export function positionsMinMax(positions: ArrayLike<number>, count: number): Bounds3 | undefined {
    if (!count) return undefined
    const b: Bounds3 = {min: [positions[0], positions[1], positions[2]], max: [positions[0], positions[1], positions[2]]}
    for (let i = 1; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            const v = positions[i * 3 + k]
            if (v < b.min[k]) b.min[k] = v
            if (v > b.max[k]) b.max[k] = v
        }
    }
    return b
}

/** `Mesh::bounds_min_max` (`mesh.cc`): the vertex positions' bounds, cached; undefined without vertices. */
export function meshBoundsMinMax(mesh: MeshData): Bounds3 | undefined {
    if (mesh.vertsNum === 0) return undefined
    const r = meshRuntime(mesh)
    return r.bounds ??= positionsMinMax(mesh.positions, mesh.vertsNum)
}
