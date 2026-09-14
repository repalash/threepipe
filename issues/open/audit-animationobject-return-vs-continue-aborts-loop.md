# AnimationObjectPlugin._objectUpdate: `return` inside loop aborts refresh of remaining trigger buttons

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
When one observer's key has no associated animation object, `return` exits the entire handler, skipping `_refreshTriggerBtn` for every remaining button in the loop. It should be `continue` to skip only that one entry.

## Root Cause
```ts
for (const obs of btns) {
    const ao1 = getAo(obj, obs.key) // todo deep access key
    if (!ao1) return                // aborts the whole loop
    this._refreshTriggerBtn(ao1, obs.btn)
}
```

## Impact
Limited because `btns` is pre-filtered by matching key, so entries usually map to the same animation — but it is still an incorrect early-exit: a single missing animation object stops refreshing all subsequent trigger buttons.

## Fix
```ts
if (!ao1) continue
```

## Files
- `src/plugins/animation/AnimationObjectPlugin.ts:457-461` — `return` should be `continue`
