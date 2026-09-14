# webgi SSGIPlugin: per-material "Enabled" toggle (`ssgiDisabled`) has no effect

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The per-material SSGI "Enabled" checkbox writes `material.userData.ssgiDisabled`, but `onObjectRender` (which computes the `SSRTAO_ENABLED` define) never reads `ssgiDisabled` — it only consults `ssrtaoDisabled` and `ssaoDisabled`. So toggling the per-material checkbox does nothing.

## Root Cause
```ts
// onObjectRender
let x: any = this.enabled
    && (this.renderWithCamera || renderer.renderManager.frameCount > 1) &&
    renderer.userData.screenSpaceRendering !== false &&
    !material.userData?.pluginsDisabled &&
    !material.userData?.ssrtaoDisabled &&
    !material.userData?.ssaoDisabled ? this.split > 0 ? 2 : 1 : 0
```
```ts
// _getUiConfig — the toggle writes a field nobody reads in the render path
set value(v) {
    if (v === !(material.userData.ssgiDisabled ?? false)) return
    material.userData.ssgiDisabled = !v
    material.setDirty()
}
```
`grep` confirms the only reads of `ssgiDisabled` are inside the UI getter/setter itself. Compare `SSReflectionPlugin`, whose `onObjectRender` correctly reads `material.userData?.ssreflDisabled` (the field its UI writes) — that one works.

## Impact
The per-material "Enabled" SSGI toggle is dead: SSGI keeps applying regardless of the checkbox state.

## Fix
Add `&& !material.userData?.ssgiDisabled` to the `x` expression in SSGI `onObjectRender` (the define flip already triggers `needsUpdate`/cache-key change).

## Files
- `experiments/threepipe-webgi/src/plugins/postprocessing/SSGIPlugin.ts:453-460` — `onObjectRender` omits `ssgiDisabled`
- `experiments/threepipe-webgi/src/plugins/postprocessing/SSGIPlugin.ts:505-522` — UI toggle that writes `ssgiDisabled`
- `experiments/threepipe-webgi/src/plugins/postprocessing/SSReflectionPlugin.ts:443-447` — the correct equivalent (`ssreflDisabled`)
