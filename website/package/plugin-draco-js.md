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
pure-JS path. Removing the plugin restores the default WASM decoder. The draco.js decoder is
**lazy-loaded** via dynamic `import()` the first time a Draco mesh is decoded.

## Universal WASM fallback

draco.js implements only the EdgeBreaker triangle-mesh path — exactly what glTF
`KHR_draco_mesh_compression` uses in practice. For anything it cannot decode (sequential
connectivity, point clouds, KD-tree, metadata) **or any decode error**, `DRACOLoader2Pure`
transparently falls back to the WASM decoder (`DRACOLoader2.EnableFallback`, `LogFallback`,
`fallbackCount`).

## Tradeoffs

| | draco.js (this plugin) | WASM (default `DRACOLoader2`) |
|---|---|---|
| Loader size (gzip) | **~25 KB** | ~100 KB |
| Decoder init | none | worker spawn + wasm instantiate (+ CDN fetch by default) |
| Decode speed | ~2× slower | faster |
| Node.js / SSR | works as-is | needs worker/wasm setup |
| Encode (export) | not supported (falls back to WASM) | supported |

draco.js tends to win **total** time for small/medium models on a cold start (no worker/wasm init),
while WASM pulls ahead on large meshes where decode throughput dominates. Output is byte-for-byte
equivalent to the WASM decoder.

## Future default

This plugin is **opt-in** today because draco.js is very new (decode-only, EdgeBreaker-only,
pre-release). **Once draco.js is stable** — published to npm and the size-aware crossover validated —
it can be promoted to the default Draco decoder in threepipe (with WASM kept as the fallback). Until
then it stays an explicit, reversible opt-in.

The vendored decoder is a port of Google Draco (Apache-2.0, © The Draco Authors) by Mr.doob (MIT);
attribution for both is included in `plugins/draco-js/src/dracojs/` (`LICENSE`, `LICENSE-Apache-2.0`,
`NOTICE.md`).
