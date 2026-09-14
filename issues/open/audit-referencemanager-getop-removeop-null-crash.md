# ReferenceManager.GetOp / RemoveOp: crash on a stored `null` state value (only `undefined` is guarded)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`null` is an explicitly-supported state value type in the component system, but both `GetOp` and `RemoveOp` dereference `.isItemRef` on a `null` value, throwing `TypeError: Cannot read properties of null (reading 'isItemRef')`.

## Root Cause
```ts
static RemoveOp(val: ItemRef | any, refOwner: any) {
    if (val !== undefined && (val as ItemRef).isItemRef) { ... }   // null passes `!== undefined` -> (null).isItemRef throws
}

static GetOp(val: ItemRef | any, warn = true) {
    if ((val as ItemRef).isItemRef) { ... }                        // no null guard at all -> (null).isItemRef throws
}
```
`null` is supported: `TypeSystem.GetType(null)` returns `'null'`, and the UI generates nullable `reference` configs (`canBeNull`/`allowNull`). `getStateProperty` only short-circuits on `undefined`, then calls `ReferenceManager.GetOp(null)`; `setStateProperty` passes a possibly-`null` old value to `RemoveOp`.

## Impact
Reading a state property that holds a stored `null` (different from its default) crashes via the generated getter. `RemoveOp(null, ...)` has the same defect on the write path. Reachable whenever a nullable reference property is serialized/restored as `null`.

## Fix
Guard for nullish in both:
```ts
// GetOp
if (val != null && (val as ItemRef).isItemRef) { ... }
// RemoveOp
if (val != null && (val as ItemRef).isItemRef) { ... }
```

## Files
- `src/plugins/extras/components/ReferenceManager.ts:127-132` — `RemoveOp` guards only `undefined`
- `src/plugins/extras/components/ReferenceManager.ts:134-144` — `GetOp` has no nullish guard
