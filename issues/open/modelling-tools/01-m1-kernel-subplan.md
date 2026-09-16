# M1 subplan — the mesh kernel

Parent: [`00-synthesis.md`](./00-synthesis.md). Package: `plugins/mesh-kernel` (`@threepipe/mesh-kernel`).

Goal: a Node-safe kernel that can represent, validate, convert, edit and serialise an n-gon mesh with
per-domain attributes, with every algorithm ported from Blender rather than invented.

## Status

| Step | State |
| --- | --- |
| 1. `MeshData` (SoA) + `AttributeStorage` + constants | **done** — 26 tests |
| 2. Operator schema generated from `bmesh_opdefines.cc` | **done** — 83 ops, verified against Blender's own generator |
| 3. BMesh elements + disk/radial/loop cycles + create/kill + validate | **done** — 32 tests |
| 4. Attribute layers on BMesh elements (`CustomData` equivalent) + interpolation | **done** — layouts per domain, offset-addressed blocks, weighted interp |
| 5. `bmFromMesh` / `bmToMesh` round trip | **done** — 16 tests; **self-consistency only, see Verification** |
| 6. Euler operators | **partly done** — SEMV, SFME, JFKE, JEKV ported and tested. JVKE, `facesJoin`, `vertSplice` still to do |
| 7. Queries, iterators, walkers (loop/ring/boundary/shell) | |
| 8. Selection flags, counters, flush rules, history | |
| 9. Tessellation (`polyfill2d` port) + normals (corner-angle weighted, sharp-edge fans) | |
| 10. Operator slot machinery (`BMO_op_init/exec/finish`, flag layers) driving the generated table | |
| 11. Chunked snapshot undo store (`BLI_array_store` port) | |

## Decisions taken while implementing

- **Disk links.** Blender stores `BMDiskLink v1_disk_link, v2_disk_link` and hands out a mutable
  pointer to whichever matches the vertex. JS cannot return a mutable reference to a field pair, and a
  link object per edge side would double allocations. Instead `BMEdge` carries four fields and the
  accessors `diskNext(v)` / `setDiskNext(v, e)`. The algorithms are unchanged line for line.
- **Ids are integers**, assigned by the mesh, not pointers. `index` remains Blender's separate lazily
  validated field.
- **Element attribute data** is two typed blocks per element (`fdata: Float32Array`, `idata: Int32Array`)
  addressed by a per-domain layer layout, mirroring `CustomData` and its `BM_ELEM_CD_GET_*` offsets.
  Blender uses one byte block with typed views; splitting by storage class avoids creating a view per
  access. Blocks are allocated on first write, and a short block reads as the layer default, so adding
  a layer to an existing mesh costs nothing until it is used.
- **Categorical layers are not blended.** Integer-typed layers (material index, group ids) take the
  value of the highest-weighted source rather than an average, which is what `CustomData_interp` does.
  Averaging two material slots produces a slot that means nothing.
- **Flag attributes are written only when needed.** `bmToMesh` scans first and allocates
  `.select_vert`, `sharp_edge`, `material_index` and friends only if some element needs them, matching
  `BM_mesh_bm_to_me`. A mesh with nothing selected carries no selection arrays at all.
- **Loops are tracked in a mesh-level set** as well as by their face, so validation and counts can see
  orphans. Blender relies on its mempool for this.
- **`validate()` returns a list of strings rather than throwing.** Cheap invariants that catch a broken
  operator at the point of breakage. `assertValid()` wraps it for tests.

## Verification approach

Every step must be provable, not asserted:

- **Cycle invariants** are asserted directly (doubly linked, terminates, loop spans its edge, radial
  members agree on the edge), not inferred from element counts.
- **Euler's formula** (V − E + F = 2 for the closed test meshes) as an independent cross-check.
- **Node-safety** is proved by importing the built bundle in plain `node` with no polyfill, not by
  inspection.
- **Blender parity is NOT yet established.** This matters: the round-trip tests prove the two
  conversions agree with each other, which a shared bug would also satisfy. They do not prove either
  agrees with Blender. Treat step 5 as unverified against ground truth until the harness below exists.
- **The ground-truth harness is feasible and cheaper than expected.** Confirmed this session: the
  blend-importer's parser runs standalone in Node (`plugins/blend-importer/src/js-blend/main.js`,
  `parseBlend(arrayBuffer)`), and 14 of the 56 fixtures in `tmp/blend-fixtures/` use the modern
  3.6+ layout with `poly_offset_indices`. `blend-load-test-prim-cube.blend` is a Blender-authored cube
  (V8 E12 P6 L24) carrying `position`, `.edge_verts`, `.corner_vert`, `.corner_edge` and a `UVMap`
  corner layer — exactly the arrays the kernel claims to reproduce. Reading them needs the decoding
  helpers in `loader/geometry.ts` (`readAttrArray` and friends) rather than touching `layer.data`
  directly, which returns lazily-decoded proxies. Wire this up as the first task of M2, then use it to
  retro-verify step 5: in particular, whether `calculateEdges()` derives the same 12 edges and the same
  `.corner_edge` mapping Blender wrote.

## Bugs found and fixed during the port

- **`joinEdgeKillVert` left a dangling radial pointer.** The first version unlinked the dropped loop
  with the equivalent of `bmesh_radial_loop_unlink`, which clears the loop's own links but does not
  repoint `edge.l`. When the dropped loop happened to be the one its edge pointed at, the edge was
  left referencing a deleted loop. Twenty-five hand-written Euler tests all passed, because only some
  relative positions of the dropped loop trigger it. An exhaustive test that splits and rejoins every
  edge of a 3-, 4-, 5-, 6- and 8-gon in both orientations caught it immediately. Fixed by using
  `radialLoopRemove`, which repoints the edge. The exhaustive test is now a permanent regression guard.

  The lesson generalises to the rest of the port: for cycle-mutating operators, enumerate the
  configurations rather than picking representative cases. Hand-picked examples systematically miss
  position-dependent link bugs.

## Open questions

- Attribute interpolation needs `bmesh_interp.cc` semantics for every topological op. Decide whether to
  port it eagerly in step 4 or per-operator as each one needs it.
- The undo store (step 11) could reuse the same chunk hashing for glTF binary payloads. Worth checking
  before designing it twice.
