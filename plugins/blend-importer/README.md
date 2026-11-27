# @threepipe/plugin-blend-importer

Integration and plugin for [threepipe](https://threepipe.org/) to import and render Blender(BLEND) files (fork of [js.blend](https://github.com/acweathersby/js.blend)). Also works in plain three.js projects, see [Using it without threepipe](#using-it-without-threepipe-plain-threejs).

Compressed `.blend` files are loaded automatically: gzip (legacy Blender) decoded via the bundled fflate, and zstd (Blender 3.0+ default save format) decoded via [fzstd](https://github.com/101arrowz/fzstd).

## Accessing the parsed file

Pass `onBlendLoad` to `viewer.load(...)` to receive the raw parsed Blender file alongside the Scene. Useful for the embedded preview thumbnail, the raw DNA tree, library/kinematics references — anything that isn't represented in the three.js Scene.

```ts
import {BlendLoadPlugin, BlendFile} from '@threepipe/plugin-blend-importer'

viewer.addPluginSync(BlendLoadPlugin)

await viewer.load('path/to/file.blend', {
    onBlendLoad: (blend: BlendFile) => {
        if (blend.thumbnail) {
            console.log(`embedded thumb: ${blend.thumbnail.width}×${blend.thumbnail.height}`)
            // blend.thumbnail.data is a Uint32Array (RGBA8 packed per pixel)
        }
        // blend.objects.Mesh, blend.objects.Material, etc. — raw DNA structs
    },
})
```

Don't write `blend` data onto `userData` — it gets serialized by export pipelines and large typed arrays (the thumbnail is ~64 KB) will balloon outputs or fail JSON encoding.

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

`thumbnail` has the same shape as `blend.thumbnail` from a full load: `{width, height, data}`, RGBA8 packed per
`Uint32`, rows bottom-up. The same functions are exported by `@threepipe/plugin-blend-importer/three`. A server that
ignores `Range` sends the whole file; reading the response as a stream and cancelling it after
`BLEND_THUMBNAIL_BYTES` avoids that.

## Options

Set these on the plugin (`viewer.getPlugin(BlendLoadPlugin)`) or on a plain three.js `BlendLoader` before loading:

- `evaluationMode`: `'viewport'` (default) or `'render'`. Evaluates the file the way Blender's viewport or its renderer does: which modifiers run, which Subdivision level is used, and which objects are hidden.
- `maxTextureSize`: the longest side, in pixels, of the images packed in the file. A bigger image is shrunk while it is decoded, keeping its aspect ratio, before it becomes a texture. Packed images then decode one at a time, so only one is ever held at full size. `0` (default) keeps images as stored. External image files load at their own size.
- `downsizedMipmaps`: `false` builds no mipmaps for the images `maxTextureSize` shrank, a quarter less GPU memory each. Images that weren't shrunk keep theirs. Default `true`.
- `allObjects`: `true` imports every object in the file. By default only what Blender shows is imported: the active scene's objects, without hidden ones (following `evaluationMode`), with collection instances expanded. A file whose scene has no objects imports all of them either way.

```ts
const blend = viewer.addPluginSync(BlendLoadPlugin)
blend.maxTextureSize = 1024 // e.g. for a memory-bound page
blend.downsizedMipmaps = false
```

On Blender's Mr Elephant demo (39 packed images used by its materials), texture memory is about 246 MB as stored, 192 MB at 2048, 111 MB at 1024, and 98 MB at 1024 without mipmaps for the shrunk images.

## Using it without threepipe (plain three.js)

The same loader is available for any three.js project, with no threepipe install, from the `/three` entry point. It imports `three` and nothing else, so it uses the three.js version your project already has (tested with r125 to r187).

```bash
npm install @threepipe/plugin-blend-importer three
```

```ts
import * as THREE from 'three'
import {BlendLoader} from '@threepipe/plugin-blend-importer/three'

const loader = new BlendLoader() // optionally new BlendLoader(manager)
const {scene, blend} = await loader.loadAsync('path/to/file.blend')
myScene.add(scene) // a THREE.Group with the file's meshes, lights, cameras and empties
// blend.thumbnail, blend.objects... - the parsed file, as with onBlendLoad above
```

It behaves like three's other loaders: `load(url, onLoad, onProgress, onError)`, `loadAsync(url)`, `parse(arrayBuffer, resourcePath, onLoad, onError)` and `parseAsync(arrayBuffer, resourcePath)`, with `setPath`, `setResourcePath`, `setCrossOrigin`, `setRequestHeader`, `setWithCredentials` and a `LoadingManager`.

Packed textures are decoded from the file. External (file-path) textures load relative to the `.blend` with three's `TextureLoader`, and `loadAsync` waits for them. For formats `TextureLoader` can't read, such as EXR or HDR, pass your own loader:

```ts
import {EXRLoader} from 'three/examples/jsm/loaders/EXRLoader.js'

const exr = new EXRLoader()
loader.setTextureLoader((url, {path}) => path.endsWith('.exr') ? exr.load(url) : new THREE.TextureLoader().load(url))
```

Without a bundler, the UMD build works with three's UMD build (three r159 and older): load `three.min.js`, then `@threepipe/plugin-blend-importer/dist/threejs.js`, and use `new BlendLoader.BlendLoader()`.

[Github](https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer) &mdash;
[Examples](https://threepipe.org/examples/?q=blend#blend-load/) &mdash;
[API Reference](https://threepipe.org/docs/)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-blend-importer.svg)](https://www.npmjs.com/package/@threepipe/plugin-blend-importer)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)

**Documentation and Guides**: [threepipe.org/package/plugin-blend-importer](https://threepipe.org/package/plugin-blend-importer.html)
