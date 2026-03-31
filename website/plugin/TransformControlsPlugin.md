---
prev: 
    text: 'InteractionPromptPlugin'
    link: './InteractionPromptPlugin'

next:
    text: 'PivotControlsPlugin'
    link: './PivotControlsPlugin'

---

# TransformControlsPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#transform-controls-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/TransformControlsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TransformControlsPlugin.html)

Transform Controls Plugin adds support for moving, rotating and scaling objects in the viewer with interactive widgets.

Under the hood, TransformControlsPlugin uses [TransformControls2](https://threepipe.org/docs/classes/TransformControls2) to provide the interactive controls, it is a extended version of three.js [TransformControls](https://threejs.org/docs/#examples/en/controls/TransformControls).

When the plugin is added to the viewer, it interfaces with the [PickingPlugin](./PickingPlugin) and shows the control gizmos when an object is selected and hides them when the object is unselected.

If the `PickingPlugin` is not added to the viewer before the `TransformControlsPlugin`, it is added automatically with the plugin.

```typescript
import {ThreeViewer, TransformControlsPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const transfromControlsPlugin = viewer.addPluginSync(new TransformControlsPlugin())

// Get the underlying transform controls
console.log(transfromControlsPlugin.transformControls)
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **W** | Translate mode |
| **E** | Rotate mode |
| **R** | Scale mode |
| **Q** | Toggle coordinate space (world/local) |
| **Shift** (hold) | Enable snapping (translation 0.5, rotation 15°, scale 0.25) |
| **X / Y / Z** | Toggle axis visibility |
| **+/-** | Increase/decrease gizmo size |
| **Space** | Toggle controls enabled/disabled |

Moving an object after a Ctrl+D duplicate (from [PickingPlugin](./PickingPlugin)) records the offset for smart duplicate chaining.

## Multi-Object Transform

When multiple objects are selected (Shift+Click), the gizmo appears at the median position of all selected objects. Translating, rotating, and scaling applies to all selected objects simultaneously, maintaining their relative positions. The coordinate space is forced to world mode during multi-select. Undo/redo records a single step for the entire group operation. See [PickingPlugin](./PickingPlugin) for multi-selection controls.

## Pivot Point Editing

To interactively edit an object's pivot point (origin), use the [PivotEditPlugin](./PivotEditPlugin) alongside this plugin. It provides a separate translate-only gizmo for moving the pivot while keeping the object mesh in place.
