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
| 7. Queries, iterators, walkers | **mostly done** — vert shell, edge loop, edge ring, face loop, boundary, loop shell, island. 41 tests |
| 8. Selection flags, counters, flush rules, history | **done** — 26 tests |
| 9. Tessellation + bake to render buffers | **done** — ear clipping, corner-indexed, faceId map, 8 tests. Corner-angle normals with sharp-edge fans still to do |
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

## Walkers: Blender behaviours worth remembering

Ported as found, because each one is load-bearing and each one is surprising:

- **A cube has no edge loops.** The walk needs a valence of exactly 4 or 2 to cross a vertex, and every
  cube corner is valence 3. An n-gon hub additionally needs a face longer than 4.
- **A boundary loop turns corners** and takes the whole border ring, because at a corner the first fan
  step already lands on another boundary edge.
- **A face loop never starts from a boundary edge**, even though the code appears to test for that case
  first; it still requires manifold afterwards.
- **A delimited face loop excludes the delimited face, but a delimited edge ring includes the delimited
  edge.** Opposite conventions for the same idea. Both are tested so neither drifts.
- Two walkers can yield an element twice, which is harmless in Blender. The generator forms reproduce
  it faithfully and the array forms deduplicate.

## Open questions

- Attribute interpolation needs `bmesh_interp.cc` semantics for every topological op. Decide whether to
  port it eagerly in step 4 or per-operator as each one needs it.
- The undo store (step 11) could reuse the same chunk hashing for glTF binary payloads. Worth checking
  before designing it twice.

---

## Generators (milestone MA of [`03-agent-modelling-api.md`](./03-agent-modelling-api.md))

`src/generate/`, all ported from Blender, 550 kernel tests green.

| File | Blender source |
| --- | --- |
| `primitives.ts` | `bmo_primitive.cc` — grid, cube, circle, cone/cylinder, UV sphere, icosphere, with UVs. Monkey skipped (a 271-vertex literal table). |
| `spin.ts` | `bmo_utils.cc` `bmo_spin_exec`, plus the `edbm_spin_exec` sanity checks and the loose-vertex branch from `bmo_extrude.cc:594` |
| `lathe.ts` | spin over a wire profile, the way `MOD_screw.cc` does it, with `mesh_remove_doubles_on_axis` for the pole weld. `primitiveTorus` follows `add_mesh_torus.py` and is checked vertex-for-vertex against it. |
| `sweep.ts` | `curve_to_mesh_convert.cc` + `curve_poly.cc` (`calculate_tangents`, `calculate_normals_minimum` including the cyclic correction, `calculate_normals_z_up`) |
| `array.ts` | `MOD_array.cc` in full — three fit modes, three summed offset sources, `dm_mvert_map_doubles`, caps. Curve placement from `curve_deform.cc` + `anim_path.cc` + the legacy `BevList` in `curve.cc`. |
| `mirror.ts` | `bmo_mirror.cc`, with the winding reversal from `mesh_flip_faces.cc` (which is where Blender actually does it) |
| `../bmesh/splice.ts` | `BM_vert_splice`, `BM_edge_splice`, `bmesh_edge_vert_swap`, `BM_edge_find_double`, `BM_face_find_double` |
| `../ops/weld.ts` | `bmo_removedoubles.cc` `bmo_weld_verts_exec` |
| `../ops/inset.ts` | `bmo_inset.cc`, both forms, every option. Needed three core kernels that did not exist here — `bmesh_kernel_edge_separate`, `bmesh_kernel_vert_separate`, `bmesh_kernel_unglue_region_make_vert` — which are private there for now and belong in `bmesh/` |
| `../ops/solidify.ts` | `MOD_solidify_extrude.cc` simple mode (the entry point is `MOD_solidify_extrude_modifyMesh:150`; there is no `solidify_extrude_modifyMesh`). Non-manifold mode and vertex-group weighting out of scope, stated in the header |
| `../ops/join.ts` | `join_geometries.cc` for the attribute union, `BM_mesh_separate_loose` and `P > Selection` for the splits |
| `../bmesh/interp.ts` | `bmesh_interp.cc` + `interp_weights_poly_v2` from `math_geom.cc`. Multires paths out of scope |
| `../bmesh/flip.ts`, `../bmesh/ngon.ts`, `../bmesh/collapse.ts`, `../ops/dissolve.ts`, `../ops/subdivide.ts` | promoted out of `primitives.ts` and `extrude.ts` — see Cleanup debt |

### Three real bugs this work found in existing kernel code

1. **`faceCreate` defaulted faces to `SMOOTH`.** Blender: `v->head.hflag = 0`,
   `e->head.hflag = BM_ELEM_SMOOTH`, `f->head.hflag = 0` (`bmesh_core.cc:161/250/493`) — vertices and
   **faces** start with nothing set, only edges start smooth. Because the kernel set `SMOOTH` on new
   faces, `bmToMesh` never wrote a `sharp_face` layer, and every generated mesh baked with averaged
   vertex normals. Invisible to topology tests; glaring in a render, where every box looked inflated.
   Fixed, with a flag-default test in `BMesh.test.ts` quoting the three Blender lines, and a bake test
   asserting a cube comes out with six face normals rather than eight corner-averaged ones.

   The knock-on: `sweep.ts` only *cleared* `SMOOTH` on its caps, relying on the wrong default for its
   sides. It now sets the flag both ways, which is what `bmFromMesh` does and what Blender's Mesh
   semantics mean (absence of `sharp_face` = smooth).

