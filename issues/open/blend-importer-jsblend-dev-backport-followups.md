# Blend importer: backport follow-ups from acweathersby/js.blend@dev audit

**Created:** 2026-06-04
**Status:** Open — deferred items from a full audit of upstream's dev rewrite
**Scope:** `@threepipe/plugin-blend-importer`

## Context

The upstream `acweathersby/js.blend` repo we forked from has an unfinished `dev` branch (TypeScript rewrite). We ran a multi-agent audit comparing it to our vendored parser/loader, producing 11 ranked candidates. This doc tracks the ones we did NOT apply, plus a critical record of what failed in practice.

Audit result available at `tmp/blend-fixtures/` + `tmp/blend-screenshot-harness/out/results.json` showing parse outcomes on 13 real Blender files.

## What we applied

1. **Embedded thumbnail forwarding** (`BlendLoadPlugin.ts:60`) — parser already extracted `FILE.thumbnail` (`parser.js:825-842`); now surfaced as `root.userData.blendThumbnail`. Real test against 13 fixtures: 9/13 carry a 128x128 or 128x70 thumbnail. Pure additive, no risk.

## What we tried and REVERTED — important record

The audit's top two "do_now" recommendations failed in practice. Don't repeat:

### 1. Replacing the 8-NUL-skip heuristic with `align4()` — REVERTED

Audit said: replace `for (let j=0; j<8; j++) { if (data.getInt8(offset)===0) {offset++; continue} break }` + the leftover `debugger;` at `parser.js:797-806` with `offset = (offset+3) & 0xFFFFFFFC` (canonical Blender 4-byte alignment, matches dev/file.ts:470).

What actually happened on a re-run against all 13 fixtures: **5 files regressed to 0 meshes** with `Error: Invalid block length detected`:
- gizmo_array.blend (1m → 0m)
- jiggly_pudding.blend (1m → 0m)
- hexgrid_blender_geometry_nodes_demo.blend (7m 1l 1c → 0m 0l 0c)
- abstract_monkey_geometry-nodes_demo.blend (12m 0l 1c → 0m 0l 0c)
- blender-4.0-splash.blend (262m 1l 1c → 0m 0l 0c)

Conclusion: our parser produces offsets that aren't strictly Blender-canonical, and the NUL-skip is load-bearing for fixing them up. align4 lands in the middle of NUL padding, then reads junk bytes as the next block header. Dev's strict align4 only works because its block-walking is otherwise correct; ours has some upstream miscount the heuristic compensates for.

The right fix is bigger than this — rebuild the block-walker to match dev's BlenderBlock + BlenderBlockIterator (audit rank 6) — and would let align4 land properly. Without that, align4 alone makes things worse. Filed below.

Left a 6-line note in `parser.js:789-796` documenting the failed experiment so future-me doesn't try it again.

### 2. Making `parseBlend` reject on parser error — REVERTED

Audit said: change `if (error) console.error(error); res(file)` to `error ? rej(error) : res(file)`. Surfaces failures cleanly.

What actually happened: the parser sets `ERROR` mid-parse on several real-world files (the geometry-nodes RangeError class), but the partial result still has usable meshes. Rejecting strips them — file loads as 0 meshes instead of 12. User-visible regression: silent partial load → loud total failure.

Left a comment in `main.js:14-19` explaining why we keep the soft-error path.

The reject is the architecturally correct behavior. Re-enable when the parser is hardened enough that ERROR genuinely means "useless result", not "partial result with logs".

## Deferred backports (audit findings 3, 6–11)

### Rank 3: Unify divergent pointer-key formats

`parser.js` has two `getPointer` implementations with different string formats: instance method uses `'l|h'`/`'h|l'` separators (lines 112-124), closure version uses empty string `''` (lines 512-525). Different keys for the same pointer; lookups can silently miss.

Effort: small (unify formats) / medium (full BigInt+Map port matching dev/file.ts). Risk: medium without tests.

### Rank 6: BlenderBlock + BlenderBlockIterator refactor

Factor the three inlined block-walk sites in `readFile()` (`parser.js:649-893`) into a class + iterator matching dev/file.ts:396+. Centralizes offset math; this is the prerequisite that would make align4 actually work.

