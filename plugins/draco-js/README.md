# @threepipe/plugin-draco-js

Decode Draco-compressed meshes in [threepipe](https://threepipe.org/) with the pure-JavaScript
[draco.js](https://github.com/mrdoob/draco.js) decoder instead of the default WebAssembly decoder —
**~4× smaller** over the wire, **no `.wasm` fetch, no worker, no CDN**, and Node/SSR-safe — with an
automatic WASM fallback so nothing ever breaks.

[Github](https://github.com/repalash/threepipe/tree/master/plugins/draco-js) &mdash;
[Example](https://threepipe.org/examples/#draco-js-plugin/) &mdash;
[API Reference](https://threepipe.org/docs/)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)

**Documentation and Guides**: [threepipe.org/package/plugin-draco-js](https://threepipe.org/package/plugin-draco-js.html)

## Installation

```bash
npm install @threepipe/plugin-draco-js
```

## Usage

```typescript
import {ThreeViewer} from 'threepipe'
import {DracoJSDecodePlugin} from '@threepipe/plugin-draco-js'

const viewer = new ThreeViewer({canvas})
viewer.addPluginSync(DracoJSDecodePlugin)

// Draco meshes (standalone .drc and glTF KHR_draco_mesh_compression) now decode via pure JS,
// with automatic WASM fallback on anything unsupported.
const model = await viewer.load('model.glb')
```

Remove the plugin (`viewer.removePlugin(DracoJSDecodePlugin)`) to restore the default WASM decoder.

## How it works

The plugin reversibly replaces the registered `.drc` importer on the viewer's `AssetImporter` with
one backed by `DRACOLoader2Pure`. Since `GLTFLoader2` pulls its Draco decoder from that same
registration, both standalone `.drc` loads and glTF `KHR_draco_mesh_compression` loads go through
the pure-JS path.

`DRACOLoader2Pure` extends threepipe's default `DRACOLoader2`, so it keeps the WASM **encoder**
(used for Draco *export*) and inherits standalone `.drc` → `Mesh` handling. The draco.js decoder
itself is **lazy-loaded** via dynamic `import()` the first time a Draco mesh is decoded.

## Universal WASM fallback

draco.js decodes triangle meshes in Draco bitstream version 2.2 (EdgeBreaker and sequential
connectivity) — what current Draco encoders and glTF `KHR_draco_mesh_compression` exporters write.
For anything it cannot decode (point clouds, bitstreams older than 2.2) **or any decode error**,
`DRACOLoader2Pure` transparently falls back to the WASM decoder.

```typescript
import {DRACOLoader2Pure} from '@threepipe/plugin-draco-js'

DRACOLoader2Pure.EnableFallback = true  // default — fall back to WASM on unsupported/error
DRACOLoader2Pure.LogFallback = true     // default — warn when a fallback happens
DRACOLoader2Pure.fallbackCount          // diagnostics: how many decodes fell back to WASM
```

## Tradeoffs

| | draco.js (this plugin) | WASM (default `DRACOLoader2`) |
|---|---|---|
| Loader size (gzip) | **~24 KB** minified (~36 KB for the unminified `dist` files) | ~100 KB |
| Decoder init | none | worker spawn + wasm instantiate (+ CDN fetch by default) |
| Decode speed | about the same (upstream reports ~1.0–1.4× the WASM decode time) | — |
| Threading | main thread (blocks while a mesh decodes) | worker pool (parallel, non-blocking) |
| Node.js / SSR | works as-is (streams that need the fallback do not) | needs worker/wasm setup |
| Encode (export) | not supported by draco.js (the `DRACOLoader2` encoder is kept) | supported |

Because the WASM decoder pays a per-load worker/wasm init that draco.js avoids, draco.js tends to
win **total** time for small/medium models on a cold start (e.g. QuickLook-style one-shot previews),
while the WASM decoder keeps the main thread free and decodes meshes in parallel, which matters for
large/heavy scenes. Output is byte-for-byte equivalent to the WASM decoder (validated against it in
the adapter unit test).

## Roadmap — future default

This plugin is **opt-in** today because [draco.js](https://github.com/mrdoob/draco.js) is very new
(decode-only, meshes only, no releases or npm package yet — it is vendored at a pinned commit, see
`src/dracojs/NOTICE.md`).

**Once draco.js is stable** — published to npm, and the benchmark crossover validated on real asset
mixes — **this can be promoted to the default Draco decoder in threepipe**
(likely as a size-aware default: pure-JS for small/medium meshes, WASM for large ones), with the
WASM path kept only as a fallback. Until then it stays an explicit, reversible opt-in.

## Licensing / attribution

This plugin is Apache-2.0. It vendors the draco.js build (`src/dracojs/`), which is MIT (© Mr.doob)
and itself a port of Google Draco (Apache-2.0, © The Draco Authors). Attribution for both is
included in `src/dracojs/` — `LICENSE` (draco.js, MIT), `LICENSE-Apache-2.0` (Google Draco), and
`NOTICE.md`.
