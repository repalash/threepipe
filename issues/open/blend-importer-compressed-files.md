# Blend importer: support gzip + zstd compressed `.blend` files

**Created:** 2026-05-14
**Status:** Implemented on dev — verification pending real fixture
**Scope:** `@threepipe/plugin-blend-importer` only

## Context

`.blend` files can be saved compressed. Blender's writer behaviour:
- Pre-3.0: gzip (when "Compress" save option was on).
- 3.0+: zstd, seekable format, level 3, 1 MiB chunks. Default save preference was flipped to compress=on in newer versions (`source/blender/blenloader/intern/versioning_userdef.cc:1714`).

Until now `plugins/blend-importer/src/js-blend/parser/parser.js:614` had a TODO and the loader bailed out on any file whose first 7 bytes weren't the `BLENDER` literal.

## Detection (ported from Blender source)

Reference: `source/blender/blenloader_core/intern/blo_core_file_reader.cc:36` `BLO_file_reader_uncompressed`. Order of checks:

1. First 7 bytes == `BLENDER` → uncompressed.
2. gzip magic — `header[0]==0x1f && header[1]==0x8b && header[2]==0x08` (`source/blender/blenlib/intern/fileops_c.cc:259` `BLI_file_magic_is_gzip`).
3. zstd magic — first 4 bytes LE u32 == `0xFD2FB528` (regular zstd frame) **or** `(u32 >> 4) == 0x184D2A5` (skippable frame; matches `0x184D2A50..5F`) (`fileops_c.cc:266` `BLI_file_magic_is_zstd`).
4. Else: not a `.blend`.

Blender 3.0+ saves wrap the compressed payload in zstd's seekable format — concatenated regular frames + a trailing **skippable frame** holding the seek table (`writefile.cc:342-365`). Standard streaming zstd decoders see the skippable-frame magic, read the 4-byte length field, and skip exactly that many bytes — no decoded output. Both Blender's own fallback streaming reader (`filereader_zstd.cc:247-276`) and fzstd handle this correctly.

## Implementation

New file `plugins/blend-importer/src/decompress.ts`:
- `detectBlendCompression(u8: Uint8Array): 'none' | 'gzip' | 'zstd' | 'unknown'`
- `decompressBlend(buf: ArrayBuffer): ArrayBuffer` — dispatches to:
  - `none` → return as-is
  - `gzip` → `gunzipSync` imported from `threepipe` (re-exported from fflate via `src/three/addons.ts:17`)
  - `zstd` → `decompress` from `fzstd`
  - `unknown` → throws with the offending magic bytes in hex

Edits:
- `plugins/blend-importer/src/BlendLoadPlugin.ts:36-37` — call `decompressBlend(res)` between `FileLoader.loadAsync` and `parseBlend`.
- `plugins/blend-importer/src/js-blend/parser/parser.js:614` — TODO removed; replaced with a one-line note pointing at `BlendLoadPlugin`.
- `plugins/blend-importer/package.json` — adds `"fzstd": "^0.1.1"` as a regular dependency (bundled into both ESM and UMD outputs).
- `plugins/blend-importer/CHANGELOG.md`, `README.md` — added entries.

## Library choice

