# Blender ground-truth fixtures

These JSON files are the expected values for [`../blender-parity.test.ts`](../blender-parity.test.ts).
Every number in them was written by Blender and read back out of the `.blend` DNA blocks by
[`extract-blend-fixture.mjs`](./extract-blend-fixture.mjs). **Nothing here is hand-written, and
nothing may be hand-edited.** If a fixture looks wrong, re-extract it or fix the extractor.

## Why they exist

The rest of the package's tests are self-consistency tests. `MeshData.test.ts` checks the kernel
against its own invariants and `convert.test.ts` checks `bmFromMesh` against `bmToMesh` - a bug
present in both directions passes all of them. These fixtures are the independent reference the
subplan (`issues/open/modelling-tools/01-m1-kernel-subplan.md`, "Verification approach") calls for.

A worked example of the difference: reversing the winding order inside `MeshData.fromFaces` leaves
all 99 pre-existing tests green, because every consumer of that function reverses with it. It fails
the parity suite on every fixture immediately, because Blender's `.corner_vert` order is fixed.

## The fixtures

All six come from `.blend` files saved by **Blender 4.3** (the 3.6+ layout: `position` /
`.edge_verts` / `.corner_vert` / `.corner_edge` CustomData layers plus `Mesh.poly_offset_indices`).
The source files live outside the repo, in `tmp/blend-fixtures/` of the main checkout.

| Fixture | Source `.blend` | Mesh | V / E / F / L | Why it is here |
| --- | --- | --- | --- | --- |
| `blend-load-test-prim-cube.json` | `blend-load-test-prim-cube.blend` | `MECube` | 8 / 12 / 6 / 24 | Quads only, closed. The smallest mesh where a wrong corner→edge mapping is still visible. |
| `blend-load-test-prim-cube-tri.json` | `blend-load-test-prim-cube-tri.blend` | `MECube` | 8 / 18 / 12 / 36 | The same cube triangulated: 6 extra diagonal edges, all faces triangles. |
| `blend-load-poly-test.json` | `blend-load-poly-test.blend` | `MEpanel #4` | 91 / 157 / 68 / 314 | N-gons - face sizes 3, 4, 8, 12 and 22 in one closed mesh. |
| `blend-load-test-prim.json` | `blend-load-test-prim.blend` | `MESphere` | 482 / 992 / 512 / 1984 | UV sphere: 448 quads + 64 pole triangles, closed, two 32-valence pole vertices. At ~110 KB it is the one large fixture; it is kept because it is the only case that exercises mixed face sizes, high valence and a non-trivial edge count together. |
| `blend-load-test-label.json` | `blend-load-test.blend`, mesh `MELabelMR_Mesh` | `MELabelMR_Mesh` | 8 / 10 / 4 / 12 | Open and disconnected: 8 of its 10 edges are boundaries, in two separate components. Its positions and UVs are awkward floats (`0.07499978691339493`) rather than round numbers, so float32 round-tripping is actually tested. |
| `blend-buildify-nonmanifold.json` | `buildify_1.0.blend`, mesh `MECube.013` | `MECube.013` | 89 / 178 / 90 / 350 | **Non-manifold**: 21 edges carry three faces and 27 are boundaries, so the radial cycle is exercised past the clean two-face case on data Blender actually produced. |

Each file carries `source`, `mesh`, `blenderVersion`, the four element counts, and
`faceOffsets` / `positions` / `edgeVerts` / `cornerVerts` / `cornerEdges` plus `uvName` / `uv` when
the mesh has a UV map. The arrays are wrapped one element per column group so a re-extraction diffs
readably.

## Regenerating

The extractor is a plain Node script with no dependencies beyond the blend importer's parser (which
runs standalone in Node). Output is deterministic - no timestamps, no absolute paths, floats printed
at full precision - so re-running it on an unchanged `.blend` produces a byte-identical file.

```sh
cd plugins/mesh-kernel/tests/fixtures
B=/path/to/blend-fixtures    # the .blend sources; they are not in the repo

node extract-blend-fixture.mjs $B/blend-load-test-prim-cube.blend
node extract-blend-fixture.mjs $B/blend-load-test-prim-cube-tri.blend
node extract-blend-fixture.mjs $B/blend-load-poly-test.blend
node extract-blend-fixture.mjs $B/blend-load-test-prim.blend
node extract-blend-fixture.mjs $B/blend-load-test.blend blend-load-test-label.json --mesh MELabelMR_Mesh
node extract-blend-fixture.mjs $B/buildify_1.0.blend blend-buildify-nonmanifold.json --mesh MECube.013
```

