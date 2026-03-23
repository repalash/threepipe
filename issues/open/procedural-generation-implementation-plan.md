# Procedural Generation Framework for Threepipe

## Context

A user submitted two research documents (v2 and v3) proposing a procedural generation framework for threepipe, inspired by Blender Geometry Nodes. The goal: a production-quality framework of pure utility functions + a generator base class + complete sample generators (terrain, buildings, cities, race tracks) that can serve as the foundation for full-fledged generators like those available in Blender.

The framework should follow threepipe's existing patterns (particularly the `plugin-geometry-generator` plugin pattern) and be implemented as a new plugin package.

---

## Architecture Decision

### Where the code lives

New plugin: `plugins/procedural-generation/` → `@threepipe/plugin-procedural-generation`

This follows the exact pattern of `plugins/geometry-generator/`. One package containing both utility functions AND sample generators — avoid premature package splitting.

### Why NOT extend AGeometryGenerator

`AGeometryGenerator` outputs raw `BufferGeometry` data (vertices/indices/normals/uvs arrays via `_generateData()`). Procedural generators output entire scene graphs (`Group2` containing multiple `Mesh2` and `InstancedMesh2`). The output types are fundamentally different. New `AProceduralGenerator<TParams>` base class, but the managing `ProceduralGeneratorPlugin` follows the same registration pattern as `GeometryGeneratorPlugin`.

### Key pattern: `generate(params, rng)` is pure

Generators take explicit params and a `SeededRandom` instance. They don't read from `this`. The managing plugin reads decorated properties → calls `generate(params, rng)`. This enables composition (city generator calls building generator with explicit params, no state mutation).

### Partial regeneration

`AProceduralGenerator` supports an optional `update()` method for partial rebuilds:

```typescript
abstract class AProceduralGenerator<TParams> {
    abstract generate(params: TParams, rng: SeededRandom): IObject3D  // full rebuild

    // Optional: partial rebuild. Defaults to full rebuild.
    update(params: TParams, rng: SeededRandom, previous: IObject3D, changedParams: Set<string>): IObject3D {
        return this.generate(params, rng)
    }
}
```

The managing plugin tracks old vs new params. When a single param changes, it passes the `changedParams` set. Generators that want to optimize can override `update()` to only rebuild affected sub-trees. Simple generators just do full rebuilds — the optimization is opt-in.

### Disposal & Object3DManager Integration

Disposal works **automatically** via threepipe's existing `Object3DManager` system — no manual disposal tracking needed:

1. Generated objects use `Mesh2`, `InstancedMesh2`, `Group2`, `PhysicalMaterial` → all tracked by `Object3DManager`
2. When regenerating, call `oldOutput.dispose(true)` → removes from parent → triggers `parentRootChanged` → `Object3DManager.unregisterObject()` cascades through all children
3. `unregisterObject()` unregisters materials/geometries/textures. When a material/geometry has `appliedMeshes.size === 0` (no remaining users), it's auto-disposed by the manager (`autoDisposeMaterials/autoDisposeGeometries` flags)
4. **Shared ModuleKit assets are safe**: materials/geometries shared across multiple buildings via `ModuleKit` have `appliedMeshes.size > 0` as long as any building still uses them → they won't be disposed prematurely
5. **Partial regeneration** (`update()` path): only dispose the sub-tree being replaced, not the whole output. The replaced children get unregistered; the kept children stay registered.

`PrimGen` functions return plain `BufferGeometry` (not `BufferGeometry2`). Geometry upgrade to `IGeometry` happens automatically when assigned to `Mesh2`/`InstancedMesh2` via `iGeometryCommons.upgradeGeometry` during `Object3DManager.registerObject()`.

### Serialization

Generated objects store all params in `object.userData.generationParams` (same pattern as `AGeometryGenerator`). This is automatically included in `ThreeSerialization.Serialize`. On deserialize, `ProceduralGeneratorPlugin` detects objects with `generationParams` via `objectAdd` event and regenerates them + restores UI.

### UI integration

