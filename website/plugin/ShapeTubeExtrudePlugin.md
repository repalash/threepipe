---
prev:
    text: 'GeometryGeneratorPlugin'
    link: './GeometryGeneratorPlugin'

next:
    text: 'GLTFKHRMaterialVariantsPlugin'
    link: './GLTFKHRMaterialVariantsPlugin'

---

# ShapeTubeExtrudePlugin

[Interactive Extrusion Example](https://threepipe.org/examples/#shape-tube-extrude-plugin/) &mdash;
[Generators Example](https://threepipe.org/examples/#shape-tube-extrude/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/geometry/ShapeTubeExtrudePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ShapeTubeExtrudePlugin.html)

Provides interactive extrusion of flat/planar geometry along a curve path. Select a flat mesh in the scene, click "Extrude Circle Tube", and the plugin auto-detects the planar axis, extracts a 2D shape from the vertices, and extrudes it along a circle curve using the `tubeShape` geometry generator.

Features:
* Extrude any flat/planar geometry along a circle curve
* Auto-detect the planar axis (X, Y, or Z) and extract a 2D shape from vertices
* Configurable shape/tube segments, shape scale, and material splits
* Multi-material support via configurable split positions
* Static `ExtrudeShape` helper for programmatic extrusion
* Static `ConvertGeometryToFlatShape` utility for extracting 2D shapes from 3D geometry

### Interactive Usage
```typescript
import {ThreeViewer, GeometryGeneratorPlugin, ShapeTubeExtrudePlugin} from 'threepipe'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GeometryGeneratorPlugin)
viewer.addPluginSync(ShapeTubeExtrudePlugin) // auto-adds PickingPlugin dependency

// Add flat shapes to the scene, then select one and click
// "Extrude Circle Tube" in the plugin UI panel.
```

### Programmatic Usage
```typescript
import {ShapeTubeExtrudePlugin, EllipseCurve3D, Shape} from 'threepipe'

// Create a custom shape
const shape = new Shape()
shape.moveTo(-0.3, -0.15)
shape.lineTo(0.3, -0.15)
shape.lineTo(0.3, 0.15)
shape.lineTo(-0.3, 0.15)
shape.closePath()

// Extrude along a circle
const curve = new EllipseCurve3D(0, 0, 1, 1, 0, 2 * Math.PI, false, 0)
const mesh = ShapeTubeExtrudePlugin.ExtrudeShape(viewer, shape, curve, 16, 64)
viewer.scene.addObject(mesh)
```

Check the [interactive example](https://threepipe.org/examples/#shape-tube-extrude-plugin/) or the [generators example](https://threepipe.org/examples/#shape-tube-extrude/) for full demos.
