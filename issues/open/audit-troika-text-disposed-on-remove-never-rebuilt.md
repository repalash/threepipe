# TroikaTextPlugin: text glyph geometry disposed on object-remove, never rebuilt on re-add

**Severity:** high
**Found:** 2026-06-13 code audit

## Bug
`_objectRemove` disposes the real troika `Text` child (which disposes its glyph geometry) but does not remove it from the wrapper nor restore a dummy mesh. `_objectAdd` only rebuilds the text when the child is a dummy mesh. So after any remove/re-add cycle the child is still the now-disposed `Text` (not a dummy), `_objectAdd` does nothing, and the text stays disposed and is never re-synced.

## Root Cause
```ts
private _objectAdd = (e: {object?: IObject3D})=>{
    const obj = e.object
    if (!obj?.userData?.textParams) return
    const child = obj.children[0]
    if (!child) return
    if (child.userData.isTextDummyMesh) {        // only rebuilds for a dummy
        const material = child.material
        child.dispose && child.dispose()
        child.removeFromParent()
        this.setupTextWrapper(obj, material)
    }
}

private _objectRemove = (e: {object?: IObject3D})=>{
    const obj = e.object
    if (!obj?.userData?.textParams) return
    const child = obj.children[0]
    if (!child) return
    // todo dispose the geometry and set the dummy material? it will be recreated on add
    child.dispose && child.dispose()             // disposes real Text glyph geometry, no dummy swap
}
```
Troika `Text.dispose()` disposes the glyph geometry (`node_modules/troika-three-text/.../Text.js`). The handlers are asymmetric: remove leaves a real (disposed) `Text`, but add expects a dummy mesh. The in-code `// todo` at line 199 acknowledges this path is unfinished.

## Impact
A remove/re-add of a text object — moving it in the hierarchy, undo/redo of an add, or `Object3DManager.unregisterObject`/`registerObject` (which dispatch `objectRemove`/`objectAdd` and call `obj.dispose(false)` when `autoDisposeObjects`) — leaves the text rendered broken / invisible, with no path that ever rebuilds it.

## Fix
On `_objectRemove`, either don't dispose (let GC handle it) or remove the disposed `Text` and re-insert a dummy mesh so `_objectAdd` can rebuild; alternatively make `_objectAdd` detect a disposed/real `Text` child and re-run `setupTextWrapper`.

## Files
- `plugins/troika-text/src/TroikaTextPlugin.ts:194-201` — `_objectRemove` disposes the real Text, no dummy swap (`// todo` at 199)
- `plugins/troika-text/src/TroikaTextPlugin.ts:181-192` — `_objectAdd` only rebuilds when child is a dummy mesh
