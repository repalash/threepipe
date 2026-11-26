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

Currently working: meshes (Blender's triangulation, flat/smooth shading, Auto Smooth, sharp edges, UVs, material slots), Principled BSDF materials mapped like Blender's glTF exporter (with packed and external textures), Emission as unlit, basic lights and cameras. Modifiers other than Smooth by Angle are not evaluated yet.

[Example](https://threepipe.org/examples/#blend-load/) &mdash;
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

## Plain three.js

The loader also works without threepipe, in any three.js project (tested with three r125 to r187), from the `/three` entry point. It imports only `three`, so it uses your project's version.

```typescript
import {BlendLoader} from '@threepipe/plugin-blend-importer/three'

const {scene, blend} = await new BlendLoader().loadAsync('path/to/file.blend')
threeScene.add(scene) // a THREE.Group
```

`BlendLoader` follows three's loader API (`load`, `loadAsync`, `parse`, `parseAsync`, `setPath`, `setResourcePath`, `setCrossOrigin`, `LoadingManager`). External textures load with `TextureLoader` relative to the `.blend`; use `loader.setTextureLoader(fn)` for EXR, HDR or other formats. See the [package README](https://github.com/repalash/threepipe/tree/dev/plugins/blend-importer#using-it-without-threepipe-plain-threejs) for details.
