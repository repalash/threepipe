# ThreeGpuPathTracerPlugin: 7 listeners with no onRemove (fire after removal) + camera `update` listener bound only to the original mainCamera

**Severity:** high
**Found:** 2026-06-13 code audit

Two related lifecycle defects in the path-tracer plugin. The first is the high-severity one (listeners fire on a disposed tracer and corrupt the render pipeline); the second is a stale-binding bug on the same listener set.

## Bug 1 (high) — 7 listeners, no `onRemove`, dispose leaves the tracer set
`onAdded` attaches seven listeners, all as inline anonymous arrows whose references are stored nowhere:
```ts
viewer.scene.addEventListener('sceneUpdate', () => { this.refreshScene() })            // 143
viewer.scene.addEventListener('mainCameraChange', () => { this.refreshScene() })        // 146
viewer.scene.addEventListener('materialUpdate', () => { ... this.tracer.updateMaterials(); this.reset() })   // 149
viewer.scene.addEventListener('environmentChanged', () => { ... this.tracer.updateEnvironment(); this.reset() }) // 154
viewer.renderManager.addEventListener('resize', () => { ... this.tracer.updateCamera(); this.reset() })      // 159
viewer.scene.mainCamera.addEventListener('update', () => { ... this.tracer.updateCamera(); this.reset() })   // 167
viewer.addEventListener('preFrame', () => { ... this.tracer.renderSample() ... })       // 172
```
The class has **no `onRemove`** (only a `// todo: onremove and ondispose ... remove event listeners` comment at line 119). `dispose()` disposes the tracer but removes none of the listeners and leaves `this.tracer` set (`= undefined` is commented out):
```ts
dispose() {
    super.dispose()
    if (this.tracer) { // todo do on plugin remove
        this.tracer.dispose()
        // this.tracer = undefined
    }
}
```
**Impact:** after the plugin is removed or disposed, all seven listeners stay attached and keep firing. `preFrame` still calls `this.tracer.renderSample()` on a disposed tracer and toggles `viewer.renderManager.defaultRenderToScreen` / `renderEnabled`, corrupting the render pipeline of whatever runs next. The captured `viewer` and tracer can never be GC'd. This is a concrete lifecycle violation, not just a leak.

## Bug 2 (medium) — camera `update` listener bound only to the original mainCamera
The `update` listener (line 167) is attached to the camera object that is current *at add time*. `RootScene.set mainCamera` swaps `_mainCamera` to a different `ICamera` instance and dispatches `mainCameraChange`. The plugin's `mainCameraChange` handler (146-148) only calls `refreshScene()` (sets a flag); it never moves/re-adds the `update` listener to the new camera, nor calls `tracer.setScene(..., newCamera)` with the new camera object. `setScene` is initially called with `viewer.scene.mainCamera` (line 134, `// todo: handle active camera change`).
**Impact:** after switching the active camera, orbiting/moving the new camera no longer resets path-trace accumulation via the per-frame `update`→`updateCamera`/`reset` path, leaving stale frames until some other event (resize/material) triggers a reset.

## Fix
- Store each listener in a field (or use `viewer.forPlugin` / the plugin's `_viewerListeners`), add an `onRemove` that removes all seven, set `this.tracer = undefined` after `dispose()`, and early-return in `preFrame` once removed.
- In the `mainCameraChange` handler, remove the `update` listener from `event.lastCamera` and add it to the new `viewer.scene.mainCamera`, then call `tracer.updateCamera()` / `reset()`.

## Files
- `plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts:119` — `// todo: onremove and ondispose` (no onRemove exists)
- `plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts:143-172` — the 7 listeners attached in `onAdded`
- `plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts:134` — `setScene(..., viewer.scene.mainCamera)` `// todo: handle active camera change`
- `plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts:146-148` — `mainCameraChange` handler only flags refresh
- `plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts:167-171` — `update` listener bound once to the original camera
- `plugins/path-tracing/src/ThreeGpuPathTracerPlugin.ts:402-408` — `dispose()` removes no listeners, leaves `tracer` set
