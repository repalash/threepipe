---
prev: 
    text: '@threepipe/plugin-geometry-generator'
    link: './plugin-geometry-generator'

next: 
    text: '@threepipe/plugins-extra-importers'
    link: './plugins-extra-importers'

---

# @threepipe/plugin-gltf-transform

Exports [GLTFDracoExportPlugin](https://threepipe.org/plugins/gltf-transform/docs/classes/GLTFDracoExportPlugin.html) that extends the default gltf exporter to compress the file after export.

[Example](https://threepipe.org/examples/#glb-draco-export/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/gltf-transform/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/gltf-transform/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-gltf-transform.svg)](https://www.npmjs.com/package/@threepipe/plugin-gltf-transform)

```bash
npm install @threepipe/plugin-gltf-transform
```

To use, simply add the plugin to the viewer and export using the `viewer.export` or `viewer.exportScene` functions. This also adds UI options to `AssetExporterPlugin` which are used when exporting using the plugin or using `viewer.exportScene`

The plugin overloads the default gltf exporter in the asset manager with `GLTFDracoExporter`. Using the [gltf-transform](https://gltf-transform.donmccurdy.com/) library, it compresses the exported gltf file using the [khr_draco_mesh_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_draco_mesh_compression/README.md) extension.

Note - Only `glb` export supported right now.

Sample Usage:

```typescript
import {ThreeViewer, downloadBlob} from 'threepipe'
import {GLTFDracoExportPlugin} from '@threepipe/plugin-gltf-transform'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GLTFDracoExportPlugin)

await viewer.load('file.glb')

const blob = await viewer.exportScene({
  compress: true, // this must be specified, by default it's false.
  viewerConfig: true, // to export with viewer, scene and plugin settings
})
// download the file
downloadBlob(blob, 'scene.glb')
```
