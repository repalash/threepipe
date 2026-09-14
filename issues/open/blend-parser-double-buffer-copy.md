# Blend parser: redundant `_data.slice()` doubles peak memory

**Created:** 2026-06-04
**Status:** Open — pre-existing perf issue, now more impactful
**Scope:** `@threepipe/plugin-blend-importer` (`src/js-blend/parser/parser.js`)

## Symptom

`parser.js:72` does `AB = _data.slice();` then `data = new DataView(_data);` — every parse makes a full copy of the input ArrayBuffer into `AB` while also keeping `_data`. The slice is then used as the source for typed-array views into the parsed structures (`block.__blender_file__.AB`).

For a 500 MB decompressed blend, the parser allocates an additional 500 MB at the start of parse. Combined with the decompressor's own output and the `decompressBlend` short-circuit (post-fix-#1) holding the decoded buffer, peak memory during parse can reach ~3× the file size.

## Why pre-existing

The slice predates the compression-support change — it was always there for uncompressed loads too. But pre-change, uncompressed loads were the only path, so the issue was always present and uniform. Post-change, gzip/zstd loads also pay this cost on the (much larger) decompressed buffer.

## Why the slice exists

Looking at the code, `AB` is referenced from `block.__blender_file__.AB` and used as the source for `new Int32Array(block.__blender_file__.AB, address, length)` etc. The `_data` DataView is only used during parsing. So `AB` and `_data` could share the same underlying buffer — the `.slice()` is defensive (against later writes? against parser detach?) but not strictly necessary.

## Options

1. **Drop the slice** — alias `AB = _data` (or omit `AB` entirely and use `_data.buffer` for typed-array constructions). Requires confirming nothing mutates the buffer.
2. **Accept Uint8Array directly** — change `parseBlend(buffer)` signature to also accept `Uint8Array`, internally derive a DataView, share the backing buffer with `AB`. Most invasive but most efficient.
3. **Leave it** — slice is cheap relative to the parse itself (parsing dominates wall-clock for large blends). Memory is the only real cost.

## Why not now

The slice is in vendored parser code (fork of js.blend). Touching it risks breaking the parser in subtle ways that aren't covered by tests. Worth a dedicated PR with a real Blender file fixture and round-trip vertex-count assertion before/after.

## References

- `plugins/blend-importer/src/js-blend/parser/parser.js:72` — the slice.
- `plugins/blend-importer/src/js-blend/parser/parser.js` lines that reference `__blender_file__.AB` for typed-array constructions.
- Decompressor side: `plugins/blend-importer/src/decompress.ts:33-34` (now short-circuits `u8.buffer` when full-span, so the parser's slice is the dominant remaining waste).
