# Track R — realism: subplan

**Status**: Phase A approved 2026-10-18 (answers in §9); R1 done (§2.1); next R2a shading. Parent: [13-roadmap-2026-10 §6](./13-roadmap-2026-10.md).
Branch `realism` (worktree `.repos/threepipe-realism`). Everything below that is a number was measured on
2026-10-18 by the scripts named next to it; the reference model is never committed (`tmp/ref/`, gitignored).

The goal: agents build models that look like the product, fast, from a library, with high poly as the source
of truth and low poly derived. The first deliverable is a benchmark that says, in numbers, how far a build
is from the ground truth, so every later step (R2–R6) is judged by it.

---

## 1. The reference, dissected

`tmp/ref/webgi-camera.glb` (2,822,688 bytes; Canon EOS 5D Mark IV + EF 24-105 f/4L, the 2021 webgi demo
model). Decoded in Node by `demos/benchmark/metrics/glb.mjs` (GLB + `KHR_draco_mesh_compression` through three's
own `draco_decoder.js`); per-part analysis by `tmp/realism/dissect2.mjs`, components by `tmp/realism/cc.mjs`.

### 1.1 Frame and scale

- Y up, lens along **−Z** (ours: lens along +Z), node tree `Scene-centered > Scene > Canon > 94 mesh nodes`,
  bbox 1.890 × 1.563 × 2.242 units, centred on the bbox (y is exactly ±0.7813).
- Scale from the lens: the EF 24-105's 83.5 mm diameter is 1.030 units → **81.07 mm/unit**. Width agrees
  (body shell 1.861 u = 150.9 mm vs the published 150.7 mm).
- **The artist model is off-spec in height**: 1.563 u = 126.7 mm against Canon's published 116.4 mm (+9 %);
  H/W is 0.84 against the real 0.77. Our demo model matches the published numbers (11/11 checks at 0.00 %),
  so a perfect-to-spec model cannot reach zero shape distance against this ground truth. The benchmark
  therefore aligns with a similarity transform and reports the fitted scale, and its acceptance thresholds
  are set from measured numbers, not from zero (§2, §8).

### 1.2 Parts and triangle budget

94 mesh nodes, **136,266 triangles**, 340 connected components (ours: 37 meshes, 28,982 triangles,
46 components). Names are generic (`+BODY0xx001`), so parts were grouped by hand (lens, shell, eyepiece,
screens, decals) and the rest by region around the mount, behind z = 1.25 u (rear) and above y = 0.15 u (top):

| Group | Meshes | Triangles | What |
| --- | ---: | ---: | --- |
| Lens | 13 | 36,157 | barrel shell `new` (18,432, micro-grain normal map), focus/zoom rubber `Rings1001`/`Rings2001` (**167 separate ribs**), front ring, red ring, 3 glass elements, switches, lens label decal, `Text001` (**3D text**, 29 letters, silver) |
| Eyepiece | 3 | 22,949 | eyecup `wizjer` (21,296: the densest part, 0.16–2 mm edges), frame, glass |
| Rear controls | 20 | 27,046 | the two largest, `+BODY076001` (6,819) and `+BODY064001` (3,560), and 18 buttons of 90–1,521 triangles each |
| Top | 17 | 12,908 | a rubber relief part `+BODY002001` (4,942, 44 % hard edges), hot shoe `+BODY077001` and 5 small metal parts on it, 9 plastic controls |
| Mount | 21 | 11,273 | metal mount ring, 6 screw-sized metal parts (1,160–1,196 triangles each), throat baffles, rear glass element, 8 gold contacts, a flat green-coated plane |
| Body shell | 4 | 10,997 | magnesium shell `Cube005001` + `Circle004001` (smooth, open: 535 + 238 boundary edges), leather skin (normal map ×6), 9 black gap strips (`GapsColor`) |
| Other (front, side) | 11 | 8,093 | plastic covers and buttons, metal parts at the body's side (`+BODY001001`, `+BODY095001`, `Cube005_4001`), the chrome bayonet `Circle004_1001` |
| Decals | 3 | 5,953 | white-print decal following the body (`+BODY018001`, 5,192), port icons, front logo |
| Screens | 2 | 890 | rear LCD and top LCD, texture + transmission |

Detail density is the plainest gap: 340 components vs our 46, and the ref spends its triangles where
highlights land (dials, buttons, ribs, eyecup), not on flat faces.

### 1.3 Smooth vs hard, and edge radii

Measured per part on welded positions: *hard%* = edges with dihedral > 30°; *split* = welded vertices
carrying more than one normal (> 5° apart, i.e. a shading seam); *r* = radius of the smooth curvature
across edges between 3° and 30° (edge length / dihedral), percentiles, in mm.

| Part | hard% | split verts | edge length p50 | r p10 / p50 |
| --- | ---: | ---: | ---: | ---: |
| ref body shell `Cube005001` | 4.4 | 12 % | 2.9 mm | 8.7 / 24.2 |
| ref lens shell `new` | 9.0 | 26 % | 2.0 mm | 4.4 / 10.4 |
| ref leather `Cube005_3001` | 1.1 | 3 % | 2.9 mm | 10.8 / 27.9 |
| ref multi-controller `+BODY076001` | 19.2 | 43 % | 0.86 mm | 1.4 / 4.2 |
| ref eyecup `wizjer` | 4.9 | 0 % | 1.0 mm | 0.5 / 4.1 |
| ref ribs `Rings2001` | 53.8 | 78 % | 2.3 mm | — (hard by design) |
| ours body | 8.9 | **100 %** | 2.6 mm, **p90 70.5 mm** | 4.4 / 8.4 |
| ours lens barrel | 26.4 | 93 % | 2.7 mm | 11.1 / 58.1 |
| ours grip (swept) | 0.0 | 47 % | 3.4 mm | 8.7 / 19.4 |

