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
| 5. `bmFromMesh` / `bmToMesh` round trip | **done and verified against Blender** — 16 round-trip tests plus 110 parity tests over 6 real `.blend` fixtures |
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
- **Blender parity is established for steps 1 to 5.** `plugins/mesh-kernel/tests/blender-parity.test.ts`
  checks the kernel against arrays Blender itself wrote, extracted straight from the DNA blocks of six
  `.blend` fixtures by `tests/fixtures/extract-blend-fixture.mjs`. The fixtures were chosen to cover
  what synthetic tests miss: quads, all-triangles, n-gons from 3 to 22 sides, a 482-vertex sphere with
  32-valence poles, an open mesh with boundary edges and two components, and a non-manifold mesh with
  21 three-face edges.

  Headline result: given only positions and Blender's face-vertex lists, `calculateEdges()` derives
  exactly Blender's edge count and edge set, and a `.corner_edge` array identical to Blender's element
  for element under the edge correspondence. `validate()` accepts real Blender topology verbatim, and
  the round trip returns Blender's positions, offsets, corner arrays and UV layer unchanged.

  Two differences found, both legitimate rather than bugs. Edge *index ordering* differs, because
  Blender's order comes from per-thread hash maps and is not reproducible even between Blender runs;
  the suite asserts a bijection instead. And `calculateEdges()` normalises each pair to (low, high)
  while Blender keeps the authored direction; `.corner_edge` and `validate()` are both
  orientation-agnostic, and the round trip preserves Blender's orientation byte for byte.

- **The parity suite has verified discriminating power.** Reversing the winding order inside
  `MeshData.fromFaces` leaves all 110 self-consistency tests green and fails 6 parity tests. That is
  exactly the class of shared-convention bug the old suite could not see, and it is the reason parity
  fixtures were worth building. Confirmed independently by mutating the source, running both suites,
  and reverting.

- **Still not proven against Blender**, and recorded in `tests/fixtures/README.md`: loose edges (no
  mesh in the 143-mesh fixture corpus has one, so `calculateEdges()` dropping them is untested and the
  suite asserts the precondition so the gap stays visible), edges with four or more faces, attributes
  beyond the four required ones and a single UV map, normals, and Blender's actual edit-mode
  behaviour.

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
