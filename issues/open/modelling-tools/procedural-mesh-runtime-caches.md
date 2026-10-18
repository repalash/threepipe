# procedural: mesh runtime caches live in a WeakMap (kernel MeshData has no runtime slot)

## Context

Blender keeps derived mesh data in `Mesh::runtime` (`blenkernel/BKE_mesh_types.hh`): bounds, true vertex/face normals,
corner triangles, BVH trees, vertex-to-face/corner maps, loose element caches. They are `SharedCache`s:

- `mesh_copy_data` (`blenkernel/intern/mesh.cc:144-170`) shares them with the copy;
- the tag functions (`mesh_runtime.cc:301-425`: `tag_positions_changed`, `tag_positions_changed_uniformly`,
  `tag_topology_changed`, ...) drop them on the mesh that changed;
- the built-in attribute change tags (`changed_tags`, `mesh_attributes.cc:694`) run those tags when `position` etc.
  are written through the attribute API.

Some caches are not recomputable from the mesh data: primitives *assign* them. The UV Sphere assigns its vertex
normals (`mesh_vert_normals_assign`, `mesh_normals.cc:50`, unit positions instead of angle-weighted face normals) and
the round primitives set eager analytic bounds (`bounds_set_eager`, `mesh.cc:1944`). Blender keeps these through every
copy until positions change, so a UV Sphere read after Store Named Attribute still has the assigned normals.

## What the procedural package does

`@threepipe/mesh-kernel`'s `MeshData` has no runtime cache slot, so `plugins/procedural/src/geometry/meshRuntime.ts`
models `MeshRuntime` with a `WeakMap<MeshData, MeshRuntime>`:

- `copyMesh(src)` is the only way the package copies a `MeshData` (`GeometrySet.meshForWrite`, single-mesh realize,
  the modelling modifier input); it clones and shares the caches.
- `meshTagPositionsChanged` / `meshTagPositionsChangedUniformly` / `meshTagTopologyChanged` port the Blender tags;
  `meshAttributeChanged` ports `changed_tags` and runs from `MeshAccessor.add/remove/layerForWrite`.
- `meshNormals.ts`, `meshTopology.ts`, `meshBVH.ts` (mesh trees) and `meshBounds.ts` keep their caches in it.
- In-place position/topology writers tag: Set Position and Store Named Attribute through the accessor hook,
  `meshTransform` (`mesh.cc:2085`), `meshTranslate` (`mesh.cc:2064`, cached bounds moved along), single-mesh realize,
  Extrude Mesh / Split Edges (`tagMeshChanged` = `tag_topology_changed`).

Before this, caches were per-object `WeakMap`s that a clone did not inherit (assigned normals and eager bounds were
lost through any write copy; `uv-sphere-normals` failed), and a cache computed on a write copy before an in-place
position write (e.g. Set Position with an offset from the Normal input) was not dropped by Set Position.

## Open

- Code outside the procedural package that edits a `MeshData` in place does not know about these caches. Meshes
  handed to the evaluator are copied first (`copyMesh` of a mesh that never had a runtime is a plain clone), so this
  is only a problem if procedural cache functions are called on a mesh that is later edited elsewhere.
- When the kernel grows a runtime slot on `MeshData` (cloned by `MeshData.clone`, dropped by its own edit operations),
  `meshRuntime.ts` should move onto it and the WeakMap go away.
- Point clouds and curves have the same model in Blender (`PointCloudRuntime`, `CurvesGeometryRuntime`); the package
  recomputes their derived data (point cloud BVH trees are a per-object `WeakMap`, curve evaluation is not cached).
