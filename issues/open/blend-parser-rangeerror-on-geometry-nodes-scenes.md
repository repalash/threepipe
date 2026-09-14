# Blend parser: `RangeError` on heavy geometry-nodes scenes

**Created:** 2026-06-04
**Status:** Partially mitigated 2026-06-05 — crash fixed, missing-DNA1 root cause still open
**Scope:** `@threepipe/plugin-blend-importer` (`src/js-blend/parser/parser.js`)

## Partial mitigation (2026-06-05)

Added a bounds guard to the SDNA-search loop (`parser.js:649-654`) matching the pattern already used in the main block loop. The guard catches the case where `offset2` walks past EOF before finding `DNA1` and softly sets `ERROR` instead of throwing.

Before: unhandled `RangeError` from `DataView.getInt32` kills the entire `viewer.load(...)` promise.
After: `parseBlend` resolves softly with a near-empty result; the viewer ends up with an empty scene instead of an error.

Affected files (verified at `tmp/blend-screenshot-harness/`):
- `mandelbrot_grow.blend` (Blender 4.5)
- `repeat_zone_fractal_raymarch.blend` (Blender 4.3)
- (Previously also `blender-4.0-splash.blend` per the first observation, but that one always reached the parser and produced 262 meshes — it's the `loader/geometry.ts:194` no-indices warning, not this crash.)

The underlying parser bug is still open — why DNA1 is unreachable in these files. That's a deeper issue in the block-walking arithmetic (probably the same one that made the dev-branch `align4` regress 5 files), unblocked by the BlockIterator refactor in `blend-importer-jsblend-dev-backport-followups.md` rank 6.

## Original symptom

When loading certain Blender geometry-nodes-heavy `.blend` files, the parser throws inside `readFile` at `parser.js:445`:

```
RangeError: Offset is outside the bounds of the DataView
    at DataView.prototype.getInt32 (<anonymous>)
    at readFile (parser.js:445)
    at parseFile (parser.js:38)
```

The parser recovers (the throw is swallowed somewhere upstream — possibly the worker callback path) and `loadAsync` resolves with an empty-ish scene. Mesh count comes back as 0.

## Verified affected files

Tested via the end-to-end harness at `tmp/blend-screenshot-harness/`:

- `download.blender.org/demo/eevee/mandelbrot_grow.blend` (Blender 4.5, zstd)
- `download.blender.org/demo/rendering/repeat_zone_fractal_raymarch.blend` (Blender 4.3, zstd)
- `download.blender.org/demo/splash/blender-4.0-splash.blend` (Blender 4.0, zstd, 33 MB)

All three are heavy geometry-nodes / procedural scenes.

## Not surfaced by this diff

Pre-existing. The compression-support change merely enabled loading these files for the first time. Before, the parser bailed at the missing `BLENDER` magic before reaching the bug.

## Likely cause

`parser.js:445` is inside the block-iteration loop. The `getInt32` call reads a structure header at an offset computed from a previous SDNA lookup. The RangeError means the offset is past end-of-buffer — likely the parser is mis-handling a block type introduced in newer Blender versions (geometry-nodes data, procedural cache), trying to read into space that doesn't exist.

Worth investigating by:
1. Logging the offending block type / SDNA index just before the failing `getInt32`.
2. Cross-referencing with Blender's own DNA struct definitions for that version.
3. Adding a length-guard so the parser skips unknown blocks gracefully instead of throwing.

## Also seen

Several files trigger `loader/geometry.ts:194` `BlendLoader - no indices data found, but face indices are present` — same root cause family (procedural geometry, no static vertex data in the file).

## References

- `plugins/blend-importer/src/js-blend/parser/parser.js:445` — failing read.
- `plugins/blend-importer/src/loader/geometry.ts:194` — related no-indices warning.
- `tmp/blend-screenshot-harness/out/results.json` — full per-file test results.
