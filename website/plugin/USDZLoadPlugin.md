---
prev: 
    text: 'PLYLoadPlugin'
    link: './PLYLoadPlugin'

next: 
    text: 'STLLoadPlugin'
    link: './STLLoadPlugin'

---

# USDZLoadPlugin

[Example](https://threepipe.org/examples/#usdz-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/USDZLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/USDZLoadPlugin.html)

Adds support for loading .usdz and .usda ([Universal Scene Description](https://graphics.pixar.com/usd/docs/index.html)) files.

```typescript
import {USDZLoadPlugin} from 'threepipe'
viewer.addPluginSync(new USDZLoadPlugin())

const mesh = await viewer.load('file.usdz')
const mesh2 = await viewer.load('file.usda')
```
