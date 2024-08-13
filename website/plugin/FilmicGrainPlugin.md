---
prev: 
    text: 'ChromaticAberrationPlugin'
    link: './ChromaticAberrationPlugin'

next: 
    text: 'NoiseBumpMaterialPlugin'
    link: './NoiseBumpMaterialPlugin'

---

# FilmicGrainPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#filmic-grain-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/FilmicGrainPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/FilmicGrainPlugin.html)

FilmicGrainPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies a filmic-grain effect to the final render. The parameters `power` and `color` can be changed to customize the effect.

```typescript
import {ThreeViewer, FilmicGrainPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const filmicGrainPlugin = viewer.addPluginSync(FilmicGrainPlugin)

// Change the filmicGrain color
filmicGrainPlugin.intensity = 10
filmicGrainPlugin.multiply = false
```
