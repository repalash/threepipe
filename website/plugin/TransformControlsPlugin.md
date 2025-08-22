---
prev: 
    text: 'InteractionPromptPlugin'
    link: './InteractionPromptPlugin'

next: 
    text: 'ObjectConstraintsPlugin'
    link: './ObjectConstraintsPlugin'

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
