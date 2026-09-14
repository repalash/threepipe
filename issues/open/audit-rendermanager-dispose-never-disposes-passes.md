# RenderManager.dispose: never disposes registered passes (material + fullscreen-quad GPU leak)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`RenderManager.dispose()` only disposes tracked render targets (via `super.dispose`) and the renderer. It never iterates `this._passes` to call `pass.dispose()`, so every registered pass's GPU resources (ShaderMaterials + fullscreen quads) leak on viewer/renderManager teardown.

## Root Cause
```ts
dispose(clear = true): void {
    super.dispose(clear)       // RenderTargetManager.dispose — only disposes tracked targets
    this._renderer.dispose()
}
```
`super.dispose` (`RenderTargetManager.dispose`) only disposes `_trackedTargets`/`_trackedTempTargets`. Neither method touches `this._passes`. `ViewerRenderManager` registers `renderPass` (ExtendedRenderPass) and `screenPass` (ScreenPass), and plugins register their own passes — each owning materials and fsQuads. On viewer `dispose()`, `this.renderManager.dispose(clear)` is called but none of these pass-owned materials/quads are released.

## Impact
GPU program/material/geometry leak for every registered pass on each viewer/renderManager teardown (ExtendedRenderPass's `_blendPass` and preserved temp targets, ScreenPass/ExtendedShaderPass materials + fsQuads, plugin passes).

## Fix
In `RenderManager.dispose()`, iterate `this._passes` (or `this._composer.passes`) calling `pass.dispose?.()` before/after clearing targets. (See also `audit-rendermanager-composer-copypasses-not-disposed.md` for the related composer copyPass leak, and `audit-extendedrenderpass-dispose-leaks-opaque-and-blendpass.md` for ExtendedRenderPass's own omissions.)

## Files
- `src/rendering/RenderManager.ts:323-326` — dispose disposes targets + renderer only, never passes
- `src/viewer/ViewerRenderManager.ts:71-72` — registers `renderPass` and `screenPass`

See `audit-rendermanager-composer-copypasses-not-disposed.md`, `audit-extendedrenderpass-dispose-leaks-opaque-and-blendpass.md`.
