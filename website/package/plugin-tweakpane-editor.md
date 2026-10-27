---
prev: 
    text: '@threepipe/plugin-blueprintjs'
    link: './plugin-blueprintjs'

next: 
    text: '@threepipe/plugin-configurator'
    link: './plugin-configurator'

---

# @threepipe/plugin-tweakpane-editor

Tweakpane Editor Plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tweakpane-editor/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/TweakpaneEditorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/TweakpaneEditorPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-tweakpane-editor.svg)](https://www.npmjs.com/package/@threepipe/plugin-tweakpane-editor)

```bash
npm install @threepipe/plugin-tweakpane-editor
```

`TweakpaneEditorPlugin` uses `TweakpaneUiPlugin` and other custom ui to create an editor for editing viewer, plugins, model and material configurations in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})

viewer.addPluginSync(new TweakpaneUiPlugin(true))
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())

// Add some plugins to the viewer
await viewer.addPlugins([
    new ViewerUiConfigPlugin(),
    // new SceneUiConfigPlugin(), // this is already in ViewerUiPlugin
    new DepthBufferPlugin(HalfFloatType, true, true),
    new NormalBufferPlugin(HalfFloatType, false),
    new RenderTargetPreviewPlugin(false),
])

// Load the plugin UI in the editor and tweakpane ui with categories.
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, SceneUiConfigPlugin, DropzonePlugin, FullScreenPlugin],
    ['GBuffer']: [DepthBufferPlugin, NormalBufferPlugin],
    ['Post-processing']: [TonemapPlugin],
    ['Debug']: [RenderTargetPreviewPlugin],
})
```

## SelectionUxPlugin

[Example](https://threepipe.org/examples/#selection-ux-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/selection/SelectionUxPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/SelectionUxPlugin.html)

`SelectionUxPlugin` selects objects in the viewport as in Figma: groups first, then one level deeper. This is the selection model; the overlay, the drags and the tools come in later versions.

- A click selects the outermost group under the pointer. A group with a single child is one level with that child (glTF wrappers like "Scene" > "root"). A top-level object that holds a whole file (an imported file root, or the only top-level object with meshes) passes the click to its parts.
- A click on the selected group keeps it. A double click selects one level deeper. When a part of a group is selected, a click on another part of that group selects that part.
- A click again on the same spot (after a pause, not a double click) selects the next object behind it.
- Shift+click adds or removes an object. Ctrl/Cmd+click selects the deepest object under the pointer.
- Keys: Esc or Shift+Enter select the parent, Enter the children, Tab / Shift+Tab the next / previous sibling, Ctrl/Cmd+A all objects at the level of the selection. With nothing selected, Esc, Enter and Tab keep their usual use.
- A drag is not a click: the camera controls keep it.
- Hidden objects are not selected. An object with `userData.userSelectable = false` is not a level: its parts are at the level of its parent (a click, Tab, Enter and Ctrl/Cmd+A reach them), and a click on a part of it that cannot be selected selects its first parent that can.

The selection is the selection of the `PickingPlugin` (the plugin adds it): its `selectedObjectChanged` event, its box widget and its undo steps work as before, and each selection change is one undo step when the viewer has an `UndoManagerPlugin`. While the plugin is enabled, it takes over the clicks of the `PickingPlugin`. The plugin is not added to the editor by default.

```typescript
import {ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {SelectionUxPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(UndoManagerPlugin)
const ux = viewer.addPluginSync(SelectionUxPlugin)

ux.addEventListener('uxUpdate', (e) => {
    if (e.reason === 'selection') console.log(ux.selected.map(o => o.name))
    if (e.reason === 'hover') console.log(ux.hovered?.name) // what a click would select
})

ux.select([object1, object2]) // the primary first; one undo step
ux.levels(object1)            // the levels from the model root down to object1
ux.resolveTarget(mesh, false, false) // what a click on mesh selects
ux.selectParent()             // also selectChildren, selectSibling(1 | -1), selectAllInScope
ux.enabled = false            // the PickingPlugin selects on click again
```
