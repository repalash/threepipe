# Procedural Generation Package — Full Exploration & Assessment

**Created:** 2026-06-05
**Scope:** `plugins/procedural-generation/` (~16k LOC) + its `examples/*` and `issues/open/procedural-*`
**Method:** Direct reading of core files + 4 parallel deep-dive agents, ground-truthed against the master tracker.
**Related:** [procedural-generation-status.md](procedural-generation-status.md) (the owner's running tracker),
[procedural-generation-blender-comparison.md](procedural-generation-blender-comparison.md),
[comparison-pipeline-v2.md](comparison-pipeline-v2.md), [flower-scatter-v5-findings.md](flower-scatter-v5-findings.md),
[building-generator-plan.md](building-generator-plan.md), [distribute-points-id-mismatch.md](distribute-points-id-mismatch.md).

## TL;DR

A substantial, sophisticated, **uncommitted/gitignored WIP** package with two intertwined goals:
1. A **procedural-generation framework** for threepipe (reactive graph + generators + plugin).
2. A **Blender-geometry-nodes → TypeScript porting toolkit** that verifies ports numerically against
   Blender's own depsgraph output (full 16-value world-matrix match, tol 1e-2).

The core library (graph engine + ~2,300 LOC of C++-source-cited Blender node ports + mature geo/points
layers) is real and several ports are **verified against Blender ground truth**. But the package is
gitignored, its examples survive only as orphaned compiled `.js`, its tests aren't in CI, and there is
**no generic `.blend`-node-tree interpreter** — every port is hand-authored TypeScript. It's a
well-equipped manual-porting framework, stalled mid-stream and never committed.

---

## 1. Architecture — three layers

### Layer 1 — Reactive node graph (`src/graph/`, ~400 LOC, zero-dep, well-tested)

Pull-based, selectively-recomputing DAG. Strict one-way dependency `graph → runtime → ui`.

- **`graph.ts`** — `defineNode`/`defineNodeType`/`defineGraph`/`connect`. Nodes are **frozen, stateless
  blueprints** (`NodeDef = {name, inputDefs, outputDefs, evaluate}`), identified by object identity.
  Connections reference NodeDefs by identity. `defineGraph` validates every connection's endpoints and
  precomputes a Kahn topological sort (`topoSort`, throws on cycle). All pure/frozen.
- **`runtime.ts`** — `createRuntime` holds the only mutable state: `Map<NodeDef, {inputs, outputs, dirty}>`,
  plus precomputed `downstream`/`incomingByNode`/`connectedInputs` adjacency. `set()` is O(1) (writes one
  input, flips one dirty flag, short-circuits unchanged primitives). `evaluate()` walks the topo order
  once — skips clean nodes, pulls upstream outputs into dirty nodes, runs `evaluate`, marks downstream
  dirty (reached later in the same pass). **Known TODO (`runtime.ts:164`):** dirty propagation is
  *structural*, not value-based — a node re-fires downstream even if its output didn't change.
- **`ui.ts`** — `graphUiConfig` flattens all settable `PropDef` inputs into one folder (Blender-modifier
  panel style); control type inferred from value + ui metadata. Raw (non-PropDef) inputs hidden.
- **`visualizer.ts`** — standalone SVG node-graph overlay (structure viewer, longest-path layout).
- **`module.ts`** — the **output contract**: a `GraphModule = {graphs: GraphEntry[], assets, assetsPath}`.
  Each graph's `outputs: OutputRef[]` points at node outputs producing either `GeneratedInstance[]`
  (`{world_matrix: number[16] column-major Blender Z-up, object_name: string}`) or plain mesh-data objects
  (`{rings: [{vertices, indices, placements}]}`).

**Compile-time type-checked connections:** `connect()` (`graph.ts:68-79`) uses a conditional-type guard
on `toInput` — if the resolved output type isn't assignable to the resolved input type, the type collapses
to `never` and the call won't compile. Key existence is enforced via `keyof`. Tested in `graph.typecheck.ts`
with `@ts-expect-error` markers.

**Verified working:** unit tests (`graph.test.ts`) cover linear chains, diamond selective-recompute,
Leibniz π, Fibonacci, an 8-node Buildify mock, `defineNodeType`; `graph.perf.ts` benchmarks a 10k-node
graph. (Tests are standalone tsx scripts, NOT in CI — see §4.)

### Layer 2 — Blender node ports (`src/blender/`, ~2,300 LOC, C++-source-cited)

Hand-written TS ports, each citing the exact Blender C++ file. Consumed directly by generators (NOT by a
generic evaluator).

- **`distribute_points_on_faces.ts` (757)** — `distributePointsOnFaces(geometry, options)`: line-by-line
  port of Blender's RANDOM + POISSON Distribute Points on Faces, incl. the exact 48-bit LCG
  `RandomNumberGenerator` (BigInt state, cites `BLI_rand.hh`), `get_barycentric_coordinates`, KDTree3D
  Poisson elimination, density-factor masking, and `compute_point_ids` (`noise::hash(...)`). Constants
  (`seed*5383843`, hash seeds) verified against `.repos/blender-gn-source`.
- **`geometry_nodes.ts` (983)** — ~30 ops: `normalizeAngle`, `alignEulerToEdgeNormal`,
  `alignEulerToVectorAutoPivot` (real `align_rotations_auto_pivot` port), `pointOnSegment`,
  `meshToCurveSplitTrim` (fused Mesh-to-Curve+Split+Trim, **2D-only**), `resampleCurve` (LENGTH, `floor()`),
  `meshGrid` (**points only**, no faces), `separateGeometry`/`joinGeometry`,
  `storeNamedAttribute`/`inputNamedAttribute`, `yUpToZUp`, `fromLocRotScale` (Instance-on-Points matrix,
  cites `BLI_math_matrix.hh`), `transformPoints` (**scale+translate only, no rotation**), Euler↔matrix
  (`eulToMat3`/`mat3ToEul`/`axisAngleToMat3`/`mulMat3`), `rotateEulerAxisAngleLocal/Object`,
  `sampleImageTexture` (bilinear, red channel), `colorRampLinear2`, `evaluateColorRamp` (N-stop),
  `evaluateFloatCurve` (bezier + auto-handles), `interpolateScatterUVs`, `scatterToInstances` (high-level).
- **`math_nodes.ts`** — `mapRange`/`mapRangeStepped`/`mapRangeSmoothstep` (clamp-by-default), `clamp`,
  `mixFloat`/`mixVector`, `compare`/`compareFloat`, `booleanMath`, `mathOp` (~40 ops incl WRAP/PINGPONG/
  SMOOTH_MIN), `smoothMin`.
- **`noise.ts`** — Jenkins lookup3 hash (`hash1/2/3`, `hash_to_float1/2/3`), constants verified vs `noise.cc`.
- **`random_value.ts`** — `randomInt`/`randomFloat`/`randomBool`/`randomVector`. **Critical gotcha:** INT
  uses `hash(id, seed)`, FLOAT/VECTOR use `hash(seed, id)` — swapped arg order, matching Blender.
- **`subdivision_surface.ts` (305)** — `catmullClark`/`subdivisionSurface`. Ported from `gl-catmull-clark`
  (MIT), NOT Blender's OpenSubdiv; standard boundary rules; treats GLB input as triangles (loses quads).

**Coverage:** field/scalar math is broad and high-fidelity; the **topology half is thin** — missing Set
Position, Vector Math, **Noise/Voronoi texture nodes** (the `utils/Noise.ts` simplex impl is separate, not
a Blender port), instance-realize-as-node, full transform-with-rotation, Switch/Index Switch, Curve-to-Mesh,
Repeat/Simulation/For-Each *zones* (only imperative `compose/ForEach.ts` helpers exist).

### Layer 3 — geo/points/generators + plugin (mature, BufferGeometry-based)

- **`geo/`** — `PrimGen` (grid/wallGrid/extrudedPolygon, Uint16→Uint32 auto-switch), `MeshOps`
  (merge/extrudeFaces/realizeInstances), `Displace` (in-place noise + two real erosion sims: thermal
  Musgrave/Olsen + hydraulic droplet per Beyer/Lague, NaN-guarded), `HeightmapOps` (gradient/laplacian/
  smooth/normalize/statistics), `DerivedAttributes` (slope/curvature/aspect/normalizedHeight +
  generic store/read/smoothAttribute), `FaceClassifier` (rule engine + `extractFaces` dual output).
- **`points/`** — `ProcPoint`/`PointCloud` model; `Distribute` (custom **seeded** area-CDF + barycentric
  sampler — explicitly NOT three.js MeshSurfaceSampler which is unseeded; on-faces Poisson decouples
  spatial-sampling RNG from density-field RNG so changing density doesn't move points; plus on-grid,
  along-curve, on-wall-grid); `Instance` (`atPoints`/`pickFromCollection`/`byRules` → `InstancedMesh2`,
  forked RNG per source).
- **`generators/`** — `TerrainGenerator` (noise + erosion, registered), `BuildingGenerator` (box-assembly,
  registered; gabled/hipped roofs are tapered-box approximations), `VegetationScatterGenerator` (the
  points-pipeline showcase, registered), `FlowerGenerator` (Blender port, petal math in Node-safe
  `flower-math.ts`), `buildify_demo_1` (Buildify 1.0 port — exported as functions, **not** a registered
  generator, needs a caller-supplied `ModuleMap`).
- **`ProceduralGeneratorPlugin`** — dirty-flag frame coalescing (param change → `Set<IObject3D>` +
  `postFrame` regenerate-once, no debounce hacks), UI injection, registers generators into
  `Object3DGeneratorPlugin` via `viewer.forPlugin(...)`. `AProceduralGenerator.generate()` is a pure
  function (doesn't read `this`) enabling composition.
- **`utils/node-polyfill.ts` (372)** — full headless-Node shim (document/canvas/Image/FileReader/
  blob-fetch/WebGL2 auto-stub Proxy + `DummyRenderManager`) so the *entire* pipeline — including a real
  `ThreeViewer` and GLB loading — runs in Node.js for verification.

---

## 2. The porting pipeline (`porting/`) — a Claude skill + scripts

`porting/skill.md` is a self-contained **Claude skill** (`name: geonode-to-threepipe`) describing a 7-phase
Blender→TS port:

1. **Extract** — `extract_geo_nodes.py` (563) dumps the geometry-node tree to JSON (nodes, links, sockets,
   sub-groups, ColorRamp/FloatCurve data, recursive) via `bl_rna` introspection.
2. **Export** — `export_assets.py` (668) exports referenced meshes as GLB + manifest (flattening procedural
   materials to flat colors); `export_ground_truth.py` (332) evaluates the modifier and dumps per-instance
   4×4 world matrices; `export_intermediate.py` (150) dumps debug point clouds.
3. **Map** — list every `bl_idname`; reuse existing `src/blender/` ports, port the rest from C++ line-by-line.
4. **Build** — **hand-write** a `graph.ts` exporting a `GraphModule`. The graph models only the **top-level**
   tree 1:1; sub-group logic is plain TS inside `evaluate`.
5. **Verify** — `compare_graph.ts` (475) imports the `graphModule`, evaluates, and checks **all 16 matrix
   values** per instance against ground truth (tol 1e-2). Also (V2) per-asset instance counts + scene bbox.
6. **Wire UI** — `launchGraphViewer(graphModule)` auto-builds scene (`buildSceneFromInstances`: groups by
   `object_name`, one `InstancedMesh2` per submesh, Blender-Z-up→three-Y-up per matrix) + Tweakpane UI.
7. **Library feedback** — new node functions go into `src/blender/`, exported from both entry points,
   documented back into the skill.

**Hard rules** (skill.md): read the C++ source for every node; never reverse-engineer parameters from
ground truth; never pre-bake computable outputs; never silently skip/approximate a node tree.

Scripts tested on **Blender 4.0.2 and 5.0.1** (so the extractor already handles Blender 5.0 files).

---

## 3. Verified ports (per the status tracker — matrix/vertex-checked against Blender)

- **Buildify demo-3** (3 grid buildings, 1149/1149 matrix match), **demo-4** (edge-based, 238/238).
- **Flower / rose** (`repeat_zone_flower_by_MiRA.blend`, 7392/7392 vertices, tol 0.002) with bud→bloom anim.
- **Flowers-on-building** (composition, mixed output types).
- **Pebble scatter** (3 sizes, Blender-ported distribute, 99.4% count, reactive).
- **Flower scatter** (grass + flowers on terrain, 4 collections, texture density, Random Orientation, reactive).

22 related `examples/*` dirs exist; 8 have a compiled `graph.js` (buildify-demo-3/4, candy-bounce,
flower-demo, flower-scatter-v4/v5, flowers-on-building, pebble-scatter).

---

## 4. Status: substantial but stalled

- **Entirely gitignored/uncommitted** — `.gitignore:96` ignores the whole plugin; `git ls-files
  plugins/procedural-generation` → 0 files. `git log` for the plugin and the examples → empty. Most src
  dated Apr 5, `dist` Apr 7. Two `porting*.zip` snapshots (Apr 1 / May 6, 83 KB each) sit in the root.
- **Examples are orphaned** — only compiled `.js` survive; `find examples -name graph.ts` → nothing. No
  `index.html`/`script.ts`/`assets/` on disk for most. The skill references files that aren't present.
  `examples/**/*.js` is also gitignored.
- **Tests not in CI** — `package.json` has no `test` script; the two tests are standalone tsx scripts with
  a custom assert harness; root `vitest.config.ts:31` explicitly excludes `plugins/**`. They fail to load
  in a bare `tsx` here (importing `threepipe` pulls modded-three TS decorators esbuild can't transform).
  Pass/fail unknown in this environment — they presumably ran against a prior build.
- **Packaging gaps** — `dist/graph/index.mjs` is a 29-byte re-export stub; the `./graph` subpath in
  `package.json` points at raw `.ts`; stale `.js` sit beside every `.ts` in `src/`. Flagged P3 in the tracker.
- **Open bugs** (`procedural-generation-blender-comparison.md`): `byRules` drops `alignToNormal`/
  `randomRotationY`; Voronoi tiles every 256 units; `fork()` precision loss; Poisson density-field RNG
  coupling. Plus a large backlog of unported noise/distribution/mesh ops.
- **Comparison pipeline V2** (`comparison-pipeline-v2.md`): Steps 1-2 done (matrix + scene-bbox checks),
  Steps 3-5 deferred (per-object-name GT counts, standardized GT format, re-verify all demos).

---

## 5. The key connection — relevance to the blend-importer / geometry-nodes gap

This is the most important finding. During the blend-importer Blender-5.0 work we hit the limitation
*"geometry-nodes output isn't stored, so it can't be rendered"* (the parser reads only the small base mesh;
the visible detail is generated by evaluating the node graph at runtime).

All four deep-dives independently flagged the same gap here: **there is no generic `.blend`-node-tree
interpreter.** The pipeline produces (a) a Python extractor → node-graph JSON, and (b) a library of
individual node-equivalent functions — but a *human/agent hand-writes the wiring per file* (skill Phase 3-4).

So between the two packages we now have most of the pieces for actual geometry-nodes evaluation:
- **A `.blend` parser** (blend-importer, now Blender-5.0-capable) that could read the node tree directly,
  replacing the Python extractor.
- **~30 verified Blender node-operation ports** here, plus distribute-points and subdivision.
- **A reactive graph engine** with the exact column-major Z-up output contract the viewer already consumes.

What's missing to bridge them into a generic evaluator (estimated "a major new subsystem, weeks", not wiring):
1. **A tree interpreter** — read the node-graph JSON (or the parsed `.blend` tree), register each
   `bl_idname` → a `NodeDef`/operation, instantiate connections, topo-walk and dispatch. Nothing does this.
2. **A real Geometry datatype** (`GeometrySet`: verts/edges/faces/corners + per-domain attributes +
   points + instances) flowing edge-to-edge. The ports currently use 3 incompatible representations
   (BufferGeometry / number[][] / arrays-of-POJOs) stitched by hand.
3. **A Field/multi-function evaluation model** — Blender fields are lazy per-element functions evaluated in
   a domain context; the ports inline field logic imperatively.
4. **Zones** — Repeat / For Each / Simulation map only to imperative helpers, not graph constructs.
5. **The remaining topology + texture node ports** (Set Position, Noise/Voronoi textures, Curve-to-Mesh,
   Extrude, Switch, etc.).

This subset is *driveable* today for already-ported nodes given a JSON→graph loader + node registry; a
*generic* evaluator for arbitrary trees needs items 2-5.

---

## 6. Assessment & options

**What it is:** a well-equipped, partially-verified manual Blender-porting framework + a clean reactive
graph engine + a mature procedural geo/points toolkit. Several real ports pass Blender ground-truth checks.

**What it isn't:** committed, CI-tested, packaged, or a generic node-tree evaluator. The reactive graph is
currently used only by the porting/comparison harness — the production generators call the ported functions
directly as plain TS.

**Possible directions (for the owner to pick):**
1. **Stabilize & commit** — un-gitignore, wire tests into CI (port the tsx-script tests to vitest, or add a
   `test` script), fix the `./graph` dist subpath + strip stale `.js`, fix the 4 known comparison bugs.
   Makes the existing verified work durable and shippable.
2. **Finish comparison pipeline V2** (Steps 3-5) — unblocks reliable verification for future ports.
3. **Bridge to blend-importer** — build the node-tree interpreter (item §5.1) driven by the parsed `.blend`
   tree + the existing node-op library, to evaluate the *subset* of geometry-nodes setups whose nodes are
   already ported. This is the highest-leverage path toward rendering geometry-nodes output from a `.blend`.
4. **Port more nodes** — Noise/Voronoi textures, Set Position, Curve-to-Mesh, zones — expanding coverage.

## 7. File index

```
plugins/procedural-generation/
  src/
    index.ts                    public API surface (~80 exports)
    AProceduralGenerator.ts     base class (pure generate())
    ProceduralGeneratorPlugin.ts viewer plugin (dirty-flag coalescing, UI injection)
    graph/  graph.ts runtime.ts ui.ts module.ts visualizer.ts   reactive DAG engine
    blender/ geometry_nodes.ts(983) distribute_points_on_faces.ts(757)
             subdivision_surface.ts math_nodes.ts noise.ts random_value.ts   C++-cited ports
    geo/    PrimGen MeshOps Displace HeightmapOps DerivedAttributes FaceClassifier
    points/ Distribute Instance types                  seeded distribution + instancing
    generators/ Terrain Building VegetationScatter Flower buildify_demo_1 flower-math
    modules/ModuleKit.ts compose/ForEach.ts            composition helpers
    viewer/GraphViewer.ts                              launchGraphViewer + scene builders
    utils/  Noise SeededRandom node-polyfill           simplex noise + headless-Node shim
  porting/
    skill.md skill-v1.md guide.md                      the Claude porting skill + tutorial
    references/ phases.md verification.md learnings.md buildify.md
    scripts/ extract_geo_nodes.py export_assets.py export_ground_truth.py
             export_intermediate.py compare_graph.ts compare_ground_truth.ts compare.sh
  tests/  graph.test.ts graph.typecheck.ts graph.perf.ts distribute_points_on_faces.test.ts
  graph.md README.md CHANGELOG.md package.json
  porting.zip  "porting 2.zip"   (Apr 1 / May 6 snapshots)
examples/  buildify-demo-1..4 candy-bounce flower-* pebble-scatter procedural-* (~22 dirs; 8 have graph.js)
```
