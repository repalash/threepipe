# Boolean: custom normals are dropped

`meshBooleanManifold` (`plugins/mesh-kernel/src/boolean/manifoldBoolean.ts`) leaves `custom_normal` out of the
result. Blender carries them:

- `realize_instances` joins the inputs' custom normals through `bke::mesh::NormalJoinInfo`
  (`geometry/intern/realize_instances.cc:1563, :1624-1650, :1756-1771`, `blenkernel/intern/mesh_normals.cc:1716-1801`):
  fan-encoded (`int16x2` corner) normals stay encoded when every input has them, otherwise all inputs are converted
  to `float3` normals on a common domain (vertex / face / corner normals of the inputs without custom ones), and
  transformed with `math::transform_normals`;
- `interpolate_corner_attributes` (`geometry/intern/mesh_boolean.cc:101-235`) mixes them like other corner
  attributes and negates `float3` custom normals on faces whose orientation flipped (`face_is_flipped`).

Needed when a part with custom (e.g. weighted / hardened) normals is cut. Port both, with a Blender fixture
(`gen-boolean-fixtures.py`, a case whose target has `normals_split_custom_set` applied).
