# GLTFObject3DExtrasExtension: `matrixAutoUpdate` exported but never imported (round-trip loss)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The export side writes `matrixAutoUpdate = false` into the object3D extras extension, but the import side never reads it back. An object with `matrixAutoUpdate = false` exports the flag but loses it on re-import — an asymmetric round-trip.

## Root Cause
Export writes the flag:
```ts
// Export.writeNode
if (object.matrixAutoUpdate === false) dat.matrixAutoUpdate = false
```
Import restores everything except `matrixAutoUpdate`:
```ts
// Import afterRoot
o.castShadow = ext.castShadow ?? false
o.receiveShadow = ext.receiveShadow ?? false
if (ext.visible !== undefined) o.visible = ext.visible
if (ext.frustumCulled !== undefined) o.frustumCulled = ext.frustumCulled
if (ext.renderOrder !== undefined) o.renderOrder = ext.renderOrder
if (ext.layers !== undefined) o.layers.mask = ext.layers
// no read of ext.matrixAutoUpdate
```
three.js `ObjectLoader.js`, which this extension mirrors, does restore `matrixAutoUpdate`.

## Impact
An object exported with `matrixAutoUpdate = false` comes back with `matrixAutoUpdate = true` (the default) on re-import, so a manually-controlled transform is silently re-enabled for auto-update. Low — uncommon flag.

## Fix
In the import branch add:
```ts
if (ext.matrixAutoUpdate !== undefined) o.matrixAutoUpdate = ext.matrixAutoUpdate
```

## Files
- `src/assetmanager/gltf/GLTFObject3DExtrasExtension.ts:65` — export writes `matrixAutoUpdate`
- `src/assetmanager/gltf/GLTFObject3DExtrasExtension.ts:27-33` — import never reads it
