# webgi AnisotropyPlugin: "Direction" slider bound to non-existent `_anisotropicDirection` field

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The "Direction" UI slider (the constant direction used when no anisotropy map is present) binds to `_anisotropicDirection`, but every other part of the plugin uses `_anisotropyDirection` (no "ic"). So the slider reads/writes a property nothing else looks at.

## Root Cause
```ts
property: [state, '_anisotropicDirection'],   // typo: should be _anisotropyDirection
```
Every other reference — `enableAnisotropy` (line 89), the `onObjectRender` upload (`userData._anisotropyDirection`, line 189), the `IMaterialUserData` declaration (line 402), and glTF import/export (lines 457, 502) — uses `_anisotropyDirection`.

## Impact
Dragging the Direction slider has no effect on the rendered anisotropy direction, and the value isn't serialized.

## Fix
Change line 284 to `property: [state, '_anisotropyDirection']`.

## Files
- `experiments/threepipe-webgi/src/plugins/extras/AnisotropyPlugin.ts:284` — slider bound to `_anisotropicDirection`
