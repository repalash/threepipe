---
prev: 
    text: 'Object3DWidgetsPlugin'
    link: './Object3DWidgetsPlugin'

next: 
    text: 'DeviceOrientationControlsPlugin'
    link: './DeviceOrientationControlsPlugin'

---

# Object3DGeneratorPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#object3d-generator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/Object3DGeneratorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/Object3DGeneratorPlugin.html)

Object3DGeneratorPlugin adds support for creating different types of lights and camera objects in the viewer.
Call the `generate` method with any type to generate a type of object(like lights, cameras, mesh etc.).

Support for the following types of generators is included in the plugin:
* camera-perspective - Creates instance of `PerspectiveCamera2`
* light-directional - Creates instance of `DirectionalLight2`
* light-ambient - Creates instance of `AmbientLight2`
* light-point - Creates instance of `PointLight2`
* light-spot - Creates instance of `SpotLight2`
* light-hemisphere - Creates instance of `HemisphereLight2`
* light-rect-area - Creates instance of `RectAreaLight2`

Additional types of generators can be added dynamically or by other plugins by adding a custom generator function to the `Object3DGeneratorPlugin.generators` object. This is done by [GeometryGeneratorPlugin](../package/plugin-geometry-generator) to add various type of primitive objects like plane, sphere, etc.
A custom generator can take in any kind object as parameters and should return an `IObject3D`.

Sample Usage
```typescript
import {ThreeViewer, Object3DWidgetsPlugin, Object3DGeneratorPlugin, Mesh2} from 'threepipe'

const viewer = new ThreeViewer({...})

const generator = viewer.addPluginSync(Object3DGeneratorPlugin)
generator.generate('camera-perspective', {
  position: new Vector3(5, 5, 0),
  name: 'My Camera'
})
const light = generator.generate('light-spot', {
  position: new Vector3(5, 0, 0),
})

// to add support for a custom helper
plugin.generators['custom-object'] = (params)=>{
  const object = new Mesh2(new PlaneGeometry(1,1), new PhysicalMaterial())
  object.name = params.name ?? 'Custom Mesh'
  if(params.position) object.position.copy(params.position)
  return object
}
const obj = generator.generate('custom-object', {
  position: new Vector3(5, 0, 0),
})

// Add Object3DWidgetsPlugin to see the added lights and cameras.
viewer.addPluginSync(new Object3DWidgetsPlugin())
```

Check the [example](https://threepipe.org/examples/#object3d-generator-plugin/) for the UI.
