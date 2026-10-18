# R2b — Subdivision Surface on the kernel (subplan)

**Status**: started 2026-10-18. Parent: [16-realism §3](./16-realism.md). One port serves two callers: the
`subsurf` modifier in plugin-modelling (this track) and Track 2's geometry-nodes Subdivision Surface and
Subdivide Mesh nodes ([A4] in `15-procedural-on-kernel.md`). Pinned to **Blender 5.2.2** (`.repos/blender-5.2.2`)
and the OpenSubdiv it builds against (Blender's `intern/opensubdiv` glue is read from `.repos/blender` with
`git show`, OpenSubdiv from `.repos/OpenSubdiv` at `ffffe6f`; the Sdc/Vtr/Far code paths used here have not
changed in years, which the fixtures will confirm).

## What Blender actually computes

`MOD_subsurf.cc` → `subdiv_modifier.cc:35-39` builds `bke::subdiv::Settings`:

| Setting | From | Default |
| --- | --- | --- |
| `is_simple` | `subdivType` (Catmull-Clark / Simple) | Catmull-Clark (Simple = Sdc bilinear scheme) |
| `is_adaptive` | `!(flags & UseRecursiveSubdivision)`, i.e. `use_limit_surface` | true |
| `level` | `is_simple ? 1 : is_adaptive ? quality : levels` | quality 3, levels 1 (render 2) |
| `use_creases` | `eSubsurfModifierFlag_UseCrease` | on |
| `vtx_boundary_interpolation` | `boundary_smooth` (`subdiv.cc:67`): ALL → `EDGE_ONLY`, PRESERVE_CORNERS → `EDGE_AND_CORNER` | ALL |
| `fvar_linear_interpolation` | `uv_smooth` (`subdiv.cc:47`): NONE → ALL, PRESERVE_CORNERS → CORNERS_ONLY, …, PRESERVE_BOUNDARIES → BOUNDARIES, ALL → NONE | PRESERVE_BOUNDARIES |

The glue (`intern/opensubdiv/internal/topology/topology_refiner_factory.cc`): edge sharpness from
`crease_edge` as `10·c²` (`subdiv_inline.hh:116`, `subdiv_converter_mesh.cc:141`), vertex sharpness from
`crease_vert` (`:172`), infinite sharpness on non-manifold vertices and a mixed sharpness where two
non-manifold edges meet (`:179-247`); options `SetVtxBoundaryInterpolation`, **`CREASE_UNIFORM`**,
`SetFVarLinearInterpolation` (`:308-311`).

The evaluator (`evaluator/evaluator_impl.cc:439-505`): non-adaptive → `RefineUniform(level)` and a uniform
(bilinear QUADS) patch table, so each output grid vertex *is* a uniformly refined control vertex; adaptive →
`RefineAdaptive(quality)`, B-spline patches with `ENDCAP_GREGORY_BASIS`, `useInfSharpPatch`, evaluated at the
grid points. `subdiv_mesh` emits a grid of resolution `(1 << levels) + 1` per ptex face (quads one ptex face,
n-gons one per corner), so with `levels ≤ quality` every grid point should be either a patch corner of the isolated
regions or a point of a regular B-spline patch — i.e. the **exact limit point of the level-`levels` vertex**,
and Gregory end-cap interiors only sampled when `levels > quality`. This is the hypothesis S6 tests against
fixtures before relying on it.

## Plan

