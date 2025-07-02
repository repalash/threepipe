---
prev: 
    text: '@threepipe/plugin-geometry-generator'
    link: './plugin-geometry-generator'

next: 
    text: '@threepipe/plugins-extra-importers'
    link: './plugins-extra-importers'

---

# @threepipe/plugin-gltf-transform

[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/gltf-transform/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/gltf-transform/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-gltf-transform.svg)](https://www.npmjs.com/package/@threepipe/plugin-gltf-transform)

```bash
npm install @threepipe/plugin-gltf-transform
```

## GLTFDracoExportPlugin

Exports [GLTFDracoExportPlugin](https://threepipe.org/plugins/gltf-transform/docs/classes/GLTFDracoExportPlugin.html) that extends the default gltf exporter to compress the file (using [KHR_draco_mesh_compression](https://github.com/KhronosGroup/gltf/tree/main/extensions/2.0/Khronos/KHR_draco_mesh_compression)) after export.

[Example](https://threepipe.org/examples/#glb-draco-export/) &mdash;

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

## GLTFSpecGlossinessConverterPlugin

[GLTFSpecGlossinessConverterPlugin](https://threepipe.org/plugins/gltf-transform/docs/classes/GLTFSpecGlossinessConverterPlugin.html) that extends the default gltf exporter to compress the file after export.

[Example](https://threepipe.org/examples/#gltf-spec-gloss-import/)

```bash
npm install @threepipe/plugin-gltf-transform
```

Plugin that adds a gltf loader extension that automatically converts GLTF files with specular glossiness materials ([KHR_materials_pbrSpecularGlossiness](https://kcoley.github.io/glTF/extensions/2.0/Khronos/KHR_materials_pbrSpecularGlossiness/)) to metallic roughness during import.

To use this plugin, simply add it to the viewer and import a file with `viewer.load` with specular glossiness materials.

If `confirm` is set to true, a confirmation dialog will be shown before the conversion.

To disable confirmation while loading a specific file, it can be passed as an option to `viewer.load`:

Sample Usage:

```typescript
import {ThreeViewer, downloadBlob} from 'threepipe'
import {GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin} from '@threepipe/plugin-gltf-transform'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GLTFDracoExportPlugin)
const plugin = viewer.addPluginSync(GLTFSpecGlossinessConverterPlugin) // it requires GLTFDracoExportPlugin

plugin.confirm = true // show a confirmation dialog before conversion
// customize the confirmation message
plugin.confirmMessage = "Convert KHR_materials_pbrSpecularGlossiness to KHR_materials_pbrMetallicRoughness?" 

await viewer.load('file.glb', {
    autoScale: true,
    autoCenter: true,
    confirmSpecGlossConversion: false, // prevents the confirmation dialog while loading this file, even if set to true in the plugin
})
```

::: tip
The plugin uses `viewer.dialog` API to show the confirmation dialog. If you want to customize the dialog, you can use the `viewer.dialog` API to set a custom dialog component.
:::
