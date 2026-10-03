# Knife port (`src/ops/knife/`): where it is not yet Blender, exactly

The knife port (`editmesh_knife.cc`, `bmesh_polygon_edgenet.cc`, `view3d_project.cc`) matches Blender
3.4.1 on every fixture in `plugins/mesh-kernel/tests/fixtures/knife-bisect/`. Known differences, none of
which a fixture exercises:

1. **Triangle BVH as a scan.** `BLI_bvhtree_ray_cast` / `BLI_bvhtree_intersect_plane` are replaced by a
   linear scan with the same leaf tests and nearest-hit rule. Two triangles hit at exactly the same
   depth (a ray along a shared edge) may resolve to the other face than Blender's tree order picks.
   Same for the 2D edge BVH in `BM_face_split_edgenet_connect_islands`.
2. **N-gon tessellation.** `em->looptris` for n-gons uses the kernel's ear clipping
   (`tessellatePolygon`) instead of `BLI_polyfill_calc` (+ beautify). Planar n-gons give the same ray
   hits with any triangulation; a non-planar n-gon's hit point can move by the bend. Porting
   `polyfill_2d.cc` (and using it in `bake.ts` too) closes this.
3. **`EDBM_face_find_nearest` fallback** (`knife_find_closest_face`, when the cursor ray misses every
   face) is a callback; mesh-edit supplies it from its selection buffer. With X-ray on there is no
   buffer and mesh-edit passes no fallback; Blender's X-ray branch of `EDBM_face_find_nearest_ex`
   (nearest projected face centre) is not ported.
4. **Not drawn yet:** distance/angle measurements (`knifetool_draw_dist_angle`, the S key cycles the
   mode but nothing is drawn) and the angle-snapping/axis guide lines.
5. **Precision.** The port runs in doubles; Blender in float32. With Blender's default `clip_start`
   (0.01) a perspective pick ray is ill-conditioned in float32 (`ED_view3d_win_to_vector` unprojects
   NDC z = -0.5, ~0.013 units from the eye), so Blender's own cut points sit up to ~5e-4 units off the
   cursor ray. The port lands on the ray. The fixtures use `clip_start = 0.5` for perspective views so
   that comparing against Blender is not comparing against its rounding (see the generator).
6. **Camera view and box clipping** (`RV3D_CAMOB`, `RV3D_CLIPPING`) have no three.js equivalent and are
   not ported; every clipping branch takes the "off" path.
