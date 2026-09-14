# BasicObjectConstraints look_at: `changed` compares post-slerp quaternion against the target instead of the original

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The `look_at` constraint mutates `obj.quaternion` in place with `slerp(q, influence)` and then compares the **mutated** quaternion against the **target** `q` to decide `changed`/`isEnd`. With `influence === 1`, slerp sets the quaternion exactly to `q`, so `changed` is always `false` and `isEnd` always `true` on the first apply — even though the object actually rotated.

## Root Cause
```ts
obj.quaternion.slerp(q, influence)          // mutates obj.quaternion in place
const changed = !obj.quaternion.equals(q)   // compares MUTATED value vs TARGET q
const isEnd = obj.quaternion.angleTo(q) < 0.00001
return {changed, end: isEnd, change: 'rotation'}
```
Every sibling constraint in this file (`copy_position`, `copy_rotation`, `copy_scale`, `copy_transforms`, `follow_path`) snapshots the ORIGINAL value first and compares the new value against that original. `look_at` is the lone handler comparing against the target.

## Impact
`ObjectConstraint.update` only calls `data.obj.setDirty(...)` when `res.changed` is true, so a `look_at` constraint mutates the object's quaternion but reports `changed=false` — failing to mark the object/scene dirty for re-render — and (via `end:true`) immediately stops updating. The data change happens, but the dirty/"needs another update" signaling is wrong.

## Fix
Snapshot the original quaternion before slerp and compare against it, mirroring `copy_rotation`:
```ts
const last = obj.quaternion.clone()
obj.quaternion.slerp(q, influence)
const changed = !obj.quaternion.equals(last)
const isEnd = obj.quaternion.angleTo(last) < 0.00001
```

## Files
- `src/plugins/extras/helpers/BasicObjectConstraints.ts:366-371` — slerp + post-mutation comparison against target
