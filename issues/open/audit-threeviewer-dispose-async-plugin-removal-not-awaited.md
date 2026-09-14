# ThreeViewer.dispose: async plugin removal not awaited; scene/renderManager torn down concurrently

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`dispose()` is synchronous. For async plugins it calls `this.removePlugin(plugin, true)` (an `async` method returning a Promise) without awaiting or catching it, then immediately disposes the scene and renderManager. Any async plugin whose `onRemove` touches the scene/renderManager now races with their disposal, and any rejection is silently swallowed.

## Root Cause
```ts
public dispose(clear = true): void {
    this.renderEnabled = false
    // TODO - return promise?
    if (clear) {
        ...
        for (const plugin of asyncPlugins) {
            this.removePlugin(plugin, true)        // async, not awaited (removePlugin is `async`)
        }
    }
    this._scene.dispose(clear)                     // runs before async removals settle
    this.renderManager.dispose(clear)
    ...
}
```
There is already a `// TODO - return promise?` acknowledging the sync/async mismatch.

## Impact
Async plugin teardown races with scene/renderManager disposal; pending cleanup that references those subsystems can hit disposed state, and un-awaited promise rejections are swallowed.

## Fix
Make `dispose` async (or collect the promises and at minimum attach `.catch`), and tear down scene/renderManager only after plugin removal settles.

## Files
- `src/viewer/ThreeViewer.ts:741-778` — sync dispose; `removePlugin(plugin, true)` at line 759 not awaited; scene/renderManager disposed at 763-764