1. **Plugin-level**: Generate buttons in tweakpane (same pattern as `GeometryGeneratorPlugin.uiConfig`)
2. **Object-level**: When a procedural object is selected, a "Generation Params" folder with auto-generated sliders/toggles is injected into the object's UI (same pattern as `AGeometryGenerator.createUiConfig` + `updateUi`)
3. **Generator-level**: Individual generators can override `createUiConfig()` for custom UI

---

## Package Structure

```
plugins/procedural-generation/
  package.json                          # peer dep: threepipe >=0.4.0
  vite.config.js                        # copy from geometry-generator, change name
  tsconfig.json                         # copy from geometry-generator
  src/
    index.ts                            # public exports

    utils/
      SeededRandom.ts                   # mulberry32 RNG with fork()
      Noise.ts                          # simplex noise, fbm, ridged, voronoi (hand-rolled, no npm dep)

    geo/
      PrimGen.ts                        # grid (XZ plane), wallGrid, extrudedPolygon, profileExtrude
      MeshOps.ts                        # merge, extrudeFaces (with top/side output), curveToMesh
      Displace.ts                       # withNoise, erode (particle droplet), applyHeightmap
      DerivedAttributes.ts              # slope, curvature, normalizedHeight, store/read
      FaceClassifier.ts                 # classify faces by rules, BUILDING_RULES, TERRAIN_RULES presets

    points/
      types.ts                          # ProcPoint, PointCloud
      Distribute.ts                     # onFaces (random/poisson), onGrid, alongCurve, onWallGrid, filter, tag, jitter, merge
      Instance.ts                       # atPoints, pickFromCollection, byRules → InstancedMesh2 / Group2

    modules/
      ModuleKit.ts                      # asset registry, pickBySize, createArchKit, createVegKit

    compose/
      ForEach.ts                        # perFaceGroup, perPoint

    AProceduralGenerator.ts             # abstract base class (generate + update)
    ProceduralGeneratorPlugin.ts        # managing plugin (registry, UI, serialization, lifecycle)

    generators/
      TerrainGenerator.ts               # noise + erosion + vegetation
      BuildingGenerator.ts              # face classification + module instancing
      CityGenerator.ts                  # grid layout + building composition
      RoadGenerator.ts                  # curve-based road + props
      RaceTrackGenerator.ts             # closed-loop track with banking
      VegetationScatterGenerator.ts     # distribute + instance on any surface
```

---

## Phase 1: Foundation

**Goal:** Core utilities + base class + first working generator. Complete and usable standalone.

**Research step (before implementation):** Research how real terrain generators work — Blender's "A.N.T. Landscape", World Machine's node graph, GPU Gems terrain articles. Document key techniques: multi-octave noise composition, biome-driven height profiles, vertex coloring strategies.

### Files

1. **Package scaffolding** — `package.json`, `vite.config.js`, `tsconfig.json`
   - Template: `plugins/geometry-generator/package.json` and `vite.config.js`
   - Add alias to `vite.examples.config.js` line ~32

2. **`src/utils/SeededRandom.ts`**
   - mulberry32 algorithm (fast, good distribution)
   - `next()`, `range()`, `int()`, `pick()`, `shuffle()`, `gaussian()` (Box-Muller), `fork()`
   - `fork()` derives child seed from current state → independent streams

