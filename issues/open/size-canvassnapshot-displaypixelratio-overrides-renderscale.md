# CanvasSnapshotPlugin.defaultOptions.displayPixelRatio silently overwrites renderScale — exports ignore setRenderSize

**Severity:** high
**Found:** 2026-08-11 external size-issues report (share.ijewel.info/threepipe-size-issues), verified against source at `0641fb7`

## Bug
`defaultOptions` includes `displayPixelRatio: window.devicePixelRatio` (`src/plugins/export/CanvasSnapshotPlugin.ts:177`). `downloadSnapshot` merges `{...this.defaultOptions, ...options}` (L203), and `_getFile` applies it: `viewer.renderManager.renderScale = options.displayPixelRatio` (L69-72, restored at L143).

So every `downloadSnapshot()` call that doesn't explicitly pass `displayPixelRatio` replaces the `renderScale` that `setRenderSize` computed, for the duration of the capture. The "only override if specified" guard at L70 never protects a caller-computed `renderScale` because the default is always non-undefined.

## Proof
The committed baseline `tests/snapshots/chromium-linux/canvas-snapshot-plugin/dl-snapshot-1024.png` (and the `chromium-darwin` twin) is **720×720** for an export the example explicitly requests at **1024×1024**. Test viewport 1280×720 → `contain` gives renderHeight 720 → renderScale ≈ 1.422 → the plugin resets it to `window.devicePixelRatio` (1 in headless) → 720×720. The test suite has recorded the wrong output as expected because `downloadFileMatch` (`tests/helpers.ts:218-278`) only checks the filename and `toMatchSnapshot` — no dimension assertion (`tests/interactive.spec.ts:351`).

The repo's own documented recipe hits it: `examples/canvas-snapshot-plugin/script.ts:44-48` calls `setRenderSize({width: 1024, height: 1024})` then `downloadSnapshot('snapshot.png', {mimeType: 'image/png'})` with no `displayPixelRatio` — the only size-sensitive button in the example, and the only one exercising the default path.

## Additional problems in the same flow
- `ThreeViewer.getScreenshotBlob` (`src/viewer/ThreeViewer.ts:712-716`) calls `plugin.getFile(...)` directly and does NOT apply `defaultOptions` — the two public entry points disagree on sizing behavior. (Adjacent bug: it passes `quality = 90` straight through where `toBlob` expects 0–1.)
- `displayPixelRatio` has two meanings in one options object: "renderScale to apply" in the plugin, then it is deleted (L101) because in `CanvasSnapshot` (`src/utils/canvas-snapshot.ts`) the same key means "clone/crop scale factor". Direct `CanvasSnapshot` callers hit the second meaning (see `size-canvas-snapshot-crop-tiling-rounding.md`). The delete also flips `doClone` (canvas-snapshot.ts L131/L152) since the key is now undefined.
- L138 writes `options.displayPixelRatio = viewer.renderManager.renderScale` back onto the options object after capture. Every public entry point spreads a fresh object (L51, L59, L203), so callers never observe this write — dead code today, and a state-leak trap for any future path passing an options object through directly. (It also writes the *pre-restore* scale, so it would be wrong even if observable.)
- There is no `{width, height}` export option at all (`CanvasSnapshotOptions`, `src/utils/canvas-snapshot.ts:20-31`; `CanvasSnapshotPluginOptions`, plugin L8-33); output size is whatever the buffer happens to be. The only route to a target pixel size is the `setRenderSize` + `renderScale` dance — the exact path this bug breaks.

## Fix
Drop `displayPixelRatio` from `defaultOptions` (undefined = keep current renderScale); never mutate the caller's options; add explicit `width`/`height` snapshot options that set an exact buffer size for the capture and restore after, in a `finally` (see also `audit-canvassnapshot-getfile-no-finally-leaves-state-broken.md`); add a test that asserts exported PNG dimensions against the request, and re-record the wrong 720×720 baselines.

## Files
- `src/plugins/export/CanvasSnapshotPlugin.ts:177,203,69-72,101,138,143`
- `src/viewer/ThreeViewer.ts:712-716` — `getScreenshotBlob` bypasses defaults; quality 0–100 vs 0–1
- `examples/canvas-snapshot-plugin/script.ts:44-48` — documented recipe defeated by the default
- `tests/interactive.spec.ts:351`, `tests/helpers.ts:218-278` — no dimension assertion; wrong baseline baked in

## Related
- `size-setrendersize-css-roundtrip-pixel-loss.md`
- `size-canvas-snapshot-crop-tiling-rounding.md`
- `audit-canvassnapshot-getfile-no-finally-leaves-state-broken.md`
