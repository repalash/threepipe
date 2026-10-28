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

## NotesPlugin

[Example](https://threepipe.org/examples/#notes-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/NotesPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/NotesPlugin.html)

`NotesPlugin` adds notes to the editor, in a UI folder (`Notes`) with two tabs:

- **Scene**: `sceneNotes` is a serialized property. The notes are saved in the viewer config, so in an exported .glb, and come back when the file loads.
- **Page**: kept in this browser (`localStorage`, key `pageKey`). With `syncUrl`, they are also kept on a server: GET returns `{text}`, POST takes `{text}`. At the start, the longer text of the two wins.

"+ Context" adds a line with the time, the text of `contextProvider` and the names of the objects selected in `PickingPlugin`. "Copy" copies the open tab. Keys typed in the notes do not reach the viewer's shortcuts.

```typescript
import {PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {NotesPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(PickingPlugin)
const notes = viewer.addPluginSync(new NotesPlugin({
    pageKey: 'my-app-notes', // default: 'threepipe-page-notes'
    syncUrl: '/api/notes', // optional
    contextProvider: () => 'Move tool', // optional, extra text for "+ Context"
}))

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(NotesPlugin, {expanded: true})

notes.sceneNotes = 'Check the prongs' // saved with the scene

// or mount the notes anywhere on the page, without the tweakpane UI
document.getElementById('side-panel')!.appendChild(notes.element)
```

The notes use the colours of the Tweakpane theme (the `--tp-*` variables). Set `NotesPlugin.InjectStyles = false` before the plugin is made to style the `np-` classes yourself.

## StickyNotesPlugin

[Example](https://threepipe.org/examples/#sticky-notes-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/StickyNotesPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/StickyNotesPlugin.html)

`StickyNotesPlugin` extends `NotesPlugin`: the same notes (the Scene and Page tabs, "+ Context", "Copy"), as a post-it over the canvas instead of in the panel.

- Drag the note by its header. "–" collapses it to the header. Its place and the collapsed state are kept in `localStorage` (key `<pageKey>:sticky`).
- The note stays inside the canvas when the window changes size.

The plugin's UI folder, `Sticky Notes`, has the settings, not the notes:

| Setting | Property | Saved in the file |
|---|---|---|
| Show | `shown` | no |
| Colour: yellow, pink, blue, green, or `theme` (the Tweakpane theme) | `color` | yes |
| Collapsed | `collapsed` | no (`localStorage`) |
| Save in the file: the scene notes go into the viewer config and an exported .glb | `saveSceneNotes` | yes |
| Reset position: the bottom left corner | `resetPosition()` | |
| Clear scene notes | `sceneNotes = ''` | |

```typescript
import {StickyNotesPlugin} from '@threepipe/plugin-tweakpane-editor'

const notes = viewer.addPluginSync(new StickyNotesPlugin({pageKey: 'my-app-notes'}))
ui.setupPluginUi(StickyNotesPlugin) // the settings

notes.color = 'blue'
notes.saveSceneNotes = false // keep the notes out of exported files
```

`StickyNotesPlugin.InjectStyles = false` leaves the `snp-` classes to the page.
