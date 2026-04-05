---
prev:
    text: 'DropzonePlugin'
    link: './DropzonePlugin'

next:
    text: 'LoadingScreenPlugin'
    link: './LoadingScreenPlugin'

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

## Multi-Selection

Picking Plugin supports selecting multiple objects simultaneously using modifier keys. Multi-selection is enabled by default and can be disabled:

```typescript
pickingPlugin.multiSelectEnabled = false // disable Shift+Click multi-selection
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Shift/Ctrl/Cmd+Click** | Toggle object in/out of selection |
| **Click** (no modifier) | Replace selection with single object |
| **Ctrl/Cmd+A** | Select all visible model objects |
| **Escape** | Clear entire selection |
| **Delete / Backspace** | Delete selected objects (with confirmation dialog) |
| **Ctrl/Cmd+D** | Duplicate selected objects (with smart offset) |
| **Ctrl/Cmd+Shift+D** | Duplicate with alternate mode (simple↔compound) |
| **Ctrl/Cmd+C** | Copy selected objects to clipboard |
| **Ctrl/Cmd+X** | Cut selected objects (visual tint, no scene change until paste) |
| **Ctrl/Cmd+V** | Paste from clipboard |
| **H** | Toggle visibility of selected objects (based on primary object's state) |
| **Shift+H** | Unhide all hidden objects in the scene |
| **F** | Focus/zoom camera to selected object |
| **Alt+G** | Reset position to (0, 0, 0) |
| **Alt+R** | Reset rotation to identity |
| **Alt+S** | Reset scale to (1, 1, 1) |

### Smart Duplicate

Duplicating with **Ctrl/Cmd+D** supports offset chaining with two modes (configurable via `duplicateMode` property or the UI dropdown):

- **simple** (default): position, rotation, and scale deltas applied independently. Translation direction stays constant in parent space. Good for straight-line grids and evenly-spaced rows.
- **compound**: full matrix delta applied. Translation direction rotates with the object. Good for circular arrays, spirals, and radial patterns.

**Ctrl/Cmd+Shift+D** uses the opposite mode from the current setting.

Usage:
1. Select an object, press Ctrl+D — duplicate appears on top (no offset).
2. Move/rotate/scale the duplicate using transform controls.
3. Press Ctrl+D again — next duplicate is placed at the same offset from the previous.
4. Repeat to create evenly-spaced chains or geometric patterns.

The offset is tied to the current selection chain. Any selection change (even reselecting the same object) resets the offset behavior. All operations are fully undoable — undo restores the tracker state so the chain can continue.

### Clipboard

Copy and cut store object references in an internal clipboard managed by [ObjectClipboard](https://threepipe.org/docs/classes/ObjectClipboard.html). Cut objects receive a visual tint (reduced opacity) until pasted or undone. Cut+paste preserves original UUIDs (single paste). Copy+paste creates new clones with new UUIDs (repeatable). All clipboard operations are fully undoable.

### API

```typescript
// Get all selected objects
const objects = pickingPlugin.getSelectedObjects()

// Toggle an object in/out of selection
pickingPlugin.toggleSelectedObject(object)

// Select all visible model objects
pickingPlugin.selectAll()

// Clear entire selection
pickingPlugin.clearSelection()

// Object operations
await pickingPlugin.deleteSelected()      // delete with confirmation
pickingPlugin.duplicateSelected()          // duplicate with smart offset
pickingPlugin.duplicateSelected('compound') // duplicate with compound mode
pickingPlugin.copySelected()               // copy to clipboard
pickingPlugin.cutSelected()                // cut to clipboard
pickingPlugin.pasteFromClipboard()         // paste from clipboard
pickingPlugin.toggleVisibilitySelected()   // toggle hide/show
pickingPlugin.unhideAll()                  // unhide all hidden objects
pickingPlugin.focusSelected()              // zoom camera to selection
pickingPlugin.resetTransform('position')   // reset position (Alt+G)
pickingPlugin.resetTransform('rotation')   // reset rotation (Alt+R)
pickingPlugin.resetTransform('scale')      // reset scale (Alt+S)

// Duplicate mode
pickingPlugin.duplicateMode = 'simple'     // or 'compound'

// The selectedObjectChanged event includes the full selection array
pickingPlugin.addEventListener('selectedObjectChanged', (e) => {
    console.log('Primary:', e.object)    // last clicked object
    console.log('All:', e.objects)        // full selection array
})
```

Multi-selection works with [TransformControlsPlugin](./TransformControlsPlugin) and [PivotControlsPlugin](./PivotControlsPlugin) for group transforms. [PivotEditPlugin](./PivotEditPlugin) operates on single objects and exits edit mode when the selection changes.
