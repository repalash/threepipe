# RenderTargetManager.releaseTempTarget: unguarded `.length` throws if the key's released-pool was cleared (post-dispose)

**Severity:** low
**Found:** 2026-06-13 code audit

## Bug
`releaseTempTarget` reads `this._releasedTempTargets[key].length` with no null-guard. The pool array for a key is only created in `_processNewTempTarget`. After `dispose(true)` resets `this._releasedTempTargets = {}`, releasing a temp target still held by a pass hits `undefined.length` → `TypeError: Cannot read properties of undefined (reading 'length')`.

## Root Cause
```ts
releaseTempTarget(target: IRenderTarget): void {
    const key = target.targetKey
    if (!key || !target.isTemporary) throw 'Not a temp target'
    if (this._releasedTempTargets[key].length > this.maxTempPerKey) {   // [key] may be undefined after dispose
        this.removeTrackedTarget(target)
        target.dispose()
    } else this._releasedTempTargets[key].push(target)
}
```
Reachability: via manually disposing/unregistering a pass that holds a preserved temp target (e.g. `ExtendedRenderPass._opaqueTarget`/`_transparentTarget`) after the pools were cleared. (Standard viewer teardown does not dispose registered passes — see related issue — so it does not normally trigger this.)

## Impact
Throws on `releaseTempTarget` for a temp target whose key pool was cleared.

## Fix
Guard the pool access:
```ts
const pool = this._releasedTempTargets[key] ??= []
if (pool.length > this.maxTempPerKey) { ... } else pool.push(target)
```

## Files
- `src/rendering/RenderTargetManager.ts:113-122` — unguarded `this._releasedTempTargets[key].length`
- `src/rendering/RenderTargetManager.ts:176` — pool array created only in `_processNewTempTarget`
