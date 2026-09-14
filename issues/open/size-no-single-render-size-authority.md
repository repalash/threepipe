# Render size has no single authority: SSAA jitter, camera aspect, and shader screenSize each use a different size source

**Severity:** medium
**Found:** 2026-08-11 external size-issues report (share.ijewel.info/threepipe-size-issues), verified against source at `0641fb7`

Once `renderScale` is fractional (any `setRenderSize` fit, or the 0.05-step Render Scale slider), the DOM box, the logical size, and the drawing buffer all differ. Subsystems pick different sources:

## 1. SSAA jitter uses an unfloored size (`src/plugins/pipeline/SSAAPlugin.ts:124-127`)
```ts
width: v.renderManager.renderSize.x * v.renderManager.renderScale,  // no floor
```
feeds `camera.setViewOffset(...)` (L108) while the real buffer is floored in all three places that create it (`RenderTargetManager.ts:71-73,168-169`; three's `canvas.width = Math.floor(width * pixelRatio)`). E.g. 800 × 3.123712 = 2498.97 used vs 2498 real — jitter offsets (and, for non-square sizes, the aspect `setViewOffset` derives) are computed for a frame that does not exist. Small (~0.04%) but systematic, and exists exactly in the high-renderScale export path. Should floor to match three's canvas floor.

Related: L106-107 derives the jitter frame height for manual-aspect main cameras from `camera.aspect` (`size.width / aspect`), entirely decoupled from the actual buffer height — the vertical jitter step is wrong by the ratio of user aspect to buffer aspect.

## 2. Camera auto-aspect reads the DOM (`src/core/object/iCameraCommons.ts:102-113`)
`refreshAspect` uses `this._canvas.clientWidth / this._canvas.clientHeight` — rounded CSS integers — while the buffer aspect is `floor(cssW×s) / floor(cssH×s)`. CSS 1237×696 at renderScale 1.15 → camera aspect 1.77729 vs buffer 1.77750: sub-pixel stretch that grows with fractional scales. The refresh is already triggered from the renderManager resize event (`src/viewer/ThreeViewer.ts:589`), so it should read the render/buffer size from the renderManager instead of the DOM.

## 3. ExtendedShaderMaterial screenSize is inconsistent between its two branches (`src/core/material/ExtendedShaderMaterial.ts:52`)
```ts
this._setUniformTexSize(this.uniforms.screenSize, renderer.getRenderTarget() ?? renderer.getSize(new Vector2()))
```
- Target bound → target size in **device pixels** (`floor(renderSize × renderScale × sizeMultiplier)`).
- Canvas bound → three's `getSize` returns the **logical** size (not multiplied by pixelRatio; `getDrawingBufferSize` is the one that multiplies).

Same uniform, off by `renderScale` between branches. Additionally, when a *downscaled* target is bound (e.g. SSAO at `sizeMultiplier` 0.5), `screenSize` is the half-res target size, not the screen size. Consumer impact: `SSAOPlugin.pass.glsl:63` divides a pixel offset by `screenSize` — a 2× wrong value directly doubles the AO sampling radius in UV space.

## Fix
One authority — the drawing-buffer size (or floored `renderSize × renderScale`, which equals it) — consumed by jitter, aspect, and the canvas-branch screenSize; DOM boxes only for pointer input.

## Files
- `src/plugins/pipeline/SSAAPlugin.ts:106-108,124-127`
- `src/core/object/iCameraCommons.ts:102-113`; trigger at `src/viewer/ThreeViewer.ts:589`
- `src/core/material/ExtendedShaderMaterial.ts:52`; consumer `src/plugins/pipeline/shaders/SSAOPlugin.pass.glsl:63`

## Related
- `size-setrendersize-css-roundtrip-pixel-loss.md` (why renderScale becomes fractional)
- `size-hygiene-sizemultiplier-epsilon-odd-buffers.md` (sizeMultiplier targets floor a different product)
