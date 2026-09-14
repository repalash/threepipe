# Pre-Delivery Verification

Read this reference before presenting any port as "done". Write and run a `verify.ts` script that checks ALL of these programmatically. Paste the output.

## Asset verification (Node.js)

```typescript
// For each GLB in graphModule.assets:
// 1. fs.statSync(path).size > 200  (not empty)
// 2. Load via GLTFLoader, traverse for meshes, check geometry.attributes.position.count > 0
// 3. Check material: strings(file).includes('baseColorFactor') or verify color is intentional
// 4. For ground/scatter meshes: getWorldGeometry() returns non-null with expected vert count
```

## Graph verification (Node.js)

```typescript
// 1. Count node trees in node_graph.json -- ALL must have corresponding graph entries
// 2. Create runtime, set inputs, evaluate, check output instance counts vs GT
// 3. Check NO pre-baked JSON files are loaded (no fs.readFileSync of position/ID dumps)
//    Exception: mesh topology JSON for SubdivisionSurface input is allowed (source data)
// 4. Reactivity: change a param, re-evaluate, verify output changes
// 5. For intermediate math chains: export per-instance values from Blender and compare
//    (proximity distances, curve outputs, scale values -- not just final matrices)
```

## Math chain verification (non-trivial pipelines)

```typescript
// If the pipeline has: proximity -> curve -> mapRange -> scale/translate
// Export from Blender: the proximity distance and final scale for 10+ instances
// Compare your TS computation for the SAME input positions
// This catches: wrong curve evaluation, wrong mapRange params, wrong link chain order
```

## Browser verification

```
// After building, check in browser console:
// 1. No "asset not loaded" warnings
// 2. Instance count logged matches expected
// 3. Animation plays (if applicable) -- not just a slider, must auto-play or have play button
// 4. Colors are correct (not all white/gray)
// 5. Scale matches Blender (objects aren't tiny or huge)
```

## Code checks

- `index.html` uses standard importmap pattern (see `examples/flower-scatter-v4/index.html`)
- New utilities moved to library (`src/blender/`), exported from both entry points
- No unused imports
- No pre-baked data files (positions JSON, ID JSON) for computed outputs
- All code uses ESM `import`/`export` -- never `require()`
- Static data files are `.ts` exports, not `.json` imports

## Comparison script

```bash
./plugins/procedural-generation/porting/scripts/compare.sh my_graph.ts ground_truth.json
```

Checks all 16 world matrix values per instance. Reports:
- **Full matrix match**: position + rotation + scale all correct
- **Position-only match**: NOT a pass -- rotation/scale wrong
- **No match**: position not found

Exit code 1 unless 100% full matrix matches.

### Debugging position mismatches in filtered instances

If main instances match but extras have wrong positions, the issue is **point index ordering**:

1. Export intermediate point cloud from Blender:
   ```bash
   blender --background file.blend --python porting/scripts/export_intermediate.py -- \
     --object "Building 1" --node "Group.009" --socket "Input_1"
   ```
2. Compare your generator's point ordering against exported positions
3. Pay attention to: MeshGrid ordering after Transform rotation, SeparateGeometry reordering, Join Geometry concatenation order

### UV interpolation for Image Texture on scattered points

UV coordinates must be interpolated from triangle vertices at the scatter point's barycentric position. Do NOT approximate UVs from the mesh bounding box. Use `interpolateScatterUVs()` with the `baryCoords` and `triIndices` returned by `distributePointsOnFaces`.
