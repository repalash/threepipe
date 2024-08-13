---
prev: 
    text: 'GLTFMeshOptDecodePlugin'
    link: './GLTFMeshOptDecodePlugin'

next: 
    text: 'MeshOptSimplifyModifierPlugin'
    link: './MeshOptSimplifyModifierPlugin'

---

# SimplifyModifierPlugin

[Example](https://threepipe.org/examples/#simplify-modifier-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/SimplifyModifierPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SimplifyModifierPlugin.html)

Boilerplate for implementing a plugin for simplifying geometries.
This is a base class and cannot be used directly.

A sample to use it:
```typescript
class SimplifyModifierPluginImpl extends SimplifyModifierPlugin {
  protected _simplify(geometry: IGeometry, count: number) {
    return new SimplifyModifier().modify(geometry, count) as IGeometry
  }
}

const plugin = viewer.addPluginSync(new SimplifyModifierPluginImpl())

const root = await viewer.load('file.glb')
plugin.simplifyAll(root, {factor: 0.75})
```
Check the [example](https://threepipe.org/examples/#simplify-modifier-plugin/) for full implementation.
