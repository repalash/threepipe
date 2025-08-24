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
