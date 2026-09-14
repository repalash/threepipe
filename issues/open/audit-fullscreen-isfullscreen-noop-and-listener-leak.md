# FullScreenPlugin: `isFullScreen()` no-op comparison + fullscreenchange listeners leak on failed enter

**Severity:** low
**Found:** 2026-06-13 code audit

Two related defects in the same plugin, grouped.

## Bug 1: `isFullScreen()` third clause is a no-op and the standard API is never checked
```ts
isFullScreen() {
    return (document as any).webkitIsFullScreen ||
        (document as any).mozFullScreen ||
        (document as any).msFullscreenElement !== undefined
}
```
In standard Chrome/Edge/Firefox, `document.msFullscreenElement` is `undefined`, so `undefined !== undefined` is `false` — the third clause never contributes. More importantly the function never checks the standard `document.fullscreenElement`, so detection relies entirely on non-standard `webkitIsFullScreen`/`mozFullScreen`. On a browser exposing only the standard API (or fullscreen entered on a non-canvas element), `isFullScreen()` can return false while in fullscreen, breaking `toggle()`.

### Fix
```ts
return document.fullscreenElement != null
    || (document as any).webkitFullscreenElement != null
    || (document as any).webkitIsFullScreen
    || (document as any).mozFullScreen
    || (document as any).msFullscreenElement != null
```

## Bug 2: fullscreenchange listeners leak if entering fullscreen never succeeds
`enter()` unconditionally adds four `*fullscreenchange` listeners before calling `requestFullscreen()`. They are removed only inside `_fsChangeHandler`'s exit branch, which runs only when a fullscreenchange event actually fires and `isFullScreen()` is false. If the browser rejects/ignores `requestFullscreen()` (e.g. no user gesture, or the promise rejects), no change event fires and the four listeners stay registered. Repeated failed `enter()` calls accumulate duplicate listeners on `document`.

### Fix
Remove any existing handlers before re-adding (or use `{once:true}` / a single standard `fullscreenchange` listener), and catch the `requestFullscreen` rejection to clean up.

## Files
- `src/plugins/interaction/FullScreenPlugin.ts:111-115` — `isFullScreen()` no-op comparison, no standard-API check
- `src/plugins/interaction/FullScreenPlugin.ts:70-73` — four listeners added in `enter()`
- `src/plugins/interaction/FullScreenPlugin.ts:50-53` — listeners removed only in the handler's exit branch
