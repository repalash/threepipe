---
prev: 
    text: 'VirtualCamerasPlugin'
    link: './VirtualCamerasPlugin'

next: 
    text: 'Object3DWidgetsPlugin'
    link: './Object3DWidgetsPlugin'

---

# EditorViewWidgetPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#editor-view-widget-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/EditorViewWidgetPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/EditorViewWidgetPlugin.html)

EditorViewWidgetPlugin adds a ViewHelper in the parent of the viewer canvas to show the current camera view and allow the user to change the camera view to one of the primary world axes.

Simply add the plugin to the viewer to see the widget.

```typescript
import {ThreeViewer, EditorViewWidgetPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const plugin = viewer.addPluginSync(new EditorViewWidgetPlugin())

// to hide the widget
plugin.enabled = false
```
