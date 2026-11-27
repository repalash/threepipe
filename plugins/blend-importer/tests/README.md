# blend-importer tests

`npm run test:unit:blend-importer` (or `npm run test --prefix plugins/blend-importer`).

These run in plain Node: the `js.blend` parser, `loader/meshData.ts` and the mesh kernel all work
headless, so the tests parse **real `.blend` files** rather than hand-built datablocks. That is
deliberate. A synthetic datablock would encode this repo's understanding of Blender's DNA rather than
test it, and every bug found while writing these tests was a disagreement with a real file.

## Getting the `.blend` corpus

The files are not in the repo - they run to hundreds of megabytes. Put them in `tmp/blend-fixtures/`
at the repo root, or point `BLEND_FIXTURES_DIR` at wherever they already are:

```sh
BLEND_FIXTURES_DIR=/path/to/blend-files npm run test:unit:blend-importer
```

`tests/fixtures.ts` walks up from this package looking for `tmp/blend-fixtures`, so a git worktree
finds the main checkout's copy without any configuration.

**Every test skips when the corpus is missing**, and says so in the run. Nothing silently passes, but
nothing here protects you either - if you are changing the importer, get the files.

The files currently used, all of them ordinary Blender saves:

| file | Blender | layout | why |
| --- | --- | --- | --- |
| `blend-load-test-prim-cube.blend` | 4.3 | `CustomData` | the smallest quad mesh with a UV seam |
| `blend-load-test-prim-cube-tri.blend` | 4.3 | `CustomData` | the same cube triangulated |
| `blend-load-poly-test.blend` | 4.3 | `CustomData` | n-gons of 3, 4, 8, 12 and 22 sides, four of them concave |
| `blend-load-test-prim.blend` | 4.3 | `CustomData` | a 482-vertex UV sphere: mixed face sizes, 32-valence poles |
| `blender-5.0.0-startup.blend` | 5.0 | `attribute_storage` | the only layout where attributes are not `CustomData` |
| `curve_bevel_profile.blend` | 2.91 | `MPoly`/`MLoop` | the pre-3.6 layout, which is still most of the corpus |

## Ground truth

The parity assertions compare against `plugins/mesh-kernel/tests/fixtures/*.json`, which were
extracted from the same `.blend` files by `extract-blend-fixture.mjs` reading the DNA blocks directly.
Nothing in them is derived or hand-written - see that folder's `README.md`. Sharing them means the
importer and the kernel are checked against one description of what Blender wrote, not two.

The parity test's discriminating power was checked by mutating the importer and confirming failures,
not assumed:

| mutation | result |
| --- | --- |
| `calculateEdges()` instead of the authored `.edge_verts` / `.corner_edge` | 4 parity tests fail |
| skip the Blender Z-up -> three Y-up rotation | 4 parity tests fail |
| weld per-corner UVs to one per vertex ("last write wins", what the importer used to do) | 5 tests fail |

The concave-n-gon test carries its own discriminator: it asserts that a first-corner fan - the old
triangulation - *does* produce at least one inverted triangle on that fixture, so the surrounding
"ear clipping produces none" assertion is evidence rather than a tautology.
