# GlobeControls2: numeric nearMargin / farMargin annotated with @uiToggle instead of @uiInput

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`nearMargin` and `farMargin` are continuous numeric multipliers, but both are annotated `@uiToggle()`, which renders a boolean checkbox. The UI cannot set arbitrary float values (clicking writes `true`/`false`).

## Root Cause
```ts
@uiToggle() @serialize() declare nearMargin: number
@uiToggle() @serialize() declare farMargin: number
```
In upstream `GlobeControls` these are continuous numeric multipliers (`this.nearMargin = 0.25; this.farMargin = 0;`, used as `maxRadius * nearMargin` / `maxRadius * farMargin`). Every other numeric property in the same class uses `@uiInput()`.

## Impact
UI-only defect: the two margins render as toggles and can only be set to `true`/`false` from the panel. Serialization is unaffected (`@serialize()` is type-agnostic).

## Fix
Change both to `@uiInput()`.

## Files
- `plugins/3d-tiles-renderer/src/GlobeControlsPlugin.ts:46-47` — `nearMargin` / `farMargin` with `@uiToggle()`
