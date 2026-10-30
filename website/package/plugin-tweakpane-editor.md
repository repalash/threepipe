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

## NotesPlugin and StickyNotesUiPlugin

[Example](https://threepipe.org/examples/#notes-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/NotesPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/NotesPlugin.html)

`NotesPlugin` keeps a list of notes. Each note is kept in a store:

- `file`: the `fileNotes` property is serialized, so these notes are saved in the viewer config, inside an exported .glb, and come back when the file loads.
- `browser`: `localStorage` (`BrowserNotesStore`).
- A store of the app: any object with `id`, `label`, `load()` and `save(notes)` (`NotesStore`), added with `addStore()` or the `stores` option. `HttpNotesStore` is one for a server: GET returns `{notes}`, POST takes `{notes}`; a save under 64 KiB is a `keepalive` request, so the last changes reach the server also when the page closes.

Changes are saved per store, 600 ms after the last one, and when the plugin is removed. Notes made in a store while it loads are kept and saved. The plugin has no notes UI. Its UI folder (`Notes`) has the settings: the store of new notes, and clear the notes in the file.

`StickyNotesUiPlugin` shows the notes as post-its over the canvas, in one of two layouts:

- `board`: each note is its own post-it. A new post-it goes below the last one in its column, inside the canvas and above the dock; when no column has room (a phone has room for one), the columns start again a little lower and to the right. "Arrange" puts all of them in columns by the same rule. "Stack" switches to the other layout.
- `stack`: the post-its lie on a pile, each one a little to the left of and above the one on it, so the pile stays on the canvas. A click on a post-it behind brings it to the top; the pile is dragged and sized as one. "Spread" switches back.

"Minimise" (the `minimized` layout) takes the post-its off the canvas. Only one button stays in the dock, with the number of notes; a click on it brings back the layout from before.

In both layouts:

- "+ Note" adds a note at once, in the store of new notes, with the cursor in it. "▾" next to it picks another store.
- The badge of a note shows its store; a click moves the note to another store.
- Each note has "+ Context" (the time, `contextProvider` and the selected objects), "Copy" and "×". Escape leaves the note. On a touch screen the text is 16 px, so a phone does not zoom in when the note gets the cursor.
- Drag a post-it by its bar, and size it from its bottom right corner. A click on a post-it brings it up.
- The buttons are `dock`, at the bottom left of the canvas. When that corner is taken, place it with its style, e.g. `sticky.dock.style.bottom = '64px'`.
- The post-its fill the nearest positioned ancestor, so the viewer container must be positioned (for example `position: relative`) for the post-its to stay inside the canvas.
- The post-its and the dock are above the loading screen and the overlays of the canvas (`z-index` 150), below the bars of the editor; their menus are with the popups (2000).

The layout, the colour, and the places and sizes of the post-its are kept in `localStorage` (the `storageKey` of the plugin), not in the file. Its UI folder (`Sticky Notes`) has the settings: Show, Layout, Colour (yellow, pink, blue, green, or `theme` for the Tweakpane theme), Arrange and Reset places.

```typescript
import {PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {HttpNotesStore, NotesPlugin, NotesStore, StickyNotesUiPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(PickingPlugin)
const notes = viewer.addPluginSync(new NotesPlugin({
    browser: 'my-app-notes', // the localStorage key; false: no browser store
    stores: [new HttpNotesStore('/api/notes')], // optional: a server
    contextProvider: () => 'Move tool', // optional, extra text for "+ Context"
}))
const sticky = viewer.addPluginSync(new StickyNotesUiPlugin())
sticky.layout = 'stack' // a pile; 'board': a post-it per note; 'minimized': off the canvas

// a store of the app
const myStore: NotesStore = {
    id: 'project', label: 'This project',
    load: async() => (await api.getNotes()) ?? [],
    save: async(list) => api.setNotes(list),
}
notes.addStore(myStore)
notes.addNote('Check the prongs', 'file')

const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
ui.setupPluginUi(StickyNotesUiPlugin) // the settings
ui.setupPluginUi(NotesPlugin)
```

Another view can show the same notes: read `notes.notes`, listen to the `notesChanged` event (`change` is `add`, `update`, `remove` or `load`; `note` is the note added, changed or removed, and `notes` the notes that `clear` or a store replaced with `addStore` removed), and change them with `addNote`, `updateNote` and `removeNote`. Set `StickyNotesUiPlugin.InjectStyles = false` before the plugin is made to style the `snp-` classes yourself.

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

The [Tweakpane Editor](https://threepipe.org/examples/#tweakpane-editor/) example has it in the Viewer tab.