2. **`mergeVerts` silently dropped every rebuilt face's attributes.** It killed the original face and
   then passed `bm.faces.has(example) ? example : undefined` as the example — always `undefined`,
   because it had just been killed. Header flags, material slot, face attributes and all per-corner
   attributes were lost on every merge. The comment claimed they had been copied first; nothing was.
   Fixed by building the replacement while the original is alive, which is `remdoubles_createface`'s
   order.

3. **`extrudeEdgeOnly` could not be chained** — filed as
   [`kernel-extrude-edge-only-orientation.md`](./kernel-extrude-edge-only-orientation.md), now fixed.
   It hardcoded the quad as `[a, b, b2, a2]`, so the second extrusion off a rim wound the opposite way.
   A lathe is a rim extruded `segments` times, so both the primitives port and the spin port hit it
   independently. `ExtrudeOptions` grew `useNormalFlip` and `useNormalFromAdjacent`, both defaulting to
   the old behaviour.

### Filed, still open

- [`kernel-extrude-delorig-divergence.md`](./kernel-extrude-delorig-divergence.md) — **fixed.**
  `extrudeFaceRegion` now computes `delorig` and only deletes the originals when the region has a
  neighbour, and reverses them with `bmesh/flip.ts` when it keeps them, which is the other half of
  the rule the report missed. Extruding a lone face gives a closed box. See the issue for what it
  means for `spin`, which passes `skip_input_flip` and so leaves its seed cap wound as drawn.
- [`kernel-split-edge-copies-corner-data.md`](./kernel-split-edge-copies-corner-data.md) — **fixed.**
  `bmesh/interp.ts` ports `bmesh_interp.cc` and `splitEdgeMakeVert` now ends with `BM_edge_split`'s
  pair. A second bug turned up with it: `interpElemAttrs` treated every integer-storage layer as
  categorical, so a vertex-colour layer took one endpoint verbatim on every split; it now dispatches
  per type as `CustomData_bmesh_interp` does.
- [`kernel-elem-attrs-copy-flags.md`](./kernel-elem-attrs-copy-flags.md) — **open.** Element creation
  does not follow `BM_elem_attrs_copy`'s flag rule: Blender keeps the destination's select bit and
  takes everything else including `BM_ELEM_TAG`, the kernel does the opposite. Both inset and
  duplicate work around it locally. Wants a deliberate pass, not a drive-by, because it changes every
  operator's output flags at once.
- [`kernel-weld-verts-not-ported.md`](./kernel-weld-verts-not-ported.md) — resolved in substance by
  `ops/weld.ts`; the remaining item is the selection-history remap (`BM_select_history_merge_from_targetmap`).

### Cleanup debt — done

`primitives.ts` went from 1862 lines to 1117. Its private copies were collapsed onto the shared
implementations and the rest of its private operators were promoted out:

| was private in `primitives.ts` | now |
| --- | --- |
| `edgeVertSwap`, `edgeSplice` | `bmesh/splice.ts`, identical ports, deleted |
| `faceFindDouble` | `bmesh/splice.ts`. The private copy compared vertex *sets*; the shared one is the real `BM_face_find_double`, which compares the edge cycle in both directions. The shared one is stricter and correct |
| `faceExists`, `weldVerts`, `remdoubles_splitface`, `remdoubles_createface` | `ops/weld.ts`, deleted. The shared weld also does `BM_elem_flag_merge_ex` properly, which the private copy approximated with a bitwise or |
| `invert_m4_m4` | `math/index.ts`'s `mat4Invert`. Differs only for a singular matrix, where Blender's own `invert_m4_m4` returns false and leaves a partially reduced matrix — undefined either way |
| `BM_faces_join`, `bmo_dissolve_faces_exec`, `bm_vert_is_manifold_flagged` | `ops/dissolve.ts` (new) |
| `bmesh_kernel_join_vert_kill_edge`, `BM_edge_collapse` | `bmesh/collapse.ts` (new). **These belong in `bmesh/euler.ts`** and should move there; that file was owned by another agent at the time |
| `bmo_subdivide_edges_exec` (`tri_3edge` + `use_sphere`), `BM_vert_pair_share_face_by_len` | `ops/subdivide.ts` (new) |
| `BM_face_create_ngon`, `bm_edges_sort_winding` | `bmesh/ngon.ts` (new). Natural home is `BMesh.ts`, next to `faceCreate` |

Still outstanding, from the later ports: `bmesh_kernel_edge_separate`, `bmesh_kernel_vert_separate`
and `bmesh_kernel_unglue_region_make_vert` are private in `ops/inset.ts` and belong in `bmesh/`;
`sin_cos_from_fraction` and `BM_face_calc_normal` are still private in `primitives.ts` (the latter is
also open-coded as `averageFaceNormal` in `extrude.ts` and ported again as `faceCalcNormal` in
`bmesh/interp.ts` — three copies of one Blender function, which is two too many).

Still private in `primitives.ts`, with no shared home yet: `sin_cos_from_fraction` and
`BM_face_calc_normal` (neither is in `math/index.ts`; the latter is also open-coded as
`averageFaceNormal` in `ops/extrude.ts`), `bmo_remove_doubles_exec` and its KD-tree half, and the
chainable `extrude_edge_only` that exists because `ops/extrude.ts`'s cannot be chained the way the UV
sphere needs.

Each promoted module has its own test file; they previously had only indirect coverage through the
primitives. `bmesh/flip.ts` (`bmesh_kernel_loop_reverse`, `BM_face_normal_flip`) is new for the same
reason as `collapse.ts` and belongs in `euler.ts` too.
