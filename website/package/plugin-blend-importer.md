---
prev: 
    text: '@threepipe/plugin-network'
    link: './plugin-network'

next: 
    text: '@threepipe/plugin-gaussian-splatting'
    link: './plugin-gaussian-splatting'

---

# @threepipe/plugin-blend-importer

Exports [BlendImporterPlugin](https://threepipe.org/plugins/blend-importer/docs/classes/BlendLoadPlugin.html) which adds support for loading .blend files, and a `BlendLoader` for plain three.js projects (see [below](#plain-three-js)).

It uses [`js.blend`](https://github.com/acweathersby/js.blend) for parsing blend file structure.

::: warning Note
This is still a WIP.
:::

Currently working: meshes (Blender's triangulation, flat/smooth shading, Auto Smooth, sharp edges, UVs, material slots), Principled BSDF materials mapped like Blender's glTF exporter (with packed and external textures), Emission as unlit, basic lights and cameras framed like Blender's. The Subdivision Surface, Mirror, Array, Solidify and Smooth by Angle modifiers are evaluated, with the viewport or the render settings (`evaluationMode`); other modifiers are listed in a warning and skipped.

[Example](https://threepipe.org/examples/#blend-load/) &mdash;
[File Inspector](https://threepipe.org/examples/#blend-file-info/) &mdash;
[Plain three.js Example](https://threepipe.org/examples/#blend-load-three/) &mdash;
[Preview While Loading](https://threepipe.org/examples/#blend-preview/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/blend-importer/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/blend-importer/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-blend-importer.svg)](https://www.npmjs.com/package/@threepipe/plugin-blend-importer)

```bash
npm install @threepipe/plugin-blend-importer
```

```typescript
import {ThreeViewer} from 'threepipe'
import {BlendLoadPlugin} from '@threepipe/plugin-blend-importer'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(BlendLoadPlugin)

// Now load any .blend file.
const model = await viewer.load<IObject3D>('path/to/file.blend')

// To load the file as a data url, use the correct mimetype
const model1 = await viewer.load<IObject3D>('data:application/x-blender;base64,...')

```

[//]: # ( TODO: The plugin should parse and references to other assets and find them relative to the .blend file or the current location.)

## Showing the preview while the file loads

A `.blend` starts with a small preview image (usually 128×128). `readBlendThumbnail` reads it from the first bytes
of the file, without parsing it, so a page can show it while the full load runs. It works on uncompressed, gzip and
zstd files, and returns null when the file has no preview or the preview isn't in the bytes given.
`BLEND_THUMBNAIL_BYTES` (256 KB) is enough for any file. The preview is in the first 2-64 KB of the files we
measured, and a zstd decoder can need up to ~130 KB.

```ts
import {BLEND_THUMBNAIL_BYTES, blendThumbnailImageData, readBlendThumbnail} from '@threepipe/plugin-blend-importer'

// the start of the file: a Range request (or file.slice(0, BLEND_THUMBNAIL_BYTES) for a dropped File)
const res = await fetch(url, {headers: {Range: `bytes=0-${BLEND_THUMBNAIL_BYTES - 1}`}})
const thumbnail = readBlendThumbnail(await res.arrayBuffer())
if (thumbnail) {
    const canvas = document.createElement('canvas')
    canvas.width = thumbnail.width
    canvas.height = thumbnail.height
    canvas.getContext('2d')!.putImageData(blendThumbnailImageData(thumbnail), 0, 0) // rows top-down
    document.body.appendChild(canvas)
}
const model = await viewer.load(url) // meanwhile, the full load
```

The [preview example](https://threepipe.org/examples/#blend-preview/) does this with Blender's 66 MB Mr Elephant demo.

`thumbnail` has the same shape as `blend.thumbnail` from a full load: `{width, height, data}`, RGBA8 packed per
`Uint32`, rows bottom-up. The same functions are exported by `@threepipe/plugin-blend-importer/three`. A server that
ignores `Range` sends the whole file; reading the response as a stream and cancelling it after
`BLEND_THUMBNAIL_BYTES` avoids that.

## Options

Set these on the plugin (`viewer.getPlugin(BlendLoadPlugin)`) or on a plain three.js `BlendLoader` before loading:

- `evaluationMode`: `'viewport'` (default) or `'render'`. Evaluates modifier stacks the way Blender's viewport or its renderer does: which modifiers run and which Subdivision level is used.
- `maxTextureSize`: the longest side, in pixels, of the images packed in the file. A bigger image is shrunk while it is decoded, keeping its aspect ratio, before it becomes a texture. Packed images then decode one at a time, so only one is ever held at full size. `0` (default) keeps images as stored. External image files load at their own size.
- `downsizedMipmaps`: `false` builds no mipmaps for the images `maxTextureSize` shrank, a quarter less GPU memory each. Images that weren't shrunk keep theirs. Default `true`.

```ts
const blend = viewer.addPluginSync(BlendLoadPlugin)
blend.maxTextureSize = 1024 // e.g. for a memory-bound page
blend.downsizedMipmaps = false
```

On Blender's Mr Elephant demo (39 packed images used by its materials), texture memory is about 246 MB as stored, 192 MB at 2048, 111 MB at 1024, and 98 MB at 1024 without mipmaps for the shrunk images.

## Plain three.js

The loader also works without threepipe, in any three.js project (tested with three r125 to r187), from the `/three` entry point. It imports only `three`, so it uses your project's version.

```typescript
import {BlendLoader} from '@threepipe/plugin-blend-importer/three'

const {scene, blend} = await new BlendLoader().loadAsync('path/to/file.blend')
threeScene.add(scene) // a THREE.Group
```

`BlendLoader` follows three's loader API (`load`, `loadAsync`, `parse`, `parseAsync`, `setPath`, `setResourcePath`, `setCrossOrigin`, `LoadingManager`). External textures load with `TextureLoader` relative to the `.blend`; use `loader.setTextureLoader(fn)` for EXR, HDR or other formats. See the [package README](https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer#using-it-without-threepipe-plain-threejs) for details.

The [plain three.js example](https://threepipe.org/examples/#blend-load-three/) is a single page with three from a CDN and an import map, no build step.
