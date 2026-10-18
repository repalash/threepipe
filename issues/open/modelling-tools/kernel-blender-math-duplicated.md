# The kernel has three private copies of Blender's BLI maths

The kernel's public maths (`src/math/index.ts`) is three.js-style (`v3add`, `mat4Multiply`). Ports of
Blender code need Blender's own functions with Blender's epsilons (`isect_seg_seg_v2_point_ex`,
`axis_dominant_v3_to_m3`, `angle_signed_on_axis_v3v3_v3`, `normalize_v3` with its `1e-35` cut-off ...),
and the P3 tracks each wrote them:

- track K (`p3-knife`): `src/ops/knife/geom.ts` (module-private; not exported from the package),
  plus private helpers inside `src/ops/scanfill.ts`;
- track F (`p3-fill`) and track L (`p3-loop`): a public `src/math/geom.ts` each, exported from
  `src/math/index.ts`, with overlapping names (`axisDominantV3ToM3`, `orthoBasisV3V3V3`,
  `isectLinePlaneV3`, `angleNormalizedV3V3` ...) and different argument conventions (`Vec2` tuples vs
  arrays, out-params vs return values).

Track K kept its copy private on purpose so that merging the three branches cannot produce duplicate
exported names. After the merge, one `src/math/blender.ts` (or similar) should hold one port of each
function, citing `math_geom.cc` / `math_vector.cc` line numbers, and the three copies should import it.
The parity suites (`tests/*-parity.test.ts`) are the safety net for that refactor.

## Status (2026-10-18, track0-followups)

Done: one home, `plugins/mesh-kernel/src/math/geom.ts`, with Blender's names (`isectSegSegV2PointEx`,
`normalizeV3V3Length`, `distSignedSquaredToCornerV3V3V3` ...), each citing its `math_*.cc` line:

- `src/ops/knife/geom.ts` is gone. Its Blender functions moved to `math/geom.ts`; where `math/geom.ts`
  already had one (`angleNormalizedV3V3`, `angleV3V3`, `orthoBasisV3V3V3`, `axisDominantV3ToM3`,
  `mulV2M3V3`, `normalTriV3`, `planeFromPointNormalV3`) the knife uses that; its elementary helpers
  (`sub3`, `dot3` ...) are `math/index.ts`'s `v3sub`, `v3dot` ... or the Blender-named `subV2V2`,
  `lenSquaredV3` ...; `mulM4M4` / `invertM4` are `mat4Multiply` / `mat4Invert`.
- `src/ops/scanfill.ts`'s private copies (`normalize_v3`, `compare_v*`, `ortho_basis`,
  `axis_dominant_v3_to_m3_negate`, `mul_v2_m3v3`, `cos_v2v2v2`, `dist_squared_to_line_v2`) are gone.
- `bisectPlane.ts`'s `plane_from_point_normal_v3` / `plane_point_side_v3`, `edgenet.ts`'s float
  constants, and identical private copies in `inset.ts`, `solidify.ts`, `generate/sweep.ts`,
  `generate/array.ts`, `bmesh/interp.ts` and `bevel-bmquery.ts` import `math/geom.ts` now.
- `math/geom.ts`'s parameters (and `math/index.ts`'s `v3*`) take `readonly number[]` (`V3Arg`,
  `V2Arg`), so callers holding plain arrays need no copies. No exported name of `math/geom.ts` changed.
- Faithfulness fixes on the way: `angle_v3v3`, `angle_v3v3v3`, `normal_tri_v3` normalise as Blender
  does (`normalize_v3_v3`: zero below `1e-35`, multiply by the reciprocal). That moved an ulp in
  `BM_verts_calc_normal_from_cloud_ex`'s refine, whose sort has an exact tie for vertices collinear
  with the centre; the refine now computes its angles in `float` like the rest of that function
  (`edgenet.ts`), which keeps the documented current-source order of the edge-net parity case.

Not done - the copies that use another calling convention, each needing its call sites rewritten:

- `src/ops/bevel-math.ts`: the bevel port's own `blenlib` set with Blender's *out-parameter* style
  (`subV3V3V3(r, a, b)`, `normalizeV3V3(r, a)` ...), 63 functions used across the `bevel-*` modules and
  `subdivideEdgering.ts`; 25 overlap `math/geom.ts` by name.
- `src/bmesh/interp.ts`: allocation-free scalar forms of `closest_to_line_v2` /
  `dist_squared_to_line_segment_v2`, a column-major `axis_dominant_v3_to_m3` and `mul_v2_m3v3` writing
  at an offset.
- `src/generate/array.ts`: return-style `mul_qt_v3`, `normalize_qt` returning the quaternion, a flat
  `quat_to_mat3`, and `vec_to_quat` over them.
- `src/bmesh/polygon.ts` `normalTriV3` (public, on `{x, y, z}` objects) and `edgenet.ts`'s
  `normalTriV3Len`.
- Outside the kernel, `plugins/mesh-edit/src/transform/math.ts` is a further `blenlib` subset.

