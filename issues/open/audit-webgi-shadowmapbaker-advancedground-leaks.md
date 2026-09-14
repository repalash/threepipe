# webgi ShadowMapBaker.dispose + AdvancedGroundPlugin: leak render target, blur material, and scene light on disable/remove

**Severity:** medium
**Found:** 2026-06-13 code audit

Two coupled leaks: `ShadowMapBaker.dispose()` is incomplete, and `AdvancedGroundPlugin` never even calls it. Grouped because the ground plugin owns the baker and re-creates it across toggles.

## Bug 1 — `ShadowMapBaker.dispose()` leaks target, blur material, and the scene light
```ts
dispose() {
    // todo: dispose everything and remove light from scene.
    this._shadowMat.dispose()
    this._target = undefined        // drops the ref; never disposeTarget(...)
    this.reset()
}
```
- `_target` is a `WebGLRenderTarget` (1024², created via `renderManager.createTarget` at line 213 with a `// todo: dispose somewhere`). `dispose()` just nulls the reference instead of `renderManager.disposeTarget(this._target)` → GPU memory leak.
- `_shadowBlurMat` (a `ShaderMaterial2`, line 102) is never disposed.
- The `RandomizedDirectionalLight` added to the scene at line 89 (`viewer.scene.addObject(this._light, {addToRoot:true})`) is never removed. `reset()` only zeroes the frame counter.

## Bug 2 — `AdvancedGroundPlugin` never disposes the baker (disable path + onRemove stub)
```ts
// refresh(), disable path
} else if (!this.bakedShadows && this._shadowBaker) {
    this._shadowBaker.reset()
    this._shadowBaker.cleanupMaterial()   // never dispose(), never null _shadowBaker
}
```
```ts
onRemove(viewer: ThreeViewer) {
    // todo
    return super.onRemove(viewer)         // disposes nothing
}
```
Turning `bakedShadows` off never calls `dispose()` and never nulls `_shadowBaker` — the baker's directional light stays in the scene (light-layer 5, castShadow) and its render target stays allocated. Re-enabling sees `!this._shadowBaker` is false and reuses the old baker, but a removed-then-re-added plugin or repeated toggles compound the leak (each `refresh` with `bakedShadows && !_shadowBaker` creates a fresh baker at line 178 without disposing the previous). `onRemove` is a `// todo` stub that also leaves the `Reflector2` reflection render target (created in `_createMesh`) allocated.

## Impact
Repeated `bakedShadows` toggles (or plugin add/remove cycles) leak a 1024² RGBA render target + a stray directional light + a blur material each cycle, and a reflector render target on removal.

## Fix
- `ShadowMapBaker.dispose()`: call `this._viewer.renderManager.disposeTarget(this._target)`, dispose `this._shadowBlurMat`, and remove `this._light` from the scene.
- `AdvancedGroundPlugin`: on disable, `this._shadowBaker.dispose(); this._shadowBaker = undefined`. In `onRemove`, dispose the shadow baker and the reflector render target before `super.onRemove`.

## Files
- `experiments/threepipe-webgi/src/utils/ShadowMapBaker.ts:116-121` — incomplete `dispose()`
- `experiments/threepipe-webgi/src/utils/ShadowMapBaker.ts:213` — target created with `// todo: dispose somewhere`
- `experiments/threepipe-webgi/src/utils/ShadowMapBaker.ts:89` — scene light added, never removed
- `experiments/threepipe-webgi/src/utils/ShadowMapBaker.ts:102` — `_shadowBlurMat` never disposed
- `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts:180-183` — disable path never disposes/nulls the baker
- `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts:140-143` — `onRemove` stub
- `experiments/threepipe-webgi/src/plugins/extras/AdvancedGroundPlugin.ts:178` — fresh baker created without disposing the previous
