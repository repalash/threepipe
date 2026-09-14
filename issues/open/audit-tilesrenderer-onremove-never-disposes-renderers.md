# TilesRendererPlugin.onRemove never disposes loaded TilesRenderers (resource leak)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`onAdded` loads tiles into `this.objects: TilesRendererGroup[]`, each owning a `TilesRenderer` with an LRU cache, download/parse queues, a registered camera, and a `setResolutionFromRenderer` binding to the viewer's `WebGLRenderer`. `onRemove` removes the importer, gltf extensions, object extension, and the `preRender`/`resize` listeners, but never disposes the `TilesRenderer` instances and never clears `this.objects`.

## Root Cause
```ts
onRemove(viewer: ThreeViewer) {
    viewer.assetManager.importer.removeImporter(this._importer)
    viewer.assetManager.unregisterGltfExtension(gltfCesiumRTCExtension.name)
    // ... other unregisters ...
    viewer.renderManager.removeEventListener('preRender', this._preRender)
    viewer.renderManager.removeEventListener('resize', this._resize)
    // todo dispose all tiles renderers?
    super.onRemove(viewer)
}
```
The `// todo dispose all tiles renderers?` at line 123 acknowledges the gap.

## Impact
After plugin removal the tiles renderers keep their caches, in-flight network requests (download/parse queues), and loaded GPU geometry/textures alive with no owner — `tilesRenderer.update()` is no longer called, so they leak without ever being driven or freed. `this.objects` is never cleared, so the plugin instance also retains them. Per-group disposal only fires if each group object is independently disposed, which plugin removal does not trigger.

## Fix
In `onRemove`, iterate `this.objects` and call `group.tilesRenderer.dispose()` (or `group.dispose()`), then `this.objects = []` and clear `this._cachedRefs`/`_cachedRefs`.

## Files
- `plugins/3d-tiles-renderer/src/TilesRendererPlugin.ts:112-125` — `onRemove`, with `// todo dispose all tiles renderers?` at 123
