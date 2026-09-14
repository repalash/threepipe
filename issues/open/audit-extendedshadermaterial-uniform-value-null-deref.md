# ExtendedShaderMaterial: `_setUniformTexSize` dereferences `uniform.value` before the null-check

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`_setUniformTexSize` reads `uniform.value.isVector2` before guarding that `uniform.value` exists. If a registered `<id>Size` uniform has a `null`/`undefined` value, the `.isVector2` access throws a `TypeError`. The `last && ...` guard that would protect it appears only on the next line, after the crash point.

## Root Cause
```ts
private _setUniformTexSize(uniform?: IUniform, t?: {width: number, height: number}) {
    if (!t || !uniform) return
    const w = t?.width ?? 512
    const h = t?.height ?? 512
    const last = uniform.value
    if (!last.isVector2) console.warn('uniform is not a Vector2')   // reads last.isVector2 with no null guard
    if (last && Math.abs(last.x - w) + Math.abs(last.y - h) > 0.1) { // guards `last` here — too late
        ...
    }
}
```
Line `if (!last.isVector2)` dereferences `last` unconditionally; the `last &&` guard is on the line below.

## Impact
Reachable from `onBeforeRender`, which passes `this.uniforms.screenSize` and `this.uniforms[textureID + 'Size']`. Any registered size uniform whose `.value` is `null`/`undefined` throws during render, breaking the frame for that material.

## Fix
Move the null guard before the `.isVector2` read:
```ts
const last = uniform.value
if (!last) return
if (!last.isVector2) console.warn('uniform is not a Vector2')
if (Math.abs(last.x - w) + Math.abs(last.y - h) > 0.1) { ... }
```

## Files
- `src/core/material/ExtendedShaderMaterial.ts:44` — `last.isVector2` read before the `last &&` null-guard on line 45
