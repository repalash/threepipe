# CameraViewPlugin: anonymous empty `preFrame` listener registered in onAdded, never removed

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`onAdded` registers an inline arrow function as a `preFrame` listener whose body is fully commented out (a no-op). Because the reference is anonymous, `onRemove` cannot and does not remove it. Each onAdded/onRemove cycle leaks another empty listener.

## Root Cause
```ts
// todo: move to PopmotionPlugin
// todo: remove event listener
viewer.addEventListener('preFrame', (_: any)=>{
    // console.log(ev.deltaTime)
    // this._updaters.forEach(u=>{ ...all commented out... })
})
```
Sibling listeners (`postFrame`) are stored on `this._postFrame` and removed correctly. The two `todo` comments above the listener already flag both problems.

## Impact
Harmless per call (no-op body), but a real dangling-listener leak and dead code that accumulates on repeated add/remove.

## Fix
Delete the dead listener entirely (preferred — it does nothing), or store it on a field and remove it in `onRemove`.

## Files
- `src/plugins/animation/CameraViewPlugin.ts:115-126` — anonymous no-op `preFrame` listener
