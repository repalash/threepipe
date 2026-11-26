# Ecosystem Survey — Polygonal Modelling Tools for threepipe

> Research date: **2026-09-14**. All licences / versions / activity dates below were verified against the live
> npm registry (`registry.npmjs.org`) and the GitHub REST API on that date unless explicitly marked
> `⚠ unverified`. "Last activity" = `pushed_at` for repos, `time[latest]` for npm.
>
> Goal context: an **editable mesh representation** (n-gons, per-corner attributes, selection, Node.js-safe,
> separate from render `BufferGeometry`), **operators** (extrude/inset/bevel/loop-cut/knife/dissolve/
> subdivide/bridge/boolean), **modal tools** with Blender keymap, **undo/redo**, and a **clean programmatic
> API** for humans and LLM agents. Blender is the algorithm reference; kokraf is the UX reference.

---

## 0. Executive summary (read this first)

Four conclusions dominate everything below:

1. **There is no reusable editable-mesh kernel in JS/TS.** Every candidate is either (a) an *analysis*
   half-edge library that cannot do topology mutation (geometry-processing-js, three-mesh-halfedge),
   (b) a *triangle-soup* library with no n-gons and no per-corner attributes (manifold, three-bvh-csg),
   or (c) licence-blocked (MeshLib, kokraf, polygonjs engine). **The BMesh-equivalent core must be built.**
2. **One genuinely valuable partial prior art exists: [`sketchpunklabs/bmesh`](https://github.com/sketchpunklabs/bmesh)**
   — an MIT-licensed TypeScript port of Blender's `bmesh_core.cc` / `bmesh_structure.cc` /
   `bmesh_queries.cc` Euler-operator layer (~2 030 LOC, verbatim disk-cycle + radial-cycle port,
   with source-line citations back to `blender/source/blender/bmesh/`). It is **not published to npm**,
   has **no CustomData/attribute layers**, **no high-level operators**, and uses
   `window.crypto.randomUUID()` per vertex (not Node-safe, and a per-vertex perf disaster). **Verdict:
   vendor + rewrite, do not depend on it.** It saves weeks on the hardest, most error-prone layer.
3. **Booleans are a solved problem — use `manifold-3d`.** Apache-2.0, active (3.5.3, 2026-09-07), used in
   production by OpenSCAD, Blender, Godot and Babylon.js CSG2. It is triangle-only, so it becomes a
   *round-trip* operator (n-gon mesh → tri mesh → manifold → tri mesh → n-gon re-merge), not the core.
4. **For the LLM-facing API, the 2026 evidence points at "compact, algebraic, stateless-ish, with
   selector queries"** (build123d style) over "verbose imperative with global context" (bpy.ops style).
   See §6.

---

## 1. three.js built-ins relevant to editing

Verified against the local three.js clone (`.repos/three.js`, `r183.1`, commit `9796ddd`) and against
npm `three@0.186.0` (published 2026-09-08, MIT).

### 1.1 `examples/jsm/utils/BufferGeometryUtils.js` — full export list (verified, r183)

```
computeMikkTSpaceTangents, mergeGeometries, mergeAttributes, deepCloneAttribute,
deinterleaveAttribute, deinterleaveGeometry, interleaveAttributes, estimateBytesUsed,
mergeVertices, toTrianglesDrawMode, computeMorphedAttributes, mergeGroups, toCreasedNormals
```

### 1.2 `examples/jsm/modifiers/` — full directory listing (verified, r183)

```
CurveModifier.js  CurveModifierGPU.js  EdgeSplitModifier.js  SimplifyModifier.js  TessellateModifier.js
```

**`SubdivisionModifier` no longer exists** — it was removed from three.js examples years ago
(it is *not* in r183). Anyone who tells you "three.js has a subdivision modifier" is working from
pre-r125 memory. `LoopSubdivision` is also *not* in three.js core/examples; the community package is
`three-subdivide` (§2).

| Item | Where | What it gives us | Verdict |
|---|---|---|---|
| `mergeVertices(geometry, tolerance=1e-4)` | `BufferGeometryUtils` | Hash-bucket weld of identical *full vertex tuples* (pos+normal+uv+…). Useful only as an **import** step; it welds on *all* attributes so a UV seam stays split — exactly wrong for building an editable mesh. | **borrow-ideas** — we need position-only welding with per-corner attribute retention. Write our own. |
| `toCreasedNormals(geometry, creaseAngle=PI/3)` | `BufferGeometryUtils` | Split/average normals by crease angle. Equivalent of Blender's auto-smooth on the *render* side. | **adopt** for the mesh→BufferGeometry bake path (or reimplement inside the baker, it's ~80 LOC). |
| `mergeGeometries` / `mergeGroups` / `interleaveAttributes` | `BufferGeometryUtils` | Standard plumbing for the render-side bake. | **adopt** as-is. |
| `SimplifyModifier` | `examples/jsm/modifiers` | Stan Melax 1998 progressive-mesh edge collapse. Verified from source header. Quality is poor by modern standards, no UV/attr preservation, no quadric error metrics. | **skip** — use `meshoptimizer` or `manifold` refine paths, or port Blender's decimate. |
| `EdgeSplitModifier` | `examples/jsm/modifiers` | Splits vertices along edges over a cutoff angle. | **borrow-ideas** only; our baker does this natively. |
| `TessellateModifier` | `examples/jsm/modifiers` | Naive edge-length subdivision of triangles. | **skip**. |
| `Earcut` + `ShapeUtils.triangulateShape(contour, holes)` | `src/extras/Earcut.js`, `src/extras/ShapeUtils.js` | 2D ear-clipping with holes. This is the *same algorithm family* Blender uses for n-gon tessellation (`BM_face_calc_tessellation` → `polyfill2d`). Also `ShapeUtils.area()` / `isClockWise()`. | **adopt** — this is our n-gon → triangle tessellator for the render bake. Already bundled with three, zero new dependency. |
| `computeVertexNormals()` | `BufferGeometry` | Area-weighted-ish per-vertex normals on the *render* geometry. | **skip for the kernel** — normals must be computed on the editable mesh (per-face + per-corner with sharp-edge splitting), not on the baked triangles. |
| `ConvexGeometry` | `examples/jsm/geometries` | QuickHull wrapper. Only produces a render geometry, not topology. | **borrow-ideas**; for a `convex_hull` operator use `quickhull3d` or `manifold.hull()`. |

**Key takeaway:** three.js gives us the *bake* side (tessellation, merging, creased normals) and nothing
on the *edit* side. That is exactly the split the maintainer already proposed.

---

## 2. Mesh data structures / half-edge / geometry processing in JS/TS

