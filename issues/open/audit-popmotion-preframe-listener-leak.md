# PopmotionPlugin: `preFrame` listener added in onAdded but never removed in onRemove

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
`onAdded` registers both a `postFrame` and a `preFrame` listener, but `onRemove` only removes the `postFrame` one. The `preFrame`/`_preFrame` listener leaks: it keeps firing every frame for the lifetime of the viewer after the plugin is removed, and accumulates one extra dead listener per add/remove cycle.

## Root Cause
```ts
onAdded(viewer: ThreeViewer): void {
    super.onAdded(viewer)
    viewer.addEventListener('postFrame', this._postFrame)
    viewer.addEventListener('preFrame', this._preFrame)
}

onRemove(viewer: ThreeViewer): void {
    viewer.removeEventListener('postFrame', this._postFrame)   // preFrame never removed
    super.onRemove(viewer)
}
```
`_preFrame` is a stable arrow-function class property, so it could be removed but isn't. After removal it early-returns on `if (!this._viewer) return`, so it doesn't crash, but the closure keeps the plugin instance alive, the `_timelineUpdaters` it drives keep running, and every re-add stacks another listener. Sibling `GLTFAnimationPlugin.onRemove` correctly removes every listener it added.

## Impact
Listener/memory leak per add-remove cycle; dead per-frame work for the viewer's lifetime; plugin instance retained via the closure. No crash.

## Fix
Add `viewer.removeEventListener('preFrame', this._preFrame)` to `onRemove`.

## Files
- `src/plugins/animation/PopmotionPlugin.ts:182-183` — both listeners added in onAdded
- `src/plugins/animation/PopmotionPlugin.ts:186-189` — onRemove removes only postFrame
- `src/plugins/animation/PopmotionPlugin.ts:135` — `_preFrame` arrow-property definition