The output path defaults to `<blend basename>.json` next to the script. `--mesh` takes a datablock
name (`MECube`, prefix included) or an index, and is required when the file holds more than one mesh.

The script fails loudly rather than guessing: a missing layer, a layer with the wrong `CD_PROP_*`
type, a data block whose byte length disagrees with the element counts, an index out of range or a
non-finite position all throw. It refuses pre-3.6 `MPoly` files and Blender 5.0 `attribute_storage`
files outright instead of half-decoding them. `extractBlendFixture()` is also exported, so a
throwaway script can sweep a whole directory of `.blend` files - that is how these five were chosen.

## What the parity suite proves

For each fixture:

- **`calculateEdges()` agrees with Blender.** Given only positions and Blender's face-vertex lists,
  the kernel derives exactly Blender's edge count and exactly Blender's edge set (compared as
  unordered vertex pairs), and the `.corner_edge` array it produces is identical to Blender's once
  remapped through the edge correspondence. This was the specific open question in the subplan.
- **`validate()` accepts real Blender topology**, loaded verbatim with nothing derived.
- **`calculateCornerEdges()` reproduces Blender's `.corner_edge` indices exactly** when the authored
  edge domain is kept (no remapping needed there).
- **`bmToMesh(bmFromMesh(m))` reproduces Blender's arrays**: positions, `faceOffsets`, `.corner_vert`,
  and also `.edge_verts` (orientation included) and `.corner_edge`, plus the UV corner layer.
- **The Euler characteristic and the per-edge face counts match** what Blender's data implies, and
  the kernel's wire / boundary / manifold classification agrees edge for edge.

Two differences from Blender are asserted as *expected*, with the reasoning in the test:

- **Edge index ordering differs** and is not required to match. Blender's order comes from its
  primitive builders, or from `mesh_calc_edges` filling per-thread `VectorSet<OrderedEdge>` maps
  (`blenkernel/intern/mesh_calc_edges.cc`), so it is not even reproducible across Blender runs. The
  suite asserts instead that the derived→Blender correspondence is a bijection. Every fixture
  differs in order today.
- **`calculateEdges()` normalises each edge to `(low, high)`**; Blender keeps the authored
  orientation (7 of the cube's 12 edges are stored `(high, low)`). `.corner_edge` and `validate()`
  are both orientation-agnostic, so nothing downstream depends on the choice.

## What it does **not** prove

- **Loose edges.** `calculateEdges()` only sees faces, so an edge belonging to no face cannot be
  recovered. No fixture here has one, and a sweep of every mesh in `tmp/blend-fixtures/` that this
  extractor can read (143 meshes across 53 files; the pre-3.6 `MPoly` files, the 5.0
  `attribute_storage` files and 5 files over 40 MB were not searched) turned up none either. So the
  behaviour is untested
  against Blender rather than verified. A fixture with wire edges is the obvious next addition, and
  the test suite asserts the no-loose-edge precondition explicitly so the gap stays visible.
- **Edges with more than three faces.** `blend-buildify-nonmanifold.json` covers the three-face case
  against real Blender data; four or more faces on one edge occurs in the wider `.blend` survey
  (`buildify_1.0.blend`'s `MEantennv2` has eight such edges) but is not in the fixture set, and is
  covered only by hand-built meshes in `BMesh.test.ts`.
- **Anything outside the four required attributes and one UV map.** Selection flags, `sharp_edge`,
  `sharp_face`, `material_index`, creases, vertex groups, shape keys and custom normals are present
  in the source `.blend` files but are not extracted and not compared. `convert.test.ts` covers them
  self-consistently only.
- **Face winding direction / normals.** Corner order is compared element for element, which pins the
  winding, but no normal is computed or compared - normals are step 9 of the subplan.
- **Blender's `bmesh` behaviour.** The fixtures are `Mesh` (object-mode) data. Nothing here checks
  the kernel's `BMesh` against Blender's `BMesh` for an actual edit operation; the round trip only
  shows the conversion pair does not lose or reorder what Blender wrote.
- **Blender 5.0 and pre-3.6 files.** The extractor rejects both layouts, so `attribute_storage` and
  `MPoly` meshes are entirely unverified.
