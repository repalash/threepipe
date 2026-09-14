# GLTFAnimationPlugin._objectRemove: clip action cache (`clip.userData.clipActions[uuid]`) not cleared on remove

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`_objectRemove` stops the mixer and splices the animation out of `_animations`, but never clears `clip.userData.clipActions[obj.uuid]`. On a remove/re-add cycle for the same object (same uuid), the stale cache entry is found but no longer matches the fresh `animation.actions`, so the code accumulates brand-new `clipData` entries instead of resetting them.

## Root Cause
```ts
private _objectRemove = (ev: {object: IObject3D})=>{
    const object = ev.object as IObject3D
    if (!this._viewer || !object) return
    const animation = this._animations.find(a => a.object === object)
    if (!animation) return
    animation.mixer.stopAllAction()
    this._animations.splice(this._animations.indexOf(animation), 1)
    this.dispatchEvent({type: 'removeAnimation', animation})
    // never clears clip.userData.clipActions[object.uuid]
}
```
In `_refreshAnimations`, the `if (!existing)` reset only runs when the uuid key is absent; with a stale-but-present entry the array is not reset and a new `action.clipData` is pushed, bloating the serialized `clip.userData.clipActions`.

## Impact
No crash, but stale `clipData` accumulates in serialized clip metadata across remove/re-add cycles and can desync clip metadata. Leaks/bloats serialized data.

## Fix
On `_objectRemove`, delete `clip.userData.clipActions[object.uuid]` for the removed object's clips (and/or detach actions), or reset the array in `_refreshAnimations` when no cached action matches.

## Files
- `src/plugins/animation/GLTFAnimationPlugin.ts:630-641` — `_objectRemove` does not clear the clipActions cache