Reading: the reference's large surfaces are smooth-shaded subdivision surfaces (few split vertices, 2–3 mm
edges everywhere) whose fillets have 4–10 mm radii; hard edges are kept where the product has them (ribs,
button rims). Ours is **flat-shaded almost everywhere**: 35 of its 37 objects export with `sharp_face` set on every face
(read from `THREEPIPE_mesh_topology`); only the swept grip and eyecup and the lugs are partly smooth. Its
3-segment bevels turn 90° in 30° steps, so every chamfer facet catches its own highlight, and the body still
has 70 mm flat faces. The kernel's bake has no auto-smooth angle and no custom
normals (`plugins/mesh-kernel/src/bake.ts:406`), and bevel has no harden-normals
(`plugins/mesh-kernel/src/ops/bevel.ts:45`).

Panel gaps are not grooves: the artist laid 9 thin black strips (`GapsColor`, black, roughness 1) into the
seams. Cheap and effective; the library should offer both (a `gap` strip and a real groove via boolean).

### 1.4 Materials: 26 slots, about 12 looks

Area-weighted (`tmp/realism/ref-geom.json`, total 241,812 mm²):

| Look | Slots | Area | Base colour / roughness / metallic | Maps & extensions |
| --- | --- | ---: | --- | --- |
| Satin black plastic, micro-grain | PlasticMaterial.002 | 49 % | 0.007 / 0.23 / 0 | normal 0.15, ×5 tiling (1024² JPEG) |
| Gloss black plastic | PlasticMaterial.003, NowyPlastik… | 15 % | 0 / 0.22–0.24 / 0 | — |
| Rubber | guma.003, guma.002 | 9 % | 0 / 0.30, 0.56 / 0 | — |
| Leather | LEATHER.001 | 5.5 % | 0.016 / 0.53 / 0 | normal 0.40, ×6 tiling (512² PNG) |
| Matte black (inner baffles) | Material.008/.009 | 6 % | 0 / 0.74 / 0 | — |
| Glass | Glass.002/.003 | 7 % | 0.8 / 0 / 0 | transmission 1, ior 1.5, BLEND |
| Screens | Screen_2.001, Material.003 | 2 % | white / 0.14–0.28 | texture + transmission 0.58 / 0.33 |
| Dark metal / chrome / silver | Metal.00x, srebro.00x, Metal_White, Material.007 | 3 % | 0–0.52 / 0.18–0.23 / 0.93–1 | — |
| Prints (decals) | LABELS2/3, labels | 1.6 % | white / red / grey | colour texture atlas, BLEND |
| Red ring, gold contacts, green coating, gaps | Material.012/.006, zieloneSzklo, GapsColor | < 1 % | | — |

Correction to the roadmap's list: **clearcoat is 0 and `KHR_materials_iridescence` is empty (factor 0) on all
26 materials** — neither contributes. What is in effect: transmission (glass, screens), two tiling normal maps
(leather, plastic grain), five colour textures for prints and screens, and roughness spread from 0.14 to
0.74 on near-black dielectrics. The file has 8 images and 7 textures; image 7 is a PNG whose bytes were
UTF-8-encoded (`0xC2 0x89 PNG…`), unreferenced — a 2021 exporter bug, nothing to fix here.

Textures (`tmp/realism/textures-sheet.png`): port icons (500², red), lens labels (1024², "Canon",
"Leica" ghost, ring marks), top LCD content (1063×438), rear LCD UI (401×276), the white-print atlas
(1807×1808, "Canon EOS 5D Mark IV", every button legend, mode dial ring), leather normal, plastic grain normal.

### 1.5 What each category is responsible for (the experiment)

Rendered on the GPU VM (ANGLE Metal, Apple Paravirtual device) in one plain viewer: `venice_sunset_1k.hdr`,
default tonemapping, no post, **viewer config and lights in the files ignored** (`importConfig: false`, lights
removed), 1200×800, seven calibrated views (front, back, right, left, top, two three-quarter heroes).
Styles: `full`; `notex` (every texture removed; colour textures folded into the material as their mean colour
and alpha); `clay` (one grey dielectric everywhere); `mask` (unlit white on black). Our model is aligned
into the reference frame (rotation 180° about Y, 1/81.07 scale, lens axis and eyecup back matched). Job:
`demos/benchmark/jobs/phase-a-styles.json`; metrics `tmp/realism/contrib.mjs` (SSIM of `metrics/image.mjs`,
over the union bounding box of the two silhouettes, mean of 7 views):

