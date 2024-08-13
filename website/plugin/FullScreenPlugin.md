---
prev: 
    text: 'PickingPlugin'
    link: './PickingPlugin'

next: 
    text: 'AssetExporterPlugin'
    link: './AssetExporterPlugin'

---

# FullScreenPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#fullscreen-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/FullScreenPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FullScreenPlugin.html)

A simple plugin that provides functions to enter, exit and toggle full screen mode and check if the viewer is in full screen mode. Either the canvas or the whole container can be set to full screen.

```typescript
import {ThreeViewer, FullScreenPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const fullscreen = viewer.addPluginSync(new FullScreenPlugin())

// enter full screen
await fullscreen.enter(viewer.container) // viewer.canvas is used if no element is passed
// exit full screen
await fullscreen.exit()
// toggle
await fullscreen.toggle(viewer.container)
// check if full screen
console.log(fullScreenPlugin.isFullScreen())
```
