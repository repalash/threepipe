# distributePointsOnFaces: ID computation mismatch with Blender

## Summary
Our `distributePointsOnFaces` implementation produces correct point positions but generates different deterministic IDs than Blender for ~75% of points (30/40 in the candy_bounce test case).

## Root Cause
The IDs are computed from `hash(hash_float(bary_coord), tri_index)` where `hash_float` uses `float_as_uint` to convert barycentric coordinates to unsigned integers before hashing. Even tiny floating-point differences in barycentric coordinates (which don't visibly affect interpolated positions) produce completely different `float_as_uint` values, which cascade through the hash into different IDs.

The positions are correct because they're interpolated from the barycentrics: `p = v0*(1-u-v) + v1*u + v2*v`. Small differences in (u,v) produce small differences in position. But `float_as_uint(u)` maps the float to its IEEE-754 bit pattern, so even a ULP difference produces a completely different hash.

## Impact
- Affects any node tree that uses `Random Value` with the implicit ID field after `DistributePointsOnFaces`
- Workaround: export Blender's IDs to a JSON file and use as a lookup table (see `examples/candy-bounce/assets/distribute_point_ids.json`)
- The workaround only works for ground truth comparison at known parameters; it doesn't fix the library for arbitrary inputs

## Potential Fix
1. Investigate why our LCG RNG produces slightly different barycentric coordinates than Blender's
2. The LCG state may accumulate floating-point drift due to JS number precision vs C++ double
3. Check if our `round_probabilistic` implementation matches Blender's exactly
4. Compare intermediate RNG states step-by-step with Blender for a failing triangle

## File
`plugins/procedural-generation/src/blender/distribute_points_on_faces.ts`

## Discovered During
Candy Bounce port (`examples/candy-bounce/`)
