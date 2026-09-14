# ViewHelper2.dispose: WebGLRenderer (and its GL context) never disposed

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`ViewHelper2` creates a dedicated `WebGLRenderer` in its constructor but `dispose()` never disposes it, leaking a full WebGLRenderer + GL context on every add/remove cycle.

## Root Cause
```ts
// constructor (line 111)
this.renderer = new WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
})
// ...
dispose() {
    this.axesLines.geometry.dispose();
    (this.axesLines.material as Material).dispose()
    this.backgroundSphere.geometry.dispose();
    (this.backgroundSphere.material as Material).dispose()
    this.spritePoints.forEach((sprite) => {
        sprite.material.map!.dispose()
        sprite.material.dispose()
    })
    this.domContainer.remove()
    // never calls this.renderer.dispose()
}
```

`dispose()` releases geometries, materials, sprite maps, and the DOM container, but never `this.renderer.dispose()` nor releases its WebGL context.

## Impact
The only consumer, `EditorViewWidgetPlugin`, creates a new `ViewHelper2` on viewer add and calls `this.widget?.dispose()` on remove. Each add/remove cycle (re-attaching the plugin, switching the viewer/canvas) leaks a WebGLRenderer + GL context. Browsers cap live WebGL contexts (~16), so repeated cycles eventually force-lose older contexts. Since `dispose` clearly intends to release all resources (it disposes everything else), the missing renderer disposal is an omission.

## Fix
Add `this.renderer.dispose()` in `dispose()` (and ideally `this.renderer.forceContextLoss()` then drop `this.renderer.domElement`).

## Files
- `src/three/utils/ViewHelper2.ts:262-280` — `dispose()` omits `this.renderer.dispose()`
- `src/three/utils/ViewHelper2.ts:111-116` — dedicated `WebGLRenderer` created in constructor
