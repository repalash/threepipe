# ExtendedRenderPass.dispose: leaks the opaque temp target and the internal `_blendPass`

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`dispose()` releases the transparent target and clears scene/camera, but never releases the opaque target (when `preserveOpaqueTarget` is set) and never disposes the internal `_blendPass`. Both own GPU resources that leak on dispose.

## Root Cause
```ts
dispose() {
    this._releaseTransparentTarget()   // opaque NOT released; _blendPass NOT disposed
    this.onDirty = []
    this.scene = undefined
    this.camera = undefined
    super.dispose?.()
}
```
- The opaque target is normally released at the end of each `render()` only when `!this.preserveOpaqueTarget`. If a consumer sets `preserveOpaqueTarget = true` (a documented, non-readonly field), the held temp target is leaked on dispose. The transparent path correctly mirrors this by releasing in dispose.
- `this._blendPass = new GenericBlendTexturePass(...)` (constructor) is an `ExtendedShaderPass` owning a `ShaderMaterial2` + fsQuad. `ExtendedShaderPass.dispose()` exists but is never called here, so the blend pass's program and full-screen quad leak.

## Impact
On dispose: a preserved opaque temp target and the `_blendPass`'s material + fsQuad are leaked.

## Fix
Add to `dispose()`:
```ts
this._releaseOpaqueTarget()
this._blendPass.dispose()
```

## Files
- `src/postprocessing/ExtendedRenderPass.ts:363-369` — dispose releases transparent target only
- `src/postprocessing/ExtendedRenderPass.ts:106` — `_blendPass` created in constructor

See `audit-rendermanager-dispose-never-disposes-passes.md` — this pass is also never disposed by RenderManager.dispose in the first place.
