# @threepipe/plugin-blend-importer

Integration and plugin for [threepipe](https://threepipe.org/) to import and render Blender(BLEND) files (fork of [js.blend](https://github.com/acweathersby/js.blend))

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

[Github](https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer) &mdash;
[Examples](https://threepipe.org/examples/?q=blend#blend-load/) &mdash;
[API Reference](https://threepipe.org/docs/)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-blend-importer.svg)](https://www.npmjs.com/package/@threepipe/plugin-blend-importer)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)

**Documentation and Guides**: [threepipe.org/package/plugin-blend-importer](https://threepipe.org/package/plugin-blend-importer.html)
