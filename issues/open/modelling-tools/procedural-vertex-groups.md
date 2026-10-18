# plugin-procedural: vertex groups are plain float attributes

**Found by**: track2-procedural, 2026-10-18 (pebble_scattering and buildify_1.0 dumps).

Geometry nodes read a mesh's vertex groups (`MDeformVert` + `Mesh::vertex_group_names`) as non-builtin float point
attributes (`blenkernel/intern/mesh_attributes.cc:732-790`). The kernel's `MeshData` has no deform-verts layer, so
`porting/blender/geometry_dump.py` exports each group as a point `FLOAT` attribute (`vertexGroup: true`) and the
importer stores it as one. That is exact for every read (pebble_scattering's density inputs read three groups and
match Blender).

Where it is not equivalent:
- A mesh can have a vertex group and a generic attribute with the same name (buildify_1.0 `building_base`:
  `building:levels`). Lookups return the group (`mesh_attributes.cc:878`), `foreach_attribute` yields both. With one
  namespace the importer keeps the group, so code that iterates attributes (join, realize, propagation) sees one
  layer where Blender sees two.
- Nodes that treat vertex groups specially when writing (`mesh_copy_selection` gathers `MDeformVert`;
  `try_delete_vertex_group`; Store Named Attribute writing into an existing group keeps it a group) behave like
  ordinary attributes here.

A deform-verts layer in the kernel would make both exact; decide whether that is worth it once an asset depends on it.

**Update 2026-10-18**: an asset now depends on it. With Subdivide Mesh, curve separation and legacy corner normals
ported, Buildify's `building_base` evaluates completely and matches Blender in every attribute except this one: the
graph stores an INT face attribute `building:levels` next to the object's float vertex group of the same name;
Blender keeps both (vertex groups live in `MDeformVert`, outside the generic attributes), the single namespace here
keeps one. `tests/parity/assets.test.ts` records it as a known gap (it must fail exactly this way).

Proposed fix (needs a decision, it touches the data model): a vertex-group store on the mesh (`vertex_group_names` +
deform weights, e.g. CSR) in the kernel's `MeshData` (additive), and the procedural mesh accessor ported from
`VertexGroupsAttributeProvider` (`mesh_attributes.cc:732-790`: lookup order corner data, vertex groups, point/edge/face
data; reads/writes/deletes of groups), plus the ops that copy groups (`BKE_defgroup_copy_list` with
`copy_parameters_for_eval`, `mesh_copy_selection`, realize/join `copy_vertex_group_names`).
