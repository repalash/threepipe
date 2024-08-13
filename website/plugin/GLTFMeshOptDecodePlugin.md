---
prev: 
    text: 'KTXLoadPlugin'
    link: './KTXLoadPlugin'

next: 
    text: 'SimplifyModifierPlugin'
    link: './SimplifyModifierPlugin'

---

# GLTFMeshOptDecodePlugin

[Example](https://threepipe.org/examples/#gltf-meshopt-compression/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/import/GLTFMeshOptDecodePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GLTFMeshOptDecodePlugin.html)

Loads the MeshOpt Decoder module from [meshoptimizer](https://github.com/zeux/meshoptimizer) library at runtime from a customisable cdn url.
The loaded module is set in `window.MeshoptDecoder` and then used by `GLTFLoader2` to decode files using [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md) extension

```typescript
import {GLTFMeshOptDecodePlugin} from 'threepipe'
const plugin = viewer.addPluginSync(new GLTFMeshOptDecodePlugin())
// await plugin.initialize() // optional, this happens when loading a gltf file with extension anyway

const texture = await viewer.load('file.glb')
```
