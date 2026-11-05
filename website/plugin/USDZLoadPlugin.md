---
prev:
    text: 'KTXLoadPlugin'
    link: './KTXLoadPlugin'

next:
    text: 'GLTFMeshOptDecodePlugin'
    link: './GLTFMeshOptDecodePlugin'

---

# USDZLoadPlugin

[Example](https://threepipe.org/examples/#usdz-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/USDZLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/USDZLoadPlugin.html)

Adds support for loading [Universal Scene Description](https://openusd.org/) files: `.usdz`, `.usda`, `.usdc` and `.usd` (text or binary). Uses the three.js `USDLoader`.

```typescript
import {USDZLoadPlugin} from 'threepipe'
viewer.addPluginSync(new USDZLoadPlugin())

const mesh = await viewer.load('file.usdz')
const mesh2 = await viewer.load('file.usda')
const mesh3 = await viewer.load('file.usdc')
```

Sublayers, point instancers and curves are not supported.

Houdini, Blender, Maya and other DCC tools can export USD. Houdini `.hip` scene files store the node network, not the geometry; export USD (or glTF) from Houdini to load the scene.
