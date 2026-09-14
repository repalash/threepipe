# AnimationObject: `_lastTarget` never assigned → target-change re-init is dead code

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`_onAccessChanged` is meant to re-initialize keyframe `values`/`offsets` when the animated target object changes while the `access` string stays the same. That re-init clause depends on `this._lastTarget`, which is declared and read but never assigned anywhere in the codebase, so the sub-condition is always falsy and the re-init never fires.

## Root Cause
```ts
private _lastTarget: any = undefined   // declared, only ever read

protected _onAccessChanged() {
    const tar = this.targetObject
    ...
    if (this.access !== this._lastAccess || !this.values.length || this._lastTarget !== tar && tar && this._lastTarget) {
        this._lastAccess = this.access   // _lastAccess IS updated here
        ...
    }
}
```
`_lastAccess` is updated inside the block, so access-change detection works. But `_lastTarget` is never assigned (verified via grep — only the declaration and the read exist). It stays `undefined`, so the clause `this._lastTarget !== tar && tar && this._lastTarget` is `(undefined !== tar) && tar && undefined` → always falsy.

## Impact
Rebinding an `AnimationObject` to a different target object with the same `access` string keeps the stale `values`/`offsets` from the old target's types — the animation references the wrong/old type data and the keyframes are never re-initialized for the new target.

## Fix
Assign `this._lastTarget = tar` inside the `if` block alongside `this._lastAccess = this.access`.

## Files
- `src/utils/AnimationObject.ts:322` — `_lastTarget` declared, never assigned
- `src/utils/AnimationObject.ts:337` — read in the re-init condition; always falsy
