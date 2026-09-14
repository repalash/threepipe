# Size hygiene: fractional sizeMultiplier target drift, resize epsilon guard skips real changes, odd buffer sizes break H.264 recording

**Severity:** low
**Found:** 2026-08-11 external size-issues report (share.ijewel.info/threepipe-size-issues), verified against source at `0641fb7`

Three smaller, related size defects:

## 1. Fractional sizeMultiplier targets drift from their nominal ratio (`src/rendering/RenderTargetManager.ts:71-73, 165-171`)
Both target creation and `resizeTrackedTarget` compute `floor(renderSize × renderScale × multiplier)` from the unfloored product, independently of the canvas floor. With a 2498 buffer (800 × 3.123712) and multiplier 0.75: `floor(800 × 3.123712 × 0.75) = 1874`, but `2498 × 0.75 = 1873.5` — the AO target ratio becomes 0.7502, so UVs are offset up to a pixel at the far edge. Multiplier 1 is consistent with the canvas by construction (both floor the same product); only fractional multipliers drift. SSAOPlugin documents 0.75/0.5/0.25 (`src/plugins/pipeline/SSAOPlugin.ts:155-159`, passed through at L196-200).

**Fix:** derive scaled targets from the floored buffer size, not from the unfloored product.

## 2. The 0.1-px resize epsilon can skip a real buffer change (`src/rendering/RenderManager.ts:213-220`)
`_renderSize` can hold fractional values: `setSize` is public and does not round its inputs (the viewer's own resize path floors first, `src/viewer/ThreeViewer.ts:823`, but other callers need not — and `ThreeViewer.setRenderSize` passes unfloored values at L1196, though that path only sets CSS). A sub-0.1 logical delta is skipped, but at renderScale 3+ that is ~0.3 device px and can cross a floor boundary — the buffer stays stale. Also `width === 0` is falsy in both the guard sum and the assignment (`if (width)`), so a hidden canvas (`clientWidth/Height = 0`) silently keeps its old buffer with no resize event.

## 3. Nothing keeps buffer dimensions even for video capture
`floor(clientW × fractional renderScale)` is freely odd — e.g. request 2500×2500 at dpr 2 in an 800.33 px container → `floor(800 × 6.2474) = 4997`. `canvas.captureStream()` + MediaRecorder with H.264 (yuv420p generally) needs even width and height; an external recorder fed this canvas fails or gets silently rescaled/cropped per browser. An even-dimension option (round the request, not the output) would fix this at the source. No `% 2`/rounding-to-even exists anywhere in the sizing code.

No recorder ships in-repo today, and the converge-pacing hook one would need is dead: `ProgressivePlugin.postFrameConvergedRecordingDelta` (`src/plugins/pipeline/ProgressivePlugin.ts:139-144`) is stubbed to return -1 with the real logic commented out (`IConvergedCanvasRecorder` exists nowhere else); consumers (`PopmotionPlugin.ts:93`, `GLTFAnimationPlugin.ts:469`, `ViewerTimeline.ts:137`, `ThreeViewer.ts:524`) all treat -1 as "not recording".

## Files
- `src/rendering/RenderTargetManager.ts:71-73,165-171`
- `src/rendering/RenderManager.ts:213-220`
- `src/plugins/pipeline/SSAOPlugin.ts:155-159,196-200`
- `src/plugins/pipeline/ProgressivePlugin.ts:139-144`

## Related
- `size-setrendersize-css-roundtrip-pixel-loss.md` (source of fractional renderScale and odd buffers)
- `size-no-single-render-size-authority.md`
