---
prev: 
    text: 'NormalBufferPlugin'
    link: './NormalBufferPlugin'

next: 
    text: 'SSAOPlugin'
    link: './SSAOPlugin'

---

# GBufferPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#gbuffer-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/GBufferPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GBufferPlugin.html)

GBuffer Plugin adds a pre-render pass to the render manager and renders depth+normals to a target and some customizable flags to another. The multiple render target and textures can be accessed by other plugins throughout the rendering pipeline to create effects like SSAO, SSR, etc.

```typescript
import {ThreeViewer, GBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const gBufferPlugin = viewer.addPluginSync(new GBufferPlugin())

const gBuffer = gBufferPlugin.target;
const normalDepth = gBufferPlugin.normalDepthTexture;
const gBufferFlags = gBufferPlugin.flagsTexture;
```
