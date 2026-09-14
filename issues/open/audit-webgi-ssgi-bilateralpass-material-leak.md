# webgi SSGIPluginPass: leaks BilateralFilterPass material/fsQuad on dispose

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`SSGIPluginPass` owns a sub-pass `bilateralPass = new BilateralFilterPass(...)` (its own ShaderMaterial + fsQuad), but declares no `dispose()` override. On plugin removal the inherited `ExtendedShaderPass.dispose()` only disposes `this.material`/`this.fsQuad`, so the bilateral pass's material/fsQuad (and the gbuffer-unpack extension registered onto it) are never freed.

## Root Cause
```ts
this.bilateralPass = new BilateralFilterPass(this.target, 'rgba')   // line 360, owns material + fsQuad
// SSGIPluginPass declares no dispose()
```
`PipelinePassPlugin.onRemove` → `this._pass.dispose()` resolves to `ExtendedShaderPass.dispose()`, which disposes only `this.material` and `this.fsQuad` — not `this.bilateralPass`.

## Impact
Each plugin add+remove cycle leaks the bilateral pass's GPU program/material/fsQuad, plus the gbuffer-unpack extension registered onto `bilateralPass.material`.

## Fix
Add `dispose() { this.bilateralPass?.dispose?.(); super.dispose() }` to `SSGIPluginPass`.

## Files
- `experiments/threepipe-webgi/src/plugins/postprocessing/SSGIPlugin.ts:360` — `bilateralPass` constructed, no `dispose()` override on `SSGIPluginPass`
