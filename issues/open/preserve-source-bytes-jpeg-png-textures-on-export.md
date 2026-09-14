# Preserve source bytes for JPEG/PNG textures on export (skip canvas re-encode)

**Created:** 2026-04-18
**Status:** Open — design exists for KTX2, needs extension to JPEG/PNG/WEBP

## Problem

When `GLTFExporter2` / `GLTFWriter2` export a GLB with embedded images, every texture is re-encoded through a browser canvas:

```js
// three.js GLTFExporter.js:1348–1362
ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
canvas.toBlob(resolve, 'image/jpeg')
```

This happens because `THREE.Texture.source.data` holds decoded pixel data (`HTMLImageElement` / `ImageBitmap`) — the original compressed bytes are discarded after GPU upload.

**Consequences:**
1. **Non-deterministic output** — `canvas.toBlob('image/jpeg')` varies by Chromium build (libjpeg version), GL backend (SwiftShader vs Mesa vs native GPU → different `drawImage` readback pixels), and possibly runtime memory state. Byte-stable exports across environments are impossible.
2. **Quality loss** — re-encoding JPEG→decode→re-encode JPEG lowers quality unless quantization tables are preserved (they aren't).
3. **Export time** — GPU readback + JPEG encode for each texture is slow, even when the texture was never modified at runtime.
4. **Test fragility** — `tests/interactive.spec.ts:glb-draco-export` byte-compares exported GLBs. The snapshot is stable only within the exact Chromium/backend it was baked on. Running on a different box (e.g. system Chromium + Mesa on Alpine vs Playwright's bundled Chromium + SwiftShader) produces different bytes for the JPEG bufferViews, though the DRACO-compressed mesh bytes are identical across runs. See the `glb-draco-export` snapshot — bufferViews 0–3 (JPEGs) diverge, bufferView 5 (DRACO mesh) is byte-identical.

## The precedent: KTX2 already does this

`src/plugins/import/KTX2LoadPlugin.ts`:

- Static opt-in flag `SAVE_SOURCE_BLOBS = false` (default off — memory concern noted below)
- On load, clones the buffer and stores it at `texture.source._sourceImgBuffer`
- On export, `glTFTextureBasisUExtensionExport` reads `texture.source._sourceImgBuffer` and hands it directly to `w.processImageBlob(blob, texture)` — **no canvas touched**

Existing TODO in the same file (line 86):

```ts
const sourceBuffer = texture.source._sourceImgBuffer || texture.__sourceBuffer
// todo do this for all images that have a __sourceBuffer
// (in GLTFExporter.processImage or GLTFWriter2.processTexture)
```

## Why not enabled by default for all formats

**Memory** — every loaded image would keep a copy of its original bytes in memory for the lifetime of the texture. For a scene with several large JPEGs (a few MB each), this doubles the image memory footprint even when the app never exports. KTX2 is the same (hence `SAVE_SOURCE_BLOBS = false`).

## Proposed implementation

### 1. Source-byte capture in `TextureLoader2` (or an interceptor on generic `TextureLoader` flow)

Static flag symmetric to KTX2's:

```ts
public static SAVE_SOURCE_BLOBS = false
```

When on, attach `_sourceImgBuffer` (and `mimeType`) to `texture.source` during load. For raster formats loaded via `FileLoader` + `createImageBitmap`, capture the ArrayBuffer before it's discarded:

```ts
// pseudo
const buf = await fetch(url).then(r => r.arrayBuffer())
if (SAVE_SOURCE_BLOBS) clonedBytes = buf.slice(0)
const bitmap = await createImageBitmap(new Blob([buf]))
const tex = new Texture(bitmap)
if (SAVE_SOURCE_BLOBS) {
    tex.source._sourceImgBuffer = clonedBytes
    tex.source._canSerialize = true
    tex.userData.mimeType = mimeTypeFromUrl(url)
}
```

### 2. Exporter prefers source bytes when available

In `GLTFWriter2.processTexture()` (before calling `super.processTexture`):

```ts
const srcBuf = map.source._sourceImgBuffer || map.__sourceBuffer
const mime = map.userData.mimeType
if (srcBuf && mime && ['image/jpeg','image/png','image/webp'].includes(mime)) {
    const blob = new Blob([srcBuf], {type: mime})
    textureDef.source = this.processImageBlob(blob, map)  // no canvas, no toBlob
    return
}
// fallthrough to canvas re-encode (current behavior)
```

### 3. Invalidation on mutation

If the texture was modified at runtime (`texture.needsUpdate` set after a programmatic pixel write, filter/size change that requires re-render, etc.), source bytes no longer represent the texture content — drop them and fall back to canvas:

```ts
// On any mutation API that changes pixels
texture.source._sourceImgBuffer = undefined
```

Most natural implementation: a setter / `__markDirty()` call at mutation sites. If that's too invasive, keep the source bytes and document that bytes represent the load-time texture — user responsibility to clear when mutating.

### 4. Per-texture override

Some apps want source preservation only for specific textures (e.g. large unmodified lightmaps). Make the flag also per-instance:

```ts
const tex = await viewer.load(url)
tex.source._preserveSourceBytes = true  // overrides static default
```

## Memory mitigation options

- **Opt-in static flag** — matches KTX2 pattern; users who never export pay nothing
- **Reference-count**: if the same URL is reused across textures, share the ArrayBuffer via `LibraryValueMap`-style cache
- **Drop on export**: after export, clear `_sourceImgBuffer` if `_preserveAfterExport === false`
- **Small-texture threshold**: always preserve bytes for textures under N MB (typical lightmaps, UI sprites) where memory cost is low

## Scope

Files to touch:
- `src/assetmanager/import/TextureLoader2.ts` (or wherever threepipe wraps three.js `TextureLoader` / `ImageBitmapLoader`) — add source-byte capture, symmetric to KTX2
- `src/assetmanager/export/GLTFWriter2.ts:processTexture` — add source-bytes fast path before super call
- `src/plugins/import/KTX2LoadPlugin.ts` — remove the TODO comment once generic path lands
- Tests — re-baseline `glb-draco-export` snapshot with `SAVE_SOURCE_BLOBS = true` during the test run (deterministic across environments)

## Out of scope

- RGBE/EXR (HDR formats) — these already go through custom encoders that are deterministic
- Generated/procedural textures (`DataTexture`, canvas-origin) — no source bytes exist
- Textures loaded from blob:/data: URIs where the original bytes are already consumed

## Workaround until implemented

For users who need deterministic or high-quality GLB export today:
- Use `embedUrlImages: false` so textures are referenced by URL (no re-encode). Fine for web deployments where images are hosted separately; not an option for self-contained single-file GLB.

## References

- `src/plugins/import/KTX2LoadPlugin.ts:20–100` — working precedent
- `src/assetmanager/export/GLTFWriter2.ts:190–218` — `embedUrlImages` URL reference path (already skips canvas)
- `node_modules/three/examples/jsm/exporters/GLTFExporter.js:1348–1394` — canvas re-encode path we'd bypass
- `tests/interactive.spec.ts:384` — `glb-draco-export` test that hits this issue (bufferView[5] is DRACO-mesh, byte-identical across runs; bufferViews 0–4 are JPEGs, vary by Chromium/GL backend)