| Name | URL | Licence | Lang | Latest / last activity | What it gives us | Verdict |
|---|---|---|---|---|---|---|
| **sketchpunklabs/bmesh** | github.com/sketchpunklabs/bmesh | MIT | TypeScript | no npm publish; repo pushed **2025-01-27**, 17 ★ | **A direct TS port of Blender's BMesh core.** `Vertex/Edge/Loop/Face` with real disk cycles (`diskEdgeAppend/Remove`, `diskVertSwap`) and radial cycles (`radialLoopAppend/Remove/Inlink`), plus the Euler operators: `splitFaceMakeEdge`, `joinFaceKillEdge`, `splitEdgeMakeVert`, `joinEdgeKillVert`, `vertSplice`, `edgeSplice`, `facesJoin`, `faceCreateNgon`, `edgesSortWinding`, plus `QueryOps` (`edgeIsManifold`, `edgeIsBoundary`, `faceExists`, `loopRadialCount`, `vertPairShareFaceCheck`). Each file cites the exact `bmesh_core.cc` line it was ported from. | **borrow-ideas → vendor & rewrite.** Do NOT `npm i` (not published). No attribute layers, no `BMHeader` flags, no operator/slot system, no tessellation, `id = window.crypto.randomUUID()` per vertex breaks Node and destroys perf. But it de-risks the single hardest part of the project. Clone at `.repos/survey/bmesh`. |
| **geometry-processing-js** | github.com/GeometryCollective/geometry-processing-js | MIT | JavaScript (ES5-ish) | last push **2021-02-14**, 534 ★ | Crane-lab halfedge mesh (`Mesh/Halfedge/Vertex/Edge/Face/Corner`) + DEC operators, Laplacian/mass matrices, geodesics (heat method), parameterisation (LSCM/SCP), curvature. **Manifold triangle meshes only, analysis-oriented — no topology mutation API.** | **borrow-ideas** for *algorithms* (Laplacian smooth, LSCM unwrap, heat geodesics for a future "smart select"). **Skip as a kernel.** Unmaintained 5.5 yrs, no TS, no n-gons. |
| **three-mesh-halfedge** | github.com/LokiResearch/three-mesh-halfedge | MIT | TypeScript | `1.0.3`, **2022-11-29**, 31 ★ | Builds a halfedge structure *from* a `BufferGeometry` for contour/silhouette extraction (it's infrastructure for a line-rendering research project). Read-only; no mutation ops. No `dist/index.d.ts` served on unpkg (packaging is shaky). | **skip.** Stale, tiny, wrong shape (triangles, read-only). |
| **@thi.ng/geom** | codeberg.org/thi.ng/umbrella | Apache-2.0 | TypeScript | `8.3.38`, **2026-09-01** | Excellent, extremely well-maintained functional geometry toolkit — but **2D only** ("2D geometry types & SVG generation"). Siblings `@thi.ng/geom-tessellate` (2D/3D convex polygon tessellators) and `@thi.ng/geom-subdiv-curve` (nD subdivision *curves*) are also 2D/curve oriented. | **skip for the mesh kernel.** Worth stealing the *API style* (small pure functions, polymorphic dispatch) and possibly `geom-tessellate` for the 2D knife/bisect plane work. |
| **polyhedra** | github.com/finnp/polyhedra | "SEE LICENSE IN copyright.txt" | JSON data | `1.0.0`, **2016-01-29** | Just a JSON dump of the Encyclopedia of Polyhedra. Not a library. | **skip.** |
| **gl-catmull-clark** | github.com/Erkaman/gl-catmull-clark | MIT | JavaScript | `1.0.0`, **2016-05-15**, single version ever | ~200 LOC Catmull-Clark on a `{positions, cells}` pair. No creases, no boundaries handling worth trusting, no UV/attr propagation. | **borrow-ideas** at most. Blender's `bmo_subdivide.cc` + OpenSubdiv semantics are the real reference. |
| **three-subdivide** | github.com/stevinz/three-subdivide | MIT | JavaScript | `1.1.5`, **2023-08-03**, 109 ★ | `LoopSubdivision.modify(geometry, iterations, params)` — Loop subdivision on `BufferGeometry` with attribute interpolation and a "split" (flat) mode. Works, but operates on the *render* geometry (triangles) so it can't do Catmull-Clark quads. | **borrow-ideas.** Good reference for attribute interpolation across subdivision. Not the kernel operator. |
| **@nasedkinpv/opensubdiv-wasm** | github.com/nasedkinpv/opensubdiv-wasm | `SEE LICENSE IN LICENSE.txt` (repo: NOASSERTION — OpenSubdiv is under Pixar's *Tomorrow Open Source Technology License 1.0*, an Apache-2.0 variant with a modified §6 Trademarks — **verified** from `LICENSE.txt` in Pixar's repo) | C++/WASM + TS | `0.2.0`, **2026-03-09**; repo pushed 2026-06-22, **2 ★** | Emscripten build of Pixar OpenSubdiv with three.js Catmull-Clark helpers, claims browser+Node. | **skip for now / revisit.** 2 stars, 2 published versions, one-person project, ambiguous licence file. If we want production Catmull-Clark with creases, the correct move is our own OpenSubdiv-semantics implementation on top of the n-gon kernel (that's what Blender does), or a self-maintained Emscripten build. Mark this as **⚠ licence text not individually read**. |
| **three-mesh-bvh** | github.com/gkjohnson/three-mesh-bvh | MIT | JavaScript (+ .d.ts) | `0.9.15`, **2026-09-09**, 3 485 ★ | `raycastFirst`, `shapecast`, `closestPointToPoint`, `intersectsGeometry`, `intersectsSphere`, `refit()` after deformation, indirect (non-destructive index) mode, async/worker generation (`GenerateMeshBVHWorker`, `ParallelMeshBVHWorker`), serialize/deserialize. Also `PointsBVH/LineBVH/SkinnedMeshBVH/ObjectBVH`. | **ADOPT.** This is the picking/snapping backbone: face picking under cursor, edge/vertex proximity picking, knife-tool ray-vs-mesh, snap-to-surface, loop-cut preview hit-testing. Pure JS+typed arrays → Node-safe. Pairs with the *baked* geometry; we map triangle index → source n-gon face id via a per-triangle `faceId` lookup table produced by our tessellator. |
| **three-bvh-csg** | github.com/gkjohnson/three-bvh-csg | MIT | JavaScript | `0.0.18`, **2026-02-17**; repo pushed 2026-08-20, 945 ★ | CSG on `BufferGeometry` using three-mesh-bvh; preserves attributes and groups; supports `Brush`/`Evaluator` with dynamic re-evaluation. | **borrow-ideas / fallback.** Still `0.0.x` after 4 years, 51 open issues, known robustness limits on coplanar/degenerate input. It *does* preserve UVs/attributes, which manifold does less naturally. Keep as an alternative backend behind the same operator interface, but default to manifold. |
| **manifold-3d** | github.com/elalish/manifold | **Apache-2.0** | C++ → WASM, ships `manifold.d.ts` (1 636 lines) | `3.5.3`, **2026-09-07**; repo pushed 2026-09-13, 2 270 ★ | Topologically-robust CSG. Verified API from the shipped `.d.ts`: `add/subtract/intersect`, `split/splitByPlane/trimByPlane`, `hull()`, `decompose()/compose()`, `refine(n)/refineToLength/refineToTolerance`, `smoothByNormals/smoothOut`, `warp/warpBatch`, `setProperties`, `calculateNormals`, `slice(h)`/`project()` → `CrossSection`, `asOriginal()/originalID()`, `genus()/volume()/surfaceArea()/status()`, plus a full 2D `CrossSection` (`extrude`, `revolve`, `offset`, `hull`, booleans). **Triangles only**, but supports **arbitrary per-vertex properties** and **originalID / material-ID tracking through booleans** — that's the hook for reconstructing our face IDs and UVs after a boolean. | **ADOPT** as the boolean/hull backend. Runs in Node (Babylon.js does exactly this). Downside: WASM blob (~1 MB) → must be an **optional lazy-loaded plugin**, not a core dependency of the kernel. |
| **polygon-clipping** | github.com/mfogel/polygon-clipping | MIT | JavaScript | `0.15.7`, **2023-12-18** | 2D Martinez boolean on polygons/multipolygons. | **borrow/optional** — only if we do 2D-plane boolean workflows (knife projection, floorplan-style tools). Unmaintained since 2023. |
| **earcut** | github.com/mapbox/earcut | ISC | JavaScript (+ types) | `3.2.3`, **2026-07-02**, 2 588 ★ | Fastest JS ear-clipping with holes. Already vendored inside three.js as `src/extras/Earcut.js`. | **adopt via three.js's bundled copy** — don't add a duplicate dependency unless we need the newer 3.x API. |
| **libtess** | github.com/brendankenny/libtess.js | SGI-B-2.0 (npm) / NOASSERTION (repo) | JavaScript | `1.2.2`, **2015-12-19**, 313 ★ | GLU tessellator port — handles self-intersecting and non-simple polygons that earcut refuses. | **borrow / optional fallback.** SGI Free Software License B 2.0 is FOSS but unusual; would need a licence-compat check against threepipe's licence before shipping. Dead since 2015. |
| **cdt2d** | github.com/mikolalysenko/cdt2d | MIT | JavaScript | `1.0.0`, **2015-06-28**; repo pushed 2019, 265 ★ | Constrained Delaunay triangulation in 2D — the *right* algorithm for knife-cut / bisect face re-triangulation where you must respect inserted edges. | **adopt-or-port.** Tiny, MIT, algorithmically correct. Dead but stable. Best to vendor (~600 LOC) rather than depend on a 2015 CommonJS package. |
| **poly2tri** | github.com/r3mi/poly2tri.js | BSD-3-Clause (npm) / NOASSERTION (repo) | JavaScript (+ types) | `1.5.0`, **2017-04-17**, 341 ★ | Sweep-line CDT with holes and Steiner points. More battle-tested than cdt2d for holes. | **borrow-ideas / alternative to cdt2d.** Dead since 2018. |
| **delaunator** | github.com/mapbox/delaunator | ISC | JavaScript (+ types) | `5.1.0`, **2026-03-23** | Unconstrained Delaunay only. | **skip** (unconstrained is the wrong tool for knife/bisect). |
| **quickhull3d** | github.com/mauriciopoppe/quickhull3d | MIT | TypeScript | `3.1.2`, **2025-12-26** | 3D convex hull producing **face lists (n-gons available)**, not just triangles. Maintained, typed. | **adopt** for a `convex_hull` operator if we don't want to pull manifold for it. Matches Blender's `bmo_hull.cc` output shape better than manifold (which returns triangles). |
| **convex-hull** | github.com/mikolalysenko/convex-hull | MIT | JavaScript | `1.0.3`, **2014-11-22** | n-dimensional hull, simplices only. | **skip** — superseded by quickhull3d. |
| **xatlas-three** | github.com/repalash/xatlas-three | MIT | TypeScript + WASM | `0.2.1`, **2024-09-28**, 127 ★ | xatlas (MIT, jpcy) compiled to WASM with three.js integration + web workers. **Authored by Palash himself** (npm author `Palash Bansal <palash@shaders.app>`, maintainer `repalash`). | **ADOPT** — it's already ours. This is the UV-unwrap operator backend. Note kokraf also ships an xatlas wasm build (`js/wasm/xatlas.js`), i.e. this is the ecosystem-standard choice. |
| **xatlas-web** | github.com/MozillaReality/xatlas-web | MIT | C++/WASM | `0.1.0`, **2020-06-18**; repo **ARCHIVED** 2020-02 | The older Mozilla build. | **skip** — archived, superseded by `xatlas-three`. |
| **@meshinspector/meshlib** (MeshLib) | github.com/MeshInspector/MeshLib | **NON-COMMERCIAL & EDUCATION LICENSE** (verified — "AMV Consulting, LLC… solely for non-commercial, evaluation or educational purposes"; npm field is `SEE LICENSE IN LICENSE`) | C++ → WASM, has `.d.ts` | `3.1.3-429`, **2026-08-03** (only 4 versions on npm); repo pushed 2026-09-14, 822 ★ | Genuinely excellent: fast booleans, mesh repair, decimation, remeshing, offset, ICP, point-cloud triangulation. Multithreaded WASM. | **SKIP — licence blocker.** Cannot be shipped in threepipe (an open-source library that people use commercially) without a paid commercial licence from AMV Consulting. Do not let a subagent "just try it". |
| **rhino3dm** | github.com/mcneel/rhino3dm | MIT | C++/WASM + Node | `8.32.2`, **2026-08-18**, 755 ★ | OpenNURBS: `.3dm` read/write, NURBS surfaces, `Mesh` class with `Faces` that are **quads or triangles** (OpenNURBS's native quad support), RhinoCommon-style API. | **skip for the kernel**, **adopt later for I/O** if `.3dm` import/export is ever wanted. Its `Mesh`/`MeshFace` API is a decent minimal precedent for quad-tolerant meshes but nowhere near n-gon BMesh. |
| **opencascade.js / replicad** | github.com/donalffons/opencascade.js ; `replicad` npm | LGPL-2.1-only (OCCT) / MIT (replicad wrapper) | C++/WASM ; TS | oc.js `1.1.1` **2020-09-27** (stale on npm, dev builds newer); replicad `1.1.0` **2026-09-04** | B-rep CAD kernel. Wrong paradigm for polygonal modelling (no n-gon mesh editing, no per-corner UVs, huge WASM). LGPL implications for bundling. | **skip.** Different problem domain. |
| **PMP / geometry-central / libigl / CGAL** | pmp-library (MIT, 2026-08-28, 1 507★) ; geometry-central (MIT, 2026-06-13, 1 338★) ; libigl (**core MPL-2.0 but repo licence detected as GPL-3.0 because optional modules (CGAL/tetgen) are GPL** — 2026-09-04, 5 088★) ; CGAL (**dual GPLv3+/commercial**, 2026-09-14) | C++ | — | All C++; **no maintained official WASM/JS bindings exist** for any of them. | **borrow-ideas (algorithm reference only).** PMP's `SurfaceMesh` API and geometry-central's `SurfaceMesh`/`MeshData<>` container design are the two best *API* references for a halfedge kernel with attached attribute containers — read them when designing our attribute-layer system. CGAL is licence-hostile; libigl's GPL modules are a trap. |
| **draco** | github.com/google/draco | Apache-2.0 | C++/WASM | repo 2026-08-18 | Compression only. | **skip** (already handled elsewhere in threepipe). |
| **mikktspace** | github.com/donmccurdy/mikktspace-wasm | MIT | Rust/WASM | `1.1.1`, **2022-04-16** | Standard tangent generation; three.js's `computeMikkTSpaceTangents` takes this as an argument. | **adopt** for the bake path if tangents are needed (threepipe likely already has this). |
| **geometry-extrude** | github.com/pissang/geometry-extrude | MIT | JavaScript | `0.2.1`, **2022-07-21**, 191 ★ | 2D polygon → 3D extrusion with bevel, earcut-based. Produces render buffers only. | **skip** — solves the "extrude a GeoJSON footprint" problem, not the "extrude a face region of an editable mesh" problem. |

### 2.1 Deliberately checked and found not to exist

- `halfedge` on npm — **404, does not exist**.
- `three-halfedge-mesh` — does not exist (only `three-mesh-halfedge`).
- `geometry-processing-js` on npm — **not published**.
- `xatlas.js` on npm — **404** (the real packages are `xatlas-web`, `xatlas-three`).
- `wings3d` / `dust3d` on npm — **404** (both are native apps).
- No npm package anywhere implements Blender-style `extrude_face_region`, `inset_region`, `bevel`,
  `loop_cut`, `dissolve_limit`, or `bridge_loops` on an editable n-gon mesh. **Verified by search.**

---

## 3. Editor / modeller projects in JS (architecture + UX references)

| Name | URL | Licence | Lang | Last activity | What it gives us | Verdict |
|---|---|---|---|---|---|---|
| **kokraf** | github.com/sengchor/kokraf | **BUSL-1.1** ⚠ (verified from `LICENSE`: "may not be used in a commercial application or service without purchasing a commercial license from kokraf.com"; Change Date **2029-05-11** → Apache-2.0; Additional Use Grant: free for non-commercial/educational/personal) | JavaScript | **2026-09-13**, 576 ★, very active | *The* UX reference. Directory map: `js/core` (`MeshData`, `MeshDataRegion`, `History`, `SnapManager`, `ControlsManager`, `Outline`), `js/commands` (**54 command classes**), `js/tools` (16 modal tools), `js/uv` (full UV editor + xatlas unwrap), `js/utils` (`GPUEdgePicker`, `GPUDepthReader`, `QuadrangulateGeometry`, `AlignedNormalUtils`, `SeamUtils`, `ShadingUtils`). | **borrow-ideas ONLY. Do not copy code — BUSL-1.1 forbids commercial use and threepipe is used commercially.** Read it, learn from it, write our own. |
| **three.js editor** | github.com/mrdoob/three.js `/editor` | MIT | JavaScript | 2026-09-14 | The canonical `Command`/`History` pattern (24 command classes: `AddObjectCommand`, `SetGeometryCommand`, `SetValueCommand`, `MultiCmdsCommand`, …) with `toJSON`/`fromJSON` per command and an `editor.signals` bus. kokraf is a direct descendant of this. | **adopt the pattern** (threepipe may already have an undo system — check before adding a second one). |
| **polygonjs** | github.com/polygonjs/polygonjs | **Repo LICENSE = MIT (© 2019-2023 Guillaume Fradin), but the published npm engine `@polygonjs/polygonjs@1.5.98` declares `PolyForm Shield`** ⚠ — mixed/ambiguous. Last npm publish **2025-07-10**; repo pushed 2026-08-08, 814 ★ | TypeScript | 2026-08-08 | Houdini-style SOP node graph over three.js — procedural modelling nodes (extrude, bevel, boolean, CSG via its own kernel). Best JS precedent for *node-based non-destructive* mesh ops. | **borrow-ideas.** Relevant to threepipe's existing `/graph` subpath work. Licence ambiguity ⇒ read, don't vendor. |
| **chili3d** | github.com/xiangechen/chili3d | **AGPL-3.0** | TypeScript | **2026-09-08**, 4 833 ★, very active | Browser CAD on OCCT/WASM. Clean TS architecture: document/history/command registry, snapping, selection filters. | **borrow-ideas.** AGPL makes any code reuse impossible for threepipe. The *command + snapping + selection-filter* architecture is worth reading. |
| **JSCAD (`@jscad/modeling`)** | github.com/jscad/OpenJSCAD.org | MIT | JavaScript (+ `.d.ts`) | `2.13.0`, **2026-02-22**; repo pushed 2026-09-13, 3 242 ★ | Functional CSG modelling API (see §6.2). Namespaces verified from shipped d.ts: `booleans` (union/subtract/intersect/scission/minkowski), `extrusions` (extrudeLinear/Rotate/Helical/Rectangular/FromSlices/project/slice), `expansions`, `hulls`, `modifiers`, `transforms`, `primitives`, `measurements`, `maths`, `curves`, `text`, `colors`. Geometry type is `Geom3 { polygons: Poly3[]; transforms: Mat4 }` — **convex polygon soup, no shared topology, no vertex identity**. | **borrow the API shape (strongly), skip the kernel.** `Geom3` has no adjacency, so no loop cut / dissolve / bevel is possible. But it's the best-documented functional 3D API in JS and it's LLM-friendly. |
| **Babylon.js CSG2** | github.com/BabylonJS/Babylon.js | Apache-2.0 | TypeScript | 2026-09-14, 26 065 ★ | Proof that the manifold-in-a-framework pattern works: `await InitializeCSG2Async()` (optionally passing your own `manifold-3d` module or a `manifoldUrl`; default pinned to `unpkg.com/manifold-3d@3.4.0`), then `CSG2.FromMesh(mesh)` → `.add/.subtract/.intersect` → `.toMesh()`. Works in Node and (with care) workers. | **adopt the pattern verbatim** for our boolean plugin: async init, injectable manifold instance, never bundle the WASM. |
| **sculptgl** | github.com/stephomi/sculptgl | MIT | JavaScript | **ARCHIVED** (2026-01-17), 1 504 ★ | Voxel/dyntopo sculpting, multires. Author moved to Nomad Sculpt. | **borrow-ideas** for a future sculpt mode only. Archived. |
| **Wings3D** | github.com/dgud/wings | Custom permissive BSD-ish (verified `license.terms`: "permission to use, copy, modify, distribute, and license… provided existing copyright notices are retained") | Erlang | **2026-09-08**, 667 ★ | **The best simple-robust-representation reference.** Winged-edge, n-gon, with a genuinely small and complete operator set (extrude, bevel, bridge, inset, loop cut, dissolve, intrude, tighten). Still maintained after 25 years. | **borrow-ideas (high value).** Read `src/wings_*.erl` for operator semantics when Blender's implementation is too entangled with its UI. Winged-edge is *less* suited to us than BMesh's radial-loop (non-manifold edges), but the op decomposition is instructive. |
| **Dust3D** | github.com/huxingyi/dust3d | MIT | C++ | 2026-08-17, 3 517 ★ | Node/stroke-based auto-modelling (not direct polygonal editing). | **skip** for scope; interesting for a future "quick base mesh" tool. |
| **Plasticity** | github.com/nkallen/plasticity | NOASSERTION (source-available, commercial product) | TypeScript | 2026-08-14, 3 395 ★ | A *TypeScript* modeller (Parasolid-class kernel via C3D) with an outstanding modal-command + gizmo + keybinding architecture, written by a single author. `src/commands/*` is a masterclass in "command = a generator that yields while a gizmo is live". | **borrow-ideas (high value for modal tools).** Licence prevents code reuse; the command/gizmo architecture is the single best TS reference for "modal operator with live numeric input", which is exactly the Blender G/R/S + type-a-number UX. |
| **vibe3d** | github.com/shulc/vibe3d | MIT | **D** | 2026-09-14, 4 ★ | Box-modeller with vertex/edge/polygon modes, bevel, inset, extrude, loop/ring/connect. Very new, tiny. | **skip** (wrong language, no traction). Listed for completeness. |
| **Verge3D / Spline / Vectary / Womp / Clara.io / Nomad** | — | closed | — | — | Closed source. Clara.io's public API docs are long dead (site defunct). | **skip.** |
| **PlayCanvas Editor / Godot web** | — | — | — | — | No polygonal mesh editing. | **skip.** |

### 3.1 kokraf — detailed architecture notes (the UX reference)

Read directly from the clone at `.repos/kokraf` (commit `2e13e71`, 2026-09-13):

- **Mesh representation (`js/core/MeshData.js`, 279 LOC):** an **incidence graph, not a half-edge / BMesh**.
  `Vertex{id, position, edgeIds:Set, faceIds:Set}`, `Edge{id, v1Id, v2Id, faceIds:Set}`,
  `Face{id, vertexIds:[], edgeIds:Set}`. Lookups via string keys: `edgeKey = "min_max"`,
  `faceKey = sorted(vertexIds).join('_')`. UVs live in a **separate `Map`** off to the side.
  Full `toJSON` / `rehydrateMeshData` (rebuilds the key maps on load, stashed in `object.userData.meshData`).
  - **Consequences we must avoid:** no ordered loop cycle per face → no *cheap* "next edge around this
    face/vertex"; `faceKey` is order-insensitive so two faces with the same vertex set collide;
    no per-corner attribute layers (UVs bolted on externally); no non-manifold edge support beyond a
    `Set` of face ids with no radial ordering, which makes bevel/edge-slide direction ambiguous.
  - **What it proves:** you *can* ship extrude/inset/bevel/knife/loop-cut/bridge/booleans on a plain
    incidence graph. It's the pragmatic-but-wrong choice. We should do BMesh properly.
- **Undo (`js/core/History.js`, 96 LOC):** classic three.js-editor `execute/undo/redo` stacks, **capped at
  25 commands**, `signals.historyChanged.dispatch()`, full `toJSON`/`fromJSON` with a `commands` registry
  map keyed by `data.type`. 54 command classes including the generic
  `MeshDataCommand`, `MeshDeltaCommand` (delta-based mesh undo — the right idea),
  `MultiCommand`, `SequentialMultiCommand`, `SwitchModeCommand`, `SwitchSubModeCommand`.
- **Modal tools (`js/tools/*.js`):** one class per operator (`ExtrudeTool` 540 LOC, `BevelTool` **2 044 LOC**,
  `InsetTool`, `KnifeTool`, `LoopCutTool`, `EdgeSlideTool`, `Union/Difference/IntersectTool`,
  `DuplicateTool`). Each tool: `constructor(editor)` pulls collaborators off the editor
  (`editSelection`, `snapManager`, `viewportControls`, `cameraManager`), `enableFor(object)` attaches a
  `TransformControls` gizmo + DOM listeners, and a `TransformCommandSolver` + `TransformNumericInput`
  pair converts drag/typed-number into a Command. **The "numeric input while dragging" is factored out
  into a reusable class** — copy that idea.
- **Keymap (`js/tools/KeyHandler.js`):** shortcuts loaded from `config.get('shortcuts')` (user-editable),
  a `matchesShortcut()` matcher, mode-aware (`currentMode`/`previousMode` for object vs edit mode),
  **double-tap detection** (300 ms threshold) for Blender-ish double-key bindings, and a
  `signals.disableKeyHandler` escape hatch for when a text field has focus.
- **Picking:** `GPUEdgePicker.js` + `GPUDepthReader.js` — GPU ID-buffer picking for edges, not CPU
  raycasting. Worth noting as an alternative/complement to `three-mesh-bvh` for dense edge picking.

**Licence warning to propagate to every subagent:** kokraf is BUSL-1.1. *Reading it for design ideas is
fine; copying any code into threepipe is not.*

---

## 4. Blender as the algorithm reference (what we actually have on disk)

Verified against the local clone `.repos/blender` (commit `e4e6c79a`, 2026-06-11).

- `source/blender/bmesh/bmesh_class.hh` — `BMHeader` (CustomData `void *data` pointer, `index`, `htype`,
  `hflag`), `BMVert`, `BMEdge` (+ `BMDiskLink v1_disk_link, v2_disk_link`), `BMLoop`
  (`radial_next/radial_prev`), `BMFace`.
- `source/blender/bmesh/intern/` — 40+ files. The ones that matter for us:
  `bmesh_core.cc` (Euler ops), `bmesh_structure.cc` (disk/radial cycle plumbing), `bmesh_queries.cc`,
  `bmesh_interp.cc` (**CustomData interpolation — this is how UVs survive every operator**),
  `bmesh_marking.cc` (selection flush between vert/edge/face modes),
  `bmesh_edgeloop.cc` (**loop cut / edge ring walking**), `bmesh_log.cc` (**undo log — read this before
  designing our undo**), `bmesh_mesh_normals.cc`, `bmesh_mesh_tessellate.cc`, `bmesh_mesh_validate.cc`.
- `source/blender/bmesh/operators/` — **40 `bmo_*.cc` files**: `bmo_bevel.cc`, `bmo_inset.cc`,
  `bmo_extrude.cc`, `bmo_subdivide.cc`, `bmo_subdivide_edgering.cc`, `bmo_dissolve.cc`, `bmo_bridge.cc`,
  `bmo_bisect_plane.cc`, `bmo_connect*.cc`, `bmo_hull.cc`, `bmo_poke.cc`, `bmo_wireframe.cc`,
  `bmo_solidify` (in `bmo_utils.cc`), `bmo_triangulate.cc`, `bmo_join_triangles.cc`,
  `bmo_removedoubles.cc`, `bmo_symmetrize.cc`, `bmo_beautify.cc`, `bmo_unsubdivide.cc`, …
- `source/blender/bmesh/intern/bmesh_opdefines.cc` — **83 `BMOpDefine` structs**, i.e. the authoritative,
  machine-readable signature list for the whole operator set. This file is effectively a **free schema
  for our TypeScript operator API** (see §6.1). Slot types: `BOOL=1, INT=2, FLT=3, PTR=4, MAT=5, VEC=8`,
  then the dynamically-allocated `ELEMENT_BUF` and `MAPPING`; `INT` can carry an
  `BMO_OP_SLOT_SUBTYPE_INT_ENUM` with a named enum table.
- `source/blender/bmesh/tools/` — the higher-level interactive tools (knife, edge slide, etc.).

**This is the single most valuable asset we have and it's already local.** Per CLAUDE.md: port from
source, never approximate.

---

## 5. Agent-facing scripting API precedents

| System | Paradigm | Selection model | Undo model | LLM-friendliness notes |
|---|---|---|---|---|
| **Blender `bmesh.ops`** | Imperative, one function per op, **named keyword args only**, explicit `bm` first arg, returns a **dict of output slots** (`{"faces.out": [...], "geom.out": [...]}`) | Caller passes explicit element lists (`geom=[...]`, `faces=[...]`) — *no implicit global selection* | External (`bmesh_log.cc` / Blender undo push) | **Best structural fit for us.** Explicit in/out slots make it trivially describable to an LLM as a JSON-schema tool. Verbose, but unambiguous. Downside: element handles are object pointers that die after an op, so LLMs get "reference to removed element" errors constantly. |
| **Blender `bpy.ops.mesh.*`** | Imperative on a hidden global context (active object, selection, mode) | Implicit global selection + `bpy.ops.mesh.select_*` | Automatic undo push per operator | **Worst fit.** Hidden state means an LLM must track "what is selected right now" across turns — the #1 failure mode in BlenderMCP transcripts. Avoid replicating. |
| **JSCAD `@jscad/modeling`** | Functional, pure, namespaced (`booleans.union(a,b)`, `extrusions.extrudeLinear({height}, sketch)`), options-object-first convention | None — no selection concept | None (pure values, re-run the script) | Very LLM-friendly (pure, composable, well-documented). But no topology ⇒ can't express "bevel these 4 edges". |
| **CadQuery** | Fluent chained builder with **string selectors**: `.faces(">Z").workplane().hole(5)` | `">Z"`, `"|X"`, `"%CIRCLE"` string DSL | Stack-based `.end()` | Compact; but the string selector DSL is cryptic and LLMs hallucinate selector syntax. |
| **build123d** | Two modes: **Algebra** (operator overloading, stateless) and **Builder** (context managers) | `ShapeList` query methods: `faces()`, `edges()`, `.sort_by(Axis.X)`, `.group_by(Face.area)`, `.filter_by(lambda ...)` | Builder context | **The 2026 evidence favours this.** See §5.1. Apache-2.0. |
| **Onshape FeatureScript** | Declarative feature functions with typed `definition` maps; **topology referenced by persistent queries** (`qCreatedBy`, `qNearestTo`, `qGeometry`) rather than by index | **Query language — the key idea.** Queries are *re-evaluated* against the current model, so they survive upstream edits | Full parametric feature tree | **The single best idea to steal: queries, not IDs.** "the 4 vertical edges of the face created by feature `extrude1`" survives a regeneration; `edgeId=27` does not. |
| **Houdini HOM / VEX** | Attribute-centric: everything is a point/prim/vertex attribute; groups are named, persisted selections | **Named groups** (`@group_top`) and expression selection (`@P.y > 0`) | Node graph | **Second best idea to steal: named selection sets that persist as mesh data.** Blender has this too (vertex groups / face maps). |
| **OpenSCAD** | Purely declarative CSG tree | none | none | Extremely LLM-friendly (huge training corpus) but no topology editing. |
| **Rhino / Grasshopper / RhinoScript** | Imperative + visual dataflow | GUIDs into the doc | doc-level undo | Mostly a cautionary tale about GUID churn. |
| **Fusion 360 API** | Deeply OO, `Component/BRepFace/Sketch`, index-based topology references | index-based (brittle) | Timeline | Famous for "topological naming problem" — index references break on regeneration. Avoid. |

### 5.1 LLM-driven modelling: the 2026 evidence

Found via search (papers, treat as indicative not definitive — **⚠ I read abstracts/summaries, not full
papers**):

- **`build123d-mcp`** (github.com/pzfreo/build123d-mcp) — reports that on the public *CADGenBench*
  leaderboard in June 2026, wrapping build123d in a tool server with render-preview + measure + fix
  loops raised the same model's score **0.360 → 0.457** and **CAD validity 88% → 100%**.
  ⚠ *vendor-reported number, not independently verified.*
- Comparative work on agent frameworks (arXiv 2606.xxxxx family, "ECIP" paradigm) reports
  **build123d attains the highest Pass@1 and shortest latency**, attributed to its *compact syntax*,
  while a dedicated intermediate representation scored better on geometric fidelity (IoU).
- **BlenderMCP** (github.com/ahujasid/blender-mcp, MIT, **28 528 ★**, pushed 2026-09-07) — the most
  popular LLM↔3D bridge by far. Its architecture is instructive *as an anti-pattern for us*: a handful
  of structured tools (`get_scene_info`, `get_object_info`, asset-library search/download) **plus an
  `execute_blender_code` escape hatch that runs arbitrary Python**. Its own README warns the code tool
  "can be powerful but potentially dangerous" and that the model "is sometimes erratic". The lesson:
  when the structured API is too coarse, the agent falls back to code-gen; therefore **make the
  structured API expressive enough that code-gen is the pleasant path, and make that path a real,
  typed, sandboxable scripting API** (which is exactly the maintainer's "scripting, not MCP" instinct).
- Generative-mesh services (Meshy, Tripo, Hyper3D Rodin, Hunyuan3D) are **out of scope** — they produce
  meshes, they don't edit them.

**Distilled findings that matter for our API:**
1. Compact beats verbose for Pass@1 — but only if it's *unambiguous*.
2. Validity jumps when the agent can **measure and preview** between ops (a `describe()` / `stats()` /
   render-thumbnail affordance is worth more than extra operators).
3. Hidden global mode/selection state is the top failure source. Prefer explicit arguments, or a
   *first-class, inspectable* selection object.
4. Stable, re-evaluable references (queries/named groups) beat integer ids.

---

## 6. API design precedents — concrete snippets

### 6.1 Blender `bmesh.ops` — verbatim operator schema from `bmesh_opdefines.cc`

This is the real thing, copied from `.repos/blender/source/blender/bmesh/intern/bmesh_opdefines.cc`:

```c
static BMOpDefine bmo_inset_region_def = {
    /*opname*/ "inset_region",
    /*slot_types_in*/
    {
        {"faces",               BMO_OP_SLOT_ELEMENT_BUF, {BM_FACE}},  /* Input faces. */
        {"faces_exclude",       BMO_OP_SLOT_ELEMENT_BUF, {BM_FACE}},  /* Faces to exclude. */
        {"use_boundary",        BMO_OP_SLOT_BOOL},   /* Inset face boundaries. */
        {"use_even_offset",     BMO_OP_SLOT_BOOL},   /* Scale offset for even thickness. */
        {"use_interpolate",     BMO_OP_SLOT_BOOL},   /* Blend face data across the inset. */
        {"use_relative_offset", BMO_OP_SLOT_BOOL},   /* Scale offset by surrounding geometry. */
        {"use_edge_rail",       BMO_OP_SLOT_BOOL},   /* Inset along existing edges. */
        {"thickness",           BMO_OP_SLOT_FLT},    /* Inset distance from the boundary. */
        {"depth",               BMO_OP_SLOT_FLT},    /* Raise/lower along the normal. */
        {"use_outset",          BMO_OP_SLOT_BOOL},   /* Outset rather than inset. */
        {{'\0'}},
    },
    /*slot_types_out*/
    { {"faces.out", BMO_OP_SLOT_ELEMENT_BUF, {BM_FACE}}, {{'\0'}} },
    /*init*/ nullptr,
    /*exec*/ bmo_inset_region_exec,
    /*type_flag*/ (BMO_OPTYPE_FLAG_NORMALS_CALC | BMO_OPTYPE_FLAG_SELECT_FLUSH),
};
```

And `bevel`, which shows the **enum-subtyped slot** pattern (offset_type, profile_type, affect,
miter_outer/inner, vmesh_method each carry a named `bmo_enum_*` table):

```c
static BMOpDefine bmo_bevel_def = {
    /*opname*/ "bevel",
    /*slot_types_in*/
    {
        {"geom",        BMO_OP_SLOT_ELEMENT_BUF, {BM_VERT | BM_EDGE | BM_FACE}},
        {"offset",      BMO_OP_SLOT_FLT},
        {"offset_type", BMO_OP_SLOT_INT, to_subtype_union(BMO_OP_SLOT_SUBTYPE_INT_ENUM),
                        bmo_enum_bevel_offset_type},
        {"profile_type",BMO_OP_SLOT_INT, ..., bmo_enum_bevel_profile_type},
        {"segments",    BMO_OP_SLOT_INT},
        {"profile",     BMO_OP_SLOT_FLT},   /* Profile shape, 0->1 (.5 => round). */
        {"affect",      BMO_OP_SLOT_INT, ..., bmo_enum_bevel_affect_type},
        {"clamp_overlap", BMO_OP_SLOT_BOOL},
        {"material",    BMO_OP_SLOT_INT},   /* -1 means inherit from adjacent faces. */
        {"loop_slide",  BMO_OP_SLOT_BOOL},
        {"mark_seam",   BMO_OP_SLOT_BOOL},
        {"mark_sharp",  BMO_OP_SLOT_BOOL},
        {"harden_normals", BMO_OP_SLOT_BOOL},
        ...
    },
    /*slot_types_out*/ { {"faces.out", ...}, {"edges.out", ...}, ... },
};
```

**Why this matters:** those 83 structs are a *complete, already-written, machine-readable schema* for our
operator layer. Named slots + typed values + enums + declared outputs ⇒ this converts 1:1 into TS
interfaces **and** into JSON-schema tool definitions for an LLM, with zero design guesswork. Also note
`BMO_OPTYPE_FLAG_NORMALS_CALC | BMO_OPTYPE_FLAG_SELECT_FLUSH` — post-op housekeeping is declared, not
hand-written per operator. Copy that too.

Python usage shape (what a user/LLM actually writes):

```python
ret = bmesh.ops.inset_region(bm, faces=sel_faces, thickness=0.1, depth=0.0,
                             use_even_offset=True, use_boundary=True)
new_faces = ret["faces.out"]
bmesh.ops.translate(bm, verts=list({v for f in new_faces for v in f.verts}),
                    vec=(0, 0, 0.25))
```

### 6.2 JSCAD — functional / options-object (verified from shipped `.d.ts`)

```js
const { booleans, extrusions, primitives, transforms } = require('@jscad/modeling')

const plate = extrusions.extrudeLinear({ height: 2 }, primitives.roundedRectangle({ size: [40, 20], roundRadius: 2 }))
const hole  = transforms.translate([10, 0, -1], primitives.cylinder({ radius: 3, height: 4 }))
const part  = booleans.subtract(plate, hole)
```

Type: `Geom3 { polygons: Poly3[]; transforms: Mat4; color?: Color }` — **convex polygon soup, no
adjacency, no persistent element identity.** Good API, wrong data structure for us.

### 6.3 build123d — algebra mode (compact) and builder mode (contextual)

From the project README (Apache-2.0):

```python
# Algebra mode — stateless, operator-overloaded
line = Line((0, -3), (6, -3))
line += JernArc(line @ 1, line % 1, radius=3, arc_size=180)
sketch = make_hull(line.edges())
sketch -= Pos(6, 0, 0) * Circle(2)
part = extrude(sketch, amount=2)

# Builder mode — context managers track a design history
with BuildPart() as part_context:
    with BuildSketch() as sketch:
        with BuildLine() as line:
            Line((0, -3), (6, -3))
        make_face()
    extrude(amount=2)
    fillet(edges().filter_by(lambda e: e.length == 2), 1)
```

The selector layer is the part worth copying:

```python
part.faces().group_by(Face.area)[-1].sort_by(Axis.X)[-1]      # ShapeList chain
part.edges().filter_by(GeomType.CIRCLE).filter_by(lambda e: e.radius == 2)
```

`faces()/edges()/vertices()` return a `ShapeList` with `sort_by`, `group_by`, `filter_by`. Composable,
readable, and — crucially — **discoverable by an LLM without memorising a string DSL** (contrast
CadQuery's `">Z"`).

### 6.4 manifold-3d — immutable value semantics (verified from `manifold.d.ts@3.5.3`)

```ts
import Module from 'manifold-3d';
const wasm = await Module(); wasm.setup();
const { Manifold, CrossSection } = wasm;

const body  = Manifold.cube([20, 20, 5], true);
const hole  = Manifold.cylinder(10, 3).translate(5, 0, 0);
const part  = body.subtract(hole).refineToTolerance(0.01).calculateNormals(0, 60);

part.status();          // ErrorStatus — explicit validity check, no exceptions in the hot path
part.genus();           // topological invariant — great for agent self-verification
part.volume();
const mesh = part.getMesh(0);   // -> MeshGL with runOriginalID[] tracking provenance
```

Also: `warp(fn)` / `warpBatch(fn)` for user-supplied deformation, `setProperties(numProp, fn)` for
arbitrary per-vertex attributes, `split/splitByPlane/trimByPlane`, `decompose()/compose()`,
`slice(h)`/`project()` → `CrossSection`, `asOriginal()/originalID()` for provenance.

**Three ideas to steal:** (1) `status()` instead of throwing — an agent can check-and-recover;
(2) `genus()/volume()/surfaceArea()` as cheap **self-verification invariants** an agent can assert on;
(3) `originalID()` — provenance carried through destructive ops, which is our answer to
"which original face did this triangle come from" after a boolean.

### 6.5 Babylon.js CSG2 — the "WASM backend as an opt-in plugin" pattern

```ts
import { InitializeCSG2Async, CSG2, Mesh } from "@babylonjs/core";
import Module from "manifold-3d";

// three ways: default (fetch from CDN), explicit URL, or inject your own instance
const wasm = await Module(); wasm.setup();
await InitializeCSG2Async({ manifoldInstance: wasm.Manifold, manifoldMeshInstance: wasm.Mesh });

const result = CSG2.FromMesh(a).subtract(CSG2.FromMesh(b)).toMesh("result", scene);
```

The default `manifoldUrl` is pinned (`unpkg.com/manifold-3d@3.4.0`). **Copy this exactly**: async init,
injectable instance so Node/bundler users control loading, no WASM in the core bundle.

---

## 7. Proposed principles for a TS modelling API (humans + LLM agents)

Synthesised from the above. These are recommendations for the maintainer to accept/reject, not decisions.

**P1 — Two layers, one kernel.** A low-level **Euler-operator layer** (`splitFaceMakeEdge`,
`joinFaceKillEdge`, `splitEdgeMakeVert`, `vertSplice`, … — the BMesh core) that nobody outside the
library calls, and a high-level **operator layer** (`extrudeFaceRegion`, `insetRegion`, `bevel`, …)
that is the public API. Blender's split; `sketchpunklabs/bmesh` already gives us layer 1's skeleton.

**P2 — Operators are named-argument, single-options-object, and return their outputs.**
Mirror `bmesh_opdefines.cc` 1:1. Never positional beyond the mesh itself.

```ts
const { faces } = ops.insetRegion(bm, {
  faces: sel.faces(),
  thickness: 0.1,
  depth: 0,
  useEvenOffset: true,
  useBoundary: true,
})
```

Reason: an options object is (a) self-documenting, (b) forward-compatible, (c) **mechanically
convertible to a JSON-schema tool definition**, and (d) the shape LLMs are most reliable with.

**P3 — Stable element IDs *and* re-evaluable queries.** Integer/handle IDs for the UI and for undo
deltas; a **Selection/Query object** (Onshape's idea, build123d's ergonomics) for scripts:

```ts
mesh.faces().filterBy(f => f.normal.dot(UP) > 0.99).groupBy(f => f.area).last()
mesh.edges().boundary().sortBy(Axis.X)
mesh.group('seat_top')                // named, persisted selection set (Houdini/Blender vertex groups)
```

`Selection` must be a *first-class, inspectable, serialisable value* — not hidden global mode state.
It should survive operators where semantically possible (Blender's `SELECT_FLUSH` behaviour), and
operators should return the new elements so chaining never needs a re-query.

**P4 — Per-corner attribute layers are core, not bolted on.** Blender's `CustomData` on `BMLoop` is
why UVs/creases/sharp/seams survive every operator (`bmesh_interp.cc`). kokraf's side-car `uvs: Map`
is the failure mode to avoid. Design: typed layer registry (`vec2 uv`, `float crease`, `bool seam`,
`int materialIndex`) with declared interpolation rules, so every new operator gets attribute handling
for free.

**P5 — The editable mesh is the source of truth; `BufferGeometry` is a derived, cached bake.**
One-way: `EditMesh → tessellate (Earcut) → split by sharp/attr discontinuity → BufferGeometry` plus a
`triangleIndex → faceId` table for picking. Never round-trip through `BufferGeometry`.

**P6 — Transactions, not per-mutation undo.** `mesh.transact('Inset Faces', () => { ... })` producing
one `MeshDeltaCommand` (kokraf has the right name for this). Read `bmesh_log.cc` first — Blender logs
*element deltas*, not full mesh snapshots, which is what makes multi-million-poly undo viable.
Integrate with threepipe's existing undo system rather than adding a second one.

**P7 — Node-safe by construction.** No `window`, no `document`, no `crypto.randomUUID()` in the kernel
(that's `sketchpunklabs/bmesh`'s bug). `Vector3`/`BufferGeometry` are fine per CLAUDE.md. WASM
backends (manifold, xatlas) are **lazy, injectable, optional plugins** — Babylon's `InitializeCSG2Async`
pattern.

**P8 — Validity is queryable, not exceptional.** `mesh.validate()` (port `bmesh_mesh_validate.cc`),
plus cheap invariants an agent can assert on: `eulerCharacteristic()`, `isManifold()`,
`nonManifoldEdges()`, `volume()`, `boundaryLoops()`. Operators return a result object with
`{ ok, warnings, created, removed }` rather than throwing for recoverable conditions
(manifold's `status()` pattern).

**P9 — Give agents eyes and a ruler.** Per the 2026 CADGenBench evidence, `describe()` (compact textual
topology/bbox/selection summary), `measure()` and a headless `renderPreview()` raise agent success rate
more than extra operators do. threepipe can render offscreen in Node with the polyfill — this is a
genuine differentiator vs. BlenderMCP.

**P10 — The scripting API *is* the agent API.** One typed TS surface, documented once. If an MCP server
is ever wanted, it should be a thin auto-generated wrapper over the same schemas (derived from the
same options-object types), never a parallel hand-written surface. And keep the `execute` escape hatch
sandboxed and explicit rather than pretending it won't be needed.

**P11 — Modal tools are a separate layer from operators.** Operator = pure `(mesh, params) → result`.
Modal tool = a state machine that (a) previews by re-running the operator on a scratch copy each frame,
(b) accepts mouse delta / typed numbers / axis constraints (X/Y/Z, shift-precision), (c) commits one
transaction on confirm, discards on Esc. Plasticity's `src/commands/*` and kokraf's
`TransformCommandSolver` + `TransformNumericInput` are the two references. This split is also what makes
every operator scriptable *for free*.

---

## 8. Recommendations

### 8.1 Adopt (add as dependencies)

| Rank | Package | Version (2026-09-14) | Licence | For |
|---|---|---|---|---|
| 1 | **`three-mesh-bvh`** | `0.9.15` | MIT | Picking, snapping, knife raycasts, proximity selection, boolean fallback. Node-safe. |
| 2 | **`manifold-3d`** | `3.5.3` | Apache-2.0 | Boolean/hull/offset operator backend. **Lazy-loaded optional plugin** (Babylon `InitializeCSG2Async` pattern). |
| 3 | **`xatlas-three`** | `0.2.1` | MIT | UV unwrap operator. Already ours (repalash). |
| 4 | **three.js built-ins** | `0.186.0` | MIT | `Earcut`/`ShapeUtils.triangulateShape` for n-gon tessellation; `BufferGeometryUtils.toCreasedNormals`/`mergeGeometries` for the bake. **No new dependency.** |
| 5 | **`quickhull3d`** | `3.1.2` | MIT | `convex_hull` operator returning n-gon faces (better fit than manifold's triangles). Optional. |
| 6 | **`mikktspace`** | `1.1.1` | MIT | Tangents in the bake path — *only if threepipe doesn't already have this.* |

### 8.2 Vendor & rewrite (copy-with-attribution, then fix)

| Rank | Source | Licence | Why vendor rather than depend |
|---|---|---|---|
| 1 | **`sketchpunklabs/bmesh`** (`src/ds`, `src/ops/{CoreOps,StructOps,QueryOps,ConstructOps}.ts`, ~2 030 LOC) | MIT | Not on npm; needs `crypto.randomUUID` → integer-handle replacement, attribute layers, `BMHeader` flags, arena/free-list storage, three.js `Vector3` interop. Saves the riskiest weeks of work. Already cloned to `.repos/survey/bmesh`. |
| 2 | **`cdt2d`** (or `poly2tri`) | MIT / BSD-3 | Constrained Delaunay for knife-cut and bisect-plane face re-triangulation. Both dead upstream (2015/2018); vendoring ~600 LOC beats depending on abandonware. |

### 8.3 Borrow ideas only (read, do not copy — licence or design mismatch)

- **kokraf** (BUSL-1.1 until 2029) — modal-tool UX, command catalogue, keymap/double-tap handling,
  GPU edge picking, numeric-input-during-drag. **Propagate the licence warning to every subagent.**
- **Plasticity** (source-available, not FOSS) — best TS modal-command/gizmo architecture.
- **Wings3D** (permissive BSD-ish, Erlang) — clean operator semantics on a simple n-gon representation.
- **three.js `/editor`** (MIT) — `Command`/`History` with `toJSON`/`fromJSON`; kokraf's ancestor.
- **PMP / geometry-central** (both MIT, C++) — halfedge + attached attribute-container API design.
- **build123d** (Apache-2.0) — `ShapeList` selector ergonomics.
- **Onshape FeatureScript** — persistent *queries* instead of ids; solves topological naming.
- **three-subdivide** / **gl-catmull-clark** — attribute interpolation across subdivision.
- **polygonjs** (licence ambiguous) — node-based non-destructive SOP design; relevant to threepipe `/graph`.

### 8.4 Explicitly skip

- **MeshLib / `@meshinspector/meshlib`** — **non-commercial licence. Hard blocker.**
- **CGAL** (GPL/commercial), **libigl** GPL-flagged modules — licence traps.
- **opencascade.js / replicad / chili3d (AGPL)** — B-rep, wrong paradigm, licence issues.
- **three-mesh-halfedge, geometry-processing-js (as a kernel), `halfedge`(nonexistent), polyhedra,
  convex-hull, xatlas-web, geometry-extrude, SimplifyModifier, TessellateModifier, delaunator** —
  stale, wrong shape, or superseded.
- **`@nasedkinpv/opensubdiv-wasm`** — 2 ★, 2 releases, ambiguous licence file. Revisit only if
  production Catmull-Clark with creases becomes a hard requirement, and then prefer our own
  implementation or our own Emscripten build. ⚠ *licence text not individually read.*
- Generative-mesh APIs (Meshy/Tripo/Rodin/Hunyuan) — out of scope.

### 8.5 Build ourselves (no viable prior art exists in JS/TS)

1. **The BMesh-equivalent kernel**: vert/edge/loop/face with disk + radial cycles, **CustomData-style
   per-corner attribute layers**, element flags, arena storage with stable integer handles,
   `validate()`, and a delta-based change log. *(seeded by §8.2 item 1, ported from
   `bmesh_core.cc` / `bmesh_structure.cc` / `bmesh_interp.cc` / `bmesh_log.cc`)*
2. **The operator layer** — ported from the 40 `bmo_*.cc` files, with signatures transcribed from
   `bmesh_opdefines.cc`: extrude (region/edge/vert/discrete), inset (region/individual), bevel,
   subdivide edges, subdivide edgering (loop cut), dissolve (verts/edges/faces/limit), bridge loops,
   grid fill, poke, solidify, wireframe, spin, bisect plane, symmetrize, triangulate,
   join_triangles, remove_doubles, connect_verts, beautify, unsubdivide.
3. **Selection model** — mode (vert/edge/face), flush semantics (`bmesh_marking.cc`), named groups,
   `ShapeList`-style query API, loop/ring walking (`bmesh_edgeloop.cc`).
4. **Edit↔render bake** — tessellation with `faceId` mapping, sharp/attribute-discontinuity vertex
   splitting, incremental re-bake of dirty faces only.
5. **Modal tool framework** — preview-on-scratch-copy, axis constraints, typed numeric input,
   Blender keymap, snapping. Integrated with threepipe's plugin/undo systems.
6. **The agent-facing scripting surface** — P2/P3/P8/P9/P10 above.

### 8.6 Immediate next steps suggested

1. Get the maintainer's sign-off on **P1–P11** (these are architectural, and CLAUDE.md requires approval
   before structural changes to core).
2. Extract all **83 operator signatures** from `bmesh_opdefines.cc` into a generated TS
   `ops.schema.ts` — mechanical, high-leverage, and it fixes the public API shape before any
   implementation starts.
3. Spike the kernel: vendor + de-`window` + re-handle `sketchpunklabs/bmesh`, add one attribute layer
   (UV), and get `splitEdgeMakeVert` + `splitFaceMakeEdge` + a bake-to-`BufferGeometry` round trip
   green under `npm run test:unit` **in Node**.
4. Spike `manifold-3d` in Node behind the Babylon-style async-init pattern, and verify
   `originalID()` survives well enough to reattach our face IDs and UVs after a boolean. **If it
   doesn't, that's a real finding to file in `issues/open`, not something to work around.**

---

## Appendix A — Verification method

- npm facts: `GET https://registry.npmjs.org/<pkg>` → `dist-tags.latest`, `versions[latest].license`,
  `time[latest]`. Script retained at `.repos/survey/npmq.sh`.
- GitHub facts: `GET https://api.github.com/repos/<owner>/<repo>` → `license.spdx_id`, `pushed_at`,
  `archived`, `stargazers_count`. Script retained at `.repos/survey/ghq.sh`.
- Licence texts read directly from raw.githubusercontent for: MeshLib, Wings3D, OpenSubdiv, polygonjs;
  and from the local clones for kokraf (`LICENSE`).
- TypeScript surfaces read from the actually-published artifacts via unpkg:
  `manifold-3d@3.5.3/manifold.d.ts` (1 636 lines), `@jscad/modeling@2.13.0/src/**/index.d.ts`.
- three.js facts read from the local clone `.repos/three.js` @ `r183.1` (`9796ddd`, 2026-03-26);
  npm `three` latest is `0.186.0` (2026-09-08) — **the local clone is 3 releases behind**, but nothing
  in §1 changed between r183 and r186 as far as this survey needed. ⚠ *r184–r186 examples/jsm diff not
  individually reviewed.*
- Blender facts read from the local clone `.repos/blender` @ `e4e6c79a` (2026-06-11).
- kokraf facts read from the local clone `.repos/kokraf` @ `2e13e71` (2026-09-13).
- `sketchpunklabs/bmesh` shallow-cloned to `.repos/survey/bmesh` and read in full.

**Marked unverified in this document:** the CADGenBench 0.360→0.457 figure (vendor-reported);
`@nasedkinpv/opensubdiv-wasm`'s `LICENSE.txt` contents; the r184–r186 three.js examples diff;
LLM-CAD paper claims (abstracts/summaries only, full PDFs not read).
