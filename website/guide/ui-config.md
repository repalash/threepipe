---
prev:
    text: 'Render Pipeline'
    link: './render-pipeline'

next:
    text: 'Serialization'
    link: './serialization'
aside: false
---

# UI Configuration

Almost all the classes and plugins in Threepipe include [uiconfig.js](https://repalash.com/uiconfig.js/) support and can be used to create configuration UIs, 3d configurators and even full-editors.
The UIs are automatically generated based on the configuration object under `.uiConfig` property on all objects. These are of type [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html).
In some classes, the ui configs are also generated using typescript decorators.

The `uiConfig` is also added to all three.js objects and materials when they are added to the scene.

The UIs can be generated at runtime using any of the UI plugins like [TweakpaneUIPlugin](../package/plugin-tweakpane), [BlueprintJsUiPlugin](../package/plugin-blueprintjs). They have full undo/redo support and interface with `UndoMangerPlugin` to maintain a common history with the rest of the viewer.

An example showing how to create a UI for a material

<iframe src="https://threepipe.org/examples/material-uiconfig/" style="width:100%;height:600px;border:none;" loading="lazy" title="Threepipe Material UI Config Example"></iframe>

```typescript
const ui = viewer.addPluginSync(TweakpaneUiPlugin)

const object = viewer.scene.getObjectByName('objectName');
const material = object.material as PhysicalMaterial;

ui.appendChild(material.uiConfig)
```

Check more examples showing [Viewer UI](https://threepipe.org/examples/#viewer-uiconfig/), [Scene UI](https://threepipe.org/examples/#scene-uiconfig/), [Object UI](https://threepipe.org/examples/#object-uiconfig/), [Camera UI](https://threepipe.org/examples/#camera-uiconfig/), [Material UI](https://threepipe.org/examples/#material-uiconfig/)

::: info
[TweakpaneEditorPlugin](../package/plugin-tweakpane-editor) further uses the Tweakpane configuration panel along with various plugins to create a 3d editor.
:::

Custom UI configuration can be created to generate custom UI for the editor or tweaking.
This can be done by using typescript decorators or defining the UI in javascript as a [UiObjectConfig](https://repalash.com/uiconfig.js/interfaces/UiObjectConfig.html) object.

Here is a sample of extending the orbit controls class with decorators to automatically generate UI.
```typescript
@uiPanelContainer('Orbit Controls')
export class OrbitControlsWithUi extends OrbitControls implements IUiConfigContainer {
  // for autocomplete
  uiConfig?: UiObjectConfig<void, 'panel'> 

  @uiToggle() enabled = true

  @uiToggle() dollyZoom = false
  @uiToggle() enableDamping = true
  @uiInput() dampingFactor = 0.08

  @uiToggle() autoRotate = false
  @uiInput() autoRotateSpeed = 2.0

  @uiToggle() enableZoom = true
  @uiInput() zoomSpeed = 0.15
  @uiInput() maxZoomSpeed = 0.20

  @uiToggle() enableRotate = true
  @uiInput() rotateSpeed = 2.0

  @uiToggle() enablePan = true
  @uiInput() panSpeed = 1.0

  @uiInput() autoPushTarget = false
  @uiInput() autoPullTarget = false
  @uiInput() minDistance = 0.35
  @uiInput() maxDistance = 1000

  @uiInput() minZoom = 0.01
  @uiInput() maxZoom = 1000

  @uiInput() minPolarAngle = 0
  @uiInput() maxPolarAngle = Math.PI

  @uiInput() minAzimuthAngle = -10000 // should be -Infinity but this breaks the UI
  @uiInput() maxAzimuthAngle = 10000

}
```

Check out the full source code:
[./src/three/controls/OrbitControls3.ts](https://github.com/repalash/threepipe/blob/master/src/three/controls/OrbitControls3.ts) for proper implementation

See it in action: https://threepipe.org/examples/#camera-uiconfig/ Open the Camera UI and click on the Orbit Controls panel.

There are many available decorators like `uiToggle`, `uiSlider`, `uiInput`, `uiNumber`, `uiColor`, `uiImage`.
Check the complete list in the [uiconfig.js documentation](https://repalash.com/uiconfig.js/).

The UI configuration can also be created using json objects in both typescript and javascript
```javascript
const viewer = new ThreeViewer({...})

const ui = viewer.addPluginSync(TweakpaneUiPlugin)

const state = {
    position: new Vector3(),
    scale: 1,
}

ui.appendChild({
  type: 'folder',
  label: 'Custom UI',
  children: [
    {
        type: 'vec3',
        label: 'Position',
        property: [state, 'position']
    },
    {
        type: 'slider',
        label: ()=>'Scale', // everything can be a function as well.
        property: [state, 'scale'],
        bounds: [1, 2],
        stepSize: 0.1,
    }
  ]
})
```

[//]: # (TODO: create example/codepen for this)

## Basic fields

Configs can have `tags` (a string or an array of strings). Renderers and editors read them to filter what they show, a renderer that does not read them shows the full UI.

The `basic` tag (`UiTags.Basic`) marks the few fields of an object, material, light, camera or material extension that a simple view shows, like an editor inspector with an "All" toggle for the full UI. The core configs tag these fields:

| Type | Basic fields |
|---|---|
| Objects and meshes | Visible, Name, Casts Shadow, Receive Shadow, Position, Rotation, Scale |
| Materials (physical, unlit, phong, shader) | name, color, map, opacity, transparent, and where the material has them: roughness, metalness, normalMap, emissive, emissiveIntensity, ior, transmission, thickness |
| Line materials | name, color, linewidth, opacity, transparent |
| Lights | Enabled, Name, Color (Sky and Ground Color for the hemisphere light), Intensity, Cast Shadow. Spot: Angle, Penumbra. Point: Distance. Rect area: Width, Height |
| Cameras | Name. Perspective: Field Of View. Orthographic: Zoom |
| Material extensions (clearcoat tint, custom bump map, fragment clipping, noise bump, SSAO) | the Enabled toggle |
| Geometry | none |

Actions like Duplicate and Delete are not basic, they belong in a menu (the `context-menu` tag, `UiTags.ContextMenu`).

The folder rule:
- Tag fields, not folders. A simple view shows a folder (as a section with its label) only when it holds a basic field, at any depth, and shows only the basic fields in it. A folder without basic fields is left out.
- A folder with the `basic` tag is basic as a whole and is shown with all its children.

`findTaggedUiConfigs(config, tag)` lists the tagged configs of a tree in order, each with the folders above it (`parents`, from the root to the direct parent), so a renderer can show them in sections or in one list. `hasUiTag(config, tag)` checks one config.

```typescript
import {findTaggedUiConfigs, UiConfigMethods, UiTags} from 'threepipe'

for (const {config, parents} of findTaggedUiConfigs(material.uiConfig, UiTags.Basic)) {
    // the last parent is the folder that holds the field, the root when there is only one
    const section = parents.length > 1 ? UiConfigMethods.GetLabel(parents[parents.length - 1]) : undefined
    // render config under the section
}
```

To mark the basic fields of your own plugin, object extension or material extension, add the tag to the config, or to the params of the decorator:

```typescript
class MyPlugin extends AViewerPluginSync {
    @uiToggle('Enabled', {tags: [UiTags.Basic]})
    enabled = true

    @uiSlider('Strength', [0, 1], 0.01, {tags: [UiTags.Basic]})
    strength = 0.5

    @uiSlider('Samples', [1, 32], 1) // not basic, shown only in the full UI
    samples = 8
}

const config: UiObjectConfig = {
    type: 'folder',
    label: 'My Extension',
    children: [
        {type: 'checkbox', label: 'Enabled', property: [state, 'enabled'], tags: [UiTags.Basic]},
        {type: 'slider', label: 'Scale', property: [state, 'scale']},
    ],
}
```

## Tags

`UiTags` lists the tags that threepipe sets in its configs. The values are plain strings, so a config or a renderer can use the string or the enum member: `tags: [UiTags.ContextMenu]` and `tags: ['context-menu']` are the same. Check a tag with `hasUiTag(config, UiTags.ContextMenu)`.

| Member | Value | Meaning | Read by |
|---|---|---|---|
| `Basic` | `basic` | The few fields that a simple view shows (see [Basic fields](#basic-fields)) | `findTaggedUiConfigs` |
| `ContextMenu` | `context-menu` | A button for a menu: an action on the object (duplicate, delete, set view, center geometry) | the blueprint renderer (menu of the folder), the blueprint editor (right-click menu of the hierarchy), the inspector of the tweakpane editor (its ⋯ menu) |
| `HeaderAction` | `header-action` | A button for the header of its folder, like Add Constraint. Set with `context-menu` | none yet (metadata) |
| `Inline` | `inline` | A `context-menu` button that stays in its folder in a UI that moves the menu buttons out of the settings | the inspector of the tweakpane editor (not in its ⋯ menu) |
| `Interaction` | `interaction` | A menu action that changes the object in the scene (scale to radius, auto center, pivot to center). Set with `context-menu` | none (metadata) |
| `Advanced` | `advanced` | A field for expert users (uuid, shadow map type, render passes, geometry groups) | none (metadata) |
| `Performance` | `performance` | A field that trades quality for speed, like a sample, ray or step count | none (metadata) |
| `Debug` | `debug` | A field to debug the output, like a buffer preview or a split view | none (metadata) |
| `Widget` | `widget` | The folder of a helper widget (`AHelperWidget`) | none (metadata) |
| `GeneratedGeometry` | `generatedGeometry` | The Generation Params folder of a generated geometry | `AGeometryGenerator`, to update or remove the folder |
| `Animation` | `animation` | The Property Animations folder of `AnimationObjectPlugin` | none (metadata) |
| `Constraints` | `constraints` | The Constraints folder of `ObjectConstraintsPlugin` on an object or material | none (metadata) |
| `Constraint` | `constraint` | The folder of one constraint, inside the Constraints folder | none (metadata) |

A plugin can also tag its own configs with its `PluginType` to find them again, like `AnimationObjectPlugin` and `ObjectConstraintsPlugin` do, or with its own tag, like `troika-text-params` of `TroikaTextPlugin`. These tags are not in `UiTags`.
