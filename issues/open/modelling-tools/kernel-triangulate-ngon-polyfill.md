# `BM_face_triangulate` n-gon branch (`BLI_polyfill`) is not ported

Found while porting Bridge Edge Loops (track F, `plugins/mesh-kernel/src/ops/bridge.ts`), which runs
`bmesh.ops.triangulate` on the faces it made between loops of different lengths.

## What exists

`plugins/mesh-kernel/src/ops/triangulate.ts` ports `bmo_triangulate_exec` (`bmo_triangulate.cc:29`),
`BM_mesh_triangulate` / `bm_face_triangulate_mapping` (`bmesh_triangulate.cc:33`, `:80`),
`bmesh_face_swap_data` (`bmesh_core.cc:2998`) and the **quad** branch of `BM_face_triangulate`
(`bmesh_polygon.cc:1103`) with every quad method (`BEAUTY`, `FIXED`, `ALTERNATE`, `SHORT_EDGE`,
`LONG_EDGE`). Faces of more than four corners throw
`mesh-kernel: n-gon triangulation (BLI_polyfill_calc_arena) is not ported; only quads`.

Bridge never reaches the n-gon branch: it only triangulates faces it created or found with
`BM_face_exists` over four vertices, i.e. quads (`bmo_bridge.cc:410-414`, `:500`).

## What is missing

The `else` branch of `BM_face_triangulate` (`bmesh_polygon.cc:1222-1243`):

- project the face with `axis_dominant_v3_to_m3_negate(axis_mat, f->no)` (ported in `math/geom.ts`);
- `BLI_polyfill_calc_arena` (`blenlib/intern/polyfill_2d.cc`, ear clipping with its KD-tree of
  reflex vertices, `USE_CONVEX_SKIP`, `USE_CLIP_EVEN` / `USE_CLIP_SWEEP`);
- with `MOD_TRIANGULATE_NGON_BEAUTY`, `BLI_polyfill_beautify` (`polyfill_2d_beautify.cc`, half-edge
  rotation with `polyedge_rotate_beauty_calc` and a `BLI_heap`; the heap is ported in `math/heap.ts`).

The kernel's display tessellation (`bake.ts`) is its own ear clipping and is not a port, so it cannot
stand in: triangulation order and diagonals must match Blender for `bmesh.ops.triangulate`,
the Triangulate modifier and `MESH_OT_quads_convert_to_tris` to be parity-testable.

## Needed by

`MESH_OT_quads_convert_to_tris` (Ctrl+T) and the Triangulate modifier, when they are ported; any
operator that triangulates arbitrary input faces.
