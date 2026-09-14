# SelectionWidget.attach: null guard placed after `object.traverseAncestors`

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The `if (!object) return this` null guard in `attach()` is placed after `object.traverseAncestors(...)`, which already dereferences `object`. A `null`/`undefined` argument throws a TypeError at `traverseAncestors` instead of returning cleanly — the guard is dead code that can't do its job.

## Root Cause
```ts
attach(object: IObject3D): this {
    this.detach()
    let inScene = false
    object.traverseAncestors(c=>(c as RootScene).isRootScene && (inScene = true))  // deref first
    if (!inScene) { return this }
    if (!object) return this   // dead: object already dereferenced above
    this._object = object
    // ...
}
```

The param is typed non-null, but callers cast/pass cast values, so a null can reach here in practice.

## Impact
If `null`/`undefined` is passed, `attach` throws instead of cleanly returning. Low severity (depends on a contract violation by the caller), but the guard is misplaced and provides no protection.

## Fix
Move `if (!object) return this` to the top of `attach`, before `traverseAncestors`.

## Files
- `src/three/widgets/SelectionWidget.ts:55-64` — null guard after deref
