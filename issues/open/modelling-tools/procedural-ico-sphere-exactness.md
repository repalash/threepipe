# plugin-procedural: Ico Sphere needs a float32-exact `create_icosphere`

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
