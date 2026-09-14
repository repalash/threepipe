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
| 4. Attribute layers on BMesh elements (`CustomData` equivalent) + interpolation | next |
| 5. `bmFromMesh` / `bmToMesh` round trip | next |
| 6. Euler operators (SFME, SEMV, JEKV, JVKE, JFKE, `facesJoin`, `vertSplice`) | |
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
- **Element attribute data** is a sparse `Map<string, number | number[]>` per element for now. Step 4
  replaces this with an offset-addressed block mirroring `CustomData`, once the layout is needed for
  interpolation. Keeping it sparse until then avoids designing the layout twice.
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
- **Blender parity** for steps 5 to 9: build the same mesh in Blender via `bmesh.ops`, dump the arrays,
  and compare against the kernel's output. Fixtures to live under `plugins/mesh-kernel/tests/fixtures/`.
  This is the step that catches a port that merely looks right.

## Open questions

- Attribute interpolation needs `bmesh_interp.cc` semantics for every topological op. Decide whether to
  port it eagerly in step 4 or per-operator as each one needs it.
- The undo store (step 11) could reuse the same chunk hashing for glTF binary payloads. Worth checking
  before designing it twice.
