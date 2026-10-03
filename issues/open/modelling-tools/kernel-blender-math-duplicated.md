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
