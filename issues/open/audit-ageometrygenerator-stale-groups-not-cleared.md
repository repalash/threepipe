# AGeometryGenerator: stale geometry groups not cleared on regeneration when generator returns no groups

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
Geometry groups are only reset inside `if (groups) { ... }`. When `_generateData` returns no `groups`, the existing (reused) geometry keeps its old groups while the position/index buffers are fully replaced — so the stale group start/count boundaries now point into the new buffer, producing wrong/garbage multi-material assignment.

## Root Cause
```ts
if (groups) {
    geometry.clearGroups()
    for (const group of groups) {
        geometry.addGroup(group.start, group.count, group.materialIndex)
    }
}
```
`clearGroups()` is gated on `groups` being truthy. The same geometry object is reused across `generate()` calls (`g ?? new BufferGeometry2()`). Reachable via `TubeShapeGeometryGenerator` (sets `result.groups` only when `materialSplits` is non-empty) and via switching a previously-grouped generator (Box → Sphere/Plane, which return no `groups`).

Flow: generate a tubeShape with `materialSplits = '0.3,0.6'` (3 groups), then set `materialSplits = ''` and regenerate → `_generateData` returns no `groups` → `clearGroups()` never runs → geometry keeps the old 3 groups over a freshly rebuilt buffer.

## Impact
Multi-material geometry renders with stale group boundaries after regeneration into an ungrouped configuration — incorrect material assignment, possibly out-of-range group ranges.

## Fix
Call `geometry.clearGroups()` unconditionally before the `if (groups)` block (or add `else geometry.clearGroups()`), so regenerating without groups removes any prior groups.

## Files
- `src/plugins/geometry/AGeometryGenerator.ts:137-142` — `clearGroups()` gated on `groups` truthiness
