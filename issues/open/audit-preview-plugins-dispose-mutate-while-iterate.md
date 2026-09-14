# RenderTargetPreviewPlugin / GeometryUVPreviewPlugin: dispose mutates `targetBlocks` while iterating it → half the targets leak

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
Both preview plugins' `dispose()` iterate `this.targetBlocks` with `for...of` while the per-element remove method splices the same array. Splicing during a `for...of` over a live array shifts every later element left, so the iterator skips every other element — roughly **half** the targets (their `div` DOM nodes, ShaderMaterials, and in the UV case 1024px canvases) are never removed.

## Root Cause
RenderTargetPreviewPlugin:
```ts
dispose() {
    for (const target of this.targetBlocks) {
        this.removeTarget(target.target)        // removeTarget does this.targetBlocks.splice(index, 1)
    }
    super.dispose()
}
```
GeometryUVPreviewPlugin (identical pattern):
```ts
dispose() {
    for (const target of this.targetBlocks) {
        this.removeGeometry(target.target)      // removeGeometry does this.targetBlocks.splice(index, 1)
    }
    super.dispose()
}
```

## Impact
Resource/DOM leak on dispose: ~half of `targetBlocks` and their attached `div` elements (plus 1024px `UVsDebug` canvases for GeometryUV) survive teardown and remain referenced.

## Fix
Iterate a copy or drain the array, in both plugins:
```ts
for (const t of [...this.targetBlocks]) this.removeTarget(t.target)
// or
while (this.targetBlocks.length) this.removeTarget(this.targetBlocks[0].target)
```

## Files
- `src/plugins/ui/RenderTargetPreviewPlugin.ts:174-179` — dispose loop; `removeTarget` splices at line 141
- `src/plugins/ui/GeometryUVPreviewPlugin.ts:145-150` — dispose loop; `removeGeometry` splices at line 104
