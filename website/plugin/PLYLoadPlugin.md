---
prev: 
    text: 'Rhino3dmLoadPlugin'
    link: './Rhino3dmLoadPlugin'

next: 
    text: 'USDZLoadPlugin'
    link: './USDZLoadPlugin'

---

# PLYLoadPlugin

[Example](https://threepipe.org/examples/#ply-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/PLYLoadPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PLYLoadPlugin.html)

Adds support for loading .ply ([Polygon file format](https://en.wikipedia.org/wiki/PLY_(file_format))) files.

```typescript
import {PLYLoadPlugin} from 'threepipe'
viewer.addPluginSync(new PLYLoadPlugin())

const mesh = await viewer.load('file.ply')
```
