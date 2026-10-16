# Two mesh-normal implementations: kernel bake (double) and plugin-procedural (float32)

**Status**: open, low. Found while porting the geometry-nodes data model (track 2, plan 15).

`plugins/mesh-kernel/src/bake.ts` computes face, vertex and corner normals for rendering (`computeNormals`,
private, double precision, Newell normals). `plugins/procedural/src/geometry/meshNormals.ts` ports
`mesh_normals.cc` again in float32 (`normals_calc_faces` :175, `normals_calc_verts` :189 with
`safe_acos_approx`, `mesh_normals_varray`), because geometry nodes read normals as data (Normal node,
Distribute, Set Position, Extrude) and parity needs Blender's rounding.

Two ports of one function drift. The kernel should own one float32-exact port (face, vertex, corner
with sharp fans and custom normals - `normals_calc_corners` is not ported in either yet) and the bake
should use it. Not done in track 2 because `bake.ts` is shared with mesh-edit and track0-followups is
deduplicating kernel maths now; to do after that lands.
