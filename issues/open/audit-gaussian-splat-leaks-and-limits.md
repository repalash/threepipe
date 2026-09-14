# Gaussian splatting: worker/listener leaks, per-splat WASM sorter never freed (8-load ceiling), over-allocated sort buffer

**Severity:** medium
**Found:** 2026-06-13 code audit

Three tightly-related lifecycle/resource defects in the gaussian-splatting plugin. Grouped because they share the `SortWorkerManager` / per-splat worker ownership story.

## Bug 1 — per-splat WASM sorter never disposed; hard 8-load ceiling (the worst one)
Each loaded `.splat` calls `sortWorkerManager.createWorker(...)`, which instantiates a comlink `WasmSorter` whose `load()` does three `_malloc`s on the WASM heap and pushes the remote into `SortWorkerManager._workers`. `disposeWorker(...)` — the only path that calls `worker.dispose()` (freeing those buffers) and removes the entry from `_workers` — has **zero callers** anywhere in the codebase. When a splat mesh is disposed, the plugin's `onDispose` only filters the mesh out of `this.splats`; it never disposes the worker.

```ts
// ThreeGaussianSplatPlugin.ts
l.onDispose = (mesh: GaussianSplatMesh)=>{ // todo: dispose should only remove from GPU?
    this.splats = this.splats.filter(splat=>splat !== mesh)
}
```
```ts
// SortWorkerManager.ts
private _maxWorkers = 8
async createWorker(data, maxSplats = 1000000) {
    if (this._workers.length < this._maxWorkers) { ... this._workers.push(worker); return worker }
    console.error('Max workers reached')
    throw new Error('Max workers reached')   // hard throw after 8 ever-loaded splats
}
async disposeWorker(worker) { ... }          // never called
```
**Impact:** every load/dispose cycle leaks the per-splat WASM allocations (≥ `vertexCount*32` bytes + combined buffer). Worse, `_workers` grows unbounded and is never reclaimed, so after **8 splats have ever been loaded** (even if all were disposed) `createWorker` throws `'Max workers reached'` and no further splat can load — a hard functional ceiling, not just a leak.

## Bug 2 — SortWorkerManager + scene listeners leak on plugin remove
`onAdded` adds two scene listeners (`mainCameraUpdate`, `geometryUpdate`) and constructs a `SortWorkerManager` (which spawns a `Worker` in its constructor). `onRemove` only removes the importer:
```ts
private _sortWorkerManager = new SortWorkerManager() // todo: dispose?
onRemove(viewer: ThreeViewer) {
    viewer.assetManager.importer.removeImporter(this._importer)
}
```
**Impact:** asymmetric onAdded/onRemove — both scene listeners stay attached (capturing the stale `this._viewer`), the underlying `Worker` is never terminated, and `_ready` is never reset. Each add/remove cycle leaks a Web Worker + 2 listeners. `SortWorkerManager` has no `terminate()`/`dispose()` for the underlying worker at all.

## Bug 3 — worker `_calculateCombinedLength` over-allocates (spurious extra ×4 on the color term)
```ts
private _calculateCombinedLength(): number {
    return 4*4*this._vertexCount + 3*4*this._vertexCount + 3*4*this._vertexCount + 4*4*this._vertexCount * Float32Array.BYTES_PER_ELEMENT
}
```
`sort.cpp` writes `quat(4)+scale(3)+center(3)+color(4) = 14` floats/vertex = `56*vc` bytes. This computes `16vc + 12vc + 12vc + (16vc*4) = 104vc` bytes — nearly double. The color term has a spurious `* Float32Array.BYTES_PER_ELEMENT` (it already multiplies by 4). The C++ `_malloc(combinedLength)` then over-allocates 104vc and `runSort` copies 104vc from the WASM heap (the extra ~48vc bytes are uninitialized heap). `_extractViews` only reads the first 56vc bytes so it renders correctly, but every sort allocates and transfers ~2× the needed memory main↔worker.

## Fix
- Bug 1: wire the mesh's `onDispose` (or the geometry's `dispose`) to call `sortWorkerManager.disposeWorker(geometry._worker)` so the WASM buffers are freed and the slot reclaimed. The mesh must expose its worker to the dispose handler.
- Bug 2: in `onRemove`, remove both scene listeners, set `_ready = false`, and add a `dispose()`/`terminate()` to `SortWorkerManager` (terminate the underlying `Worker`) and call it.
- Bug 3: `return (4 + 3 + 3 + 4) * this._vertexCount * Float32Array.BYTES_PER_ELEMENT` (= 56vc).

## Files
- `plugins/gaussian-splatting/src/three-gaussian-splat/ThreeGaussianSplatPlugin.ts:39-41` — `onRemove` only removes importer
- `plugins/gaussian-splatting/src/three-gaussian-splat/ThreeGaussianSplatPlugin.ts:53` — `_sortWorkerManager` `// todo: dispose?`
- `plugins/gaussian-splatting/src/three-gaussian-splat/ThreeGaussianSplatPlugin.ts:65-67` — `onDispose` never disposes the worker
- `plugins/gaussian-splatting/src/three-gaussian-splat/loaders/SplatLoader.ts:32` — `createWorker` called once per splat load
- `plugins/gaussian-splatting/src/three-gaussian-splat/cpp-sorter/SortWorkerManager.ts:34-54` — `_maxWorkers=8`, `createWorker` throws at the ceiling, `disposeWorker` has no callers
- `plugins/gaussian-splatting/src/three-gaussian-splat/cpp-sorter/worker.ts:45-47` — over-allocated combined-buffer length

## Related
- `audit-gaussian-splat-geometry-buffer-aliasing.md` — separate buffer-aliasing hazard in the same geometry
- `audit-gaussian-splat-material-window-listener-ssr.md` — SSR-unsafe `window` listener in the material extension constructor
