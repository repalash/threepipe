---
prev: 
    text: 'CanvasSnapshotPlugin'
    link: './CanvasSnapshotPlugin'

next: 
    text: 'FullScreenPlugin'
    link: './FullScreenPlugin'

---

# PickingPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#picking-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/interaction/PickingPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/PickingPlugin.html)

Picking Plugin adds support for selecting and hovering over objects in the viewer with user interactions and selection widgets.

When the plugin is added to the viewer, it starts listening to the mouse move and click events over the canvas.
When an object is clicked, it is selected,
and if a UI plugin is added, the uiconfig for the selected object is populated in the interface.
The events `selectedObjectChanged`, `hoverObjectChanged`, and `hitObject` can be listened to on the plugin.

Picking plugin internally uses [ObjectPicker](https://threepipe.org/docs/classes/ObjectPicker.html),
check out the documentation or source code for more information.

```typescript
import {ThreeViewer, PickingPlugin} from 'threepipe'

const viewer = new ThreeViewer({...})

const pickingPlugin = viewer.addPluginSync(new PickingPlugin())

// Hovering events are also supported, but since its computationally expensive for large scenes it is disabled by default.
pickingPlugin.hoverEnabled = true

pickingPlugin.addEventListener('hitObject', (e)=>{
  // This is fired when the user clicks on the canvas.
  // The selected object hasn't been changed yet, and we have the option to change it or disable selection at this point.
    
  // e.intersects.selectedObject contains the object that the user clicked on.
  console.log('Hit: ', e.intersects.selectedObject)
  // It can be changed here 
  // e.intersects.selectedObject = e.intersects.selectedObject.parent // select the parent
  // e.intersects.selectedObject = null // unselect
  
  // Check other properties on the event like intersects, mouse position, normal etc.
  console.log(e)
})

pickingPlugin.addEventListener('selectedObjectChanged', (e)=>{
  // This is fired when the selected object is changed.
  // e.object contains the new selected object. It can be null if nothing is selected.
  console.log('Selected: ', e.object)
})

// Objects can be programmatically selected and unselected

// to select
pickingPlugin.setSelectedObject(object)

// get the selected object
console.log(pickingPlugin.getSelectedObject())
// to unselect
pickingPlugin.setSelectedObject(null)

// Select object with camera animation to the object
pickingPlugin.setSelectedObject(object, true)

pickingPlugin.addEventListener('hoverObjectChanged', (e)=>{
  // This is fired when the hovered object is changed.
  // e.object contains the new hovered object.
  console.log('Hovering: ', e.object)
})

```
