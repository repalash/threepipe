# Procedural Generation Package — Status & Tracking

## Goal
A procedural generation package for threepipe that supports:
1. **Code-based generation** via the graph system and AProceduralGenerator framework
2. **First-class Blender geometry nodes porting** — extract, implement, verify, render
3. **Iterative library building** — each ported .blend file expands the library of reusable node implementations

## Strategy
Take pre-made Blender geometry node setups → port them → test against Blender output via Node.js comparison scripts → use the ported Blender C++ functions to build a growing library of reusable nodes.

---

## What We Have (verified working)

### Core Infrastructure
- [x] Graph system: defineNode, defineNodeType, defineGraph, connect, createRuntime, graphUiConfig
- [x] Selective recompute with dirty propagation
- [x] Auto-generated UI from PropDef metadata
- [x] GraphModule standard export format
- [x] Graph visualizer (SVG overlay)
- [x] AProceduralGenerator base class + ProceduralGeneratorPlugin
- [x] GeometryGeneratorPlugin with 9 primitive types + Text + Line extras

### Blender Utilities (src/blender/)
- [x] Jenkins hash (hash1/2/3, hash_to_float1/2/3) — from BLI_noise.hh
- [x] Random Value (INT, FLOAT, BOOL, VECTOR) — from node_fn_random_value.cc
- [x] mapRange (LINEAR, STEPPED, SMOOTHSTEP, clamp=true default) — from node_shader_map_range.cc
- [x] clamp, mixFloat, mixVector, compare, booleanMath
- [x] mathOp (40+ operations) — all ShaderNodeMath ops
- [x] meshGrid — from mesh_primitive_grid.cc
- [x] fromLocRotScale — from BLI_math_matrix.hh
- [x] resampleCurve (floor(), not round()) — from resample_curves.cc
- [x] meshToCurveSplitTrim, alignEulerToEdgeNormal, pointOnSegment, normalizeAngle
- [x] separateGeometry, storeNamedAttribute, inputNamedAttribute
- [x] joinGeometry, transformPoints
- [x] distributePointsOnFaces (RANDOM + POISSON) — from node_geo_distribute_points_on_faces.cc, with Blender's exact LCG RNG + KDTree elimination

### Geometry/Point Cloud System
- [x] PrimGen: grid, wallGrid, extrudedPolygon
- [x] MeshOps: merge, extrudeFaces, realizeInstances
- [x] Displace: withNoise, heightmap ops, terrace, thermal/hydraulic erosion
- [x] DerivedAttributes: slope, curvature, normalizedHeight, aspect
- [x] FaceClassifier: classify, extractFaces
- [x] Distribute: onFaces, onGrid, alongCurve, onWallGrid
- [x] Instance: atPoints, pickFromCollection, byRules

### Porting Pipeline
- [x] extract_geo_nodes.py — dumps node tree to JSON
- [x] export_assets.py — GLB + manifest export
- [x] export_ground_truth.py — instance matrices export
- [x] export_intermediate.py — debug point cloud export
- [x] compare_graph.ts — verifies GeneratedInstance[] and mesh vertex outputs
- [x] compare.sh — convenience wrapper
- [x] skill.md — comprehensive porting guide (610 lines)
- [x] guide.md — tutorial-style walkthrough

### Verified Ports
- [x] Buildify demo-3: 3 grid-based buildings, 1149/1149 matrix match
- [x] Buildify demo-4: edge-based building from .blend, 238/238 matrix match
- [x] Flower: procedural rose from .blend, 1232/1232 vertex match (tol=0.002)
- [x] Flowers-on-building: composition demo, mixed output types
- [x] Pebble scatter: 3 pebble sizes on ground mesh, Blender-ported distributePointsOnFaces (40524/40758, 99.4% count match, reactive)
- [x] Flower: redone as proper graph (not monolith), with bloom animation (bud→bloom), 7392/7392 vertex match
- [x] Flower scatter: grass + flowers on terrain, 4 collections (2 grass + bluebells + dandelions), texture-based density filtering, Random Orientation, reactive (seed/density)

### Generators
- [x] TerrainGenerator — noise + erosion
- [x] BuildingGenerator — box-assembly
- [x] VegetationScatterGenerator — distribute + instance
- [x] FlowerGenerator — procedural rose (from Blender port)
- [x] buildify_demo_1 — Blender-accurate Buildify

---

## Active Work

**Currently:** All comparisons verified — instances (238/238 with scene bbox), vertices (7392/7392 world-space). Ready for next task.

### Sub-plans
- [comparison-pipeline-v2.md](comparison-pipeline-v2.md) — Unified scene verification (unblocked)
- [threepipe-nodejs-support.md](threepipe-nodejs-support.md) — ThreeViewer Node.js support status & issues

---

## What Needs Fixing (bugs/issues)

### P0 — Correctness
- [x] `math_nodes.ts` WRAP operation — fixed, verified against `blenlib/intern/math_base_inline.cc:271`

