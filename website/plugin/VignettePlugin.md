---
prev: 
    text: 'FrameFadePlugin'
    link: './FrameFadePlugin'

next: 
    text: 'ChromaticAberrationPlugin'
    link: './ChromaticAberrationPlugin'

---

# VignettePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#vignette-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/VignettePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/VignettePlugin.html)

VignettePlugin adds a post-processing material extension to the ScreenPass in render manager
that applies a vignette effect to the final render. The parameters `power` and `color` can be changed to customize the effect.

```typescript
import {ThreeViewer, VignettePlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const vignettePlugin = viewer.addPluginSync(VignettePlugin)

// Change the vignette color
vignettePlugin.power = 1
vignettePlugin.color = new Color(0.5, 0, 0)

// or 
// vignettePlugin.color.set('#ff0000'); vignettePlugin.setDirty() // Call setDirty to tell the plugin that color has changed
```
