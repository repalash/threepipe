# GLTFLoader2: preserve texture source bytes to enable byte-stable GLB export

**Created:** 2026-04-18
**Status:** Open — to be done later (likely in the downstream fork)
**Depends on:** `TextureLoader2.SAVE_SOURCE_BLOBS` path landed 2026-04-18 (already in place for standalone image loads)

## Problem

`TextureLoader2.SAVE_SOURCE_BLOBS` (new) preserves raw compressed bytes on `texture.source._sourceImgBuffer` for raster images loaded directly via `AssetManager` (drag-drop image, `viewer.load('img.jpg')`, editor-authored textures). `GLTFWriter2.processTexture` has a fast path that uses these bytes to skip the non-deterministic canvas re-encode on export.

**But**: textures inside a GLB/GLTF file are loaded by three.js's `GLTFLoader`, which has its own internal image pipeline. It does **not** go through threepipe's `AssetManager` or `TextureLoader2`. So:

- The `TextureLoader2` flag has no effect on GLTF-loaded textures
- Their `_sourceImgBuffer` stays empty
- On GLB export, `GLTFWriter2.processTexture`'s fast path is skipped and three.js re-encodes via canvas
- Byte-unstable exports (varies by Chromium build + GL backend), quality loss, GPU readback cost

Concrete symptom: `tests/interactive.spec.ts:glb-draco-export` loads `DamagedHelmet.gltf` (textures come via GLTFLoader) and exports as DRACO GLB. The snapshot bytes differ between runs on different Chromium/GL backends (Playwright's bundled Chromium + SwiftShader vs system Chromium + Mesa/llvmpipe) — even though the DRACO mesh bytes are byte-identical, the JPEG texture bytes differ per-environment.

## Why it's not in the initial TextureLoader2 PR

three.js's `GLTFLoader` has a private-ish image loading path. It uses `loadImageSource(sourceIndex, loader)` (where `loader` is an `ImageBitmapLoader` or `ImageLoader`) and the `loader` is configured internally. Intercepting it cleanly requires either:

1. **Subclass GLTFLoader + override `loadImageSource`** — possible but brittle; the method signature and implementation can change across three.js versions. `GLTFLoader2` already subclasses and adds extension hooks, but this particular path isn't extension-friendly.
2. **Swap GLTFLoader's internal image loader** — `parser.fileLoader` / `parser.textureLoader` are instances held by the parser; replace with something that captures bytes. Requires identifying the right hook point in the parser.
3. **Intercept via the three.js loading manager** — every URL fetch goes through the manager. A manager-level `onLoad`/`onStart` hook could capture bytes for known image URLs. Sketchy (manager callbacks fire post-decode; bytes already gone).

Option 2 is probably cleanest. Needs investigation of three.js's `GLTFParser.loadImageSource` / `loadTextureImage` internals.

## Proposed approach (when done)

Inside `GLTFLoader2` (threepipe's subclass):

```ts
// pseudo
override parse(data: ArrayBuffer|string, path: string, onLoad, onError) {
    const parser = this._buildParser(data, path)
    if (TextureLoader2.SAVE_SOURCE_BLOBS) {
        // Hook the parser's image loading to capture bytes
        const origLoadImageSource = parser.loadImageSource.bind(parser)
        parser.loadImageSource = async (sourceIndex, ...rest) => {
            const source = parser.json.images[sourceIndex]
            const uri = source.uri  // external URL or data: URI
            const bufferViewIndex = source.bufferView  // or embedded in GLB
            // fetch bytes either from URL (via FileLoader with arraybuffer) or from bufferView
            const bytes = await this._captureImageBytes(parser, source)
            const texture = await origLoadImageSource(sourceIndex, ...rest)
            if (texture && bytes) {
                (texture.source as any)._sourceImgBuffer = bytes
                texture.userData.mimeType = source.mimeType || mimeFromUri(uri)
            }
            return texture
        }
    }
    return super.parse(data, path, onLoad, onError)
}
```

Implementation notes:

- For **external URIs** (separate files referenced from .gltf): fetch via `FileLoader(arraybuffer)`, same pattern as `TextureLoader2`. Goes through threepipe's CacheStorage.
- For **embedded data URIs** (`data:image/jpeg;base64,...`): decode base64 once, use the bytes directly — don't refetch.
- For **GLB bufferView-embedded images**: the bytes are already in the parsed GLB buffer. Slice the bufferView range and use those bytes directly — no fetch needed.
- **Texture sharing** in GLTF: multiple textures can share one image source (`source._sourceImgBuffer` is per-source so shared storage is natural — bytes stored once regardless of how many textures reference the image).

## Memory cost

Same trade-off as `TextureLoader2.SAVE_SOURCE_BLOBS` — each image retains its compressed bytes. Gated behind the same flag.

## Verification criteria

- `glb-draco-export` interactive test becomes byte-stable across Chromium builds and GL backends (DRACO mesh already is; textures should join)
- `dl-helmet.glb` snapshot can be regenerated and tests reliably pass on any Playwright config
- Memory profiler: before vs after — each image ~200KB–2MB extra retention, consistent with `TextureLoader2` cost

## Out of scope

- Non-raster textures inside GLTF (KTX2, basis-u) — KTX2 plugin already handles its own source byte preservation via `_sourceImgBuffer` direct write
- Images that were modified post-load (e.g., procedural shader applied via plugins) — source bytes become stale; document and don't use fast path if `_sourceImgBuffer` was explicitly cleared

## References

- `src/assetmanager/import/TextureLoader2.ts` — standalone-image counterpart, precedent for this work
- `src/assetmanager/export/GLTFWriter2.ts:processTexture` — reader side of `_sourceImgBuffer`; ready to use bytes from GLTF-loaded textures too once they're populated
- `src/plugins/import/KTX2LoadPlugin.ts` — reference pattern for source-bytes capture inside a plugin-style loader
- three.js `GLTFLoader.js` — `loadImageSource`, `loadTextureImage` entry points
- `tests/interactive.spec.ts:glb-draco-export` — failing snapshot that would become stable
- `issues/open/preserve-source-bytes-jpeg-png-textures-on-export.md` — parent issue covering both standalone and GLTF paths