### P1 — Performance
- [x] `buildSceneFromInstances` converted to use `InstancedMesh2` — one draw call per (asset, submesh) instead of per instance. See [instanced-rendering-subplan.md](../resolved/instanced-rendering-subplan.md).
- [x] `GraphViewer.ts` rebuild() now disposes `instanceMatrix`/`instanceColor` GPU buffers on InstancedMesh2 (was leaking on every rebuild)

### P1 — Runtime
- [x] `runtime.get()` now throws for non-existent output keys (was silently returning undefined)
- [x] `runtime.isSettable()` now returns false for unknown nodes (was returning true)
- [x] `runtime.markDirty()` now throws for unknown nodes (was silently ignoring)

### P1 — Architecture
- [x] `ModuleMap`/`ModuleData` types in `buildify_demo_1.ts` imported by generic `GraphViewer.ts`. Moved to `graph/module.ts`, re-exported from old location for backward compat.
- [x] `flower-math.ts` local `mapRange` — fixed, now imports from `blender/math_nodes`
- [x] `GraphViewer.ts` mid-file `three` import — fixed, moved to top
- [x] `GraphViewer.ts` unused `Box3` — fixed, removed
- [x] `compare_graph.ts` stale "IObject3D" comment — fixed
- [x] `compare_graph.ts` unused `GTVertices` — fixed, removed

### P2 — Documentation
- [ ] README lists only 4 of 16 examples. Update.
- [x] `skill.md` flower-demo reference — fixed

### P2 — Audit findings (need discussion/research)
- [ ] `graph/ui.ts` proxy initialized with defaults, not current runtime values — UI out of sync if `set()` called before UI creation
- [ ] `graph/graph.ts` self-loop connections silently accepted — input resolution runs but dirty propagation skips them. Should reject in `defineGraph`.
- [ ] `graph/graph.ts` no validation for duplicate connections to same input port
- [ ] `Instance.ts` `_composeMatrix` allocates `new Quaternion()` + `new Euler()` per instance (80K objects for 40K instances). Should use module-level temps.
- [ ] `Displace.ts` `thermalErode` read-while-write — modifies heightmap in-place during iteration (scan-direction bias)
- [ ] `DerivedAttributes.ts` `curvature` fallback (no normals) uses unsigned magnitude — produces incorrect sign
- [ ] `math_nodes.ts` `mathOp('LOGARITHM', negative, b)` returns NaN — Blender returns 0
- [ ] `math_nodes.ts` `mapRangeStepped` has no clamp — inconsistent with `mapRange` default

### P3 — Build/Package
- [ ] `./graph` subpath in package.json points to `.ts` source files — won't work for npm publish
- [ ] `@threepipe/plugin-tweakpane` is imported but not listed in peerDependencies
- [ ] `createGraphOverlay` in `/graph` subpath uses DOM APIs (only at call time, not import time)
- [ ] `ProceduralGeneratorPlugin` has no deserialization — loaded scenes have params but empty geometry

---

## What's Missing (for future ports)

### Blender Nodes Not Yet Ported
These will be ported on-demand as new .blend files need them:
- Noise Texture (Blender's exact Perlin, not simplex)
- Subdivision Surface (Catmull-Clark)
- Distribute Points on Faces (Blender's exact algorithm)
- Instance on Points (formal node wrapper, not inline)
- Delete Geometry (by selection predicate)
- Duplicate Elements (SPLINE domain)
- Extrude Mesh (edge/vertex modes — only face mode exists)
- Curve to Mesh, Curve to Points, Mesh Circle
- Repeat Zone / Simulation Zone (formal abstraction)
- Switch / Index Switch
- Accumulate Field / Evaluate at Index

### Verification Gaps
- [ ] `compare_graph.ts` has no automated reactivity check — should perturb inputs and verify output changes (prevents pre-baked graphs passing trivially)

### Testing Gaps
- No unit tests for blender/ utilities (verified via ground truth comparison only)
- No unit tests for generators
- No unit tests for geo/points operations
- Graph system is well-tested (355 lines of tests)

### Geo/Points Improvements (from blender-comparison and v3 plan)
- Hybrid Multifractal noise, White noise, Voronoi F2, 3D/4D noise, Wave Texture
- Stable point IDs across regeneration
- Per-axis scale in Distribute/Instance
- `mergeByDistance` in MeshOps
- `realizeInstances` improvements

---

## Tracking Approach

Each new .blend file port follows this process:
1. **Extract** — run extract_geo_nodes.py, analyze the graph
2. **Export** — assets + ground truth from Blender
3. **Map** — identify which nodes exist vs need porting
4. **Port missing nodes** — from Blender C++ source, add to src/blender/
5. **Build** — implement as GraphModule (instance output) or AProceduralGenerator (mesh output)
6. **Verify** — compare_graph.ts or vertex comparison, 100% match required
7. **Update skill.md** — document any new learnings

New issues go in `issues/open/`. Resolved issues move to `issues/resolved/`.
