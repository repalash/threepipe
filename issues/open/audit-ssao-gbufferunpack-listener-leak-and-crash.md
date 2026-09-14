# SSAOPlugin: `gbufferUnpackExtensionChanged` renderManager listener leaked on removal (+ crash on later dispatch)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`onAdded` registers a direct `gbufferUnpackExtensionChanged` listener on `renderManager`, but `onRemove` never removes it. The base `PipelinePassPlugin.onRemove` disposes the pass and sets `this._pass = undefined`, but does not touch this separate subscription. After removal the stale listener remains, and because its handler throws when `_pass`/`_viewer` are null, any later dispatch crashes.

## Root Cause
```ts
// onAdded:
viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)

// onRemove:
onRemove(viewer: ThreeViewer): void {
    this._disposeTarget()
    return super.onRemove(viewer)   // never removes the gbufferUnpackExtensionChanged listener
}

// handler:
private _gbufferUnpackExtensionChanged = ()=>{
    if (!this._pass || !this._viewer) throw new Error('SSAOPlugin: pass/viewer not created yet')
    ...
}
```
The `forPlugin(GBufferPlugin, ...)` registration self-cleans, but the `gbufferUnpackExtensionChanged` subscription is a separate direct subscription that is never removed. After removal `_pass` is null and `_viewer` is cleared, so any future dispatch (e.g. adding/removing a GBufferPlugin/DepthBufferPlugin afterward) throws from the dead listener.

## Impact
Listener leak per add/remove cycle, plus a hard crash (`throw`) when a GBuffer/Depth plugin is added or removed after SSAOPlugin has been removed.

## Fix
In `onRemove`, before `super.onRemove`:
```ts
viewer.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
```
(and optionally unregister `this._gbufferUnpackExtension` from the pass material).

## Files
- `src/plugins/pipeline/SSAOPlugin.ts:250` — listener added in onAdded
- `src/plugins/pipeline/SSAOPlugin.ts:224-225` — handler throws when `_pass`/`_viewer` are null
- `src/plugins/pipeline/SSAOPlugin.ts:253-256` — onRemove never removes the listener