Effort: medium. Risk: medium without tests. **Highest leverage** but blocked on test infrastructure.

### Rank 7: Per-struct cached property descriptors + NaN-length fix

Replace per-instance `setData` Object.defineProperty walks with cached PropertyDescriptorMap on the struct definition, constructed via Object.create. Also fixes a confirmed NaN-length bug at `parser.js:560-568` where `length` is read from an unset local for fixed-size nested-struct arrays.

Effort: large. Risk: high (touches core object materialization).

### Rank 8: Tighten `main.d.ts` types

Replace `parseBlend(ab): Promise<any>` with a typed `Promise<BlenderFile>` declaring `objects.{Object,Mesh,Material}[]` and named DNA-field interfaces for the structs the loader consumes. Tighten beyond dev's `& any` to actually catch typos in `loader/*.ts`.

Effort: small-medium. Risk: low. Doesn't touch the parser. Could be done independently.

### Rank 9: Re-export `parseBlend` from plugin entry

Add `parseBlend` to `src/index.ts` for non-threepipe consumers (node-side, metadata-only). Optionally a three-free `loadMesh` returning typed arrays.

Effort: small. Risk: low.

### Rank 10: `getObjectById` / `getObjectsByType` helpers

Name → object Map populated in `addObject`. O(1) `getObjectById('OBSuzanne')`. Cannot lift dev's offset-based version verbatim (our parser is eager not lazy), but a Map post-parse is trivial.

Effort: small. Risk: low.

### Rank 11: New-format UV / normal / tangent / vertex-color extraction

Our 4.x mesh path (`loader/geometry.ts:16-212`) only extracts position + index. Per the Blender 4.0 splash output (262 meshes, all flat-shaded sphere fallbacks), real UVs/normals are missing.

Effort: medium-large. Risk: medium. Dev provides ZERO reference — must port from Blender's `io_scene_gltf2/primitive_extract.py`. This is the biggest user-visible quality gap and the most valuable but largest piece of work.

## Foundation: vitest test suite + .blend fixtures (audit rank 5)

Zero parser unit-test coverage today. The 13-fixture screenshot harness in `tmp/blend-screenshot-harness/` is reusable but slow and headless-browser-bound. A Node-side vitest with a handful of small `.blend` fixtures (dev branch ships `test.278.blend` + `test.400.blend` for this) would catch regressions in ~ms.

**This is the prerequisite for safely attempting any of the parser changes above.** Recommend doing this before rank 3, 6, or 7 work.

Effort: small. Risk: low. Reduces risk on everything else.

## Overall assessment of dev branch

Largely a partial reset we mostly don't need. The TS rewrite is incomplete (test files use `test.todo`, `BlendObj` type is `& any`, has a `db`-vs-`dv` typo). Genuine wins are narrow:

1. **Thumbnail extraction** — applied. Free data we were throwing away.
2. **`align4` formula** — looks right on paper, breaks in practice without the BlockIterator refactor.
3. **Reject-on-error semantics** — architecturally correct but practically regresses UX.
4. **Test fixtures + canonical Suzanne assertions** — pure addition, no risk.

Everything else (BlockIterator, BigInt pointer Map, cached SDNA descriptors, getObjectById, tree-shakeable surface, tighter types) is worth filing as follow-ups but not worth blocking on dev — most need adaptation to our eager-materialization parser anyway.

The biggest real gap (new-format UV/normal/tangent/vertex-color extraction) dev does not address at all and must be ported from Blender source.

## References

- Audit script: `~/.claude/projects/.../workflows/scripts/js-blend-dev-audit-wf_*.js`
- Audit transcripts: `~/.claude/projects/.../subagents/workflows/wf_30d618fd-37f/`
- Real-fixture results: `tmp/blend-screenshot-harness/out/results.json`
- Upstream dev branch: `https://github.com/acweathersby/js.blend/tree/dev` (cloned at `.repos/js-blend-dev`)
- Related: [blend-parser-rangeerror-on-geometry-nodes-scenes.md](./blend-parser-rangeerror-on-geometry-nodes-scenes.md) — the bug align4 was supposed to fix.