3. **`src/utils/Noise.ts`**
   - Hand-rolled simplex noise (~150 lines, Stefan Gustavson's public domain algorithm)
   - `createNoise2D(seed)`, `createNoise3D(seed)` → sampler functions returning -1..1
   - `fbm(noiseFn, x, y, options?)` — fractional Brownian motion
   - `ridged(noiseFn, x, y, options?)` — ridged multifractal
   - `voronoi2D(seed)` → `{ distance, cellId }`

4. **`src/geo/PrimGen.ts`**
   - `grid(sizeX, sizeZ, segsX, segsZ)` → `BufferGeometry` on XZ plane (Y-up, for terrain)
   - `wallGrid(width, height, baysX, baysY)` → subdivided quad on XY plane (for facades)
   - `extrudedPolygon(points, depth)` → uses Three.js `ShapeUtils.triangulateShape` (re-exported at `src/three/Threejs.ts:214`)
   - `profileExtrude(profile, path, segments, closed?)` → extrude 2D profile along 3D curve
   - Returns plain `BufferGeometry` — auto-upgraded to `IGeometry` when assigned to `Mesh2` via `Object3DManager`

5. **`src/AProceduralGenerator.ts`**
   ```typescript
   export abstract class AProceduralGenerator<TParams extends object = object> {
       constructor(public type: string) {}
       abstract defaultParams: TParams
       abstract generate(params: TParams, rng: SeededRandom): IObject3D
       update(params: TParams, rng: SeededRandom, previous: IObject3D, changedParams: Set<string>): IObject3D {
           return this.generate(params, rng)  // default: full rebuild
       }
       createUiConfig(object: IObject3D): UiObjectConfig[]  // auto from params
       setDefaultParams(params: Partial<TParams>): this
   }
   ```
   - Output: `IObject3D` (scene graph), not raw geometry
   - Params stored in `object.userData.generationParams` (same as geometry-generator)
   - UI auto-generated via `generateUiConfig()` from uiconfig.js

6. **`src/ProceduralGeneratorPlugin.ts`**
   - Manages generator registry: `generators: Record<string, AProceduralGenerator>`
   - `generateObject(type, params?, seed?)` → creates object, returns it (doesn't auto-add to scene)
   - `regenerateObject(object, changedParam?)` → computes changedParams set, calls `update()` or `generate()`
   - `disposeObject(object)` → traverse and dispose owned geometries/materials
   - Integration: `viewer.forPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin', plugin => plugin.addObject3DGenerators('procedural-', ...))`
   - Serialization: listens for `objectAdd` → detects `userData.generationParams` → restores UI
   - UI: folder with generate buttons per type (same pattern as `GeometryGeneratorPlugin.uiConfig`)

7. **`src/generators/TerrainGenerator.ts`** (Phase 1 version — noise only, no erosion yet)
   - Params: `size`, `resolution`, `seed`, `octaves`, `noiseScale`, `heightScale`, `waterLevel`
   - Uses `PrimGen.grid()` + vertex displacement via `fbm()`
   - Vertex coloring by height (green low, gray mid, white high)
   - Water plane at waterLevel

8. **`src/index.ts`** — export everything

### Examples

- `examples/procedural-terrain-basic/` — terrain with noise displacement, vertex colors, water plane, tweakpane UI for all params
- `examples/procedural-noise-visualizer/` — flat grid colored by different noise types (perlin, fbm, ridged, voronoi) side by side

### Verification
- `npm run vite` → open `procedural-terrain-basic` example
- Tweak seed, resolution, noise params → terrain regenerates
- Check: uses `Group2`, `Mesh2`, `PhysicalMaterial` correctly
- Check: disposal works (no leaked geometries/materials when regenerating)

---

## Phase 2: Point Distribution + Instancing

**Goal:** The universal "Distribute → Instance" pipeline. Working vegetation scatter.

**Research step:** Research how Geo-Scatter, Botaniq, and Blender's "Distribute Points on Faces" node work. Key questions: Poisson disk on mesh surfaces (Bridson's algorithm adaptation), density masks, normal-based filtering, per-instance random variation strategies.

### Files

1. **`src/points/types.ts`**
   ```typescript
   export interface ProcPoint {
       position: Vector3
       normal: Vector3
       rotation?: Euler
       scale?: Vector3
       attrs: Record<string, number | string>
   }
   export type PointCloud = ProcPoint[]
   ```

2. **`src/geo/DerivedAttributes.ts`**
   - `slope(geo)` → per-vertex angle from UP in degrees
   - `curvature(geo)` → approximate mean curvature
   - `normalizedHeight(geo)` → 0=min_y, 1=max_y
   - `store(geo, name, data, itemSize?)` / `read(geo, name)` — wrap `setAttribute`/`getAttribute`

3. **`src/geo/FaceClassifier.ts`**
   - `classify(geo, rules)` → `FaceClassification { labels, groups, faceInfos }`
   - `FaceInfo`: index, normal, center, area, slopeAngle, facingDirection, floorIndex
   - `BUILDING_RULES`: roof (slope<20), floor (normal.y<-0.7), wall_north/south/east/west
   - `TERRAIN_RULES`: cliff (slope>60), steep (slope>30), flat (slope<15)

4. **`src/points/Distribute.ts`** (~300 lines, core of the framework)
   - `onFaces(geo, options)` — random (uses three.js `MeshSurfaceSampler` already exported by threepipe) or poisson (Bridson's algorithm ~60 lines)
   - `onGrid(sizeX, sizeZ, spacingX, spacingZ, options?)` — regular grid with jitter/mask
   - `alongCurve(curve, options)` — evenly spaced points along curve with tangent frames
   - `onWallGrid(width, height, baysX, baysY, options)` — grid points on a wall face
   - `filter(cloud, pred)`, `tag(cloud, name, fn)`, `jitter(cloud, amount, rng)`, `transform(cloud, matrix)`, `merge(...clouds)`

5. **`src/points/Instance.ts`**
   - `atPoints(cloud, source, options?)` → `InstancedMesh2` — single source at every point
   - `pickFromCollection(cloud, sources, options?)` → `Group2` — weighted random pick, one `InstancedMesh2` per source
   - `byRules(cloud, rules, seed?)` → `Group2` — match points to sources by attribute predicates
   - Creates `InstancedMesh2` (not bare `InstancedMesh`) for proper threepipe integration

6. **`src/generators/VegetationScatterGenerator.ts`**
   - Params: targetMesh (or generate flat ground), density, method, slopeRange, heightRange, biome, seed
   - Pipeline: `DerivedAttributes.slope()` → `Distribute.onFaces()` → `Instance.pickFromCollection()`
   - Procedural trees: cone (canopy) + cylinder (trunk) merged into single geometry
   - Multiple vegetation types with weighted random selection

### Examples

- `examples/procedural-vegetation-scatter/` — terrain from Phase 1 + vegetation scatter. Poisson disk distribution, slope filtering, multiple tree types.
- `examples/procedural-point-distribution/` — visual debug: random vs poisson, grid vs curve distribution shown as small spheres

### Verification
- Vegetation scatter on terrain: trees only on non-steep, non-underwater areas
- Change density → regenerates with new distribution
- Performance: 10k+ instances should be fine via InstancedMesh2
- Poisson disk: no overlapping instances

---

## Phase 3: Mesh Ops + Building System

**Goal:** Face-based building generation, erosion terrain, module instancing.

**Research step:** Research how Buildify, Coan's PBG, and Gauthier's Auto-Building work in Blender. Key patterns: face classification for module placement, edge crease for pillars, face area for detail level selection, module collection swapping for style changes. Also research hydraulic erosion algorithms (Hans Theobald Beyer's paper, Sebastian Lague's implementation).

### Files

1. **`src/geo/MeshOps.ts`** (informed by Blender extrude_mesh.cc, separate_geometry.cc, realize_instances.cc)
   - `merge(...geometries)` — wraps `mergeGeometries` with material index remapping
   - `mergeByDistance(geo, distance)` — spatial hash + Union-Find vertex welding (needed after extrude)
   - `extrudeFaces(geo, selection, amount)` → `{ geometry, topFaceIndices, sideFaceIndices }` — individual face mode first, correct winding via fill_quad_consistent_direction
   - `realizeInstances(group)` → `BufferGeometry` — flatten InstancedMesh2 to real geometry for export/boolean
   - Use `TubeShapeGeometry` from core for curve-to-mesh (supports per-point scale, fill caps, multi-material splits)

2. **`src/geo/Displace.ts`** (informed by Blender grid nodes: Gradient, Laplacian, Advect, Median)
   - `withNoise(geo, options)` — displace vertices by noise along axis
   - `erode(heightmap, w, h, options)` → `{ heightmap, flowMap, sedimentMap, erosionMap }` — particle droplet
   - `thermalErode(heightmap, w, h, options)` — moved from Phase 5: Laplacian-based, ~20 lines
   - `terrace(heightmap, w, h, levels, sharpness)` — moved from Phase 5: `floor(h*levels)/levels` + smoothstep, ~10 lines
   - `applyHeightmap(geo, heightmap)` — write heightmap to geometry Y
   - `extractHeightmap(geo, w, h)` → `Float32Array` — inverse of applyHeightmap

3. **`src/geo/HeightmapOps.ts`** (NEW — 2D analogs of Blender's OpenVDB grid nodes)
   - `gradient(heightmap, w, h, cellSize)` → `{gx, gz}` — finite difference, for erosion flow direction
   - `laplacian(heightmap, w, h, cellSize)` → `Float32Array` — foundation for thermal erosion
   - `smooth(heightmap, w, h, iterations, method: 'mean'|'median')` — double-buffered, post-erosion
   - `normalize(heightmap, targetMin, targetMax)` — remap after erosion

4. **`src/utils/Noise.ts` additions** (moved from Phase 5)
   - `domainWarp(noiseFn, x, y, warpAmount, warpScale, seed)` — one-liner wrapper, massive visual improvement

5. **`src/geo/FaceClassifier.ts` additions**
   - `extractFaces(geo, faceIndices)` → `{selected: BufferGeometry, remainder: BufferGeometry}` — dual output like Blender's Separate Geometry

6. **`src/geo/DerivedAttributes.ts` additions**
   - `smoothAttribute(geo, attrName, iterations, weight?)` — Blender's Blur Attribute analog
   - `attributeStatistics(data)` → `{min, max, range, mean, median, variance, stdDev}`
   - `aspect(geo)` — compass direction per vertex (0-360°), for north-facing snow etc.

7. **`src/modules/ModuleKit.ts`**
   - `add/get/getAll/pick/pickBySize` — Map-based registry
   - `createArchKit('modern'|'classical'|'industrial')` — procedural windows, doors, panels
   - `createVegKit('temperate'|'tropical'|'arid')` — procedural trees, bushes, grass

8. **`src/compose/ForEach.ts`**
   - `perFaceGroup(classification, fn)` → `Group2` — iterate groups (not individual faces)
   - `perPoint(cloud, fn, seed?)` → `Group2` — forked RNG per point

9. **`src/generators/BuildingGenerator.ts`**
   - Params: width, depth, floors, floorHeight, baysX, baysZ, roofStyle, style, seed
   - Pipeline: BoxGeometry body → `FaceClassifier.classify(BUILDING_RULES)` → `Distribute.onWallGrid()` per wall → `Instance.byRules()` with ModuleKit
   - Roof: flat (parapet), gabled, or hipped
   - Ground floor differentiation (doors vs windows)

10. **Update `TerrainGenerator`** — add erosion (hydraulic + thermal), terracing, domain warping, slope-based materials

### Examples

- `examples/procedural-building/` — single parametric building, tweakpane UI for all params, style switching
- `examples/procedural-terrain-erosion/` — terrain with hydraulic erosion + thermal erosion + terracing + vegetation

### Verification
- Building: change floors/width/style → rebuilds correctly
- Building: facade modules placed on walls, doors on ground floor, nothing on roof
- Erosion: visible river channels and sediment deposits
- Thermal erosion: talus/scree at cliff bases
- Terracing: visible stepped levels
- Domain warping: swirling organic terrain shapes vs straight FBM

---

## Phase 4: Composition + Advanced Generators

**Goal:** Multi-generator composition. City, road, racetrack.

**Research step:** Research city layout algorithms (L-shaped blocks, varying lot sizes, zoning), road generation techniques (Bezier road profiles, banked curves, lane markings), and racetrack design principles (racing lines, elevation changes, run-off areas, FIA track design guidelines for banking angles).

### Files

1. **`src/generators/CityGenerator.ts`**
   - Params: gridX, gridZ, blockSize, streetWidth, density, minFloors, maxFloors, seed
   - Pipeline: `Distribute.onGrid()` for block layout → `ForEach.perPoint()` calling `BuildingGenerator.generate()` per block → road surface between blocks → `VegetationScatterGenerator` for parks
   - Uses `rng.fork()` per building for deterministic independence

2. **`src/generators/RoadGenerator.ts`**
   - Params: curve (CurvePath3), width, hasSidewalk, lampSpacing, guardrailSide, seed
   - Pipeline: `MeshOps.curveToMesh()` for road surface → `Distribute.alongCurve()` for lamp posts → `Instance.atPoints()` for props
   - Proper road banking on curves

3. **`src/generators/RaceTrackGenerator.ts`**
   - Params: trackPoints (control points), width, bankAngle, barrierHeight, grandstandCount, seed
   - Closed-loop CatmullRomCurve3 → road generation → barriers via `Distribute.alongCurve()` → grandstands at select points
   - Terrain cutout/fill around track

### Examples

- `examples/procedural-city/` — grid city with buildings, roads, trees. Tweakpane for grid size, density, building height range.
- `examples/procedural-road/` — curved road with lamp posts, guardrails, sidewalks.
- `examples/procedural-racetrack/` — closed-loop track with barriers, grandstands, surrounding terrain.

### Verification
- City: buildings don't overlap, roads align with grid, trees in remaining spaces
- Road: lamps evenly spaced, guardrails follow curve, road surface is smooth
- Racetrack: closed loop, banked turns, barriers on both sides
- Seed changes: deterministic regeneration (same seed = same output)

---

## Phase 5: Advanced Terrain & Materials

- **Domain warping** — feed noise output back as input coordinates to create swirling organic terrain shapes (used in World Machine, Inigo Quilez's articles). `Noise.domainWarp(noiseFn, x, y, warpAmount, warpScale)`.
- **Thermal erosion** — material crumbles from steep slopes to create talus/scree at cliff bases. Simpler than hydraulic, good for rocky terrain. `Displace.thermalErode(heightmap, w, h, options)`.
- **Terracing** — quantize height levels for stepped terrain (rice paddies, mesas, canyon layers). `Displace.terrace(heightmap, levels, sharpness)`.
- **Multi-biome blending** — Voronoi cells assign different noise profiles per biome region, blended at boundaries. Produces varied terrain (mountains in one region, plains in another).
- `ProceduralTerrainMaterialExtension` — `MaterialExtension` that reads vertex attributes (slope/height/curvature) in fragment shader for texture blending. Replaces vertex colors with proper texture splatting.
- WebWorker offloading for erosion and heavy noise computation
- LOD integration via existing `SimplifyModifierPlugin`

## Phase 6: GPU Compute & Scale (future)

- **GPU noise** — move noise computation to vertex/compute shaders for real-time 1024x1024+ terrain
- **Chunked terrain** — tile-based terrain with LOD levels, loading/unloading chunks as camera moves
- **GPU erosion** — port particle erosion to compute shader for interactive erosion painting
- **Texture splatting** — proper multi-texture terrain material with triplanar mapping to avoid UV stretching on cliffs
- Documentation examples page and "Blender GN to threepipe" translation guide

---

## Key Files to Modify (existing codebase)

| File | Change |
|---|---|
| `vite.examples.config.js` ~line 32 | Add alias: `'@threepipe/plugin-procedural-generation': path.resolve(__dirname, './plugins/procedural-generation/src/index.ts')` |
| `examples/index.html` | Add links to new procedural examples |

## Key Files to Reference (patterns to follow)

| File | What to copy |
|---|---|
| `plugins/geometry-generator/package.json` | Package.json structure |
| `plugins/geometry-generator/vite.config.js` | Build config (change name) |
| `plugins/geometry-generator/src/AGeometryGenerator.ts` | Base class pattern (defaultParams, generate, createUiConfig, userData.generationParams) |
| `plugins/geometry-generator/src/GeometryGeneratorPlugin.ts` | Managing plugin pattern (Object3DGeneratorPlugin integration, UI, lifecycle) |
| `src/core/object/InstancedMesh2.ts` | Use this for instancing, not bare Three.js InstancedMesh |
| `src/core/object/Group2.ts` | Use this for output groups |
| `src/core/object/Mesh2.ts` | Use this for meshes |
| `src/core/material/PhysicalMaterial.ts` | Use this for materials |

## Dependencies

| Dependency | Decision |
|---|---|
| Simplex noise | Hand-rolled (~150 lines) — standard algorithm, no npm dep |
| Poisson disk | Hand-rolled (~60 lines) — Bridson's algorithm |
| Erosion | Hand-rolled (~100 lines) — particle droplet method |
| Polygon triangulation | Three.js `ShapeUtils.triangulateShape` (already available) |
| Geometry merge | Three.js `mergeGeometries` from `BufferGeometryUtils` (already re-exported by threepipe at `src/three/addons.ts:16`) |
| Surface sampling | Three.js `MeshSurfaceSampler` (already re-exported by threepipe at `src/three/addons.ts:37`) — use for `Distribute.onFaces` random mode |
| CSG / Boolean | Defer to Phase 5 — not needed by any Phase 1-4 generator |

## Phase 1 Learnings (applied during implementation)

- **Regeneration must be in-place**: `regenerateObject()` keeps the root Group2 alive and replaces children. Disposing the root breaks UI references. Same principle as GeometryGeneratorPlugin which mutates geometry in-place.
- **Dirty-flag + postFrame for param changes**: `onChange` → `_markDirty(object)` adds to a `Set<IObject3D>`. `postFrame` callback processes all dirty objects once per frame. Coalesces rapid slider changes naturally.
- **UI on folder, not per-child**: `onChange` goes on the folder `UiObjectConfig`, not on each slider individually. The folder propagates to children.
- **Generators must override `createUiConfig()`**: The auto-generated UI from `generateUiConfig()` has no bounds and can produce NaN. Each generator should provide explicit sliders with bounds, stepSize, and dropdowns for enum params.
- **Param clamping in `generate()`**: Always clamp params to safe ranges at the top of `generate()` to prevent NaN from invalid UI values.
- **No premature `update()` method**: Removed partial rebuild API from `AProceduralGenerator`. Full rebuild via `generate()` is the only path. Add partial rebuild later if a real generator needs it and the API shape is clear.
- **No redundant state**: Removed `__proceduralGenType` — `generationParams.type` is the single source of truth.
- **Zero allocations in hot loops**: Reuse Color/Vector objects in per-vertex loops. Hoist constants out of loops. Generators run on every slider drag — allocations add up.
- **Use `TubeShapeGeometry` (core) instead of hand-rolled profile extrude**: The existing implementation uses Three.js `computeFrenetFrames()`, has proper edge normal fixing, and multi-material splits. Added to core with TODO for full threepipe integration.

## Blender GN Comparison Findings (from source analysis)

Bugs fixed based on Blender comparison:
- `byRules` now properly forwards all InstanceOptions (alignToNormal, randomRotationY)
- Voronoi uses hash-on-the-fly instead of 256x256 precomputed table (no tiling)
- `fork()` uses raw 32-bit state directly instead of float→int conversion
- Poisson density field decoupled from spatial sampling (two-phase like Blender)

Full comparison saved to `issues/open/procedural-generation-blender-comparison.md`

## Implementation Order

Phase 1 → Phase 2 → Phase 3 → Phase 4 (each complete and usable after finishing)

Within each phase: research → utilities → base class/plugin updates → generators → examples → verify.

## Verification Requirements

After every phase:
1. Every hand-crafted mathematical formula or algorithm must have a source citation comment above it linking to the reference (paper, article, or well-known implementation)
2. If it's a novel derivation, include a derivation comment explaining why it works
3. Add each new example to `examples/index.html` sidebar
4. Every example script must have a block comment at the top explaining: what it demonstrates, how to test it, and what to verify visually
5. Scaffold must match the plugin-template-vite pattern: standalone tsconfig (not extending root), vite.config.js using `vite-utils.mjs`, typedoc.json, README.md, CHANGELOG.md
