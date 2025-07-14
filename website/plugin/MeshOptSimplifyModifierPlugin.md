---
prev: 
  text: 'SimplifyModifierPlugin'
  link: './SimplifyModifierPlugin'

next:
  text: 'UndoManagerPlugin'
  link: './UndoManagerPlugin'
---

# MeshOptSimplifyModifierPlugin

[Example](https://threepipe.org/examples/#meshopt-simplify-modifier-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/MeshOptSimplifyModifierPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/MeshOptSimplifyModifierPlugin.html)

Simplify modifier using [meshoptimizer](https://github.com/zeux/meshoptimizer) library. It Loads the library at runtime from a customisable CDN URL.

Note: It does not guarantee that the geometry will be simplified to the exact target count.

```typescript
const simplifyModifier = viewer.addPluginSync(new MeshOptSimplifyModifierPlugin())

const root = await viewer.load('file.glb')
simplifyModifier.simplifyAll(root, {factor: 0.75})
```
