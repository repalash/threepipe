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

By default, transparent and transmissive materials are rendered to the normal buffer like opaque materials. Set `renderTransparent` to `false` to apply the same material rule as the depth in [`GBufferPlugin`](./GBufferPlugin): a transparent or transmissive material is then rendered only when its `userData.renderToDepth` (or `userData.renderToGBuffer`) is `true`, and an opaque material is left out when it is `false`. Objects with a `customGBufferMaterial` or `customNormalMaterial` can still differ, as each pass draws its own custom material. Screen-space effects that compare normals across edges with the GBuffer depth need this, otherwise a transparent surface over an object that only the depth shows gives wrong normals at its edges.

```typescript
normalPlugin.renderTransparent = false

// render one transparent material to the normal buffer anyway
material.userData.renderToDepth = true
```
