---
prev: 
    text: 'TonemapPlugin'
    link: './TonemapPlugin'

next: 
    text: 'ProgressivePlugin'
    link: './ProgressivePlugin'

---

# DropzonePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#dropzone-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/DropzonePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/DropzonePlugin.html)

DropzonePlugin adds support for drag and drop of local files to automatically import, process and load them into the viewer.

DropzonePlugin can be added by default in ThreeViewer
by setting the `dropzone` property to `true` or an object of `DropzonePluginOptions` in the options.

```typescript
import {DropzonePlugin, ThreeViewer} from 'threepipe'
const viewer = new ThreeViewer({
  canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
  dropzone: true, // just set to true to enable drag drop functionatility in the viewer
})
```

To set custom options,
pass an object of [DropzonePluginOptions](https://threepipe.org/docs/interfaces/DropzonePluginOptions.html) type to the `dropzone` property.
```typescript
import {DropzonePlugin, ThreeViewer} from 'threepipe'
const viewer = new ThreeViewer({
  canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
  dropzone: { // this can also be set to true and configured by getting a reference to the DropzonePlugin
    allowedExtensions: ['gltf', 'glb', 'hdr', 'png', 'jpg', 'json', 'fbx', 'obj', 'bin', 'exr'], // only allow these file types. If undefined, all files are allowed.
    addOptions: {
      disposeSceneObjects: true, // auto dispose of old scene objects
      autoSetEnvironment: true, // when hdr is dropped
      autoSetBackground: true, // when any image is dropped
      autoCenter: true, // auto center the object
      autoScale: true, // auto scale according to radius
      autoScaleRadius: 2,
      license: 'Imported from dropzone', // Any license to set on imported objects
      importConfig: true, // import config from file
    },
    // check more options in the DropzonePluginOptions interface
  },
})
```
