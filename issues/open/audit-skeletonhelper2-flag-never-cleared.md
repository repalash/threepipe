# SkeletonHelper2: `_hasSkeletonHelper` set on Create but never cleared on dispose

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`SkeletonHelper2.Create` stamps `_hasSkeletonHelper = true` on the root object to prevent duplicate helpers, but `dispose()` never clears it. After the first dispose, the object (and any descendant) keeps the flag forever, so `SkeletonHelper2.Check` returns `false` and a new helper can never be auto-created again for that hierarchy.

## Root Cause
```ts
static Check(object: Object3D): boolean {
    let parentHas = false
    object.traverseAncestors(o => { if ((o as any)._hasSkeletonHelper) parentHas = true })
    if (parentHas) return false
    return getBoneList(object).length > 0
}

static Create(object: Object3D): SkeletonHelper2 {
    const helper = new SkeletonHelper2(object)
    ;(object as any)._hasSkeletonHelper = true   // set here
    return helper
}

dispose() {
    this.lineSegments.geometry.dispose()
    this.lineSegments.material.dispose()
    super.dispose()                               // never clears _hasSkeletonHelper
}
```

`Create` sets the flag so nested objects don't each spawn a duplicate skeleton helper (the `Check` guard walks ancestors). But neither `dispose()` nor `detach()` (via `super.dispose()` → `AHelperWidget.detach`, which nulls `this.object` at line 88) removes it.

## Impact
Once a skeleton helper is created and disposed for an object, the stale `_hasSkeletonHelper === true` permanently disables auto-recreation for that object and its descendants. Silent, persistent stale-state bug.

## Fix
In `dispose()`, `delete (object)._hasSkeletonHelper` for the object the helper was created on. Because `AHelperWidget.detach` nulls `this.object`, store a reference to the root object at `Create`/construction time and clear the flag on that stored reference in `dispose()`.

## Files
- `src/three/widgets/SkeletonHelper2.ts:156-160` — `Create` sets `_hasSkeletonHelper = true`
- `src/three/widgets/SkeletonHelper2.ts:139-143` — `dispose()` never clears the flag
- `src/three/widgets/SkeletonHelper2.ts:145-153` — `Check` returns false when an ancestor has the flag
- `src/three/widgets/AHelperWidget.ts:88` — `detach()` nulls `this.object` (so capture the root reference)
