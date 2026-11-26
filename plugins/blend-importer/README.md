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
