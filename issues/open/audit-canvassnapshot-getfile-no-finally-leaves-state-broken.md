# CanvasSnapshotPlugin._getFile: leaves camera interactions disabled and renderScale changed on error (no try/finally)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`_getFile` disables main-camera interactions and may change `renderManager.renderScale` near the top, but restores both only on the normal fall-through path. There is no try/finally, so any throw between leaves the viewer non-interactive and at the wrong render resolution until reload.

## Root Cause
```ts
viewer.scene.mainCamera.setInteractions(false, CanvasSnapshotPlugin.PluginType)   // line 67
const dpr = viewer.renderManager.renderScale
if (options.displayPixelRatio !== undefined && options.displayPixelRatio !== dpr) {
    viewer.renderManager.renderScale = options.displayPixelRatio                  // line 71
}
// ... multiple awaits / external calls: progressive convergence loop,
//     CanvasSnapshot.GetFile / GetTiledFiles, f.arrayBuffer(), zipSync ...
// restore only on normal path:
if (progressive && lastMaxFrames !== undefined) progressive.maxFrameCount = lastMaxFrames  // 139-141
viewer.scene.mainCamera.setInteractions(true, CanvasSnapshotPlugin.PluginType, false)       // 142
viewer.renderManager.renderScale = dpr                                                       // 143
```
If any awaited call throws (convergence loop, `GetFile`/`GetTiledFiles`, `arrayBuffer()`, `zipSync`), the restore block is skipped. The caller `downloadSnapshot` catches the error for logging but cannot restore this internal state.

## Impact
On a snapshot error, the main camera's interactions stay disabled and `renderScale` stays at the snapshot value — the viewer becomes non-interactive / wrong-resolution until reload.

## Fix
Wrap the body from line 67 onward in try/finally and move the interaction restore, `renderScale = dpr`, and `progressive.maxFrameCount` restore into the `finally` block.

## Files
- `src/plugins/export/CanvasSnapshotPlugin.ts:62-146` — `_getFile`: state set at 67/71, restored only on normal path (138-143), no try/finally
