# three-svg-renderer computePolygons: leaks Arrangement2D (WASM/embind) objects every call

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`computePolygons` allocates embind/WASM objects — a `PointList`, two `Point`s per chain segment, and an `ArrangementBuilder` — but only destroys the output `Polygon`/`PolygonList`/inside-point. The `PointList`, every `Point`, and the `ArrangementBuilder` are never freed, leaking WASM heap on every call.

## Root Cause
```ts
const points = new Arr2D.PointList();         // never destroyed
let a, b;
for (const chain of visibleChains) {
    a = new Arr2D.Point(...);                  // never destroyed
    for (let i=1; i<chain.vertices.length; i++) {
        b = new Arr2D.Point(...);              // never destroyed
        points.push_back(a); points.push_back(b);
        a = b;
    }
}
const builder = new Arr2D.ArrangementBuilder(); // never destroyed
const arr2DPolygonlist = builder.getPolygons(points);
// ...
Arr2D.destroy(arr2DPolygon);     // freed
Arr2D.destroy(arr2DPolygonlist); // freed
Arr2D.destroy(p);                // freed
```
`arrangement-2d-js` is an emscripten/embind module; `new Arr2D.X(...)` heap-allocates and must be released with `Arr2D.destroy(...)`. Only the three output objects are freed.

## Impact
`Arr2DPromise` is a single shared global module, so the leaked `2*Σ(edges)` `Point` objects, the `PointList`, and the `ArrangementBuilder` accumulate on the WASM heap across every `generateSVG`/viewmap build and are never reclaimed by JS GC.

## Fix
After `getPolygons`, `Arr2D.destroy(points)` and `Arr2D.destroy(builder)`; destroy each `Point` after `push_back` (embind copies into the list) or track and free them in a final loop.

## Files
- `plugins/svg-renderer/src/three-svg-renderer/core/viewmap/operations/computePolygons.ts:44-58` — allocations never freed (only outputs at 87/89/90 are destroyed)
