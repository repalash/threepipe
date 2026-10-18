# kernel: extruding lone vertices is not ported

**Found**: 2026-10-18, track0-followups (menus), wiring Vertex > Extrude Vertices.

`extrudeSelection` (`plugins/mesh-kernel/src/ops/extrude.ts:348`) extrudes the selected faces, else the
selected edges, else nothing. Blender's Extrude Region (`edbm_extrude_mesh`,
`editors/mesh/editmesh_extrude.cc:358`) dispatches on the select mode and the counts: in vertex mode one
selected vertex, or vertices with no selected edge, go to `edbm_extrude_verts_indiv` (:169,
`extrude_vert_indiv`, `bmo_extrude_vert_indiv_exec` in `bmesh/operators/bmo_extrude.cc`): a new vertex
joined by a new edge per selected vertex. Edge mode with no selected face goes to
`EDBM_extrude_edges_indiv`.

So E on a lone vertex does nothing here (a notice: "Select something to extrude first"), and the
engine has no `mesh.extrude_vertices_move` (Vertex > Extrude Vertices is shown "Not available yet").

**Fix**: port `edbm_extrude_mesh`'s dispatch and `bmo_extrude_vert_indiv_exec` into the kernel's
extrude, then register `mesh.extrude_vertices_move` (`MESH_OT_extrude_verts_indiv` + translate) and
`mesh.extrude_edges_move` in the engine.
