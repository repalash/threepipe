# ThreeSVGRendererPlugin: per-mesh listeners and SVGMesh objects leak on plugin removal

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`makeSVGObject` adds two listeners to every mesh (`dispose`, `objectUpdate`) and stores an `SVGMesh` per mesh in `this._meshes`. `onRemove` only calls `this._meshes.clear()` and removes the modelRoot/resize listeners — it never iterates the meshes to `removeEventListener` the two per-mesh listeners nor `dispose()` the `SVGMesh` objects.

## Root Cause
```ts
// makeSVGObject
o.addEventListener('dispose', this._onMeshDispose)
o.addEventListener('objectUpdate', this._onMeshUpdate)
```
```ts
// onRemove
viewer.renderManager.removeEventListener('resize', this._onResize)
this._meshes.clear() // ?
this.svgNodeContainer.style.display = 'none'
viewer.scene.modelRoot.removeEventListener('objectUpdate', this.updateMeshes)
```
Contrast `_onMeshDispose`, which *does* correctly `removeEventListener` both events and `svgMesh.dispose()` for a single mesh — `onRemove` does neither for the bulk.

## Impact
After plugin removal, the bound `dispose`/`objectUpdate` listeners stay attached to every scene mesh. They early-return harmlessly (`_meshes` was cleared so the lookup returns undefined), but they leak. More importantly the `SVGMesh` objects (each owning a cloned threeMesh, BVH, and halfedge structure) are never `.dispose()`d on plugin removal — only on a per-mesh `dispose` event. onAdded/onRemove asymmetry + listener leak + SVGMesh resource leak.

## Fix
In `onRemove`, before clearing, iterate `this._meshes` (and/or scene meshes), `removeEventListener('dispose', this._onMeshDispose)` / `removeEventListener('objectUpdate', this._onMeshUpdate)`, and call `svgMesh.dispose()`.

## Files
- `plugins/svg-renderer/src/ThreeSVGRendererPlugin.ts:186-199` — `onRemove` only clears the map
- `plugins/svg-renderer/src/ThreeSVGRendererPlugin.ts:228-239` — `makeSVGObject` adds the per-mesh listeners
- `plugins/svg-renderer/src/ThreeSVGRendererPlugin.ts:201-210` — `_onMeshDispose` shows the correct per-mesh cleanup
