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

- **Edit** (`editing = true`, the default): the view is through the editor camera. It moves 1:1 with the pointer (no damping) and has no orbit limits or ground limit.
- **View** (`editing = false`): the view is through `previewCamera`, a copy of the scene's default camera (the start view, saved in the file) with its controls (orbit limits, damping). This is what a visitor sees. With `syncStartView` (on by default), each move in View changes the start view as it happens (one undo step per move). With it off, a move in View is a preview: `saveStartView()` keeps it, `resetStartView()` goes back. So an export in View (`exportConfig()`, `exportScene()`) always has the saved start view, never a preview that is not saved.

The editor camera and the preview camera are added to the scene outside the model root, so they are not saved in a file or exported. The preview camera is made again from the start camera each time View starts, so a change of the start camera settings in Edit is in the next View.

When a file with a viewer config loads, the editor camera takes its start view (in View, the view does too). `setStartViewFromEditor()` moves the start view to the view that is seen: the editor view in Edit, the preview in View. With the `UndoManagerPlugin`, each change of the start view is one undo step.

The C key switches between Edit and View (`hotkey`, a `KeyboardEvent.code`; `''` turns it off; the `hotkeyChange` event tells a UI when it changes). It does nothing in a text field, with Ctrl, Cmd, Alt or Shift, while held down, or when another handler used the key. The `editingChange` event tells a UI when the view changes, from the code, the key or the panel, and when the plugin is turned off or on (`enabled`, `disable(key)` / `enable(key)`, a remove; `editing` is `false` while it is off):

```typescript
import {ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {EditorCameraPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...plugins: [UndoManagerPlugin]})
const editorCamera = viewer.addPluginSync(EditorCameraPlugin)

// look through the start view, as a visitor. Each move here changes the start view (syncStartView is on by default;
// Ctrl+Z undoes a move)
editorCamera.editing = false
// or make a move in View a preview only
editorCamera.syncStartView = false
// after a move: keep the view as the start view (Ctrl+Z undoes it)
editorCamera.saveStartView()
// or go back to the saved start view
editorCamera.resetStartView()
// back to the editor camera
editorCamera.editing = true

// the start view takes the view that is seen, here the editor view (Ctrl+Z undoes it)
editorCamera.setStartViewFromEditor()

// the editor camera takes the start view
editorCamera.copyStartView()

// a button that follows the view
editorCamera.addEventListener('editingChange', ({editing}) => {
    button.classList.toggle('on', editing)
})
// another key than C
editorCamera.hotkey = 'KeyK'
```

Options and state:
- `smooth`: a light damping on the editor camera. Off: 1:1 with the pointer.
- `syncStartView`: in View, each move changes the start view at once. A move (with the glide of damping, or wheel steps close together) is one undo step; `EditorCameraPlugin.SyncGestureDelay` (ms) is the pause that ends it. On by default. Turned on in View after a move, it saves the view. Off: a move in View is a preview only. The `syncStartViewChange` event (`{sync}`) tells a UI when it changes.
- With orbit controls, only a user gesture on the controls of the preview camera is a move: from their `start` event to their `end` event, and the glide after it (with `autoRotate`, it ends `EditorCameraPlugin.SyncGestureDelay` ms after the `end` event). A change that the user did not make is not synced and does not count as a move: a clamp of the orbit limits (a start view outside them), an animation of the camera by another plugin. The keyboard pan of `OrbitControls` sends no `start` and `end` events, so it is not a move either. Other controls (first person, pointer lock) send no gesture events: each change of the view is a move, and a move ends when the view is still for `SyncGestureDelay` ms. Without controls (`controlsMode` `''`), no change is a move.
- `startViewMoved`: in View, a user gesture moved the view away from the saved start view and the move is not saved. `saveStartView()` keeps it (one undo step), `resetStartView()` goes back. The `startViewMovedChange` event (`{moved}`) tells a UI when it changes.
- The `startViewChange` event (`{camera}`): the saved start view changed (a save, a sync, an undo, a load, a change in the camera panel).
- `showsStartView`: the view shows the saved start view now (in View before a move; in Edit when the editor camera is at the start view and the start camera is perspective, as the editor camera). A UI can take a picture of the start view from the canvas then.
- `EditorCameraPlugin.ControlProps`: the orbit controls of the editor camera.

The plugin is not saved with the viewer config (`serializeWithViewer = false`).

In the `TweakpaneEditorPlugin`, while the plugin is added (before or after the editor):
- A pill at the top centre of the canvas, in the style of the `PerfPanelPlugin` pill, names the camera: "Editor camera" (a grey camera icon) or "Scene camera" (a blue icon; green when `syncStartView` is on). An amber corner tells that a move in View is not saved. In View, a frame in the same colour is around the canvas. The pill shows the key of `hotkey` (none when it is `''`), and a click on it switches Edit and View, as the key. The pill and the frame are hidden while the plugin is disabled.
- A card under the pill opens on hover (with a mouse), on a tap on a touch screen or on keyboard focus, and stays open until a press outside it or Escape. It shows a picture of the saved start view. A click on the picture looks through the start view; in View after a move, it goes back to it. The Sync toggle over the picture is `syncStartView`. Under it: an Edit / View toggle; "Set as start view" in Edit; "Save" and "Reset" in View, on after a move that is not saved (they stay in the card when off, so it keeps its size). Ctrl+Z undoes a change of the start view.
- The picture is taken from the canvas right after a render, when the view shows the saved start view (`showsStartView`): after a load, in View before a move, after a save, a sync or "Set as start view". It is a small copy of the canvas (448 px wide); it is taken again when the render ends (progressive rendering), and shows faded while it is out of date.
- On the classic page on a phone, the pill is on the right, under the title bar of the settings panel, so it does not cover the view widget.
- `setupEditorCameraUi(viewer, plugin)` adds the pill, the card, the frame and their styles in another app (the tooltips use tippy.js, and need its CSS). It returns a function that removes them. The [Tweakpane Editor](https://threepipe.org/examples/#tweakpane-editor/) example has the settings in the Viewer tab.
