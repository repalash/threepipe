---
prev:
    text: 'Object3DGeneratorPlugin'
    link: './Object3DGeneratorPlugin'

next:
    text: 'ShapeTubeExtrudePlugin'
    link: './ShapeTubeExtrudePlugin'

---

# GeometryGeneratorPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#geometry-generator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/geometry/GeometryGeneratorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/GeometryGeneratorPlugin.html)

GeometryGeneratorPlugin creates updatable parametric objects and geometries. It includes built-in generators for several primitive types from three.js and automatically registers them with [Object3DGeneratorPlugin](./Object3DGeneratorPlugin) when both plugins are active.

Built-in geometry generators:
* plane, sphere, box, circle, torus, cylinder — basic primitives
* tube — circular cross-section along a curve
* shape — flat 2D shapes (rectangle, circle, polygon)
* tubeShape — arbitrary shape cross-section extruded along a curve
* line — curve/path visualization with interactive control point handles

Additional `text` geometry is available through `GeometryGeneratorExtrasPlugin` in the [`@threepipe/plugin-geometry-generator`](../package/plugin-geometry-generator) package.

Generated geometries can be updated at any time by modifying their parameters and calling `geometry.setDirty({regenerate: true})`.

Sample Usage
```typescript
import {ThreeViewer, GeometryGeneratorPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const generator = viewer.addPluginSync(GeometryGeneratorPlugin)

// Generate a sphere mesh and add it to the scene
const sphere = generator.generateObject('sphere', {
  radius: 1,
  widthSegments: 32,
  heightSegments: 32,
})
viewer.scene.addObject(sphere)

// Generate a box mesh
const box = generator.generateObject('box', {
  width: 2,
  height: 2,
  depth: 2,
})
viewer.scene.addObject(box)

// Update the geometry parameters later
sphere.geometry.userData.generationParams.radius = 2
sphere.geometry.setDirty({regenerate: true})
```

Check the [example](https://threepipe.org/examples/#geometry-generator-plugin/) for the UI.
