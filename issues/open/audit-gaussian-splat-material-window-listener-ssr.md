# GaussianSplatMaterialExtension / Raw: `window.addEventListener` in constructor (SSR/Node crash + lifecycle asymmetry)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
The material extension adds a `window` resize listener unconditionally in its constructor and removes it only in `dispose()`. An unguarded `window.addEventListener` at construction time throws in Node when `window` is undefined, and the add/remove lifecycle is wrong (tied to construct/dispose rather than mesh attach/detach).

## Root Cause
```ts
constructor() {
    window.addEventListener('resize', this._refresh)
}

dispose() {
    // todo: add again on added to mesh?
    window.removeEventListener('resize', this._refresh)
}
```
The extension is constructed eagerly inside the `GaussianSplatMaterialUnlit`/`Physical` constructors. threepipe is documented Node-safe with polyfill — this is exactly the kind of browser-only API that is not Node-safe, used at construction time without a guard. The `// todo` at line 78 acknowledges the lifecycle is wrong: if `dispose` is called and the material reused, the listener is gone but never re-added. The same pattern exists in `GaussianSplatMaterialRaw`.

## Impact
Constructing a gaussian-splat material in Node/SSR throws `ReferenceError`/`TypeError`. In the browser, a dispose+reuse leaves the resize listener permanently gone.

## Fix
Guard with `typeof window !== 'undefined'`, and tie listener add/remove to material attach/detach rather than construct/dispose.

## Files
- `plugins/gaussian-splatting/src/three-gaussian-splat/materials/GaussianSplatMaterialExtension.ts:73-80` — unguarded `window` listener in ctor (`// todo` at 78)
- `plugins/gaussian-splatting/src/three-gaussian-splat/materials/GaussianSplatMaterialRaw.ts:37` — same pattern

## Related
- `audit-gaussian-splat-leaks-and-limits.md`, `audit-gaussian-splat-geometry-buffer-aliasing.md`
