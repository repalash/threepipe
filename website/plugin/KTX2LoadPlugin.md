---
prev: 
    text: 'STLLoadPlugin'
    link: './STLLoadPlugin'

next: 
    text: 'KTXLoadPlugin'
    link: './KTXLoadPlugin'

---

# KTX2LoadPlugin

[Example](https://threepipe.org/examples/#ktx2-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/KTX2LoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/KTX2LoadPlugin.html)

Adds support for loading `.ktx2` [Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files with asset manager and embedded in glTF files.

KTX2LoadPlugin also adds support for exporting loaded .ktx2 files in glTF files with the [KHR_texture_basisu](https://www.khronos.org/registry/KHR/textures/2.0-extensions/KHR_texture_basisu/) extension.

```typescript
import {KTX2LoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTX2LoadPlugin())

const texture = await viewer.load('file.ktx2')
```
