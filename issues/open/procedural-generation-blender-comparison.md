# Blender Geometry Nodes Comparison — Findings & Action Items

Source: Blender GN source downloaded to /tmp/blender-gn-source/, compared against our plugin at plugins/procedural-generation/

## Bugs to Fix (Now)

### 1. `byRules` silently ignores alignToNormal / randomRotationY
In Instance.ts `byRules()`, the `_composeMatrix` call passes `{seed}` as options — no `alignToNormal` or `randomRotationY`. These options are silently lost.

### 2. Voronoi 256-unit tiling
Our Voronoi uses a 256x256 precomputed jitter table with `& 255` wrapping. Pattern tiles every 256 units — visible on large terrains. Blender uses hash-on-the-fly to avoid tiling.

### 3. `fork()` precision loss
`new SeededRandom(this.next() * 0x7FFFFFFF)` — float multiplication loses precision. Should use raw 32-bit state directly.

### 4. Poisson density field coupling
When `densityField` is provided in Poisson mode, density rejection consumes RNG values before distance check. Changing density field changes positions of ALL points. Blender decouples by generating all candidates first, then eliminating by density as separate pass.

## Highest-Value Additions (Phase 5+)

### Noise
- **Hybrid Multifractal** — most useful missing terrain noise (smooth plains with rugged peaks)
- **White noise** — trivial hash-based, no spatial coherence, useful for per-point random
- **Voronoi F2 + Distance to Edge** — cell borders, cracked surfaces
- **3D FBM/ridged overloads** — current functions only accept 2D noise
- **4D noise** — for animated noise (time as 4th dimension)
- **Wave Texture** — sin bands with noise distortion (wood grain, water ripples)

### Distribution
- **Stable point IDs** — maintain consistency when count changes
- **Output rotation with tangent** — full orientation frame, not just normal
- **Per-vertex density from attributes** — weight-painted meshes
- **Hash-based random** — `hashRandom(seed, index)` for parallel/stable randomness

### Instancing
- **Instance index input** — explicit index-per-point, not just weighted random (cycling, spatial patterns)
- **Per-axis scale** — non-uniform scaling per instance
- **Selection field on Instance** — boolean filter at instance time, not just pre-distribution

