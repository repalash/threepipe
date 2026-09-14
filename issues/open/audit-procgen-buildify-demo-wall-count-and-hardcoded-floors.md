# procedural-generation buildify_demo_1.ts: wall resample uses Math.round (vs Blender floor) and prop floors hardcoded to 5

**Severity:** medium
**Found:** 2026-06-13 code audit

Two related reactivity/fidelity bugs in the buildify demo generator. Both are
Blender-graph ports; per project rules a graph must reproduce Blender exactly and
be reactive (changing inputs must change outputs).

---

## H08 — Wall/module resample uses Math.round instead of Math.floor

### Bug
Three inline reimplementations of Blender's Resample Curve (LENGTH mode) compute
the module/wall count with `Math.round`, producing different counts from Blender
ground truth — and from the project's own shared `resampleCurve` helper — for any
segment whose `len / moduleWidth` has a fractional part ≥ 0.5. `wallsNodeGroup`
and `wallPropsNodeGroup` resample independently, so props can be generated for a
different slot count than the walls they sit on.

### Root Cause
```ts
// buildify_demo_1.ts:111
const n = Math.max(1, Math.round(usable / p.moduleWidth))
// buildify_demo_1.ts:158
const n = Math.max(1, Math.round(usable / p.moduleWidth))
// buildify_demo_1.ts:264
const n = Math.max(1, Math.round(len / p.moduleWidth))
```
Blender Resample Curve (LENGTH mode), `geometry/intern/resample_curves.cc:43`
(`get_count_from_length`):
```c
return int(curve_length / sample_length) + 1;
```
`int()` truncates toward zero = floor for positive lengths. The project's own
canonical helper `resampleCurve` (`plugins/procedural-generation/src/blender/geometry_nodes.ts:112`)
correctly uses `Math.floor(usable / moduleWidth)`. The plugin's own reference note
`plugins/procedural-generation/porting/references/buildify.md` ("Resample Curve
LENGTH mode uses floor(), not round()") records that `round(len/3)` gave 38
walls/floor where `floor(len/3)` correctly gave 28 during demo-4 porting.

`Math.round` rounds up when the fractional part ≥ 0.5, adding one over-compressed
module slot that would not fit at full module width — diverges from BOTH Blender
(`int()`) and the in-repo helper.

### Fix
Replace all three `Math.round(...)` with `Math.floor(...)`, or better, call the
existing `resampleCurve()` helper so there is a single source of truth.

---

## M15 — wallPropsNodeGroup hardcodes floor count to 5, not reactive to numFloors

### Bug
The Duplicate-Elements (SPLINE domain) expansion that creates one wall-prop
instance per floor loops to a literal `5`. `numFloors` is never passed into
`wallPropsNodeGroup`, so prop instances only ever exist for floors 1..5 — buildings
taller than 6 floors get zero wall props above floor 5. Increasing `floors` past 6
does not add props, violating the "graphs must be reactive" rule.

### Root Cause
```ts
// buildify_demo_1.ts:276
for (let floor = 1; floor <= 5; floor++) {
    for (const wp of ordered) {
        wallInstances.push({x: wp.x, y: floor * p.moduleHeight, z: wp.z, rotY, floor})
    }
}
```
The `wallPropsNodeGroup` param object (`:245-253`) has no `numFloors`/`floors`
field, and both call sites (`:354`, `:360`) omit it. `numFloors`
(`:325` `Math.max(2, params.floors)`) drives every other group (walls, pillars).
The caller filters with `removeFromTop: numFloors - 2` (`:358`), but with no
instances above floor 5 every floor from 6 up gets zero props. For small buildings
the `removeFromTop` filter (`:284`) happens to mask the excess, so the bug only
surfaces for tall buildings.

### Fix
Add `numFloors` to the `wallPropsNodeGroup` param object, pass it from both call
sites, and loop `for (let floor = 1; floor < numFloors; floor++)` (matching the
floor range the rest of the generator uses). Remove the magic `5`.

---

## Impact
Wall and prop instance counts diverge from Blender ground truth (H08) and props
silently stop scaling with building height past 6 floors (M15). The two together
mean the buildify demo output is neither Blender-faithful nor fully reactive to
`floors`/`moduleWidth`.

## Files
- `plugins/procedural-generation/src/generators/buildify_demo_1.ts:111,158,264` — Math.round vs Blender floor (H08)
- `plugins/procedural-generation/src/generators/buildify_demo_1.ts:276` — hardcoded `<= 5` floors (M15)
- `plugins/procedural-generation/src/generators/buildify_demo_1.ts:245-253,354,360` — numFloors not a wallPropsNodeGroup param (M15)
- `plugins/procedural-generation/src/blender/geometry_nodes.ts:112` — `resampleCurve` helper that uses the correct floor (reference for H08)
