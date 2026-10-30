---
prev:
    text: 'KTX2LoadPlugin'
    link: './KTX2LoadPlugin'
---

# TextureLoader2

[Source Code](https://github.com/repalash/threepipe/blob/master/src/assetmanager/import/TextureLoader2.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TextureLoader2.html)

`TextureLoader2` is an opt-in subclass of three.js's `TextureLoader`. It replaces three's
loader in `AssetManager.importers` so every raster image (JPEG / PNG / WebP / AVIF / BMP /
GIF / TIFF / ICO) goes through it.

**Default behavior is unchanged** from three.js. Turn on `SAVE_SOURCE_BLOBS` and each
loaded image additionally retains its raw compressed bytes on
`texture.source._sourceImgBuffer` — enabling [GLTFWriter2's fast path](../guide/exporting-files)
to skip the browser's canvas re-encode on GLB export.

## Why

three.js's standard flow is:

```
TextureLoader → ImageLoader → <img>.src = url
  ↳ browser decodes pixels, discards original bytes
```

On GLB export, `GLTFExporter.processImage` has to re-encode the decoded pixels via
`ctx.drawImage` + `canvas.toBlob('image/jpeg')` — which is:
- **Non-deterministic** across Chromium builds and GL backends (libjpeg version, GPU
  upload/readback variance → byte-different output per environment)
- **Quality-lossy** (JPEG → decode → re-encode rounds quantization tables)
- **Slow** (GPU readback + JPEG encode per texture)

With `SAVE_SOURCE_BLOBS` on, the original bytes are retained and fed straight back into
the GLB — deterministic, bit-exact, zero re-encoding.

## Enable

```typescript
import {TextureLoader2} from 'threepipe'

// Global default — every texture loaded after this preserves source bytes
TextureLoader2.SAVE_SOURCE_BLOBS = true
```

Per-instance override (if you need a specific loader instance to behave differently):

```typescript
const loader = viewer.assetManager.importer.registerFile('foo.jpg') as TextureLoader2
loader.saveSourceBlobs = true  // or false to override SAVE_SOURCE_BLOBS
```

The tweakpane-editor example enables this flag alongside `KTX2LoadPlugin.SAVE_SOURCE_BLOBS`
so editor exports are byte-stable and preserve input quality.

## How it works

When enabled, the loader:

1. Fetches the URL as an `ArrayBuffer` via `FileLoader` (routes through threepipe's
   `CacheStorage` + empty-payload guard)
2. Wraps the bytes in a `Blob` and creates a blob URL
3. Decodes via a direct `<img>` element — same `HTMLImageElement` result as stock three.js
4. Stores `texture.source._sourceImgBuffer = bytes` + `texture.userData.mimeType = ...`
5. Revokes the blob URL after decode

A direct `document.createElement('img')` is used instead of `ImageLoader` so the
`LoadingManager` sees only one `itemStart/End` pair (avoiding premature `onLoad` triggers).

Skips capture (defers to `super.load`) for:
- `data:` / `blob:` / `chrome-extension:` URLs (bytes are already in-memory / opaque)
- Unknown file extensions (can't infer mime type)

## Memory cost

Each retained buffer is ~source-file-size. Typical textures are 100 KB–2 MB, so a scene
with 10 textures costs ~5–20 MB extra heap. Disable for deployments where exports don't
happen (pure viewing) and enable for editors / authoring tools.

## What it doesn't cover

- **Textures loaded by three.js's `GLTFLoader`** (inside a GLB/glTF) — those go through
  GLTFLoader's internal image pipeline, which bypasses `TextureLoader2`. Tracked in
  `issues/open/gltfloader2-preserve-texture-source-bytes.md`.
- **Procedural / runtime-modified textures** — no source bytes exist. Falls through to
  the existing canvas re-encode path on export.
