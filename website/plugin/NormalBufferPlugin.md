---
prev: 
    text: 'DepthBufferPlugin'
    link: './DepthBufferPlugin'

next: 
    text: 'GBufferPlugin'
    link: './GBufferPlugin'

---

# NormalBufferPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#normal-buffer-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/NormalBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/NormalBufferPlugin.html)

Normal Buffer Plugin adds a pre-render pass to the render manager and renders a normal buffer to a target. The render target can be accessed by other plugins throughout the rendering pipeline to create effects like SSAO, SSR, etc.

::: info NOTE
Use [`GBufferPlugin`](./GBufferPlugin) if using both `DepthBufferPlugin` and `NormalBufferPlugin` to render both depth and normal buffers in a single pass.
:::

```typescript
import {ThreeViewer, NormalBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin())

const normalTarget = normalPlugin.target;

// Use the normal target by accessing `normalTarget.texture`.
```
