# DRACOLoader2: eliminate `eval` by moving gltf-transform decoder/encoder into a Worker

**Created:** 2026-04-18
**Status:** Open — low priority, optional refactor
**Scope:** `@threepipe/plugin-gltf-transform` only (core threepipe DRACO loading is unaffected)

## Context

`DRACOLoader2.initDecoder()` and `DRACOLoader2.initEncoder()` use indirect `eval` to instantiate the draco emscripten modules on the main thread. These are the only consumers of that `eval` in the project.

Call graph (verified via grep):

- `initDecoder()` — called from:
  - `plugins/gltf-transform/src/GLTFDracoExporterBase.ts:57` (DRACO GLB export)
  - `plugins/gltf-transform/src/GLTFSpecGlossinessConverterPluginBase.ts:81` (spec-gloss conversion of DRACO-compressed imports)
- `initEncoder()` — called from:
  - `plugins/gltf-transform/src/GLTFDracoExporterBase.ts:56` (DRACO GLB export)

Standard threepipe DRACO paths (`.drc` loading, DRACO-compressed GLB loading via GLTFLoader) do **not** use our `eval` — they go through three.js's `DRACOLoader.decodeGeometry()` → Worker pool → `new Worker(blobUrl)`, which executes the draco JS through the Worker API instead.

## Why `eval` is there today

The draco files at the default CDN (`cdn.jsdelivr.net/gh/google/draco@1.5.6/javascript/`) and on the `draco3d` npm package are **UMD/IIFE scripts, not ES modules**. They declare `var DracoDecoderModule = ...` as a global and expect to be loaded via `<script>` tag (or similar script-execution context).

Researched 2026-04-18:
- Latest draco release: **1.5.7** (January 2021 — 5+ years stale)
- google/draco issue [#977 "Modernizing Draco package - ES modules"](https://github.com/google/draco/issues/977) opened Feb 2023 has **0 comments and no linked PR**. No ESM work in flight.
- `draco3d@1.5.7` npm package has no `module`/`exports` fields, no `.mjs` files. `draco3dgltf@1.5.7` is the same story.
- Repo is maintained (dependabot bumps through April 2026) but has no JS modernization on the roadmap.

So `import(blobUrl)` / `await import('draco3d')` is **not an option today** — the source is not an ES module.

Alternatives we ruled out for the main-thread path:
- `<script>` tag injection — async, browser-only (breaks Node/worker), pollutes global scope
- `new Function(body)()` — `var` declarations stay local, breaks emscripten's globals assumption
- `eval` (indirect) — works in browser main, workers, and Node; load-bearing

Three.js avoids `eval` by **not executing draco JS on the main thread at all** — it stitches the text into a Blob and calls `new Worker(blobUrl)`. The browser's worker runtime executes the script as if it were loaded via `<script>`, with `DracoDecoderModule` becoming a worker global. Decoding happens inside the worker; the main thread talks to it via `postMessage`.

## Proposed refactor

Port the three.js Worker pattern to the gltf-transform plugin's use case:

1. Spin up a dedicated Worker from a Blob containing:
   - The draco decoder/encoder JS (loaded as text like today, via `_loadLibrary` caching in `LibraryValueMap`)
   - A small RPC shim that exposes `createDecoder(config)` / `createEncoder(config)` and forwards the Module's public surface (e.g. `DT_FLOAT32` constants, `Decoder`/`Encoder` class methods) over `postMessage`.
2. Replace `initDecoder()` / `initEncoder()` with proxy objects that route gltf-transform's synchronous-looking API calls through async `postMessage` round-trips.
3. Gltf-transform's `KHRDracoMeshCompression.install('draco3d.decoder', module)` uses the module synchronously (e.g. `decoderModule.DT_FLOAT32`) — so the proxy would need to either:
   - (a) Pre-fetch all constants at init time and expose them as a plain object, plus wrap `Decoder`/`Encoder` constructors to return proxies, OR
   - (b) Run all gltf-transform encode/decode work inside the worker (copy the gltf-transform document over, operate on it, ship results back) — bigger change, cleaner boundary.

Option (b) is probably the right one — gltf-transform already supports running in workers, and the document is serializable.

## Benefits

- Removes the only `eval` usage in threepipe
- Aligns plugin DRACO handling with the three.js main-thread policy
- Frees main thread from emscripten module instantiation (faster cold start for large scenes)
- Makes DRACO encode/decode offloadable (doesn't block render loop during export)

## Costs / caveats

- Non-trivial refactor of `GLTFDracoExporterBase` and `GLTFSpecGlossinessConverterPluginBase`
- Worker is a browser API — Node (with current polyfill) does not have Worker; would need `worker_threads`-based polyfill or conditional code path
- Blob URL lifecycle management (revoke on dispose)
- Structured-clone overhead for large GLB buffers crossing the boundary
- Some CSP policies block `worker-src blob:` — same constraint three.js already lives with

## Recommendation

Revisit if/when one of:

- google/draco ships ESM (issue #977 merges) — then `import(blobUrl)` or direct `import 'draco3d'` becomes viable, which is simpler than the Worker refactor
- We observe main-thread jank during DRACO export in real workloads
- A security review flags the `eval` as unacceptable

Until then, the current `eval`-based implementation (post the 2026-04 fix that enabled WASM by default and fixed the async init callback) is the correct scope of change.

## References

- [google/draco issue #977 — Modernizing Draco package (ES modules)](https://github.com/google/draco/issues/977)
- [three.js `DRACOLoader.js` (r183)](https://github.com/mrdoob/three.js/blob/master/examples/jsm/loaders/DRACOLoader.js) — reference Worker pattern
- `src/assetmanager/import/DRACOLoader2.ts` — current `initDecoder` / `initEncoder`
- `plugins/gltf-transform/src/GLTFDracoExporterBase.ts` — consumer
- `plugins/gltf-transform/src/GLTFSpecGlossinessConverterPluginBase.ts` — consumer
