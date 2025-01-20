---
prev: 
    text: 'KTX2LoadPlugin'
    link: './KTX2LoadPlugin'

next: 
    text: 'GLTFMeshOptDecodePlugin'
    link: './GLTFMeshOptDecodePlugin'

---

# KTXLoadPlugin

[Example](https://threepipe.org/examples/#ktx-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/KTXLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/KTXLoadPlugin.html)

Adds support for loading `.ktx` [Khronos Texture](https://www.khronos.org/opengles/sdk/tools/KTX/file_format_spec/) files.

Note: This plugin only adds support for loading .ktx file, and not exporting them in the bundled .glb.  Use .ktx2 files instead of .ktx files for better compression and performance.

```typescript
import {KTXLoadPlugin} from 'threepipe'
viewer.addPluginSync(new KTXLoadPlugin())

const texture = await viewer.load('file.ktx')
```
