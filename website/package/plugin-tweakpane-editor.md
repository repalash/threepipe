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

`SelectionUxPlugin` selects objects in the viewport as in Figma: groups first, then one level deeper, and draws the selection over the canvas. The drags, the handles and the tools come in later versions.

- A click selects the outermost group under the pointer. A group with a single child is one level with that child (glTF wrappers like "Scene" > "root"). A top-level object that holds a whole file (an imported file root, or the only top-level object with meshes) passes the click to its parts.
- A click on the selected group keeps it. A double click selects one level deeper. When a part of a group is selected, a click on another part of that group selects that part.
- A click again on the same spot (after a pause, not a double click) selects the next object behind it.
- Shift+click adds or removes an object. Ctrl/Cmd+click selects the deepest object under the pointer.
- Keys: Esc or Shift+Enter select the parent, Enter the children, Tab / Shift+Tab the next / previous sibling, Ctrl/Cmd+A all objects at the level of the selection. With nothing selected, Esc, Enter and Tab keep their usual use, and so do Enter and Tab on a button or a link reached with the keyboard.
- A drag is not a click: the camera controls keep it.
- As in the `PickingPlugin`, a hidden object, an object with `userData.userSelectable = false` or `userData.bboxVisible = false`, and everything inside it are not selected: a click goes to the object behind, and Enter, Tab and Ctrl/Cmd+A skip them. A click on a mesh that the `PickingPlugin` cannot select selects its first parent that it can.
- With Multi-Select off in the `PickingPlugin`, one object is selected: Shift+click is a click, Enter selects the first child, and Ctrl/Cmd+A does nothing.

The overlay draws the selection over the canvas: its box, a thin box around each object of a multiple selection, a thin box around the hovered object (what a click would select), the name above the box after the names of its parent levels (a click on a parent name selects it), and the size of the box below it. Set `overlay = false` to draw nothing. The box has three styles (`boxStyle`): `rect`, the screen rectangle as in Figma; `box`, the 3D box, with the edges that face away dashed (`xray`); `brackets`, the corners of the 3D box. The box of one object turns with it (`boxSpace = 'local'`), or follows the world axes (`'world'`). `showHover`, `showName`, `showSize`, `unit` (like `'cm'`, after the size) and `accent` (the colour) set the rest. The overlay draws again only after a change: a render of a changed view (the camera or an object moved), the selection, the hover or one of these settings. After a change that it does not see, like the name of a selected object, call `redrawOverlay()`.

The selection is the selection of the `PickingPlugin` (the plugin adds it): its `selectedObjectChanged` event and its undo steps work as before (while the overlay draws, the box and the hover box of the `PickingPlugin` are off), and each selection change is one undo step when the viewer has an `UndoManagerPlugin`. While the plugin is enabled, it takes over the clicks of the `PickingPlugin`. When the `PickingPlugin` picks materials, geometries or textures (`selectionMode` or `pickingMode`), the plugin is off and the core picker keeps the clicks. The plugin is not added to the editor by default. As the other editor plugins, it has a UI folder (an Enabled toggle), `new SelectionUxPlugin(false)` adds it off, and it is not saved in the viewer config.

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
ux.boxStyle = 'box'           // the 3D box; 'rect' (default) or 'brackets'
ux.unit = 'cm'                // the size label shows "2.24 × 2.76 × 0.80 cm"
ux.enabled = false            // the PickingPlugin selects on click again, and shows its box
```
