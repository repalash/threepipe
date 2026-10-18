# plugin-procedural: Ico Sphere needs a float32-exact `create_icosphere`

**Status**: fixed 2026-10-18 (track2-procedural); see Resolution.

**Found by**: track2-procedural, 2026-10-18.

Blender's Ico Sphere node (`node_geo_mesh_primitive_ico_sphere.cc:66`) builds the mesh with the BMesh operator
`create_icosphere` (`bmo_primitive.cc:965`: the float `icovert` table scaled by `radius / 200`, then
`subdivide_edges ... use_sphere` for subdivisions > 1) and `BM_mesh_bm_to_me`. The kernel's `createIcoSphere` +
`bmToMesh` give the same shape but not Blender's result: against the geonodes-kit case `edge-angle-icosphere`
(Blender 5.2.2) 42 of 60 `.edge_verts` / `.corner_edge` values differ (another edge order) and positions differ
around 1e-5 (double instead of float arithmetic).

So the GN node is not registered (`GeometryNodeMeshIcoSphere` stays "not ported"): registering it on the kernel
generator would be an approximation. Needed: a float32 port of `bmo_create_icosphere_exec` and of the parts of
`bmo_subdivide_edges_exec` (`bmo_subdivide.cc`) it uses, with BMesh element creation order, and `BM_mesh_bm_to_me`
order - either in the kernel (fixing the kernel primitive's parity too) or in the procedural package.

## Resolution (2026-10-18)

Ported in the procedural package, without touching the kernel (whose BMesh interpolates in double and keeps elements in
`Set`s, so it could not give float32-exact positions / UVs without overriding its Euler ops):

- `plugins/procedural/src/blender/bmesh/bmeshCore.ts`: a small float32 BMesh - `BM_vert_create`, `BM_edge_create`,
  `BM_face_create(_verts)` with `BM_edges_from_verts_ensure`, disk / radial cycles, `bmesh_kernel_split_edge_make_vert`
  + `BM_edge_split` (loop UV via `BM_data_interp_face_vert_edge`), `bmesh_kernel_split_face_make_edge` (`l_first`
  rules), `BM_vert_pair_share_face_by_len` with the `BM_LOOPS_OF_VERT` iterator. Nothing is freed during the operator,
  so creation-ordered arrays equal `BLI_mempool` iteration order (no free-list reuse can occur).
- `plugins/procedural/src/geometry/icoSphere.ts`: `bmo_create_icosphere_exec`, the `subdivide_edges` path it uses
  (`tri_3edge` grid fill, `use_sphere` via the temp shape key, LIFO face stack), identity `mul_m4_v3`, `BM_mesh_bm_to_me`
  order and layers (`sharp_face`, `.uv_select_*`).
- Node `src/nodes/geometry/meshIcoSphere.ts`. Case set `meshIcoSphere`: subdivisions 1-6, radii, negative / zero
  radius, no-UV - all exact; `ico-edge-angle` is 1 ulp on 1/480 values, proven to be Apple `asinf` in Edge Angle
  (exact with the platform values substituted). geonodes-kit `edge-angle-icosphere` passes.