| Comparison | SSIM (gray) | SSIM (Sobel edges) |
| --- | ---: | ---: |
| ref full vs ref notex — *markings and texture maps* | 0.943 (back view 0.875) | 0.878 |
| ref notex vs ref clay — *materials* | 0.561 | 0.781 |
| ours full vs ref full — *today's gap, all of it* | **0.492** | **0.432** |
| ours clay vs ref clay — *form only* | **0.598** | **0.536** |
| silhouette IoU (mask) | 0.845 (0.80 back … 0.90 top) | |

What it says:
- **Form is most of the gap.** Taking materials and markings away from both models (clay vs clay) only lifts
  similarity from 0.49 to 0.60; the remaining 0.40 SSIM deficit and the 0.54 edge-SSIM are shape: the soft
  prism and grip, the dial and button population, the ribs, the chamfer highlights. Silhouettes already agree
  at 0.85 IoU — the gap is inside the outline.
- **Markings are small in pixels and large in reading.** 6 % SSIM overall, 12 % on the back (screens, legends);
  they are what makes it read as a Canon rather than as a camera. Cheap to add once a decal path exists.
- **Materials matter mostly as luminance and roughness spread** on black: grey clay vs black plastic is a
  0.44 SSIM change by itself, so appearance metrics must be judged per style, never only on `full`.

### 1.6 Where the camera demo's time went

From the demo agent's transcript (`agent-a2f9294cc5b9a7a99.jsonl`, Opus): 262 tool calls, 160k output tokens,
129M input tokens (mostly cache reads); 37.6 min of model time between tool results and 130.9 min inside tools:

| Tool time | Calls | Minutes |
| --- | ---: | ---: |
| `sleep` (waiting on background session/recording jobs and the browser lock) | 22 | 50.9 |
| `modelling:session` runs (SwiftShader page + captures) | 24 | 24.4 |
| other Bash (reading inspect output, scripts, ffmpeg checks) | 111 | 23.4 |
| report generation | 10 | 14.5 |
| video recording | 29 | 13.9 |

The build itself (`transcript.json`): 308 commands, **15.4 s** total wall in the page, of which **12.3 s is
the 31 SwiftShader captures**; the 222 commands left after dropping captures, cameras, references, lights and
display replay through the CLI's Node session
(`npm run modelling -- run`, this branch) in **0.92 s wall, 0 failures**, and write the same GLB. Haussmann
(389 commands) and the stair (260) show the same shape: their agents spent 54 and 42 minutes in session runs
and 15–18 minutes sleeping, against command time of seconds. So **agent iteration, not geometry, is the
cost**: every look at the model went through a page start, SwiftShader frames and a shared lock.

---

## 2. R1 — the benchmark

`demos/benchmark/` (plain ESM, no build step, like the demos). It stays there until a second consumer needs
it as a library; then the metric code moves into `@threepipe/modelling-cli` as a `score` verb (Track 1's
CLI already has the Node session and the browser session).

```
npm run benchmark:score  -- --target canon-5d4 --glb <build.glb> [--transcript transcript.json]
                            [--agent <agent.jsonl>] [--out tmp/bench/<run>] [--vm]
npm run benchmark:render -- <job.json>          # renders only (VM or local)
```

Inputs per target, `demos/benchmark/targets/<target>.json` (committed; the reference itself is referenced by
path and sha256 and must exist locally):

```json
{"reference": {"path": "tmp/ref/webgi-camera.glb", "sha256": "…", "mmPerUnit": 81.07},
 "candidate": {"units": "mm", "rotation": [0, 180, 0], "exclude": ["reference:*"]},
 "groups": {"body": {"ref": ["Cube005001", "Circle004001", …], "candidate": ["body", "grip", "body-prism"]}, …},
 "views": [{"name": "front", "position": […], "target": […], "fov": 32}, …],
 "samples": 100000, "taus": [1, 2, 5]}
```

Steps:

1. **Read** both GLBs into world-space triangle soups (`metrics/glb.mjs`), in mm. Reads `THREEPIPE_mesh_topology`
   when present (n-gons, so quads % and poles are real, not inferred from triangles).
2. **Align** (`metrics/shape.mjs`): initial rotation from the target file, translation by bbox centres, then
   trimmed ICP (Chetverikov 2002, keep 90 %) with closest points on the reference surface (BVH), solving each
   step with Horn's quaternion method (1987) for a **similarity** (rotation, uniform scale, translation).
   Reported: fitted scale, rotation residual (°), translation, RMS history. The scale is reported, not hidden:
   on the preliminary baseline the fit shrinks ours by 1.2 % (scale 0.988) against the lens-derived 81.07 mm/unit.
3. **Shape**: 100k seeded area-weighted samples on each surface (Osada 2002), point-to-surface distances via
   the BVH (three's `Triangle.closestPointToPoint`). Accuracy (candidate→ref mean), completeness (ref→candidate
   mean), Chamfer (their mean), Hausdorff (max) and Hausdorff95, **F-score at 1/2/5 mm** (Tanks and Temples).
   Per group: completeness of each reference group (what is missing) and accuracy of each candidate group
   (what is wrong); per-vertex distances for heat maps.
4. **Geometry quality** (both models): triangles, welded vertices, objects, components, closed / boundary /
   non-manifold edges, quads / n-gons / triangles and poles (topology extension), triangle min-angle p5 and
   slivers (< 10°), split-vertex % (faceting), smooth-curvature radius distribution, UV coverage, materials,
   textures, file bytes.
