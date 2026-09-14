# InteractionPromptPlugin: numeric `autoStartOnObjectLoadDelay` decorated `@uiToggle()` (should be `@uiInput()`)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`autoStartOnObjectLoadDelay` is a numeric delay used in arithmetic, but it is exposed in the UI as a checkbox via `@uiToggle()`. Toggling the checkbox coerces the value to a boolean, corrupting the delay math.

## Root Cause
```ts
@serialize()
@uiToggle() autoStartOnObjectLoadDelay = 3000
```
Used at: `this.lastActionTime = now() - this.autoStartDelay + this.autoStartOnObjectLoadDelay`. Sibling delay/duration fields (`animationDuration`, `autoStartDelay`, etc.) all use `@uiInput()`. This looks like a copy-paste of the decorator from the adjacent `@uiToggle() autoStartOnObjectLoad` boolean line.

## Impact
Using the UI control turns the 3000 ms delay into `true`/`false` (→ 1/0 in the arithmetic), corrupting the auto-start timing.

## Fix
```ts
@uiInput() autoStartOnObjectLoadDelay = 3000
```

## Files
- `src/plugins/interaction/InteractionPromptPlugin.ts:85-86` — numeric field decorated `@uiToggle()`