### FaceClassifier
- **extractFaces()** — extract face group into new BufferGeometry (like Blender's Separate Geometry)
- **Edge/vertex classification** — edge crease for pillars, vertex for detail
- **Material index in FaceInfo** — multi-material meshes

## Phase 3 Updates (from Blender mesh/terrain/composition analysis)

### New: `HeightmapOps` utility module
Blender's grid nodes (Gradient, Laplacian, Advect, Median) operate on OpenVDB volumes. The 2D heightmap equivalents are simple and essential:
- `gradient(heightmap, w, h, cellSize)` → `{gx, gz}` — finite difference, needed for erosion flow direction
- `laplacian(heightmap, w, h, cellSize)` → `Float32Array` — foundation for thermal erosion
- `smooth(heightmap, w, h, iterations, method: 'mean'|'median')` — double-buffered, post-erosion smoothing
- `extractHeightmap(geo, w, h)` → `Float32Array` — extract Y values from grid geometry
- `normalize(heightmap, targetMin, targetMax)` — remap after erosion lowers average height

### Move to Phase 3 (from Phase 5)
- **`thermalErode`** — trivial ~20 lines, just moves material from steep to flat using Laplacian. Core terrain feature.
- **`terrace`** — trivial ~10 lines: `floor(h * levels) / levels` with smoothstep. Very visual.
- **`domainWarp`** — one-liner noise wrapper: sample noise for offset, then sample again at offset position. Massive visual improvement.

### Add to DerivedAttributes
- **`smoothAttribute(geo, attrName, iterations, weight?)`** — Blender's Blur Attribute analog. Topology-based neighbor averaging with double-buffer. Reuse adjacency from curvature().
- **`attributeStatistics(data)`** → `{min, max, range, mean, median, variance, stdDev}` — proper normalization pipeline
- **`aspect(geo)`** — compass direction per vertex (0-360°). `atan2(normal.x, normal.z)`. For north-facing snow, south-facing dry vegetation.

### Selection masking
Every displacement function should accept optional `selection: boolean[] | null`. Blender's universal pattern — enables "erode only mountains" or "smooth only above water."

### MeshOps additions (from extrude/boolean/primitive analysis)
- `extrudeFaces` should output `{geometry, topFaces, sideFaces}` matching Blender's Extrude Mesh Top/Side outputs
- `extractFaces(geo, faceIndices)` → new BufferGeometry — missing utility, needed for FaceClassifier pipeline completion

### MeshOps extrusion details (from Blender extrude_mesh.cc)
- Implement individual face extrusion first (each face extruded independently) — simplest, sufficient for buildings
- Must implement `fill_quad_consistent_direction` — check adjacent face winding to orient side quads correctly, prevents flipped normals
- Per-face offset mixed to per-vertex (averaged from connected faces) — prevents cracks between adjacent extruded faces
- Return `{ geometry, topFaceIndices: number[], sideFaceIndices: number[] }` matching Blender's Top/Side outputs

### MeshOps.mergeByDistance (from Blender mesh_merge_by_distance.cc)
- Add `mergeByDistance(geo, distance)` using spatial hash + Union-Find — essential after extrudeFaces on adjacent faces
- Blender uses KD-tree for "all" mode, Union-Find for "connected" mode
- Spatial hash works well for JS (lower constant overhead than KD-tree)

### MeshOps.realizeInstances (from Blender realize_instances.cc)
- Add `realizeInstances(group: Group) → BufferGeometry` — flatten InstancedMesh2 to real geometry
- Needed for: GLTF export, boolean operations, vertex painting on instances
- Algorithm: for each instance, copy source geometry transformed by instance matrix, merge all copies
- Must handle material index remapping when merging different sources

### FaceClassifier.extractFaces dual output (from Blender separate_geometry.cc)
- Should return `{selected: BufferGeometry, remainder: BufferGeometry}` — both parts, not just one
- Blender's Separate Geometry always produces matching AND inverted outputs
- Essential for composition: extrude walls, keep roof unchanged, recombine

### ForEach patterns (from instance/composition analysis)
- `ForEach.perFaceGroup` — iterate groups (not individual faces), matches Blender's foreach_real_geometry pattern
- `ForEach.perPoint` — forked RNG per point is correct
- Blender processes unique geometries in parallel (threading::parallel_for) — defer to Phase 5 WebWorker

### Curve to Mesh improvements (from Blender node_geo_curve_to_mesh.cc)
- Add `scales?: number[]` param for per-point profile scale (tapering for roads, racetracks)
- Add `fillCaps?: boolean` param for closed profiles
- Use TubeShapeGeometry from core (already decided)

### PrimGen improvements (from Blender mesh primitives)
- Add face group outputs to primitives — `wallGrid` should tag faces by bay position
- Handle dimensional degeneracy (0 segments → graceful fallback)
- Cylinder = Cone(r, r) — consider unified `revolution(topR, bottomR, ...)` function

### Composition patterns (from Blender closures/bundles)
- TypeScript closures already cover Blender's Closure pattern naturally — no special infrastructure needed
- Consider `GeneratorConfig` bundle type for passing complete styles/biomes as single objects
- Material index remapping in MeshOps.merge is critical (Blender handles this with VectorSet dedup)

## Things We Do Better Than Blender (for web)
- Spatial hash for Poisson (lower overhead than KD-tree in JS)
- Direct-to-InstancedMesh2 (correct for WebGL draw call constraints)
- Single-call FaceClassifier vs Blender's multi-node chain
- densityField callback (more flexible than vertex-attribute-only density)
