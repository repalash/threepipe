---
prev:
    text: 'VirtualCamerasPlugin'
    link: './VirtualCamerasPlugin'

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

In the example, each light and camera has a round icon at its position: a sun for the directional light (amber), a
spot lamp for the spot light (orange), a bulb for the point light (yellow) and a camera for the perspective and
orthographic cameras (violet). The light icons have a small dot in the colour of the light. The lines of each helper
(the plane and aim line of the directional light, the spot cone, the point light sphere, the camera frustum) are in the
colour of the kind, and the boxes in front of the two shadow-casting lights are their shadow camera frustums
(`showShadowFrustum` is on in the example).

## Icons

Each light and camera widget shows a round icon at the object's position. The icon always faces the camera, keeps its
size in pixels at any distance and zoom, and is drawn on top of the scene. It is not rendered in the GBuffer or the
depth passes, casts no shadows, and is never exported (widgets are not part of the model root).

- Every kind of light and camera has its own colour and icon, the same for the icon and the lines of its helper. A light
  icon also has a small dot in the light's own colour.
- A click on the icon selects the light or the camera, through the `PickingPlugin`, like a click on its lines. The icon
  is in front of the models for the click too, as it is drawn on top of them.
- The colours and icons are in `widgetKinds` (`src/three/widgets/widgetKinds.ts`), with `getWidgetKind(object)` and the
  shared textures `getWidgetIconTexture(kind)`, for any other UI that shows lights and cameras.

| Kind | Colour | Icon |
|---|---|---|
| Directional light | `#f59e0b` | sun |
| Spot light | `#f97316` | spot lamp |
| Point light | `#eab308` | bulb |
| Rect area light | `#fb923c` | panel |
| Hemisphere and ambient light | `#64748b` | dome |
| Perspective camera | `#8b5cf6` | camera with a lens |
| Orthographic camera | `#8b5cf6` | camera with a square lens |

The rect area, hemisphere and ambient lights have no widget yet; their colours are there for other UI.

## Options

| Property | Default | |
|---|---|---|
| `showIcons` | `true` | Show the icons of lights and cameras |
| `iconSize` | `22` | The diameter of the icons in CSS pixels |
| `showShadowFrustum` | `false` | Draw the frustum of the shadow camera of directional and spot lights that cast shadows |

All three are in the plugin UI (Widgets folder) and apply to every widget. A single widget has the same options:
`widget.showIcon`, `widget.iconSize`, `lightWidget.showShadowFrustum`, and `widget.color` for another colour of its lines.

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

// icon size in pixels, and the frustum of the shadow cameras
plugin.iconSize = 28
plugin.showShadowFrustum = true

// to hide the icons only
plugin.showIcons = false

// to hide the widgets
plugin.enabled = false

// to add support for a custom helper
plugin.helpers.push(MyCustomHelper)
plugin.refresh()

```
