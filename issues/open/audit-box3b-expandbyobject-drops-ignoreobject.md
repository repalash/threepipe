# Box3B.expandByObject: `ignoreObject` predicate dropped in child recursion

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`Box3B.expandByObject` honors a caller-supplied `ignoreObject` predicate only on the root object. The recursive call into children omits it, so descendants the caller asked to exclude still expand the box. (`ignoreInvisible` IS forwarded correctly; only `ignoreObject` is dropped.)

## Root Cause
```ts
expandByObject(object, precise = false, ignoreInvisible = false, ignoreObject?: (obj: Object3D)=>boolean): this {
    // ...
    if (ignoreObject && ignoreObject(object)) return this    // checked only at this level
    // ...
    for (let i = 0, l = children.length; i < l; i++) {
        this.expandByObject(children[i], precise, ignoreInvisible)   // ignoreObject NOT passed
    }
    return this
}
```

For the typical call `box.expandByObject(scene, precise, ignoreInvisible, ignoreObject)`, the meshes contributing geometry are descendants, never the root — so the predicate is effectively useless: it filters only the root and silently includes excluded children.

## Impact
A caller's `ignoreObject` filter is silently ineffective for any non-root object, producing a bounding box that includes geometry meant to be excluded. Low severity: the feature is incompletely wired rather than crashing, and the common root-only check is rare.

## Fix
Forward the predicate: `this.expandByObject(children[i], precise, ignoreInvisible, ignoreObject)`. Also add an `ignoreObject` parameter to the `expandByObjects` convenience method and forward it (it currently lacks the param entirely).

## Files
- `src/three/math/Box3B.ts:127` — recursion drops `ignoreObject`
- `src/three/math/Box3B.ts:134-137` — `expandByObjects` has no `ignoreObject` param to forward
