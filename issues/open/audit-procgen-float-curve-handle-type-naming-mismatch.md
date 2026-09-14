# procedural-generation geometry_nodes.ts: Float Curve reads `handle_type` but interface field is `handleType` — AUTO bezier path is dead code

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The `FloatCurvePoint` interface declares the handle type as `handleType`
(camelCase), but every code path that reads it uses `p.handle_type` (snake_case).
No code anywhere sets `handle_type`, so `p.handle_type` is always `undefined`. As a
result `hasAutoHandles` is always `false`, the AUTO/AUTO_CLAMPED cubic-bezier
evaluation path is **dead code**, and `evaluateFloatCurve` silently falls back to
linear interpolation for every curve. The VECTOR branch in `computeAutoHandles` is
likewise never taken specially.

## Root Cause
```ts
// geometry_nodes.ts:716-723 — interface declares camelCase
export interface FloatCurvePoint {
    x: number
    y: number
    /** Handle type: 'AUTO' | 'VECTOR' | 'ALIGN' (determines interpolation) */
    handleType?: string
}

// geometry_nodes.ts:746 — read uses snake_case
if (p.handle_type === 'VECTOR' || (!prev && !next)) { ... }

// geometry_nodes.ts:889 — read uses snake_case
const hasAutoHandles = points.some(p => p.handle_type === 'AUTO' || p.handle_type === 'AUTO_CLAMPED')
```
A caller constructing points using the documented `handleType` field gets
`p.handle_type === undefined` everywhere. `grep` confirms only `handleType` is ever
defined; the compiled `.js` has the same bug. (This also indicates the package is
not strict-typechecked — reading an undeclared property of an interface type would
normally be a TS error and would have caught this.)

## Impact
Float Curve evaluation never runs the bezier/auto-handle code, so any Float Curve
with AUTO/AUTO_CLAMPED handles is silently linearized — the curve shape is wrong
(straight segments between control points instead of the smooth Blender curve).

## Fix
Use one consistent key. Either rename the two reads (`:746`, `:889`) to
`p.handleType`, or rename the interface field to `handle_type` (and update the
JSDoc which already references `handle_type`). The reads and the declared field must
match. Enabling strict property checks in the package tsconfig would prevent a
recurrence.

## Files
- `plugins/procedural-generation/src/blender/geometry_nodes.ts:722` — interface declares `handleType?` (camelCase)
- `plugins/procedural-generation/src/blender/geometry_nodes.ts:746` — `computeAutoHandles` reads `p.handle_type` (VECTOR branch dead)
- `plugins/procedural-generation/src/blender/geometry_nodes.ts:889` — `evaluateFloatCurve` reads `p.handle_type` (AUTO path dead)
