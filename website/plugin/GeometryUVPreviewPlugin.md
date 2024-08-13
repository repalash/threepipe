---
prev: 
    text: 'RenderTargetPreviewPlugin'
    link: './RenderTargetPreviewPlugin'

next: 
    text: 'FrameFadePlugin'
    link: './FrameFadePlugin'

---

# GeometryUVPreviewPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#geometry-uv-preview/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/ui/GeometryUVPreviewPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GeometryUVPreviewPlugin.html)

GeometryUVPreviewPlugin is a useful development and debugging plugin
that adds a panel to the viewer to show the UVs of a geometry.

```typescript
import {ThreeViewer, GeometryUVPreviewPlugin, SphereGeometry} from 'threepipe'

const viewer = new ThreeViewer({...})

const previewPlugin = viewer.addPluginSync(new GeometryUVPreviewPlugin())

const geometry = new SphereGeometry(1, 32, 32)
// Show the normal buffer in a panel
previewPlugin.addGeometry(geometry, 'sphere')
```
