# 15d. Track 2 acceptance: Subdivision Surface on the kernel, the three assets in the editor, report and video

Parent plan: `15-procedural-on-kernel.md` (§8 M8–M11, §12 progress). Course correction 2026-10-18 13:40: no new nodes
outside the acceptance assets; go to acceptance and make `track2-procedural` merge-ready into `modelling-editor`.

## Goals (each "done" is a test result)

1. **Merge `modelling-editor`** into `track2-procedural`. 4 conflicts are expected (`git merge-tree`):
   - `package.json`
   - `vite.examples.config.js`
   - `plugins/modelling/src/modifiers.ts`
   - `plugins/modelling/src/commands/modifiers.ts`

   Keep both sides. The modifier command shapes stay those of `modelling-editor` plus the additive `geometryNodes`
   type.
   Done when unit tests (mesh-kernel, modelling, procedural) and typecheck are green after the merge.
2. **One OpenSubdiv port.**
   - The kernel's `plugins/mesh-kernel/src/subdiv/` is the realism track's port: OpenSubdiv 3.7.0, uniform plus
     adaptive, 34/34 parity.
   - `GeometryNodeSubdivisionSurface` is built on it, and `GeometryNodeSubdivideMesh` moves onto the kernel refiner.
   - Delete `plugins/procedural/src/blender/opensubdiv/` once the procedural parity sets (`subdivMesh` and others)
     are unchanged on the kernel refiner.
   - Done when `subdivMesh` keeps its statuses, a new `subdivSurface` set is exact (or libm-proven), and the rose
     and candy floor assets match their Blender ground truth.
3. **Vertex groups.** The user decides. `building_base` stays the recorded known gap (`procedural-vertex-groups.md`).
4. **The three assets in the editor.** Buildify, flower scatter and terrain run as `geometryNodes` modifiers in the
   modelling-editor app's Properties > Modifiers.
   - Their inputs are editable there and the result is reactive.
   - The two Blender assets come in through the `blendAsset` command from their bundles. The terrain is the DSL group.
   - One e2e test each, in `tests/procedural.spec.ts`, with SwiftShader baselines.
   - Bundles are local (`tmp/bundles`, licences undecided [A6]). Their tests skip with that reason when the bundle is
     missing.
5. **Report page and video.**
   - The page `examples/procedural-acceptance-report/`, or under `tmp/` if it holds third-party renders, shows for each
     asset:
     - the GPU screenshot
     - the parity status (exact / ulp / known gap)
     - eval ms (cold / input change)
     - instance and vertex counts
     - the agent time and token metrics
   - A directed MP4 (GPU VM, `tpvm`, Metal) shows each asset loading in the editor, an input edited, and the result
     updating.
   - The bundles reach the VM with `ij write` in chunks. They are never committed.
6. **Merge-ready.** Unit, typecheck, and the modelling and procedural e2e suites are green. State that in agent.md.

## Order

1. Commit the sub-agent's last work (Pack UV Islands, bounding-box cases) and stop it.
2. Merge (goal 1).
3. Subdivision Surface on the kernel (goal 2). Rose and candy floor need it.
4. Editor acceptance (goal 4).
5. Report and video (goal 5).
6. Final green run (goal 6).

## Parked

These are written but not committed, kept outside the package:
- UV Tangent (MikkTSpace serial port) in `tmp/parked-uv-tangent/`. It is not verified against Blender.
- Format String, Image Info, Integer Vector, Input Menu: not started.
