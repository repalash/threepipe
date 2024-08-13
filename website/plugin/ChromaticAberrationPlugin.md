---
prev: 
    text: 'VignettePlugin'
    link: './VignettePlugin'

next: 
    text: 'FilmicGrainPlugin'
    link: './FilmicGrainPlugin'

---

# ChromaticAberrationPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#chromatic-aberration-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/ChromaticAberrationPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ChromaticAberrationPlugin.html)

ChromaticAberrationPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies a chromatic-aberration effect to the final render. The parameter `intensity` can be changed to customize the effect.

```typescript
import {ThreeViewer, ChromaticAberrationPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const chromaticAberrationPlugin = viewer.addPluginSync(ChromaticAberrationPlugin)

// Change the chromaticAberration color
chromaticAberrationPlugin.intensity = 0.5
```
