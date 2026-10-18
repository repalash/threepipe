# 15e. One subdivision port in the kernel (OpenSubdiv float pipeline + bke::subdiv)

Parent: `15-procedural-on-kernel.md`. Problem statement and evidence: `procedural-subdiv-one-port.md`. Approved by the
coordinator on 2026-10-18 at 15:30 (item 4). The realism track does not touch `plugins/mesh-kernel/src/subdiv/` in the
meantime.

## Goal (each "done" is a test result)

There is exactly one implementation of Blender's subdivision, in `plugins/mesh-kernel/src/subdiv/`:

- **OpenSubdiv layer.** A port that follows OpenSubdiv's own source structure. Blender runs OpenSubdiv in float, so
  this port runs in float too:
  - `Sdc` / `Vtr` refinement, uniform and sparse/adaptive;
  - `Far` stencil tables, including intermediate levels and local points;
  - patch tables with Gregory-basis end caps;
  - `Osd::CpuEvaluator` (`EvalStencils` / `EvalPatches`);
  - Blender's opensubdiv C API (`opensubdiv_converter`, `TopologyRefinerImpl`, `EvalOutputAPI`, `PatchMap`).
- **Blender layer.** `bke::subdiv`:
  - the mesh converter;
  - `subdiv_eval`;
  - `subdiv_foreach` / `subdiv_mesh`, which define the output order;
  - attribute interpolation.
- **Users:**
  - the kernel's `subdivisionSurface` (the editor's Subdivision Surface modifier);
  - procedural's Subdivide Mesh and Subdivision Surface nodes;
  - `plugins/procedural/src/blender/opensubdiv/` and `src/geometry/subdiv*.ts` deleted.

Done when:
1. `subdivMesh` keeps its statuses.
2. `subdivSurface` is exact, or within ulps that are proven to come from libm (`LIBM_PROOF`). That includes the limit
   surface.
3. The rose and candy floor assets stay exact.
4. The kernel's `subsurf-parity.test.ts` is **order-exact**: vertex i equals Blender's vertex i, and faces match index for
   index. Today it pairs vertices by nearest position within 2e-4. It must pass at float32 ulps, not at 2e-4.

## Phases

1. **Move.** Move the procedural port into the kernel and keep it exact.
   - The procedural OpenSubdiv port and `bke::subdiv` move into `mesh-kernel/src/subdiv/` (`osd/`, `bke/`).
   - The attribute mixing they use comes along:
     - `mix2` / `mix4` / `mixIndicesWeighted` for every attribute type;
     - the quaternion and float4x4 expmap math, which needs `libm` (atan2f / sincosf / acosf with the proof hooks).
   - The kernel cannot depend on procedural, so these become kernel modules. Procedural re-exports or imports them.
     There must be no duplicate implementation.
   - The procedural nodes import from the kernel. The kernel's own `createSubdivLimitEvaluator` (double) is still used
     for the limit surface until phase 2.
2. **Exact limit surface.** Port the OpenSubdiv code below from `.repos/OpenSubdiv-3.7.0` with float storage, in OpenSubdiv's
   accumulation order:
   - `TopologyRefiner::RefineAdaptive`: feature-adaptive selection with `SparseSelector` and sparse `Vtr` refinement;
   - `PatchTableFactory` for adaptive refinement: regular and boundary patches with `useInfSharpPatch`, Gregory-basis end
     caps via `CatmarkPatchBuilder` / `GregoryConverter` / `SparseMatrix<float>`, and face-varying patch tables;
   - `StencilTableFactory::AppendLocalPointStencilTable(Varying)`;
   - `EvaluatePatchBasis<float>`.

   The kernel's current double-precision adaptive modules serve as a reference for structure only. They are deleted
   once this works.
3. **Kernel modifier on bke::subdiv.**
   - `subdivisionSurface(mesh, opts)` becomes `subdiv_new_from_mesh` followed by `subdiv_to_mesh`, which is what
     Blender's modifier runs (`subdiv_modifier.cc` / `MOD_subsurf.cc`).
   - The output is then in Blender's order.
   - `subsurf-parity.test.ts` becomes order-exact. The editor's `subsurf` modifier and its tests keep working.
4. **Delete** the procedural copies and verify:
   - every unit suite and typecheck;
   - procedural, modelling and mesh-kernel parity;
   - the e2e suites.

## Notes

- `-ffp-contract=off` holds, so all arithmetic is unfused, except where OpenSubdiv uses explicit FMA (none on the CPU
  evaluator path).
- Blender's adaptive evaluator refines to `level = quality` and evaluates at `(1 << levels) + 1` grid points per ptex
  face (`subdiv_mesh`).

## Status (2026-10-18)

- **Phase 1, done** (commit 0ade0037). The procedural port moved unchanged:
  - `osd/`: Sdc, Vtr, Far stencils and patch tables, Osd CPU, and Blender's C API;
  - `bke/`: converter, eval, foreach and mesh;
  - `src/blender/`: f32, fma, libm, system, colour, math, attribute data types and mixers (`mix4` moved out of
    `curvesEval`), mesh runtime and topology.

  Five names that clashed with kernel exports are exported as `blender*` (`blenderMat4Multiply` and so on). The
  procedural modules at the old paths re-export them. Procedural stays at 1892 passed and 15 skipped, with unchanged
  statuses; the kernel at 2088.
- **Phase 3, done.**
  - `subdivisionSurface` runs `BKE_subsurf_modifier_settings_init`, then `subdiv_new_from_mesh`, then `subdiv_to_mesh`
    at `(1 << levels) + 1`.
  - The double limit evaluator moved to `limitEvaluator.ts`. For `simple` (bilinear) it uses all-infinitely-sharp
    Catmark until phase 2.
  - `gen-subsurf-fixtures.py` now records the input edges in Blender's order, the output edges, and exact floats
    (no rounding).
  - `subsurf-parity.test.ts` compares index for index:
    - 34/34 pass;
    - the uniform cases are bit-exact;
    - the limit cases are within 1e-6 or 4 ulps.
  - The kernel unit tests follow Blender in two places, and the old port differed from Blender in both:
    - loose vertices are kept (`subdiv_foreach_loose_vertices`);
    - output size follows `levels` at any `quality`.
  - The unused `edgeCrease` / `vertexCrease` overrides were dropped from `SubdivisionSurfaceOptions`.
  - The OpenSubdiv licence moved to `osd/OPENSUBDIV-LICENSE.txt`.
- **Phase 4, partly done.** The procedural copies are gone. The kernel's double adaptive modules (`adaptive.ts`,
  `patchBuilder.ts`, `patchTable.ts`, `gregory.ts`, `refiner.ts`, ...) are deleted once phase 2 replaces them.
- **Phase 2, open.** This is the exact limit surface. Once it lands, `subsurf-parity.test.ts`'s `TOLERANCE` becomes
  exact for every case.
