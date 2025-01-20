---
prev: 
    text: '@threepipe/plugin-network'
    link: './plugin-network'

next: 
    text: '@threepipe/plugin-gaussian-splatting'
    link: './plugin-gaussian-splatting'

---

# @threepipe/plugin-blend-importer

Exports [BlendImporterPlugin](https://threepipe.org/plugins/blend-importer/docs/classes/BlendLoadPlugin.html) which adds support for loading .blend files.

It uses [`js.blend`](https://github.com/acweathersby/js.blend) for parsing blend file structure.

::: warning Note
This is still a WIP.
:::

Currently working: `Mesh`, `BufferGeometry` and basic `PointLight`.
To be added: `PhysicalMaterial`, `UnlitMaterial` (similar to blender-gltf-io plugin)

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
