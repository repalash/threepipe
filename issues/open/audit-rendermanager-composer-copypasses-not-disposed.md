# RenderManager.dispose: composer copy passes (`copyPass`, `copyPass2`) never disposed

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`RenderManager.dispose()` never calls `this._composer.dispose()`, so the composer's copy passes leak. The base three.js `EffectComposer.dispose()` would dispose `copyPass`, and `EffectComposer2` additionally owns `copyPass2 = new ExtendedCopyPass()` — neither is ever disposed, leaking their GPU programs/geometry on every viewer/renderManager teardown.

## Root Cause
```ts
dispose(clear = true): void {
    super.dispose(clear)       // disposes tracked render targets only
    this._renderer.dispose()
    // _composer.dispose() never called
}
```
`EffectComposer2`:
```ts
export class EffectComposer2 extends EffectComposer {
    copyPass2 = new ExtendedCopyPass()
    // no dispose() override
}
```
A grep confirms `_composer.dispose()` / `copyPass2.dispose()` are never called anywhere in `src`. (The composer's two render targets ARE freed because they're tracked; only the copy passes' materials/quads leak.)

## Impact
`copyPass` (three.js ShaderPass: ShaderMaterial + fsQuad) and `copyPass2` (ExtendedCopyPass material + fsQuad) leak their GPU programs/geometry on every teardown.

## Fix
Call `this._composer.dispose()` and `this._composer.copyPass2.dispose()` in `RenderManager.dispose()` (or add an `EffectComposer2.dispose()` override that disposes `copyPass2` and calls `super.dispose()`).

## Files
- `src/rendering/RenderManager.ts:323-326` — dispose never disposes the composer
- `src/postprocessing/EffectComposer2.ts:7` — `copyPass2` with no dispose override

See `audit-rendermanager-dispose-never-disposes-passes.md` (medium) for the registered-pass leak in the same method.
