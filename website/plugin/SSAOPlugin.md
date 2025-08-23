---
prev: 
    text: 'GBufferPlugin'
    link: './GBufferPlugin'

next: 
    text: 'CanvasSnapshotPlugin'
    link: './CanvasSnapshotPlugin'

aside: false
---

# SSAOPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#ssao-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/SSAOPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SSAOPlugin.html)

<iframe src="https://threepipe.org/examples/ssao-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe SSAO Plugin Example"></iframe>

SSAO Plugin adds support for [Screen Space Ambient Occlusion](https://en.wikipedia.org/wiki/Screen_space_ambient_occlusion) to the viewer. Simply add the plugin to the viewer to use it.

This is done by adding a pre-render pass to the render manager which renders SSAO to a custom render target. SSAOPlugin depends on [GBufferPlugin](./GBufferPlugin), and is automatically added if not already.

This render target is then used by all PhysicalMaterial(s) in the scene during the main RenderPass to get the AO data. SSAO can also be disabled from the UI of the material.

Note: Use with [ProgressivePlugin](./ProgressivePlugin) and `TemporalAAPlugin` for best results.

```typescript
import {ThreeViewer, SSAOPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const ssaoPlugin = viewer.addPluginSync(new SSAOPlugin())

// get the buffer. 
console.log(ssaoPlugin.target);

// disable ssao for a material in the scene
material.userData.ssaoDisabled = true
```
> In the target/buffer - The ssao data is in the `r` channel to remain compatible with ORM. `gba` contains the depth in vec3(xyz) format.
> Note that its `ssaoDisabled`, so setting it to `true` will disable the effect.

