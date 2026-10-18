# One OpenSubdiv port: Blender's float pipeline in the kernel (subdivision exactness)

**Found by**: track2-procedural, 2026-10-18, building the GN Subdivision Surface node on the kernel subdiv (course correction 13:40, item 2).

## State

Two ports exist.

| | `plugins/procedural/src/blender/opensubdiv/` + `src/geometry/subdiv*.ts` | `plugins/mesh-kernel/src/subdiv/` (realism track) |
|---|---|---|
| Layers | Blender's opensubdiv C-API (converter, `TopologyRefinerImpl`, `EvalOutputAPI`), `Far` stencil tables, `Osd::CpuEvaluator` in float, `bke::subdiv` (`subdiv_foreach`, `subdiv_mesh`) | `Vtr` refinement including sparse/adaptive, `Far` patch builder, Gregory end caps, face-varying, patch evaluation |
| Precision | float32 as Blender: **bit-exact** | double: 2e-4 criterion, about 1e-6 measured |
| Output order | `subdiv_foreach` (Blender's mesh order) | OpenSubdiv level order: **not Blender's vertex order** (see the probe below) |
| Adaptive (limit surface) | not ported | ported |

Probe, a cube at level 1 with SIMPLE: the kernel's `subdivisionSurface` gives corner verts `0,14,8,17,...`, while Blender
and the procedural port give `0,10,20,8,...`. Positions agree as a set. So the kernel's Subdivision Surface modifier
output differs from Blender's in vertex, edge and face order, and with it in every index-dependent result downstream.

## Now (acceptance)

- The GN Subdivision Surface node runs on the procedural `bke::subdiv` layer, which gives Blender's order. Its limit
  surface comes from the kernel's adaptive refiner and patch tables, through the new kernel export
  `createSubdivLimitEvaluator`.
- Rose and the candy floor use `Limit Surface = off`, so they take the uniform float path and are **bit-exact**.
- With the limit surface on, results are within 1e-5 (`subdivSurface` cases, "pass (> 16 ulp)").

## Correct end state (a proposal for the realism track and the maintainer)

1. Keep one port, in the kernel. It should contain:
   - the kernel's refinement and patch building
   - Blender's float evaluation pipeline, moved from procedural:
     - `Far::StencilTableFactory` with intermediate levels and `AppendLocalPointStencilTable`, using float
       `SparseMatrix` weights in OpenSubdiv's accumulation order
     - `CpuEvaluator::EvalStencils` / `EvalPatches`
     - `EvaluatePatchBasis<float>`
2. Move `bke::subdiv` (the mesh converter, `subdiv_foreach`, `subdiv_mesh`) into the kernel too. Then the Subdivision Surface
   modifier also matches Blender's output order.
3. Point procedural's Subdivide Mesh and Subdivision Surface at it, and delete `procedural/src/blender/opensubdiv/`.
   Do this only when the `subdivMesh` set keeps its exact statuses and `subdivSurface` turns exact.

Until then, Subdivide Mesh stays on the procedural port. Moving it now would lose bit-exactness and Blender's output order.
