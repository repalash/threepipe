# 15b - OpenSubdiv port for Subdivide Mesh and Subdivision Surface (subplan of 15-procedural-on-kernel)

Goal: `GeometryNodeSubdivideMesh` and `GeometryNodeSubdivisionSurface` bit-exact against Blender 5.2.2 (macOS arm64
ground truth), by porting the code Blender runs - Blender's `bke::subdiv` + `intern/opensubdiv` and OpenSubdiv
v3_7_0 - file by file, citing file:line. No approximation: anything not ported throws naming the missing function.
`plugins/blend-importer/src/loader/catmull.ts` (gl-catmull-clark + heuristics) is not used; once this lands the blend
importer's Subsurf could call it instead (other package - parent decides).

## Sources (pinned)

- OpenSubdiv **v3_7_0**: `.repos/OpenSubdiv-3.7.0/` (GitHub archive, MD5 `470d53c4d4335a601c33a052ce7c33b4` = the
  hash Blender's `build_files/build_environment/cmake/versions.cmake:232-234` pins). `.repos/OpenSubdiv` is a shallow
  `dev` clone (newer than 3.7.0) - not used for porting.
  Licence: **TOST-1.0** (Tomorrow Open Source Technology License = Apache-2.0 with a different trademark section 6),
  not plain Apache-2.0. Ported files need its notice (LICENSE.txt + NOTICE.txt) - to settle like the Eigen port
  (`procedural-eigen-port-licence.md`): the parent decides before anything is committed.
- Blender `intern/opensubdiv` at v5.2.2: exported read-only to `.repos/blender-5.2.2-opensubdiv/` (the sparse
  `.repos/blender-5.2.2` checkout does not contain `intern/`).
- Blender `source/blender/blenkernel/intern/subdiv*.cc` (`.repos/blender-5.2.2`).

## What Blender runs

Both nodes: `bke::subdiv::new_from_mesh` (`subdiv.cc:131`, converter `subdiv_converter_mesh.cc`, refiner
`intern/opensubdiv/internal/topology/topology_refiner_factory.cc` - full topology incl. edges, creases, UV
face-varying channels) then `subdiv_to_mesh` (`subdiv_mesh.cc:1521`) with `resolution = (1 << level) + 1`, which
traverses ptex faces (`subdiv_foreach.cc`, defines element order) and evaluates `eval_limit_point(ptex, u, v)` per
result vertex through `openSubdiv_createEvaluatorFromTopologyRefiner` (`evaluator_impl.cc:418`): stencil tables +
patch table + `Osd::CpuEvaluator` + Blender's `PatchMap`.

| node | scheme | refine | patches |
| --- | --- | --- | --- |
| Subdivide Mesh (`node_geo_mesh_subdivide.cc:22`) | bilinear (`is_simple`) | uniform, level 1 | uniform linear quads, evaluated on a `2^level + 1` grid |
| Subdivision Surface, Limit Surface off | Catmull-Clark (+creases, boundary/uv options) | uniform, `level` | uniform linear quads at `level` |
| Subdivision Surface, Limit Surface on | Catmull-Clark | adaptive, `quality` | B-spline regular/boundary/corner patches, Gregory basis end caps, inf-sharp patches, face-varying patches |

Other attributes: vertex data interpolated from coarse corners/edges/faces with ptex weights (`subdiv_mesh.cc:452-740`,
`CustomData`-style mixing), UV maps via face-varying evaluation, loose edges via `find_loose_edge_interpolation_positions`
(`subdiv_mesh.cc:1387`), creases written as `crease_vert`/`crease_edge` then removed (`node_geo_subdivision_surface.cc`).

## Files to port (in this order)

Phase A - **Subdivide Mesh** (bilinear, uniform). Unblocks `building_base` (Buildify).
1. Sdc: `types.h`, `options.h`, `crease.h/.cpp` (needed by Vtr even for bilinear), `scheme.h`, `bilinearScheme.h`.
2. Vtr: `level.h/.cpp` (topology storage, `completeTopologyFromFaceVertices` only if Blender does not give edges - it
   does: `specifies_full_topology` = true), `refinement.h/.cpp`, `quadRefinement.h/.cpp` (child ordering = result
   order), `fvarLevel.h/.cpp`, `fvarRefinement.h/.cpp` (UV channels), `stackBuffer.h`, `array.h`,
   `componentInterfaces.h`. Not `triRefinement` (Loop only).
3. Far: `topologyRefiner.h/.cpp`, `topologyRefinerFactory.h/.cpp` (+ Blender's specialisation in
   `topology_refiner_factory.cc`), `topologyLevel.h`, `primvarRefiner.h`, `stencilBuilder.h/.cpp`, `stencilTable.h/.cpp`,
   `stencilTableFactory.h/.cpp` (uniform; `generateOffsets`), `patchDescriptor`, `patchParam.h`, `ptexIndices.h/.cpp`,
   `patchTable.h/.cpp`, `patchTableFactory.h/.cpp` (uniform path only), `patchBasis.h/.cpp` (linear quad basis).
4. Osd: `cpuEvaluator` `EvalStencils` / `EvalPatches`, `cpuKernel.cpp` (`CpuEvalStencils`), `bufferDescriptor.h`,
   `types.h` (`PatchCoord`, `PatchArray`, `PatchParam`).
5. Blender intern: `topology_refiner_impl.cc`, `mesh_topology.cc`, `evaluator_impl.cc`, `eval_output.h`,
   `eval_output_cpu.cc`, `patch_map.cc/.h`, `type_convert.cc`.
6. Blender bke: `subdiv.cc`, `subdiv_converter.cc`, `subdiv_converter_mesh.cc`, `subdiv_topology.cc`, `subdiv_eval.cc`,
   `subdiv_foreach.cc`, `subdiv_mesh.cc` (no displacement/multires/CCG/GPU), `subdiv_inline.hh`.
7. Node: `node_geo_mesh_subdivide.cc`.

Phase B - **Subdivision Surface, Limit Surface off**: `catmarkScheme.h` masks + `Sdc::Crease` (semi-sharp creases,
vertex sharpness, boundary interpolation options, fvar linear interpolation options), the node
(`node_geo_subdivision_surface.cc`) incl. crease fields.

Phase C - **Limit Surface on**: `TopologyRefiner::RefineAdaptive`, `sparseSelector`, `patchTableFactory` adaptive path,
`patchBuilder.cpp`, `catmarkPatchBuilder.cpp` (Gregory basis end caps), `sparseMatrix.h`, `patchBasis.cpp` (B-spline,
Gregory, boundary/corner via `PatchParam` boundary mask), `StencilTableFactory::AppendLocalPointStencilTable(FaceVarying)`,
face-varying patch tables, `patchMap` for adaptive patches (Blender's copy), `Osd::EvalPatches` cubic bases.

## Float exactness notes

- OSD `Real` is float in Blender's build (`StencilTable` = `StencilTableReal<float>`, `stencilTable.h:256`;
  `StencilTableFactory` / `PrimvarRefiner` = `...Real<float>`, `stencilTableFactory.h:270`, `primvarRefiner.h:1248`;
  mask weights are the `MASK::Weight` of those). Every operation `f32`, in source order.
- **FMA contraction differs by where code is compiled.** Blender's own code (bke subdiv, `intern/opensubdiv`, and OSD
  header templates instantiated there) is built with `-ffp-contract=off` (`build_files/cmake/platform/platform_apple.cmake:161`).
  The OSD library itself is a dependency built by `build_files/build_environment/cmake/opensubdiv.cmake` with only
  `-O2 -std=c++20 -fPIC -march=armv8.2-a+...` (`options.cmake` deps flags, no `-ffp-contract`), i.e. Apple clang's default
  `-ffp-contract=on`: inside one expression `a * b + c`, `c + a * b`, `x += a * b`, `a * b - c` become one fused
  multiply-add (clang `tryEmitFMulAdd`: the left operand's multiply is fused first). So code from OSD `.cpp` files
  (`stencilTableFactory.cpp`, `patchTableFactory.cpp`, `patchBasis.cpp`, `cpuKernel.cpp`, `vtr/*.cpp`, templates
  instantiated in them) needs `fmaf` (already exact in `src/blender/math/eigen.ts:50`, to move to `f32.ts`) at exactly
  those expressions, and code compiled in Blender must not use it. First milestone of Phase A: confirm on Blender's
  output (a stencil weight sum and one bilinear evaluation) before porting further.
- `std::` math only where OSD calls it (`std::pow` in crease decay, `std::sqrt`/`cos` in Gregory basis) - libm ulps
  allowed only there.
- Element order comes from `subdiv_foreach.cc` traversal (vertices of corners, edges, inner; edges; loops; faces) - not
  from OSD's refined level order; OSD only supplies positions/UVs.

## Verification

Case sets (`tests/parity/cases/subdiv*.ts`, `run_cases.py`), each case compared bit-exact:
- `subdivMesh`: Subdivide Mesh levels 0-4 on the shape object (tris, non-planar quads, pentagon, non-manifold edge, loose
  edge + vertex), cube, grid with holes, a single n-gon; attributes on every domain (float/int/vector/bool/colour/
  quaternion), a UV map, materials, ids; level clamped (negative, 16 error).
- `subdivSurface`: levels 1-3, limit off, crease fields (0, 0.5, 1, per element), Boundary Smooth both, UV Smooth all six
  items; then limit on with quality 1-4 (Phase C).
- Unit tests per ported module where OSD has a direct invariant (refined counts, stencil weight sums = 1, patch basis
  partition of unity), plus the existing geonodes-kit / asset suites (`building_base` must turn exact after Phase A;
  candy_bounce and rose after Phase C).

## Size and order of work

~30k lines of C++ in scope (Vtr ~8.5k, Far ~12k without Loop, Sdc ~1.5k, Osd cpu ~2k, Blender intern ~2.5k, bke subdiv
~4.5k). Phase A first and reported before B; each phase ends with its case set vendored and a report in agent.md.
