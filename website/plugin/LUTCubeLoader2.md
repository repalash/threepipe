---
prev:
    text: 'LUTPlugin'
    link: './LUTPlugin'
---

# LUTCubeLoader2 / LUTCubeTextureWrapper

[Source Code](https://github.com/repalash/threepipe/blob/master/src/assetmanager/import/LUTCubeLoader2.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/LUTCubeLoader2.html)

`LUTCubeLoader2` is a drop-in replacement for three.js's `LUTCubeLoader` that wraps the
result in a **serializable** `LUTCubeTextureWrapper`. Registered on `AssetImporter` for
the `.cube` extension — any `viewer.load('foo.cube')` or drag-drop of a `.cube` file
returns a `LUTCubeTextureWrapper` ready to assign to plugins like [`LUTPlugin`](./LUTPlugin).

## Why the wrapper exists

Three.js's native `LUTCubeResult` is a plain object with `{title, size, domainMin,
domainMax, texture3D}`. It doesn't round-trip through viewer config / GLB export —
no `toJSON`, no asset metadata, no path for a deserializer to find.

`LUTCubeTextureWrapper`:
- Implements `IJSONSerializable` (has `toJSON` via `serializeTextureInExtras`)
- Opts into source-byte caching by setting `__needsSourceBuffer = true` — so the raw
  `.cube` bytes are retained on `__sourceBuffer` for serialization (File/Blob loads)
  and later reconstruction
- Carries a `uuid`, `type`, and `assetType = 'lutTexture'` so the asset manager /
  serializer recognizes it

## Loading a LUT

```typescript
import {ThreeViewer, LUTCubeTextureWrapper} from 'threepipe'

const viewer = new ThreeViewer({...})

const lut = await viewer.load<LUTCubeTextureWrapper>(
    'https://example.com/my-grade.cube'
)
// lut.texture3D is a THREE.Data3DTexture ready to use
// lut.size / lut.domainMin / lut.domainMax / lut.title as per the .cube header
```

Drag-drop a `.cube` file onto the viewer (with DropzonePlugin active) — same result.

## Serialization flow

Save (via `viewer.exportConfig()` or plugin serialization):
1. A plugin field holding the wrapper serializes as `{uuid, resource: 'extras'}`
2. The wrapper's `toJSON(meta)` writes the raw `.cube` bytes (when available) or the
   URL into `meta.extras[uuid]`

Load (via `viewer.loadConfigResources(config)`):
1. Each entry in `json.extras` with a `.url` is handed to `AssetImporter.importSingle`
   — either as a `File(bytes, 'file.cube')` or a URL string
2. `LUTCubeLoader2` picks it up, parses, returns a fresh `LUTCubeTextureWrapper`
3. Plugin fields pointing at `{uuid, resource: 'extras'}` resolve to the fresh wrapper

So round-trip works as long as the original bytes were captured (File/Blob loads, or
drag-drop) OR the original URL is still reachable.

## Notes

- Implements `LUTCubeResult` — can be passed anywhere a `LUTCubeResult` is expected
- `fromJSON` is intentionally a stub — restoration goes through the loader path above,
  not through decorator-walk deserialization
- No 2D-image LUT support (unlike three.js's `LUTImageLoader`) — add separately if needed
- No `.3dl` support (unlike three.js's `LUT3dlLoader`) — add separately if needed