- **gzip**: `gunzipSync` from fflate (already in threepipe via three's bundled `fflate.module.js`). Zero new dependency. Chosen over `decompressSync` because we already detect the gzip magic ourselves; `gunzipSync` skips the redundant dispatch, reads the gzip footer to pre-allocate the exact output buffer, and lets rollup tree-shake `inflateSync` / `unzlibSync` from our bundle.
- **zstd**: `fzstd@^0.1.1`. Pure-JS, ~3.8 KB gzipped, MIT, dual CJS+ESM, ships types. Skippable frames handled correctly (source masks `magic>>4` to match all `0x184D2A50..5F` and advances by `size+8`).

Considered alternatives, ruled out:
- `decompressSync` (auto-detecting fflate): unnecessary indirection; bundles more code.
- WASM zstd (`zstddec`, `@oneidentity/zstd-js`): faster on large files, but adds WASM-lazy-load complexity that requires the DRACOLoader2 pattern. fzstd is small enough for the common `.blend` size range (< 50 MB).
- Setter pattern (`SetZstdDecompressor`): would have kept the plugin zero-dep but required a 2-line opt-in for every user. The current "bundle always" approach trades ~4 KB gzipped for zero-config zstd.
- Dual-build ESM/UMD with fzstd external for ESM only: dropped for simplicity per user preference; `simple` won over `lean`.

## Bundle size impact

Before:
- `dist/index.mjs`: 36.6 KB raw / 7.9 KB gzipped
- `dist/index.js`: 39.1 KB raw / 8.1 KB gzipped

After (with fzstd inlined into both):
- `dist/index.mjs`: 52.8 KB raw / 12.6 KB gzipped
- `dist/index.js`: 56.6 KB raw / 12.9 KB gzipped

Net delta: +~5 KB gzipped per format.

## Verification

Done:
- `npm run build` succeeds (TS errors visible are pre-existing in core threepipe `PolyhavenMaterialGLTFLoader.ts`, not introduced by this change).
- Decompress logic smoke-tested: magic detection across all cases (uncompressed / gzip / zstd / zstd-skippable / unknown / too-short) — all pass. gzip round-trip with node's `zlib.gzipSync` against fflate's `gunzipSync` — round-trips bit-exact.
- **End-to-end test against 13 real Blender Foundation demo files** (Blender 1.69 through 4.0, downloaded from `download.blender.org/demo/`):

| Blender version | Compression | Files tested | Result |
|---|---|---|---|
| 1.69, 1.70 | uncompressed (`BLENDER` magic at offset 0) | 2 | ✓ all parse |
| 2.82, 2.83, 2.91, 2.93 | gzip | 4 | ✓ all decompress + parse |
| 3.06, 4.03, 4.5 (splash + 3.5 splash) | zstd seekable format | 7 | ✓ all decompress + parse |

All 13 files loaded successfully through `BlendLoadPlugin` in a real headless browser (system Chromium on Alpine, ANGLE/Mesa). Parse times 7-1957 ms; largest file was `blender-4.0-splash.blend` at 33 MB compressed (parsed 262 meshes in 1.9 s). Visual screenshots in `tmp/blend-screenshot-harness/out/` confirm geometry renders correctly for non-procedural scenes.

**Key finding**: the gzip→zstd cutover in Blender's writer happened **between v2.93 and v3.06**, not at v3.0 as widely reported. The cutoff point can be confirmed against Blender's release notes for 3.0.

Fzstd handles Blender's zstd-seekable-format trailing skippable frame correctly in practice (was the audit's biggest open question). Confirmed across 7 zstd-compressed real Blender files spanning v3.06 through v4.5.

Harness retained at `tmp/blend-screenshot-harness/` (excluded by `.gitignore`):
- `index.html` — minimal viewer that reads `?file=` from query.
- `run.mjs` — node script that drives playwright across all fixtures, captures screenshots, reports per-file load time + mesh/light/camera count.

### Pre-existing parser issues surfaced (not from this diff)

- `parser.js:445` throws `RangeError: Offset is outside the bounds of the DataView` on some files (`mandelbrot_grow.blend`, `repeat_zone_fractal_raymarch.blend`) — heavy geometry-nodes scenes. The parser recovers; mesh count comes back as 0. Worth filing as a separate issue.
- `loader/geometry.ts:194` `BlendLoader - no indices data found, but face indices are present` on several files. Same pattern — geometry-nodes scenes where vertex data is computed at render-time, not stored in the file.

These are limitations of the existing parser, exposed now that we can actually open the files. Out of scope for this PR.

## Follow-up issues filed from review

- [blend-importer-sync-decompress-blocks-main-thread.md](./blend-importer-sync-decompress-blocks-main-thread.md) — sync decode on main thread for large files.
- [blend-importer-unknown-magic-throws-vs-parser-soft-error.md](./blend-importer-unknown-magic-throws-vs-parser-soft-error.md) — behavior change: now rejects instead of soft-erroring.
- [blend-parser-double-buffer-copy.md](./blend-parser-double-buffer-copy.md) — parser's `_data.slice()` allocates a second copy of the decompressed payload.
- [iloader-preprocess-hook-for-compressed-formats.md](./iloader-preprocess-hook-for-compressed-formats.md) — architectural follow-up for when a second compressed-format loader lands.
- [blend-parser-rangeerror-on-geometry-nodes-scenes.md](./blend-parser-rangeerror-on-geometry-nodes-scenes.md) — parser throws on heavy geometry-nodes files; surfaced now that we can open them.
- [blend-importer-jsblend-dev-backport-followups.md](./blend-importer-jsblend-dev-backport-followups.md) — deferred items from the acweathersby/js.blend@dev audit, including a record of two backports that failed in practice.

## References

- Blender source (sparse clone at `.repos/blender/`):
  - `source/blender/blenloader_core/intern/blo_core_file_reader.cc:36` — detection
  - `source/blender/blenlib/intern/fileops_c.cc:259,266` — magic checks
  - `source/blender/blenloader/intern/writefile.cc:163-166, 342-365` — zstd writer + seekable framing
  - `source/blender/blenlib/intern/filereader_gzip.cc:82` — `inflateInit2(16+MAX_WBITS)`
  - `source/blender/blenlib/intern/filereader_zstd.cc:247-276,299` — streaming + seekable readers
- zstd seekable format spec: https://github.com/facebook/zstd/blob/master/contrib/seekable_format/zstd_seekable_compression_format.md
- fzstd source (skippable-frame handling): https://github.com/101arrowz/fzstd/blob/master/src/index.ts
- Threepipe re-export of fflate: `src/index.ts:3` → `src/three/addons.ts:17`
