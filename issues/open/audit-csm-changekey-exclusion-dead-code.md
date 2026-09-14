# CascadedShadowsPlugin: changeKey exclusion-list check is dead code (wrong `&&` operator)

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The light `objectUpdate` handler is meant to call `cameraNeedsUpdate()` for any change EXCEPT a listed set of keys. Because the two clauses are joined with `&&` (not `||`), `cameraNeedsUpdate()` fires **only when `changeKey` is falsy**, and the exclusion list is completely dead. For any real key (light position/direction/color change routed through this path), the cascade camera/frustum is never marked for update.

## Root Cause
```ts
const changeKey = e?.change ?? e?.key
if (!changeKey && ![
    'intensity', 'castShadow', 'mapSize', 'bias', 'radius', 'shadow', 'deserialize',
].includes(changeKey)) this.cameraNeedsUpdate()
```
Truth table:
- `changeKey` truthy (real key) → `!changeKey` is false → whole expr false → `cameraNeedsUpdate()` NEVER called; the `.includes(...)` arm is never reached.
- `changeKey` falsy → `!changeKey` true, `![...].includes(falsy)` true → expr true → runs (but a falsy key is never in the list anyway).

The commit that added the exclusion list intended to SKIP `cameraNeedsUpdate` only for the listed keys and run it for all others. Correct operator is `||`.

## Impact
Cascades do not recompute on light transform/color changes routed through this handler — shadow cascades go stale when the light moves or rotates.

## Fix
```ts
if (!changeKey || ![
    'intensity', 'castShadow', 'mapSize', 'bias', 'radius', 'shadow', 'deserialize',
].includes(changeKey)) this.cameraNeedsUpdate()
```

## Files
- `src/plugins/rendering/CascadedShadowsPlugin.ts:257-260` — `&&` should be `||`; exclusion list currently dead
