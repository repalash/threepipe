# Flower Scatter V5 Port — Findings & Library Feedback

**Parent:** [procedural-generation-status.md](procedural-generation-status.md)
**Port:** `examples/flower-scatter-v5/` (from `tmp/flower_scattering.blend`)

## Framework Improvements Made

### 1. distributePointsOnFaces now exposes baryCoords and triIndices
**File:** `plugins/procedural-generation/src/blender/distribute_points_on_faces.ts`
- Added `baryCoords: [number, number, number][]` and `triIndices: number[]` to `DistributePointsOnFacesResult`
- Needed for UV interpolation at scatter points (Image Texture sampling in Blender)
- Previously only `positions`, `normals`, `ids` were returned; callers had to approximate UVs from bounding box

### 2. New `interpolateScatterUVs()` utility
**File:** `plugins/procedural-generation/src/blender/geometry_nodes.ts`
- Takes geometry, baryCoords, triIndices → returns `[u, v][]` per scatter point
- Correctly interpolates vertex UVs using barycentric coordinates
- Used by flower texture sampling (density map + bluebell mask)

### 3. compare_graph.ts `initRuntime` hook
**File:** `plugins/procedural-generation/porting/scripts/compare_graph.ts`
- Added support for an optional `initRuntime(rt, assetsDir)` export from graph modules
- Allows scatter graphs (which need external geometry) to work with the comparison script
- Previously, compare_graph.ts only worked for self-contained graphs (building generators)

## Known Limitations of compare_graph.ts for Scatter Graphs

1. **Triangle ordering**: GLB mesh has different triangle ordering than Blender's internal mesh. Since `distributePointsOnFaces` seeds per-triangle RNG with `hash(tri_i, seed)`, different triangle indices produce different scatter positions. Exact position matching is not possible.

2. **Object names**: GT exports use Blender internal names (e.g., `GEO-leaf.grass.001`) while our graph uses GLB filenames (e.g., `object_GEO-leaf_grass_001.glb`). The comparison script doesn't map between them.

3. **Coordinate space**: GT instances from `depsgraph.evaluated_instances_get()` are in WORLD space (include modifier object's world matrix). Our graph produces instances in object LOCAL space. This causes a systematic position offset that the comparison script doesn't account for.

4. **Separate Children=false**: Blender composes child object origins with the scatter transform, producing different positions per child. Our implementation places all children at the same scatter point position (since GLB assets already have child offsets baked into their mesh data). Visual result is correct but matrices differ from GT.

## Missing Blender Utilities

### 3D Noise Texture (FBM)
- The Blender Noise Texture node (3D FBM with distortion) has no port
- Currently approximated with `hash_to_float2()^4` through `colorRampLinear2()` to match GT statistics
- A proper port from `source/blender/blenlib/intern/noise.cc` (Perlin/simplex noise + FBM + distortion) would eliminate this approximation
- Affects: grass scale variation, any graph using Noise Texture for procedural control

## Statistical Verification Results (seed=0, default params)

| Metric | Generated | Ground Truth | Notes |
|--------|-----------|-------------|-------|
| Total instances | 114,967 | 117,343 | ~2% diff (triangle ordering) |
| Scale range | [0.25, 1.50] | [0.27, 1.16] | Approximation tail |
| Scale mean | 0.674 | 0.668 | Excellent match |
| Scale below 1.0 | ~94% | ~97% | Close |
| Grass long | 21,759 | (not in sample) | |
| Grass medium | 92,840 | (500 in sample) | |
| Bluebells | 87 | (not in sample) | |
| Dandelions | 281 | (not in sample) | |
