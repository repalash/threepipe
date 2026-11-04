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

## Materials in the GBuffer

Opaque materials are drawn into the GBuffer. Transparent and transmissive materials are drawn only when their `userData.renderToDepth` (or, when that is not set, `userData.renderToGBuffer`) is `true`, and any material is left out when it is `false`. A transparent material without maps and with an opacity of 1 draws as opaque when neither is set.

The flags texture holds bits per pixel that the plugins read, like the tone mapping bit of [`TonemapPlugin`](./TonemapPlugin) (off for a material with `toneMapped: false`). A material that is left out of the GBuffer writes no flags, so its pixels get the clear value (all bits on). Set `userData.renderToFlags` to `true` to write only the flags for such a material: no depth and no normal, so SSAO, SSR, depth of field and outlines do not see it. It is drawn after the other objects, without depth write and with its own depth test, and its pixels with an alpha of about 0 are left out. The helper widgets use it, so that their colors are not tone mapped:

```typescript
const material = new LineMaterial2({color: 0xff0000, toneMapped: false, transparent: true, depthWrite: false})
material.userData.renderToGBuffer = false // no depth and normal
material.userData.renderToDepth = false
material.userData.renderToFlags = true // but the flags: not tone mapped
```

`renderToFlags` needs WebGL2 (the flags texture) and a material that the GBuffer material draws: one with `allowOverride` true, or a fat line (`LineMaterial2`, drawn with its `customGBufferMaterial`). A material that is drawn into the GBuffer always writes its flags.
