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

Opaque materials are drawn into the GBuffer. Transparent and transmissive materials are drawn only when their `userData.renderToDepth` (or, when that is not set, `userData.renderToGBuffer`) is `true`, and any material is left out when it is `false`. A transparent material that looks opaque (an opacity above 0.99, no `map` and no `alphaMap`) is drawn as opaque when neither is set. SSAO, SSR, depth of field and outlines see only the materials in the GBuffer.

### Alpha: foliage, lace and decals

A material in the GBuffer keeps the cut-out shape of its `map` and `alphaMap` alpha: pixels with an alpha below its `alphaTest` are left out, and all the others write depth and normal, as in the render. With `alphaTest` 0 (the default) nothing is cut.

| Material | In the GBuffer | Result |
|---|---|---|
| Cutout: opaque with `alphaTest`, like 0.5 (glTF `alphaMode: MASK`) | Yes, with its shape | SSAO, SSR, depth of field and outlines see the leaf shape. Use this for foliage, lace and decals. |
| Blended: `transparent: true` with an alpha texture (glTF `BLEND`) | No | It casts no SSAO, and outlines and SSR do not see it. Its pixels keep the depth and flags of the object behind it (or of the background), so depth of field blurs it at that depth, tone mapping follows that object, and a `PhysicalMaterial` receives the SSAO of that object (`userData.ssaoDisabled` turns it off). |
| Blended, with `userData.renderToDepth = true` | Yes | All its pixels write depth and normal, also the transparent ones, which shows its whole quad in SSAO and depth of field. Set `alphaTest` with it. |

Use a blended material only for a surface that is really see-through, like glass or a veil.

The flags texture holds bits per pixel that the plugins read, like the tone mapping bit of [`TonemapPlugin`](./TonemapPlugin) (off for a material with `toneMapped: false`). A material that is left out of the GBuffer writes no flags, so its pixels get the clear value (all bits on). Set `userData.renderToFlags` to `true` to write only the flags for such a material: no depth and no normal, so SSAO, SSR, depth of field and outlines do not see it. It is drawn after the other objects, without depth write and with its own depth test, and its pixels with an alpha of about 0 are left out. The helper widgets use it, so that their colors are not tone mapped:

```typescript
const material = new LineMaterial2({color: 0xff0000, toneMapped: false, transparent: true, depthWrite: false})
material.userData.renderToGBuffer = false // no depth and normal
material.userData.renderToDepth = false
material.userData.renderToFlags = true // but the flags: not tone mapped
```

`renderToFlags` needs the flags texture (`renderFlagsBuffer`, on by default) and a material that the GBuffer material draws: one with `allowOverride` true, or a fat line (`LineMaterial2`, drawn with its `customGBufferMaterial`). A material that is drawn into the GBuffer always writes its flags.
