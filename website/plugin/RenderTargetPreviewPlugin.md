---
prev: 
    text: 'TransformAnimationPlugin'
    link: './TransformAnimationPlugin'

next: 
    text: 'GeometryUVPreviewPlugin'
    link: './GeometryUVPreviewPlugin'

---

# RenderTargetPreviewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#render-target-preview/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/ui/RenderTargetPreviewPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/RenderTargetPreviewPlugin.html)

RenderTargetPreviewPlugin is a useful development and debugging plugin that renders any registered render-target to the screen in small collapsable panels.

```typescript
import {ThreeViewer, RenderTargetPreviewPlugin, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin(HalfFloatType))

const previewPlugin = viewer.addPluginSync(new RenderTargetPreviewPlugin())

// Show the normal buffer in a panel
previewPlugin.addTarget(()=>normalPlugin.target, 'normal', false, false)
```
