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

## Operator fixtures written by Blender's Python API

`bmesh-ops-poke-wireframe.json` is a different kind of fixture: it checks an *edit operation*
rather than the conversion pair, which is the gap the last section describes for those two
operators. [`gen-bmesh-ops-fixtures.py`](./gen-bmesh-ops-fixtures.py) runs inside Blender, builds
each input mesh from explicit coordinates, refreshes normals (`bm.normal_update()`, what edit mode
keeps current), runs `bmesh.ops.poke` / `bmesh.ops.wireframe`, and records every resulting position
and face. The input is stored with the output so the TypeScript side builds the identical mesh.

```sh
blender --background --factory-startup --python plugins/mesh-kernel/tests/fixtures/gen-bmesh-ops-fixtures.py
```

It was generated with **Blender 3.4.1** (Debian's package). Neither `bmo_poke.cc` nor
`bmesh_wireframe.cc` has changed algorithmically since; the port cites the current source.
[`../bmesh-ops-parity.test.ts`](../bmesh-ops-parity.test.ts) compares the multiset of positions
(within 1e-4, Blender being float32) and every face as a cyclic vertex sequence, so winding is
checked too. Element *order* is not compared: Blender's mempool reuses the slot of a face that poke
kills mid-operator, so its order is not creation order.

## Knife and bisect fixtures written by Blender itself

[`../knife-bisect-parity.test.ts`](../knife-bisect-parity.test.ts) checks the knife
(`src/ops/knife/`) and bisect (`src/ops/bisectPlane.ts`) ports against Blender 3.4.1 driving its own
operators through a real 3D view. Blender needs a window for these, so the generators run under Xvfb:

```sh
# Knife Project (EDBM_mesh_knife) and bisect with a given plane -> knife-bisect/
xvfb-run -a -s "-screen 0 1280x1024x24" blender --factory-startup \
    --python plugins/mesh-kernel/tests/fixtures/gen-knife-bisect-fixtures.py

# The interactive knife and bisect's line gesture, fed simulated input -> knife-interactive/
xvfb-run -a -s "-screen 0 1280x1024x24" blender --factory-startup --enable-event-simulate \
    --python plugins/mesh-kernel/tests/fixtures/gen-knife-interactive-fixtures.py
```

- `knife-bisect/knife-*.json` (10): `bpy.ops.mesh.knife_project` from curve polylines, in orthographic
  and perspective views, with and without cut-through - the line hits, cuts and edge-net split, with
  snapping off. Each carries the view's matrices, region size and the screen polylines.
- `knife-bisect/bisect-*.json` (10): `bpy.ops.mesh.bisect` with a plane: crossing edges, through
  vertices, tilted planes, clear inner/outer, fill (an n-gon cross-section and a cylinder).
- `knife-interactive/iknife-*.json` (16): `mesh.knife_tool` invoked with a context override and fed
  `Window.event_simulate` mouse moves, clicks and modal keys - vertex and edge snapping, midpoints
  (Shift), ignore snap (Ctrl), cut-through (C), segment undo (Ctrl+Z), new cut (RMB), X lock, angle
  snapping (A), a drag cut, a closed loop, points inside a face, a perspective cut over two faces, a
  grid. Each records every event in region pixels and the preference scale the snap distances use.
  The test replays them through Blender's modal keymap into `KnifeTool.modal`; mesh-edit's
  `tests/knife.test.ts` replays them again as DOM input through `KnifeModal`.
- `knife-interactive/ibisect-*.json` (4): `mesh.bisect` invoked without a plane and drawn with the
  straight-line gesture; the plane Blender computed is compared, then the cut.

Two things to know when reading or regenerating them:

- **Blender's vertex order is not stable** between its own runs (it splits edges from pointer-keyed
  maps), so the comparison is order-free: vertices paired by position (1e-4), faces as cyclic
  sequences (winding included), edges as vertex pairs. A regeneration that only reorders vertices
  is noise; keep the committed file.
- **Perspective views use `clip_start = 0.5`**, not Blender's default 0.01. At 0.01 Blender's float32
  pick ray (`ED_view3d_win_to_vector` unprojects NDC z = -0.5, which then lies 0.013 units from the eye)
  carries enough rounding to put a cut point ~5e-4 units (0.03 px) off the cursor ray; the port runs in
  doubles and lands on the ray. Changing only the near plane made that difference disappear, so the
  fixtures avoid comparing against Blender's rounding.

When the cursor ray misses every face, Blender's interactive knife falls back to the GPU selection
buffer (`EDBM_face_find_nearest`). The test stands in for that buffer with ray casts at pixel centres,
searched with mesh-edit's port of Blender's square spiral; several snap cases depend on it.

What these do not cover: measurements (S cycles the mode; nothing is drawn yet), multi-object editing, the camera view, box clipping,
X-ray's projected face fallback, and non-planar n-gons (the port tessellates them with the kernel's ear
clipping instead of `BLI_polyfill`). `issues/open/modelling-tools/kernel-knife-port-gaps.md` lists them.

## Triangle fill

`triangle-fill.json` (34 cases), written by [`gen-triangle-fill-fixtures.py`](./gen-triangle-fill-fixtures.py)
with `bmesh.ops.triangle_fill` and `bmesh.ops.face_attribute_fill` (plain `--background`), checks
`src/ops/scanfill.ts`, `triangleFill.ts` and `faceAttributeFill.ts` in
[`../triangle-fill-parity.test.ts`](../triangle-fill-parity.test.ts): convex and concave loops, holes,
islands, given and computed normals, winding votes from neighbouring faces, dissolve on and off, and
attribute fill flipping a wrongly wound face. 27 cases are compared exactly - face order, first loop,
winding, attributes, `geom.out` order; the dissolve cases and one two-island case order-free, because
Blender reuses freed face slots and 3.4.1 fills islands in a different order from main.
