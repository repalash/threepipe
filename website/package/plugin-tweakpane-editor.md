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

## EditorCameraPlugin

[Example](https://threepipe.org/examples/#editor-camera-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/EditorCameraPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/EditorCameraPlugin.html)

`EditorCameraPlugin` gives an editor its own camera, separate from the scene's camera.

- **Edit** (`editing = true`, the default): the view is through the editor camera. It moves 1:1 with the pointer (no damping) and has no orbit limits or ground limit. It is added to the scene outside the model root, so it is not saved in a file or exported.
- **View** (`editing = false`): the view is through the scene's default camera, the start view. This is what a visitor sees, with the controls of the file (orbit limits, damping).

When a file with a viewer config loads, the editor camera takes its start view. `setStartViewFromEditor()` moves the start view to the editor view. With the `UndoManagerPlugin`, this is one undo step.

```typescript
import {ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {EditorCameraPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...plugins: [UndoManagerPlugin]})
const editorCamera = viewer.addPluginSync(EditorCameraPlugin)

// look through the start view, as a visitor
editorCamera.editing = false
// back to the editor camera
editorCamera.editing = true

// the start view takes the editor view (Ctrl+Z undoes it)
editorCamera.setStartViewFromEditor()

// the editor camera takes the start view
editorCamera.copyStartView()
```

Options:
- `smooth`: a light damping on the editor camera. Off: 1:1 with the pointer.
- `keepViewMoves`: in View, the camera moves change the start view when Edit starts again (one undo step). Off: the start view goes back to where it was when View started. `resetStartView()` puts it back at any time in View.
- `EditorCameraPlugin.ControlProps`: the orbit controls of the editor camera.

The plugin is not saved with the viewer config (`serializeWithViewer = false`).