| Step | Port | Done = |
| --- | --- | --- |
| S1 | `Sdc`: `options.h`, `crease.cpp/.h` (uniform and Chaikin, sharpness decay, transitional rules), `scheme.h` (vertex/edge/face masks, rule selection), `catmarkScheme.h`, `bilinearScheme.h` | unit tests on masks against hand-derived Catmull-Clark rules (smooth, crease, corner, dart, boundary) |
| S2 | `Vtr::Level` over the kernel's arrays: face-verts, edge-verts, and the derived vertex-faces / vertex-edges / edge-faces with local indices (`level.cpp` `completeTopologyFromFaceVertices` `:1623`, `populateLocalIndices` `:1797`), component tags (`level.cpp` vertex rules, boundary / non-manifold / semi-sharp / inf-sharp tagging), base-level setup from `TopologyRefinerFactory` (`topologyRefinerFactory.cpp`) | topology of the cube, a grid, a non-manifold fan agree with OpenSubdiv's invariants |
| S3 | Uniform refinement: `refinement.cpp` (child counts, parent→child maps, `subdivideEdgeSharpness` `:849`, `subdivideVertexSharpness` `:909`, tag propagation), `quadRefinement.cpp` (child topology) | refined topology counts and face-vertex order |
| S4 | `Far::PrimvarRefiner::Interpolate` (`primvarRefiner.h:458-650`: face, edge, vertex points with crease masks) | **parity with Blender, `use_limit_surface = false`**, levels 1–3, cube / creased cube / plane (boundary modes) / n-gon panel / non-manifold, max vertex error < 1e-5 |
| S5 | Face-varying: `fvarLevel.cpp`, `fvarRefinement.cpp`, `InterpolateFaceVarying` with the six linear-interpolation modes | UV parity with Blender for all six `uv_smooth` values |
| S6 | Limit positions: `PrimvarRefiner::Limit` (`:1007`) with `Scheme::ComputeVertexLimitMask` (`scheme.h:580-640`, `catmarkScheme.h:191-260`) at the final level | **parity with Blender's default (`use_limit_surface = true`, quality 3)** for levels 1–3; documented and measured gap for levels > quality (Gregory interiors), which would need `Far` patch tables (not planned unless a fixture needs it) |
| S7 | Output `MeshData` like `subdiv_mesh.cc`: quads, attribute interpolation (UVs from S5, other point/corner attributes linear as Blender does, `crease_edge` on child edges as `subdiv_mesh` writes it), `sharp_edge` / `sharp_face` | attribute parity on the fixtures |
| S8 | API + `subsurf` modifier in plugin-modelling's stack (`levels`, `quality`, `useLimitSurface`, `useCreases`, `boundarySmooth`, `uvSmooth`, `simple`), and a `crease` command (`crease_edge` / `crease_vert`) | camera body re-built as a cage + subsurf, scored on the benchmark |

Kernel API (for Track 2 too):

```ts
subdivisionSurface(mesh: MeshData, options?: {
    levels?: number                 // 1
    useLimitSurface?: boolean       // true
    quality?: number                // 3
    useCreases?: boolean            // true: read crease_edge / crease_vert
    edgeCrease?: Float32Array       // GN node inputs: override the attributes (per edge / per vertex, 0..1)
    vertexCrease?: Float32Array
    boundarySmooth?: 'ALL' | 'PRESERVE_CORNERS'                                   // 'ALL'
    uvSmooth?: 'NONE' | 'PRESERVE_CORNERS' | 'PRESERVE_CORNERS_AND_JUNCTIONS'
             | 'PRESERVE_CORNERS_JUNCTIONS_AND_CONCAVE' | 'PRESERVE_BOUNDARIES' | 'SMOOTH_ALL'  // 'PRESERVE_BOUNDARIES'
    scheme?: 'CATMULL_CLARK' | 'SIMPLE'                                           // Subdivide Mesh = SIMPLE
}): MeshData
```

Enum spelling follows Blender RNA (D15). MeshData in, MeshData out, Node-safe, no three.js.

## Verification

Fixtures from Blender 5.2.2 through the Blender worker (`plugins/mesh-kernel/tests/fixtures/gen-subsurf-fixtures.py`,
same pattern as the other generators): input mesh with creases, modifier settings, evaluated output positions,
faces and UVs. Compared as geometry (vertex multiset within 1e-5, faces as cyclic sequences), since Blender's
`subdiv_foreach` vertex order is its own. `plugins/blend-importer/src/loader/catmull.ts` is used only as an oracle
for the uncreased interior rule (it has an angle heuristic for corners and no creases).
