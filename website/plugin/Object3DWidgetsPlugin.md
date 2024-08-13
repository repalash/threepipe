---
prev: 
    text: 'EditorViewWidgetPlugin'
    link: './EditorViewWidgetPlugin'

next: 
    text: 'Object3DGeneratorPlugin'
    link: './Object3DGeneratorPlugin'

---

# Object3DWidgetsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#object3d-widgets-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/Object3DWidgetsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/Object3DWidgetsPlugin.html)

Object3DWidgetsPlugin adds support for light and camera helpers/gizmos in the viewer.
A helper is automatically created when any supported light or camera is added to the scene.
Simply add the plugin to the viewer to see the widget.

Support for additional types of helpers can be added dynamically or by other plugins by pushing a helper constructor to the `Object3DWidgetsPlugin.helpers` array, and calling `Object3DWidgetsPlugin.refresh()`.

The helper class prototype should implement the `IObject3DHelper` interface. Check `DirectionalLightHelper2` for an example.

```typescript
import {ThreeViewer, Object3DWidgetsPlugin, Object3DGeneratorPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

// Add the plugin to add support
const plugin = viewer.addPluginSync(new Object3DWidgetsPlugin())

// Add some lights or cameras to the scene. (This can be done before adding the plugin as well)
// Using Object3DGeneratorPlugin to create a camera and add it to the scene.
const generator = viewer.getOrAddPluginSync(Object3DGeneratorPlugin)
generator.generate('camera-perspective', {
  position: new Vector3(5, 5, 0),
  name: 'My Camera'
})

// to hide the widgets
plugin.enabled = false

// to add support for a custom helper
plugin.helpers.push(MyCustomHelper)
plugin.refresh()

```
