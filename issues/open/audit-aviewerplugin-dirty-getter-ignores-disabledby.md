# AViewerPlugin: `dirty` getter checks only `enabled`, ignoring the `_disabledBy` set

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`isDisabled()` returns `this._disabledBy.size > 0 || !this.enabled`, so a plugin can be temporarily disabled by any keyed caller via `disable(key)` even while `enabled === true`. But the `dirty` getter returns `this.enabled && this._dirty` — it does NOT consult `_disabledBy`. The two "is this plugin active" predicates disagree on the `_disabledBy` dimension.

## Root Cause
```ts
isDisabled = () => {
    return this._disabledBy.size > 0 || !this.enabled
}
...
get dirty(): boolean {
    return this.enabled && this._dirty   // ignores _disabledBy
}
```
`ThreeViewer` collects `dirtyPlugins` by reading `plugin.dirty` to decide which plugins keep the viewer rendering. A `disable(key)`-d plugin (still `enabled`) with `_dirty === true` still reports `dirty === true` and keeps forcing frames, contradicting its disabled state.

## Impact
Wasted re-renders: a temporarily-disabled-but-enabled plugin keeps the viewer rendering. Most plugins gate their actual pass work with `isDisabled()`, so output is correct — only extra frames are forced. Hence low.

## Fix
```ts
get dirty(): boolean {
    return !this.isDisabled() && this._dirty
}
```

## Files
- `src/viewer/AViewerPlugin.ts:86-88` — `isDisabled()` factors in `_disabledBy`
- `src/viewer/AViewerPlugin.ts:113-115` — `dirty` getter ignores `_disabledBy`
