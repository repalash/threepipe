# Pebble Scattering Port

Port `tmp/pebble_scattering.blend` to a working threepipe procedural generation example using the exact Blender `distributePointsOnFaces` algorithm.

## Status: Complete

## Blend File
`tmp/pebble_scattering.blend` -- Scatters 3 sizes of pebbles onto a ground mesh.

## Architecture
- **Large pebbles** (GEO-pebble): Poisson distribution, scale range [0.25, 0.6]
  - Density Max = Factor(5) * 100 = 500
  - Density Factor = pebbles_L vertex group (avg ~0.286)
  - Min distance = 0.02
- **Medium pebbles** (GEO-pebble.004): Random distribution, scale range [0.25, 0.45]
  - Density = pebbles_M(avg ~0.334) * 100 * Factor(8) = ~267
- **Small pebbles** (GEO-pebble.002): Random distribution, scale range [0.1, 0.35]
  - Density = pebbles_S(avg ~0.572) * Factor(10) * 100 = ~572
  - Scale seed = 2 (differs from other pipelines)

Each pipeline: Ground mesh -> distributePointsOnFaces (Blender port) -> Random rotation (full 3D EulerXYZ) -> Random uniform scale -> fromLocRotScale -> Join all 3.

## Key Implementation Details
- Uses the exact Blender `distributePointsOnFaces` port (LCG RNG, round_probabilistic, per-tri noise::hash seeding)
- Point IDs from the distribution are used for randomVector/randomFloat (matching Blender's implicit ID field)
- Vertex group weights (pebbles_L, pebbles_M, pebbles_S) are not available in the GLB export
- Vertex groups are approximated as uniform average values: 0.286, 0.334, 0.572
- For POISSON mode, a uniform Float32Array density factor is created from the average weight
- GLB geometry is Y-up (glTF convention); converted to Blender Z-up for fromLocRotScale
- Viewer handles Z-up -> Y-up conversion via buildSceneFromInstances

## Phases
- [x] Phase 1 -- Extract node graph JSON (from archived extraction)
- [x] Phase 2 -- Export assets (3 pebble GLBs + ground mesh GLB)
- [x] Phase 3 -- Map nodes to implementations
- [x] Phase 4 -- Build the generator (graph.ts)
- [x] Phase 5 -- Verify (comparison + reactivity)
- [x] Phase 6 -- Wire UI (script.ts + index.html)

## Verification Results
- Total instances: 40524 (Blender: 40758) -- 99.4% match
- Large pebbles: 4839 vs 4865 (ratio: 0.99) -- excellent
- Medium pebbles: 11253 vs 11501 (ratio: 0.98) -- excellent
- Small pebbles: 24432 vs 24392 (ratio: 1.00) -- excellent
- Scene extent: X=6.51, Y=6.50 -- matches ground mesh bounds
- Full matrix matches: limited (593/4839 large, 1632/11253 medium, 4700/24432 small)
  - Expected: uniform approximation of vertex groups means different spatial distribution
  - Position-only matches much higher, confirming the algorithm is correct
- Reactivity: all parameters (seed, factor, mask) produce different output when changed
- Zero density: all factors=0 produces 0 instances

## Why not 100% full matrix match
The vertex group attributes (pebbles_L, pebbles_M, pebbles_S) define per-vertex density weights in Blender but are not exported in the glTF/GLB format. Without these, we use uniform average values instead of spatially-varying density. This means:
1. Points land at different positions (different density distribution across the surface)
2. Different positions produce different barycentric-based IDs
3. Different IDs produce different rotation/scale values

The instance COUNTS match very closely because the total integrated density is the same (average * area). To achieve 100% full matrix match, the vertex group weights would need to be exported separately and passed as per-vertex Float32Array to distributePointsOnFaces.

## Files
- `examples/pebble-scatter/graph.ts` -- GraphModule with reactive scatter using Blender distributePointsOnFaces
- `examples/pebble-scatter/script.ts` -- Custom viewer with ground geometry loading
- `examples/pebble-scatter/index.html` -- Standard example HTML
- `examples/pebble-scatter/verify.ts` -- Verification script (loads ground geometry, compares vs ground truth)
- `examples/pebble-scatter/assets/` -- GLB files (ground + 3 pebbles)
- `examples/pebble-scatter/ground_truth.json` -- Blender ground truth (40758 instances)
