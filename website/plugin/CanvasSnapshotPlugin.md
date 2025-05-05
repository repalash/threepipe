---
prev: 
    text: 'SSAOPlugin'
    link: './SSAOPlugin'

next: 
    text: 'PickingPlugin'
    link: './PickingPlugin'

---

# CanvasSnapshotPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#canvas-snapshot-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/export/CanvasSnapshotPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/CanvasSnapshotPlugin.html)

Canvas Snapshot Plugin adds support for taking snapshots of the canvas and exporting them as images and data urls. It includes options to take snapshot of a region, mime type, quality render scale, tiled zip export for large resolution, scaling the output image, interfacing with SSAA, Progressive plugins etc. 

Check out the interface [CanvasSnapshotOptions](https://threepipe.org/docs/interfaces/CanvasSnapshotOptions.html) for more details.

```typescript
import {ThreeViewer, CanvasSnapshotPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const snapshotPlugin = viewer.addPluginSync(new CanvasSnapshotPlugin())

// download a snapshot.
await snapshotPlugin.downloadSnapshot('image.webp', { // all parameters are optional
  scale: 1, // scale the final image
  timeout: 0, // wait before taking the snapshot, in ms
  quality: 0.9, // quality of the image (0-1) only for jpeg and webp
  displayPixelRatio: 2, // render scale 
  mimeType: 'image/webp', // mime type of the image
  waitForProgressive: true, // wait for progressive rendering to finish (ProgressivePlugin). true by default
  progressiveFrames: 64, // number of frames to wait for progressive rendering to finish (ProgressivePlugin). 64 by default
  rect: { // region to take snapshot. eg. crop center of the canvas
    height: viewer.canvas.clientHeight / 2,
    width: viewer.canvas.clientWidth / 2,
    x: viewer.canvas.clientWidth / 4,
    y: viewer.canvas.clientHeight / 4,
  },
  // tileRows: 3, // number of rows to tile the image. If more than one, a zip file will be exported
  // tileColumns: 3, // number of columns to tile the image
})

// get data url (string)
const dataUrl: string = await snapshotPlugin.getDataUrl({ // all parameters are optional
  displayPixelRatio: 2, // render scale 
  mimeType: 'image/webp', // mime type of the image
})

// get File
const file: File = await snapshotPlugin.getFile('file.jpeg', { // all parameters are optional
  mimeType: 'image/jpeg', // mime type of the image
})
```
