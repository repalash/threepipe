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

## UiConfigForm

[Example](https://threepipe.org/examples/#ui-config-form/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/ui/UiConfigForm.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/UiConfigForm.html)

`UiConfigForm` draws a list of uiconfig.js configs (the same configs that the Tweakpane panels use) as a small plain-DOM form. Use it for a popup or a card next to an object, where a Tweakpane panel is too large.

- Fields: number (drag the name to scrub, Shift for 10x), slider, checkbox, dropdown, vector, color, text, button, monitor, and folders (always open).
- A change sets the value through the binding of the config, then calls `onChange` of the config and of each parent folder, as the Tweakpane renderer does.
- With an `undoManager`, each edit is one undo step. Quick edits of the same field (a scrub, the slider) merge into one step.
- A number field takes whole numbers when its `stepSize` is a whole number of 1 or more, or when its name is a count (segments, sides, steps...). Change this with the `isInteger` option.
- The form adds its stylesheet once (`UiConfigForm.InjectStyles`). The colours follow the Tweakpane theme variables (`--tp-...`) when the page sets them.

```typescript
import {UiConfigMethods, UndoManagerPlugin} from 'threepipe'
import {UiConfigForm} from '@threepipe/plugin-tweakpane-editor'

const undo = viewer.addPluginSync(UndoManagerPlugin)

// the fields of the material, in a popup
const form = new UiConfigForm(UiConfigMethods.GetChildren(material.uiConfig), {
    undoManager: undo.undoManager,
    onChange: () => viewer.setDirty(),
    // a dropdown or a button can change which fields there are: make the form again
    onStructureChange: () => {/* form.dispose(); make a new form */},
})
popup.appendChild(form.element)

// after a change from elsewhere
form.refresh()
```

The form does not watch the values: call `refresh()` after a change from elsewhere (code, another panel). Its own undo and redo steps refresh it. A config that is `hidden` when the form is made is not drawn.

