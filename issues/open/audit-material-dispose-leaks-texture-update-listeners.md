# iMaterialCommons: texture `update` listeners never removed on material dispose (leak)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`refreshTextureRefs` subscribes a material to each of its textures' `update` events but only unsubscribes textures that drop out of the set (the diff/shrink path). The material `dispose` override only chains `superDispose` — it never removes the `update` listeners for textures still referenced. A disposed material therefore stays subscribed to its (shared, still-alive) textures and cannot be garbage-collected while those textures exist.

## Root Cause
`refreshTextureRefs` adds a listener for every current map and only removes dropped ones:
```ts
for (const map of newMaps) {
    if (!map || !map.isTexture) continue
    map.addEventListener('update', this.__textureUpdate!)   // added for every current map
    ...
}
for (const map of oldMaps) {
    if (newMaps.has(map)) continue
    map.removeEventListener('update', this.__textureUpdate!) // only removed when a map drops out
    ...
}
```
The `dispose` override never touches these:
```ts
dispose: (superDispose) =>
    function(this: IMaterial, force = true): void {
        if (!force && this.userData.disposeOnIdle === false) return
        superDispose.call(this)   // only this — no listener cleanup, no _mapRefs iteration
    },
```
The only `removeEventListener('update', ...)` for the handler is the shrink path in `refreshTextureRefs`; nothing fires on dispose.

## Impact
Disposing a material that shares textures with other materials (common — shared envmaps, atlases) leaves the material subscribed to those textures' `update` events. The texture's listener list retains the closure and the material object, so the material leaks for as long as the shared texture lives. Over many load/dispose cycles this accumulates.

## Fix
In the dispose override, iterate `_mapRefs` and `removeEventListener('update', this.__textureUpdate)` for each (or call `refreshTextureRefs` after clearing the maps so the shrink path removes them) before `superDispose`.

## Files
- `src/core/material/iMaterialCommons.ts:81` — `dispose` override only chains `superDispose`, no listener cleanup
- `src/core/material/iMaterialCommons.ts:224` — `refreshTextureRefs` adds the `update` listener; the only removal is the shrink path at line 231
