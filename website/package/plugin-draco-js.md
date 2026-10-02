---
prev:
    text: '@threepipe/plugin-gltf-transform'
    link: './plugin-gltf-transform'

next:
    text: '@threepipe/plugins-extra-importers'
    link: './plugins-extra-importers'

---

# @threepipe/plugin-draco-js

[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/draco-js/src/index.ts) &mdash;
[Example](https://threepipe.org/examples/#draco-js-plugin/) &mdash;
[API Reference](https://threepipe.org/plugins/draco-js/docs)

```bash
npm install @threepipe/plugin-draco-js
```

Decode Draco-compressed meshes (standalone `.drc` and glTF `KHR_draco_mesh_compression`) with the
pure-JavaScript [draco.js](https://github.com/mrdoob/draco.js) decoder instead of the default
WebAssembly decoder — **~4× smaller** over the wire, **no `.wasm` fetch, no worker, no CDN**, and
Node/SSR-safe — with an automatic WASM fallback so nothing ever breaks.

## DracoJSDecodePlugin

```typescript
import {ThreeViewer} from 'threepipe'
import {DracoJSDecodePlugin} from '@threepipe/plugin-draco-js'

const viewer = new ThreeViewer({canvas})
viewer.addPluginSync(DracoJSDecodePlugin)

// Draco meshes now decode via pure JS, with automatic WASM fallback on anything unsupported.
const model = await viewer.load('model.glb')
```

The plugin reversibly replaces the registered `.drc` importer on the viewer's `AssetImporter` with
one backed by `DRACOLoader2Pure`. Since `GLTFLoader2` pulls its Draco decoder from that same
registration, both standalone `.drc` loads and glTF `KHR_draco_mesh_compression` loads use the
pure-JS path. Removing the plugin restores the default WASM decoder. Add the plugin before loading any Draco file, a Draco loader that was already created keeps being used. The draco.js decoder is
**lazy-loaded** via dynamic `import()` the first time a Draco mesh is decoded.

## Universal WASM fallback

draco.js decodes triangle meshes in Draco bitstream version 2.2 (EdgeBreaker and sequential
connectivity) — what current Draco encoders and glTF `KHR_draco_mesh_compression` exporters write.
For anything it cannot decode (point clouds, bitstreams older than 2.2) **or any decode error**,
`DRACOLoader2Pure` transparently falls back to the WASM decoder (`DRACOLoader2Pure.EnableFallback`,
`LogFallback`, `fallbackCount`).

## Tradeoffs

| | draco.js (this plugin) | WASM (default `DRACOLoader2`) |
|---|---|---|
| Loader size (gzip) | **~24 KB** minified (~36 KB for the unminified `dist` files) | ~100 KB |
| Decoder init | none | worker spawn + wasm instantiate (+ CDN fetch by default) |
| Decode speed | about the same (upstream reports ~1.0–1.4× the WASM decode time) | — |
| Threading | main thread (blocks while a mesh decodes) | worker pool (parallel, non-blocking) |
| Node.js / SSR | works as-is (streams that need the fallback do not) | needs worker/wasm setup |
| Encode (export) | not supported by draco.js (the `DRACOLoader2` encoder is kept) | supported |

draco.js tends to win **total** time for small/medium models on a cold start (no worker/wasm init),
while WASM keeps the main thread free and decodes meshes in parallel, which matters for large scenes.
Output is byte-for-byte equivalent to the WASM decoder.

## Future default

This plugin is **opt-in** today because draco.js is very new (decode-only, meshes only, no releases
or npm package yet — it is vendored at a pinned commit). **Once draco.js is stable** — published to npm and the size-aware crossover validated —
it can be promoted to the default Draco decoder in threepipe (with WASM kept as the fallback). Until
then it stays an explicit, reversible opt-in.

The vendored decoder is a port of Google Draco (Apache-2.0, © The Draco Authors) by Mr.doob (MIT);
attribution for both is included in `plugins/draco-js/src/dracojs/` (`LICENSE`, `LICENSE-Apache-2.0`,
`NOTICE.md`).
