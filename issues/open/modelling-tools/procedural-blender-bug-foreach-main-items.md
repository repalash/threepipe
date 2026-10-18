# Blender bug (5.2.2): For Each Geometry Element main items read the wrong bodies for later components

**Found by**: track2-procedural, 2026-10-18, case `zonesForeach/foreach-points-main` (a mesh and a point cloud
iterated over points together).

`LazyFunctionForReduceForeachGeometryElement::handle_main_items_and_geometry`
(`nodes/intern/geometry_nodes_foreach_geometry_element_zone.cc:893`) reads each selected element's value from
`lf_param_index = pos * body_main_outputs_num + item_i`. Here `pos` is the element's position in *this component's*
selection mask. The generation items use the component's own body, `component_info.body_nodes_range[local_body_i]`
(:1050). When the zone iterates over several components (a mesh and a point cloud on the point domain, for example),
every component after the first stores the main-item values of the first component's bodies.

Measured: for the point cloud's element 3 (mask position 2), Blender stores the value computed for the mesh's
body 2 (mesh point 3): `len = |(-1/6, -0.5, 0)| * 3 = 1.5811`, where the point cloud's own body gives `1.5 * 3 = 4.5`.

The port reproduces this so results match Blender (`src/runtime/foreachZone.ts`). When Blender fixes it, use
`body_nodes_range[pos]` there (the case will then fail against the new ground truth).