5. **Renders** on the VM (`--vm`: commit, `tpvm sync`, inputs copied to the VM worktree's `tmp/` by
   `demos/benchmark/vm.mjs push`, `tpvm run`, `tpvm pull` one tarball): styles `full`, `clay`, `mask`, and
   `heat` (per-vertex distance colours) for each view. Locally the same job runs on SwiftShader (marked as such
   in `score.json`, not comparable to GPU numbers).
6. **Image metrics** (`metrics/image.mjs`, all local): SSIM on grayscale and on Sobel magnitude per view and style
   (a port of Wang's `ssim.m`, 11×11 Gaussian σ 1.5, auto-downsampling, averaged over the union bounding box of
   both silhouettes), silhouette IoU from the masks, plus an overlay (ref red, candidate cyan).
7. **Run metrics**: from the build's `transcript.json` (commands, failed, captures, per-command ms, and a new
   `wallMs` the session harness will record itself — `scripts/modelling-session.mjs` and the CLI `session`
   verb); from the agent transcript when given (model, active minutes with gaps > 10 min dropped, tool calls,
   input/output tokens — the same rules as the status page); and the benchmark's own wall time.
8. **Output**: `score.json` (every number above, inputs' sha256, renderer string, versions) and `index.html`
   (side-by-side sheets per view and style, silhouette overlays, heat renders with a legend, per-group distance
   table coloured by distance, the metrics tables, run metrics).

**Composite score** (0–100, for ranking runs; every component is also reported on its own):

| Component | Weight | Measure |
| --- | ---: | --- |
| Shape | 30 | F-score at 2 mm |
| Detail | 10 | per-group completeness at 2 mm, averaged over groups (a missing button group counts) |
| Silhouette | 10 | mean IoU over views |
| Form render | 20 | mean edge-SSIM, `clay` vs `clay` |
| Appearance render | 20 | mean SSIM, `full` vs `full` |
| Geometry quality | 10 | 1 − faceting of large smooth parts, manifoldness, no slivers (equal thirds) |

Unit tests (`tests/unit/benchmark/*.test.ts`, run by `npm run test:unit -- tests/unit/benchmark`): SSIM's
closed form on constant images and identity, downsampling offsets against MATLAB's `imfilter` conventions,
IoU, seeded sampling determinism and uniformity, BVH closest point against brute force, Chamfer/F-score on
analytic pairs (concentric spheres, offset cubes), ICP recovering a known similarity, GLB reader on a GLB
written in the test (plain and Draco), quality metrics on a cube and an open grid.

---

### 2.1 R1 done: the harness and the baseline (2026-10-18)

Code: `demos/benchmark/` — `score.mjs` (entry), `render.mjs` + `render/` (the plain-viewer page), `metrics/`
(`glb`, `shape`, `image`, `quality`, `run`, `vm`, `report`), `targets/canon-5d4.json` (reference sha256, mm/unit,
spec, 7 views, 9 part groups partitioning all 94 reference meshes). The folder is `metrics/`, not `lib/`: the
root `.gitignore` drops every `lib`. Tests: `npm run test:unit -- tests/unit/benchmark` (26 tests).

```
npm run build:modelling-cli        # once: score.mjs imports its Node polyfill before three
npm run benchmark:score -- --target canon-5d4 --glb <build.glb> [--transcript t.json] [--agent a.jsonl] [--label x]
npm run benchmark:score -- --target canon-5d4 --ceiling
```

Changes from the design above, from what the runs showed:
- **Alignment holds the rotation** (`scale-translation`) by default. A free-rotation fit tilts our camera by
  4.45° (mostly about X) to trade the reference's extra height for a lower RMS (2.19 vs 2.44 mm) and lifts
  F@2 mm from 0.517 to 0.578: the fit was hiding a shape error. The free fit is still run and reported as a
  diagnostic (`alignment.freeRotationDiagnostic`).
- The **ceiling** is measured: the reference scaled per axis to Canon's published size
  (`spec.refScaleToSpec` = 0.9987, 0.9188, 0.9696) scored against the reference.
- Builds now record their own wall time: `scripts/modelling-session.mjs` and the CLI `session` verb write
  `summary.wallMs` and `startedAt`, and the CLI records per-command `wallMs` (the demo transcripts predate
  this, so `buildWallMs` is null for them).
- Determinism: three VM render runs of the baseline gave byte-identical PNGs (70 each), and re-scoring gives
  identical values for all 183 numbers compared (shape, groups, images, quality, alignment, composite).

| | camera demo (baseline) | spec ceiling |
| --- | ---: | ---: |
| fitted scale | 0.984 | 1.027 |
| accuracy / completeness (mm) | 2.63 / 3.00 | 0.75 / 0.80 |
| Chamfer (mm) | **2.81** | 0.78 |
| Hausdorff95 / max (mm) | 8.93 / 21.6 | 3.05 / 4.18 |
| F-score @ 1 / 2 / 5 mm | 0.301 / **0.517** / 0.835 | 0.731 / 0.894 / 1.000 |
| silhouette IoU (7 views) | **0.881** | 0.946 |
| SSIM full / notex / clay | **0.502** / 0.534 / 0.613 | 0.701 / 0.749 / 0.772 |
| edge-SSIM full / clay | 0.430 / **0.544** | 0.668 / 0.724 |
| group completeness within 2 mm (mean of 9) | 0.489 | 0.931 |
| faceting of large parts (split vertices, area-weighted) | 85 % (reference 21 %) | 21 % |
| triangles / components | 28,976 / 46 | 136,266 / 340 |
| quads (topology) / 3-poles / 5+-poles | 87.1 % / 1,192 / 974 | — |
| **composite (ranking aid)** | **56.6** | 80.9 |

Per group (baseline, completeness mean in mm / share within 2 mm): top 5.97 / 15 % (the reference's taller
prism, hot shoe and top controls), decals 4.69 / 47 %, other 3.62 / 37 %, shell 3.29 / 50 %, lens 2.84 / 44 %,
mount 2.66 / 49 %, screens 2.31 / 68 %, eyepiece 2.12 / 59 %, rear controls 1.45 / 72 %. Worst views: back
(SSIM full 0.38, clay edge 0.44) and hero-rear.

Run metrics of the baseline: 308 commands, 0 failed, 31 captures; 13.0 s in commands, 15.4 s operation wall,
12.3 s of it captures; agent (claude-opus-5-5): 189 active min, 262 tool calls, 160k output and 129M input tokens.
A benchmark run takes 3.7 min: 30 s in Node (align 27 s), the rest is the VM round trip (render 47 s; sync,
pushes and pulling a 9 MB tarball through the relay ~2 min).

### 2.2 R2a part 1: shade by angle, measured (2026-10-18)

`shade {object, mode: flat|smooth|byAngle, angle: 30, keepSharpEdges: true}` (kernel `shading.ts`, ports of
`mesh_smooth_set` / `mesh_sharp_edges_set_from_angle` / `mesh_edges_sharp_tag` / `face_normal_calc`). The camera
build replayed in the Node session (221 commands, 0.9 s) is the control; the same plus `shade {object: "*"}`:

| | control | + shade byAngle |
| --- | ---: | ---: |
| faceting of large parts | 85 % | 50 % |
| body / prism / grip split vertices | 100 / 100 / 47 % | 14 / 17 / 24 % |
| edge-SSIM `clay` (up in all 7 views) | 0.543 | 0.552 |
| SSIM `clay` / `full` | 0.612 / 0.499 | 0.618 / 0.503 |
| F@2 mm | 0.516 | 0.516 |
| composite | 56.5 | 57.9 |

Shading fixes the wrong faceting but moves the form metrics by about 0.01: the blockout's shape is the gap,
which R2b (subdivision cages) and R3 (parts) address. The remaining 50 % is mostly real 90° steps (knurl ribs,
mount flanges); the reference's rib rings are 78 % split as well.

---

## 3. R2 — the high-poly workflow

| Item | Port from | Kernel/API work | Size |
| --- | --- | --- | --- |
| **Subdivision Surface modifier** with edge and vertex creases, Blender semantics | OpenSubdiv `sdc/catmarkScheme.h`, `sdc/crease.cpp`, `vtr/` refinement (cloned at `.repos/OpenSubdiv`); Blender glue `intern/opensubdiv/internal/topology/topology_refiner_factory.cc:179–247` (crease→sharpness, non-manifold vertex sharpness), `:308–311` (boundary interpolation, **`CREASE_UNIFORM`**, FVar linear interpolation); `blenkernel/intern/subdiv_inline.hh:116` (`sharpness = 10·crease²`), `subdiv_converter_mesh.cc:141–179`, `subdiv_mesh.cc`/`subdiv_foreach.cc` (grid emission), `subdiv_modifier.cc:35–39` (settings), `modifiers/intern/MOD_subsurf.cc` | `subsurf` modifier in plugin-modelling's stack (levels, quality, `use_limit_surface`, `uv_smooth`, `boundary_smooth`, `use_creases`) evaluated on `MeshData`, applying bakes to `MeshData`; `crease` command writing `crease_edge`/`crease_vert` (already declared in `mesh-kernel/src/constants.ts:167–203`) | 3–4 weeks: uniform Catmull-Clark refinement with creases and FVar UVs first (1.5 w), limit-surface evaluation of patches second |
| Evaluate `blend-importer/src/loader/catmull.ts` | — | It is a gl-catmull-clark port with an **angle heuristic** for corners (< ~150° pinned, `:82–88`) where OpenSubdiv's `VTX_BOUNDARY_EDGE_AND_CORNER` pins valence-2 boundary vertices; **no creases**, no limit surface, `number[][]` cages. It becomes a test oracle for the uncreased interior rule only; the modifier is a fresh port. Fixture: Blender exports of a creased cube at levels 1–3 through the Track 2 Blender worker | 2 days for fixtures |
| **Shade smooth / smooth by angle** | `blenkernel/intern/mesh_normals.cc:903` (`edges_sharp_from_angle_set`) | `shade` command: `smooth`, `flat`, `byAngle` (writes `sharp_edge`), so a filleted block stops rendering faceted | 2 days |
| **Custom normals, harden normals, weighted normal** | `mesh_normals.cc:1190` (fan + custom normals), `bmesh/tools/bmesh_bevel.cc:3006` (`bevel_harden_normals`), `:3135` (face strength), `modifiers/intern/MOD_weighted_normal.cc:122–457` | a `custom_normal` corner layer in `MeshData` and the bake reading it (`bake.ts:406` today: not ported); bevel option `hardenNormals`; `weightedNormal` modifier | 1.5 weeks |
| **Booleans** (approved, D6) | `geometry/intern/mesh_boolean_manifold.cc` (Blender's own manifold path), manifold-3d as the solver | `boolean` command and modifier (difference/union/intersect, `MeshData` ↔ manifold `Mesh` with attribute passthrough via `runOriginalID`/`faceID`), recesses, ports, the monitor well, button holes | 1.5 weeks |
| **Support loops** | kernel `loopcut`, `bevel` (exist) | `supportLoops` helper: an edge selection → loops at a given distance either side, the classic subdivision control (`bevel` with `segments: 2, profile: 1` or two `offsetEdgeLoops`) | 3 days |

Order: shading (immediately visible, tiny), subsurf + crease, booleans, custom normals.

---

## 4. R3 — the standard library

### 4.1 What the demos hand-built

From the four build scripts and transcripts: the camera's 749-line `build.mjs` is mostly helpers the agent
wrote for itself — `block` (box from extents + applyTransform), `bevelWhere` (select edges by angle, bevel),
`cutRect` (four `bisect`s + face pick; the monitor recess and the top LCD window), `knurl` (pick every other
radial face, inset individually; 2 lens rings and 3 dials), `button` (a 6-point lathe profile; 9 calls, arrayed
to 14 buttons),
profile arithmetic for the lens and eyecup. Haussmann: 83 `duplicate`s, 24 `applyTransform`s and 7 `transform`s
to place railings, balconettes and dormers by hand, 17 `extrude`s for storey bands, its own `straightRailing`,
`spread`, `balcony`, `stack` (chimney) helpers. Stair: `modifier` ×60 (live arrays/mirrors), lathe profiles
for balusters, columns, capitals, a vault from two barrels. All three recompute 2D profiles and placement
math in JS before any command — that is the time the library removes.

### 4.2 API

A package `@threepipe/modelling-parts` (Node-safe like the kernel; depends on `mesh-kernel` and
`plugin-modelling`):

```ts
interface PartDefinition<P> {
    id: string                       // 'product/knurled-ring', 'arch/window'
    title: string; tags: string[]
    params: JSONSchema                // units (mm/m), defaults, ranges; the same schema style as commands
    build(params: P, ctx: PartContext): PartResult
}
interface PartResult {
    mesh: MeshData                    // editable n-gon topology, creases and sharp edges set
    materialSlots: string[]           // 'body', 'rubber', 'print' - mapped to presets (R4) by name
    groups: Record<string, {faces?: number[], edges?: number[], verts?: number[]}>   // named, for later edits
    anchors: Record<string, {position: Vec3, normal: Vec3}>                         // 'mount', 'top', 'axis'
    subdivision?: {levels: number}    // if the part is a cage meant to be subdivided
}
```

One command, `{op: 'part', type: 'product/knurled-ring', name, params, position, rotation, at?: {object,
anchor}}`, creates a document object storing `{type, params}`, so `{op: 'part', name, params: {...}}`
re-generates it until the object is edited (then it is plain topology, as Blender's "Apply"). `profile`
returns named 2D profiles (`ogee`, `cyma-recta`, `cyma-reversa`, `torus`, `astragal`, `cavetto`, `scotia`,
`ovolo`, `fillet`, `lens-barrel` from points) for `lathe` and `sweep`, which accept `profile: {type, ...}`
inline. Discovery: `help parts` lists ids and one-line summaries; `help part <id>` prints the schema; the
SKILL.md generator (Track 1) adds a "Library first" section and a cookbook entry per part. Every part has a
unit test (manifold, counts, groups, determinism) and a `look` sheet in the docs.

### 4.3 The first 25

| # | Part | Replaces (demo evidence) | Form |
| --- | --- | --- | --- |
| 1 | `product/knurled-ring` (ribs as separate rib bodies or cut grooves; count, depth, profile) | camera `knurl` ×5; ref ribs are 167 separate bodies | code |
| 2 | `product/rubber-grip-band` (focus/zoom ring with real rib section) | lens rings | code |
| 3 | `product/button-round` (chamfer, dome, collar, icon slot) | camera `button` ×9 (14 buttons) | code |
| 4 | `product/button-rect` (rounded rect, chamfer, legend slot) | rear column | code |
| 5 | `product/dial` (detents, knurled side, top marking ring, lock button) | mode dial, quick dial | code |
| 6 | `product/thumb-wheel` (axle, ribbed rim) | main dial | code |
| 7 | `product/screw` (pan / countersunk / socket; slot / cross / hex / torx) | tripod and body screws | code |
| 8 | `product/port-door` (flap with gap groove, hinge side, icon slot) | ref port covers | code |
| 9 | `product/grille` (hole/slot pattern on a plate or curved face) | mic/speaker | **GN** (distribute + instance + boolean) |
| 10 | `product/display` (recess, bezel, glass layer, screen material slot) | `cutRect` (8 `bisect`s) + inset | code |
| 11 | `product/lens-element-stack` (front element cap, retaining ring, filter thread, baffles, rear element) | lens lathe profiles | code |
| 12 | `product/bayonet-mount` (lugs, index dot, contacts) | mount + lugs | code |
| 13 | `product/hot-shoe` (ISO 518 channel, contacts) | shoe | code |
| 14 | `product/eyecup` (swept rounded-rect rubber) | eyecup sweep | code |
| 15 | `product/strap-lug` | lugs | code |
| 16 | `product/slide-switch` (track, knob, legend) | lens switches | code |
| 17 | `product/gap-strip` and `groove` (along an edge loop or a curve on a surface) | ref `GapsColor` strips | code (+ boolean) |
| 18 | `arch/moulding-profiles` (ogee, cyma recta/reversa, torus, astragal, cavetto, scotia, ovolo) | stair/arcade lathe profiles | code (profiles) |
| 19 | `arch/cornice` (profile swept along a footprint with mitred corners) | Haussmann storey bands, 17 extrudes | code |
| 20 | `arch/window` (frame, sill, glazing bars, shutters/guard options) | Haussmann window bays | code |
| 21 | `arch/door` (panelled leaf, frame, transom) | shop fronts | code |
| 22 | `arch/baluster` (from profile library) and `arch/railing` (balusters or cast-iron bars along a path, handrail) | `straightRailing`, `spread`, stair balusters | baluster code; railing **GN** |
| 23 | `arch/balcony` (slab, console brackets, railing) | Haussmann `balcony` | code + railing |
| 24 | `arch/dormer` (cheeks, pediment, window) and `arch/chimney` (stack, coping, pots) | dormer ×24 commands, `stack` | code |
| 25 | `arch/facade-bays` (windows/balconies/cornices distributed on a wall by storey and bay) | 83 duplicates + transforms | **GN** (Track 2's Buildify family) |

GN-shaped families (9, 22-railing, 25) are specified here and built by Track 2 on its runtime; this track
supplies the parts they instance. Coordination goes through the parent.

---

## 5. R4 — materials and markings

- **Preset library** (`@threepipe/modelling-parts/materials`, values only): from §1.4 — `plastic-satin-black`
  (0.007, r 0.23, grain normal 0.15 ×5), `plastic-gloss-black` (r 0.22), `rubber` (r 0.30), `rubber-matte`
  (r 0.56), `leather-black` (0.016, r 0.53, leather normal 0.40 ×6), `matte-black` (r 0.74), `metal-dark`
  (0.068, r 0.23, m 0.93), `chrome` (0.507, r 0.23, m 1), `gold-contact`, `glass` (transmission 1, ior 1.5),
  `screen-glass` (transmission 0.58), `accent-red` (0.8, 0.06, 0.034, r 0.5), `gap-black` (r 1). Architecture:
  limestone, zinc, slate, cast iron, glass, terracotta, painted wood. A `material {preset}` parameter on the
  existing `material` command; slots from parts map by name.
- **Textures**: tiling normal/roughness sets from **ambientCG** (CC0 1.0) and **Poly Haven** (CC0), one licence
  record per set in `refs/SOURCES.md`; leather, fine plastic grain, rubber, limestone, zinc. Fetched by a script
  into an asset cache, not committed if over 5 MB; 1k JPEG/PNG committed only if small.
- **`decal` / `label` command**: the reference's approach, ported to a command — markings are **decal meshes**
  (`+BODY018001` is a 5,192-triangle decal following the body) sharing one atlas texture. `{op: 'decal',
  object, content: {text, font, size} | {svg}, at: {point, normal, up} | {face}, size: [w, h], mode:
  'project' | 'wrap', wrap: {axis, center, radius}, color, preset: 'print-white'}`. `project` clips the target's
  triangles to the decal box and emits a conforming mesh offset along normals (the algorithm of three's
  `DecalGeometry`, implemented on `MeshData`); `wrap` maps decal u to angle around an axis for text round a
  lens ring. The atlas is rasterised from SVG (text as SVG `<text>` with a bundled font): in Node by sharp
  (librsvg), in the browser by canvas, from the same SVG. **Engraved/embossed text** (the lens front's 3D
  letters) is geometry: font outlines → `MeshData` faces → extrude or boolean.
- **Render presets**: `product-studio` (studio HDRI, ground with baked shadow, optional webgi SSR/SSAO when
  the plugins are present), `architectural-daylight` (sun + sky). A `lighting {preset}` parameter.

---

## 6. R5 — LOD from the high poly

- **Decimate (collapse)**: port `bmesh/tools/bmesh_decimate_collapse.cc` (1,549 lines: quadrics `:75`,
  optimal position `:130`, flip check `:157`, cost `:233`, collapse `:958`/`:1136`, entry `BM_mesh_decimate_collapse`
  `:1293`, symmetry `:405`, triangulate begin/end `:533`/`:610`) and `blenlib/intern/quadric.cc` (163 lines),
  with Blender's heap; a `decimate` modifier (ratio, symmetry, triangulate, vertex-group factor) per
  `modifiers/intern/MOD_decimate.cc`. Fixtures from Blender. 2 weeks.
- **Normal-map bake high → low**: ray-cast from the low-poly surface along its interpolated normals (cage
  extrusion, max distance) to the high-poly BVH (the benchmark's BVH), write tangent-space normals with
  **MikkTSpace** tangents (port `intern/mikktspace` as used by Blender's bake; three's mikktspace WASM is the
  fallback). Output a texture and a glTF with the low mesh. 1.5 weeks.
- Done = the camera high poly decimated to 10 % with baked normals scores within 0.02 SSIM (`full`) of the
  high poly on the benchmark.

---

## 7. R6 — faster builds

Measured in §1.6: commands are seconds, agents spend their hours waiting on pages and locks. So:

1. **Build in Node**: `npm run modelling -- session build.mjs` (Track 1's headless session); every `inspect`,
   `measure`, `validate`, `diff`, `verifySpec` there. The camera replay: 0.92 s for 222 commands.
2. **Look only at checkpoints, on the GPU**: a `checkpoint` writes the GLB; `look` and the benchmark render on
   the VM (56 renders in 34 s including 8 page loads, ANGLE Metal), never SwiftShader during iteration.
3. **Staged workflow, each stage gated by a measured check**:

   | Stage | Gate |
   | --- | --- |
   | blockout (primitives + parts at published dimensions) | dimension checks, silhouette IoU ≥ 0.8 vs refs |
   | form (subsurf cages, creases, booleans) | F@2 mm and clay edge-SSIM up vs blockout; no faceting on smooth parts |
   | detail parts (library) | per-group completeness at 2 mm; components count |
   | materials (presets, textures) | `notex` SSIM vs ref |
   | markings (decals) | `full` SSIM on back/top views |
   | render (preset) | final score; side-by-side sheet |

4. The harness writes run metrics into the transcript (`wallMs`, commands, failures, looks, renders) and the
   benchmark reads them, so every demo and test reports time, model and tokens next to its score.

---

## 8. Milestones

| M | What | Done = |
| --- | --- | --- |
| R1 | Benchmark harness, unit tests, baseline score of the camera demo | `score.json` + `index.html` for `demo-camera`; tests green; re-run gives identical numbers |
| R2a | `shade` (smooth / by angle) + custom normals + harden normals | baseline camera re-scored with shading only: faceting of the body < 15 % split vertices, `clay` edge-SSIM up |
| R2b | Subsurf modifier with creases (Blender fixtures at levels 1–3, max vertex error < 1e-5) | fixtures pass; a creased cube and the camera body cage match Blender |
| R2c | Booleans (manifold-3d) | the monitor well, ports and button holes cut by boolean in a test build, manifold |
| R3a | Parts 1–17 (product) + profiles | each part: unit tests, `look` sheet, SKILL.md entry |
| R4 | Material presets, `decal` (project + wrap), render presets | ref back view markings reproduced; SSIM `full` back view ≥ ref's own `notex` level |
| R6 | Node-first staged workflow in SKILL.md, harness run metrics | a camera rebuild's agent time ≤ 60 min and ≤ 120 tool calls |
| R3b | Parts 18–25 (architecture) with Track 2's GN families | Haussmann rebuilt with mouldings, windows, railings, dormers, materials |
| R5 | Decimate + normal bake | camera LOD at 10 % within 0.02 SSIM of the high poly |

**Acceptance — the camera.** Measured (§2.1): baseline 56.6 composite, spec ceiling 80.9. A spec-correct
copy of the reference reaches only 0.70 SSIM `full`, so the Phase A proposal (SSIM ≥ 0.70, IoU ≥ 0.92 and
edge-SSIM ≥ 0.70) asked for the ceiling itself. Re-anchored: X = baseline + 70 % of the gap to the ceiling,
rounded:

| Measure | Baseline | Ceiling | X (pass) |
| --- | ---: | ---: | ---: |
| F-score @ 2 mm | 0.517 | 0.894 | **≥ 0.78** |
| Chamfer | 2.81 mm | 0.78 mm | **≤ 1.4 mm** |
| SSIM `full` (7 views) | 0.502 | 0.701 | **≥ 0.64** |
| edge-SSIM `clay` | 0.544 | 0.724 | **≥ 0.67** |
| silhouette IoU | 0.881 | 0.946 | **≥ 0.92** |
| faceting of large parts | 85 % | 21 % | **≤ 30 %** |
| composite (ranking aid) | 56.6 | 80.9 | ≥ 73 |

plus run metrics recorded by the harness (agent time ≤ 60 min).

**Acceptance — Haussmann.** Rebuilt with the moulding profiles, cornices, windows, railings, balconies,
dormers and chimneys from the library, material presets (limestone, zinc, slate, cast iron), daylight preset;
scored against its reference photos by silhouette IoU from calibrated views and by the dimension checks it
has today (21/21), with agent time and command counts reported. There is no ground-truth mesh for it; if
Palash has one (a webgi/iJewel building scene), it gets the full benchmark.

---

## 9. Decisions (parent, 2026-10-18)

1. The VM may hold the reference GLB in its gitignored `tmp/` (Palash's machine, his relay); never committed,
   never sent anywhere else.
2. Both: every component is the primary result; the composite is printed as a "ranking aid" with its weights.
3. New package `@threepipe/modelling-parts`; the `part` command lives in plugin-modelling and resolves the registry.
4. This track takes shading (R2a).
5. This track owns the single Subdivision Surface port (R2b, OpenSubdiv semantics). Track 2's Subdivision
   Surface node ([A4] in `15-procedural-on-kernel.md`) calls the same kernel API: `MeshData` in, `MeshData` out,
   crease attributes, levels, boundary and UV options.
6. Order: R1 → R2a → R2b → R2c; report after R1 and after R2a with numbers.
