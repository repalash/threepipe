---
prev: 
    text: 'USDZLoadPlugin'
    link: './USDZLoadPlugin'

next: 
    text: 'KTX2LoadPlugin'
    link: './KTX2LoadPlugin'

---

# STLLoadPlugin

[Example](https://threepipe.org/examples/#stl-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/STLLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/STLLoadPlugin.html)

Adds support for loading .stl ([Stereolithography](https://en.wikipedia.org/wiki/STL_(file_format))) files.

```typescript
import {STLLoadPlugin} from 'threepipe'
viewer.addPluginSync(new STLLoadPlugin())

const mesh = await viewer.load('file.stl')
```
