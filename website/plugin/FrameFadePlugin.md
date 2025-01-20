---
prev: 
    text: 'GeometryUVPreviewPlugin'
    link: './GeometryUVPreviewPlugin'

next: 
    text: 'VignettePlugin'
    link: './VignettePlugin'

---

# FrameFadePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#frame-fade-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/FrameFadePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FrameFadePlugin.html)

FrameFadePlugin adds a post-render pass to the render manager and blends the last frame with the current frame over time. This is useful for creating smooth transitions between frames for example when changing the camera position, material, object properties, etc. to avoid a sudden jump.

```typescript
import {ThreeViewer, FrameFadePlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const fadePlugin = viewer.addPluginSync(new FrameFadePlugin())

// Make some changes in the scene (any visual change that needs to be faded)

// Start transition and wait for it to finish
await fadePlugin.startTransition(400) // duration in ms

```

To stop a transition, call `fadePlugin.stopTransition()`. This will immediately set the current frame to the last frame and stop the transition. The transition is also automatically stopped when the camera is moved or some pointer event occurs on the canvas.

The plugin automatically tracks `setDirty()` function calls in objects, materials and the scene. It can be triggerred by calling `setDirty` on any material or object in the scene. Check the [example](https://threepipe.org/examples/#frame-fade-plugin/) for a demo. This can be disabled by options in the plugin.
