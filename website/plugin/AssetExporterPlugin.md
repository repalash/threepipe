---
prev: 
    text: 'FullScreenPlugin'
    link: './FullScreenPlugin'

next: 
    text: 'FileTransferPlugin'
    link: './FileTransferPlugin'

---

# AssetExporterPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#asset-exporter-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/AssetExporterPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/AssetExporterPlugin.html)

Asset Exporter Plugin provides options and methods to export the scene, object GLB or Viewer Config.
All the functionality is available in the viewer(and `AssetExporter`) directly, this plugin only provides an ui-config and maintains state of the options which is saved as plugin configuration along with glb/vjson file

```typescript
import {ThreeViewer, AssetExporterPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const assetExporter = viewer.addPluginSync(new AssetExporterPlugin())
// check the existing options
console.log(assetExporter.exportOptions)
// enable/disable viewer config/json embedding in glb
assetExporter.viewerConfig = true
// set encryption
assetExporter.encrypt = true
assetExporter.encryptKey = 'superstrongpassword' // comment this to get prompted for a key during export.

// export scene as blob
const blob = assetExporter.exportScene()
// or export and download directly 
assetExporter.downloadSceneGlb()

// export a specific object
const object = viewer.scene.getObjectByName('objectName')
const blob2 = assetExporter.exportObject(object, true) // true to also download
```
Note: when downloading the model through the plugin, it uses viewer.export, which downloads the files by default, but uploads it to remote destinations when overloaded using `FileTransferPlugin`.
