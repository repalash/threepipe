---
prev: 
    text: 'SSAAPlugin'
    link: './SSAAPlugin'

next: 
    text: 'NormalBufferPlugin'
    link: './NormalBufferPlugin'

---

# DepthBufferPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#depth-buffer-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/DepthBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/DepthBufferPlugin.html)

Depth Buffer Plugin adds a pre-render pass to the render manager and renders a depth buffer to a target. The render target can be accessed by other plugins throughout the rendering pipeline to create effects like depth of field, SSAO, SSR, etc.

```typescript
import {ThreeViewer, DepthBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const depthPlugin = viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType))

const depthTarget = depthPlugin.target;

// Use the depth target by accesing `depthTarget.texture`.
```

The depth values are based on camera near far values, which are controlled automatically by the viewer. To manually specify near, far values and limits, it can be set in the camera userData. Check the [example](https://threepipe.org/examples/#depth-buffer-plugin/) for more details.
