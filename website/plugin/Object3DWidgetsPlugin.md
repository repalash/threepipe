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
orthographic cameras (violet). The light icons have a small dot in the colour of the light. The lines of a light helper
(the plane and aim line of the directional light, the spot cone, the point light sphere) are in the colour of the light,
the camera frustums in the camera colour, and the boxes in front of the two shadow-casting lights are their shadow camera frustums
(`showShadowFrustum` is on in the example).

## Icons

Each light and camera widget shows a round icon at the object's position. The icon always faces the camera, keeps its
size in pixels at any distance and zoom, and is drawn on top of the scene. It is not rendered in the GBuffer or the
depth passes, casts no shadows, and is never exported (widgets are not part of the model root).

- Every kind of light and camera has its own colour and icon. A camera helper draws its lines in that colour; a light
  helper draws its lines in the light's own colour, and the light icon has a small dot in it.
- A click on the icon selects the light or the camera, through the `PickingPlugin`, like a click on its lines. The icon
  is in front of the models for the click too, as it is drawn on top of them.
- The colours and icons are in `widgetKinds` (`src/three/widgets/widgetKinds.ts`), with `getWidgetKind(object)`, the
  shapes of the icons `getWidgetIconShapes(kind)` and the same icon as SVG, `getWidgetIconSvg(kind)`, for any other UI
  that shows lights and cameras.

### Icon mode

`iconMode` sets how the icons are drawn. Changing it switches all icons at once, with no reload.

| `iconMode` | How | Good | Not |
|---|---|---|---|
| `'dom'` (default) | SVG elements in a layer over the canvas, in the viewer container | Sharp at any pixel ratio and icon size; never in a render, screenshot or recording of the canvas | Not seen in WebXR. Without a viewer container in a page (an offscreen canvas) the icons are sprites |
| `'sprite'` | Camera-facing quads in the scene, not tone mapped | Seen in WebXR and with an offscreen canvas; part of a render or screenshot of the canvas | Pixels of a texture: sharp only with `renderScale` set to the device pixel ratio |

The widgets are not tone mapped (`toneMapped: false`): their pixels write only their GBuffer flags, so the plugin
depends on the [`GBufferPlugin`](./GBufferPlugin) and adds it to the viewer. Without the GBuffer flags, the tone
mapping applies to every pixel, and the colours of the lines and of the `'sprite'` icons change.

In both modes the icons follow `showIcons`, `iconSize` and the visibility of the widgets, a click or tap selects the
object, and where two icons overlap the nearer one is on top and gets the click. An icon whose centre is just out of the
view still shows the part of it that is on the canvas.

- DOM: the layer (`WidgetIconOverlay`, `plugin.iconOverlay`) has `z-index` 8, under the other overlays on the canvas.
  The icons are placed after each render with `transform` only, and hidden behind the camera. A click or tap goes
  through the picker as a click on a sprite icon does (`ObjectPicker.selectHit`): the same check (the selection
  condition, `userData.userSelectable`, `userData.bboxVisible`), the `hitObject` event, the picking mode, multi-select
  with shift, ctrl or cmd, and the same limits for a click (a long press or a drag is not one). With hover on in the
  picker, the pointer on an icon hovers the object. An icon that cannot be selected lets the pointer through to the
  canvas; the others show the pointer cursor, and a wheel over them still zooms the camera. A drag that starts on an
  icon that can be selected does not orbit. The icons follow the camera of the render.
- Sprite: the texture is drawn at about one texel per device pixel (`iconSize` times the render scale), and again only
  when one of them changes. For a sharp canvas on high DPI screens, create the viewer with `renderScale: 'auto'`.

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
| `iconMode` | `'dom'` | How the icons are drawn: `'dom'` (SVG over the canvas) or `'sprite'` (in the scene), see [Icon mode](#icon-mode) |
| `showShadowFrustum` | `false` | Draw the frustum of the shadow camera of directional and spot lights that cast shadows |

All four are in the plugin UI (Widgets folder) and apply to every widget. A single widget has the same options:
`widget.showIcon`, `widget.iconSize`, `widget.iconMode`, `lightWidget.showShadowFrustum`, and `widget.color` for another
colour of its lines. A widget used without the plugin has no DOM layer, so it shows its icon as a sprite (its default).

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
plugin.iconMode = 'sprite' // icons in the scene (WebXR, renders); 'dom' (default) draws them over the canvas
plugin.showShadowFrustum = true

// to hide the icons only
plugin.showIcons = false

// to hide the widgets
plugin.enabled = false

// to add support for a custom helper
plugin.helpers.push(MyCustomHelper)
plugin.refresh()

```
