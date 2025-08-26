---
prev: 
    text: 'ParallaxMappingPlugin'
    link: './ParallaxMappingPlugin'

next: 
    text: 'VirtualCamerasPlugin'
    link: './VirtualCamerasPlugin'

aside: false
---

# HDRiGroundPlugin (Projected Skybox)

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#hdri-ground-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/HDRiGroundPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/HDRiGroundPlugin.html)

<iframe src="https://threepipe.org/examples/hdri-ground-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe HDRi Ground Plugin Example"></iframe>

HDRiGroundPlugin patches the background shader in the renderer to add support for ground projected environment map/skybox. Works simply by setting the background same as the environment and enabling the plugin.

The world radius, tripod height, and origin position(center offset) can be set in the plugin.

The plugin is disabled by default when added. Set `.enabled` to enable it or pass `true` in the constructor.
If the background is not the same as the environment when enabled, the user will be prompted for this, unless `promptOnBackgroundMismatch` is set to `false` in the plugin.

```typescript
import {ThreeViewer, HDRiGrounPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const hdriGround = viewer.addPluginSync(new HDRiGrounPlugin())

// Load an hdr environment map
await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
// set background to environment
viewer.scene.background = 'environment'
// or 
// viewer.scene.background = viewer.scene.environemnt

// enable the plugin
hdriGround.enabled = true
```
