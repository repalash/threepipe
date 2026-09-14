# canvas-snapshot crop/tiling rounding: tiles drop pixel columns, normalized rects double-apply displayPixelRatio, crop example crops wrong region

**Severity:** medium
**Found:** 2026-08-11 external size-issues report (share.ijewel.info/threepipe-size-issues), verified against source at `0641fb7`

All in `src/utils/canvas-snapshot.ts` unless noted.

## 1. Tiling loses the division remainder (L189-192)
`GetTiledFiles` computes tile rects as `width: rect.width / tileCols` with no remainder handling, then each tile is floored independently (L63-66). Both plugin paths always pass normalized `{i/cols, j/rows, 1/cols, 1/rows}` rects (plugin `defaultOptions.rect` at `CanvasSnapshotPlugin.ts:184-191`, or the L178 default).

With 3×3 tiles on a 2500 px buffer: each tile is `floor(0.3333… × 2500) = 833`, origins 0/833/1666 — coverage 2499 px; the last pixel column is never exported and a reassembled mosaic is 2499, not 2500. On a 2498 buffer: `floor(832.67) = 832`, 3×832 = 2496 — 2 px lost.

**Fix:** per-tile edges from `Math.round((i+1)*W/n) - Math.round(i*W/n)`.

## 2. Normalized rects double-apply displayPixelRatio (L62-66 then L107-111)
For a normalized rect, L63-66 already convert to buffer pixels (`* canvas.width`); L109 then multiplies by `displayPixelRatio` again in the `drawImage` source rect. With `displayPixelRatio: 2` and normalized `{0, 0, 1/3, 1}` on a 2500 buffer: source width becomes `floor(833×2) = 1666` instead of 833 — and tile1/tile2 source x becomes 1666/3332, entirely outside the buffer. The `*displayPixelRatio` at L109 is only coherent for the untouched (non-normalized, non-client) branch.

Masked when called via `CanvasSnapshotPlugin` (which does `delete options.displayPixelRatio` at L101 before calling), but `CanvasSnapshot` is public API (`src/utils/index.ts:14`) — direct `GetFile`/`GetBlob`/`GetDataUrl` callers hit it unmasked. The same double-apply propagates to the default full-canvas rect (L42) and the background-image path (L93-99).

## 3. Client-space rects floor twice (L56-61 then L109)
`floor(w_css × bufW/(dpr × clientW))` then `floor(result × dpr)` — the first floor truncates in pre-dpr units, so up to 1 unit lost there becomes up to `dpr` device pixels, plus up to 1 more from the second floor. Example: dpr 2, clientW 800, bufW 2498, w_css 400 → `floor(400 × 2498/1600) = 624` → `floor(624×2) = 1248` vs the exact 1249.

**Example bug (verified, worse than a rounding issue):** `examples/canvas-snapshot-plugin/script.ts:55-69` builds its crop rect from client-space values (`clientWidth / 2` etc.) but sets neither `assumeClientRect: true` nor `normalized` — so the rect skips both conversion branches and is used as **raw buffer pixels**. With the button's `displayPixelRatio: 2` making `canvas.width ≈ clientWidth × 2`, the export crops a **quarter-width region at 12.5% offset** instead of the intended centered half. The example needs `assumeClientRect: true`.

## 4. Destination floors fractional products (L72-73)
`destCanvas.width = Math.floor(rect.width * scale * displayPixelRatio)` — with `scale: 0.4` on a 2498 buffer: `floor(999.2) = 999`. Round at the API boundary instead, and compute the destination from a single rounding of the final product, not from pre-floored intermediates.

## 5. Background-image source rect floors four fractional products (L93-99)
Four independent `Math.floor` calls on products scaled by `img.width / canvas.width` — the background can be sampled up to ~1 px short/shifted per edge relative to the foreground blit (which floors in a different space), a visible seam on crops.

## Files
- `src/utils/canvas-snapshot.ts:42,56-66,72-73,93-99,107-111,177-205`
- `src/plugins/export/CanvasSnapshotPlugin.ts:101,184-191`
- `examples/canvas-snapshot-plugin/script.ts:55-69` — missing `assumeClientRect: true`

## Related
- `size-canvassnapshot-displaypixelratio-overrides-renderscale.md` (the dual meaning of `displayPixelRatio` that makes L101's delete necessary)
- `size-setrendersize-css-roundtrip-pixel-loss.md` (source of the odd 2498 buffers)
