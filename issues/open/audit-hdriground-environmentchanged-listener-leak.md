# HDRiGroundPlugin: `environmentChanged` scene listener added in onAdded, never removed (no onRemove)

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
`onAdded` subscribes to the scene's `environmentChanged` event with `this.setDirty`, but the class defines **no `onRemove`** at all. The inherited `AViewerPluginSync.onRemove` only removes the `'*'` viewer listener, so the scene `environmentChanged` listener is never detached and leaks on every add/remove cycle.

## Root Cause
```ts
// onAdded(), last line of the method:
viewer.scene.addEventListener('environmentChanged', this.setDirty)
// ...class ends; there is no onRemove() override
```
`this.setDirty` is bound in the constructor, so the reference is stable and could have been removed — but nothing removes it.

## Impact
After the plugin is removed, every scene environment change still invokes `this.setDirty` (early-returns on a missing `_viewer`, so no crash), the closure keeps the plugin alive, and re-adding to a new viewer accumulates listeners. Sibling `BaseGroundPlugin` correctly removes all its scene listeners in `onRemove`.

Note: `onAdded` also permanently mutates the global `ShaderLib.backgroundCube.fragmentShader` and never restores it on remove — a separate global-side-effect concern flagged for awareness (lower priority).

## Fix
Add an `onRemove(viewer)` override that calls `viewer.scene.removeEventListener('environmentChanged', this.setDirty)` before `super.onRemove(viewer)`.

## Files
- `src/plugins/extras/HDRiGroundPlugin.ts:122` — listener added in onAdded
- `src/plugins/extras/HDRiGroundPlugin.ts:49` — `setDirty` bound in constructor (stable ref)
- `src/plugins/extras/HDRiGroundPlugin.ts` — class has no `onRemove` (ends at line 125)
