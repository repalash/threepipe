# Blender 5.2.2 bug (ported as is): Realize Instances can drop `material_index`

**Found by**: track2-procedural, 2026-10-18, case `materialOps/replace-material`.

`calc_material_index_max_hint` (`geometry/intern/realize_instances.cc:1871`) maps each mesh's cached maximum
material index through its slot map (`get_mapped_material_index(info, *max)`) instead of taking the maximum of the
mapped indices. When a mesh has duplicate slots (e.g. `[Green, Blue, Green]` after Replace Material), the highest
index can map to slot 0, the hint becomes 0, and `join_mesh_material_indices` returns without writing
`material_index` (:1934): every realized face then uses the first material. The output also keeps the first mesh's
slot list past the deduplicated materials (`BKE_mesh_copy_parameters_for_eval` + `BKE_id_material_eval_assign`).

The port reproduces this exactly (parity), including the runtime cache it depends on (`max_material_index`, filled
only by Set Material). If Blender fixes it, the case flips and the port follows the fix.
