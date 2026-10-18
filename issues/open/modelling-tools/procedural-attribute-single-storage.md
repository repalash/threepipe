# Procedural: attributes Blender stores as a single value are arrays here

Found while porting Extrude Mesh / Split Edges to `@threepipe/plugin-procedural` (track 2).

## Blender 5.2.2

`bke::AttributeStorage` has two storage kinds (`AttrStorageType::Array` / `::Single`). An attribute is created as
**Single** when it is added from a single value and its name is not in `array_storage_required()`:

- `attribute_init_to_data` (`blenkernel/intern/attribute_storage_access.cc:76-106`): `AttributeInitValue` → `SingleData`,
  `AttributeInitVArray` of a single varray → `SingleData` (unless array data is required);
- the mesh provider passes `array = array_storage_required().contains(name)` (`mesh_attributes.cc:989`); likewise
  for point clouds, curves, instances.

Callers that hit this: `try_capture_fields_on_geometry` with a constant field (Store Named Attribute / Capture of a
single value), Set Material on all faces (`attributes.add<int>("material_index", ..., AttributeInitValue)`,
`node_geo_set_material.cc:76`), Instances to Points' single radius, realize/join single material indices, ...

Consumers then behave differently from an array with equal values:

- `lookup` returns `VArray::from_single`, so `adapt_domain` keeps a single value where it can
  (`mesh_attributes.cc:533`) instead of mixing equal values;
- Extrude Mesh and Split Edges skip Single attributes when transferring to new elements
  (`node_geo_extrude_mesh.cc:281`, `mesh_split_edges.cc:49`, `:95`): the resized single attribute keeps its value;
- writers convert Single to Array on first span write (`get_mutable_attribute`, `attribute_storage_access.cc:205`).

## Here

`@threepipe/mesh-kernel`'s `AttributeStorage` stores every attribute as an array, and the procedural package's
accessors return array varrays. Results equal Blender's wherever the array path computes the same value as the single
path: copies, gathers, ints, booleans, and float mixes of 1, 2 or 4 equal values. They can differ by an ulp where
Blender would keep the single value but the array path mixes 3 (or 5, 6, ...) equal floats (`(v + v + v) * (1/3)`),
or interpolates equal quaternions/matrices.

No parity case hits this yet (they use per-element values). It needs a data-model decision: either a single-value
layer kind in the kernel's `AttributeStorage` (with `array_storage_required` names) or a single flag on the procedural
side, plus the Single-aware lookups/transfers listed above.
