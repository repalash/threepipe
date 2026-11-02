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
// TweakpaneEditorPlugin.DefaultLayout = 'classic' // before the plugin is made: the layout when none is stored
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

## Page layout, frame and mode bar

`TweakpaneEditorPlugin.layout` sets the layout of the page. The first three layouts put the editor in a page frame (`EditorFrame`). In a frame, the modes are coloured icons on the right (`EditorModeBar`) instead of the tabs at the bottom.

- `'titlebar'` (the default): a slim bar on top with the app name, the file name and the actions. The canvas and the panel are edge to edge below it.
- `'statusbar'`: the same bar at the bottom, like a code editor.
- `'floating'`: the canvas fills the window. The panel and the mode bar float over it as one card (side by side, with a line between them), with the same gap to the window on every side (no gap on a phone in portrait, where the room is small). The actions are in the mode bar. It has no bar, so it does not show the file name.
- `'classic'`: no frame. The page has the mode tabs at the bottom, as before.

In the frame:
- A click on a mode shows its panels. A click on the open mode hides the panel, and the canvas takes its room.
- The button at the bottom of the mode bar steps through three states: the mode names and the panel, the icons and the panel, the icons only (the panel hidden), then back. Ctrl+\\ (Cmd+\\ on a Mac) does the same. Its tooltip names the next step. A window without room for the names skips them. A click on the open mode still hides or shows the panel.
- Shift+T switches between the light and the dark theme of the same family (`clean` and `clean-dark`, `light` and `dark`, `white` and `black`).
- The layout button opens the layout menu, with Classic too.
- The bar has a slot for the name of the open file or project: the app sets it with `editor.documentName` (empty: no name), and it is kept when the frame is made again. A click on the name in the bar renames it (Enter or a click outside keeps it, Escape goes back). Each change sends the `documentNameChange` event (`{name}`), so the app can use the name elsewhere. The plugin does not follow the loads. The tweakpane-editor example shows `Untitled`, then the name of the first loaded model or viewer config file (a URL or a dropped file); later files, or a name that the person typed, do not change it. The example also names the exported file with it (`AssetExporterPlugin.exportOptions.name`).

The plugin has a UI folder, `Editor`, with the page layout and the mode names. Add `TweakpaneEditorPlugin` to a mode (`loadPlugins`) to show it; it works in the classic layout too.

The layout that the person picks (in the menu or the UI) is kept in `localStorage` (`TweakpaneEditorPlugin.LayoutStorageKey`), and so is the names setting that the person picks in the mode bar (`EditorModeBar.StorageKey`; set a key to `null` to not keep it). A layout or a names setting set from code (`editor.layout = 'floating'`, `editor.modeNames = false`) applies, but is not kept, so the person's pick is back at the next visit. `TweakpaneEditorPlugin.DefaultLayout` is the layout when none is stored. The plugin reads the stored layout when it is made, so set `TweakpaneEditorPlugin.LayoutStorageKey` and `TweakpaneEditorPlugin.DefaultLayout` before `new TweakpaneEditorPlugin()`. For the old page with the mode tabs at the bottom in an app, set `TweakpaneEditorPlugin.DefaultLayout = 'classic'`, or `editor.layout = 'classic'` (this one also replaces a layout that the person picked).

The frame applies in every window size. In a wide or a landscape window, the canvas, the panel and the mode bar are side by side. In a portrait window under 920 px wide (a phone), the layout keeps its bars (floating has no gap there). The canvas is on top at full width, and the panel and the mode bar are below it, with the same height. The CSS variable `--lay-split` is the part of the height for the canvas: `0.45`, set on `body.lay-frame`. To change it, use a more specific rule, like `html body.lay-frame { --lay-split: 0.5; }`. A mode bar taller than its room scrolls. When the panel is hidden, the mode bar is a row at the bottom, and a tap on a mode brings the panel back. The mode names are hidden at the first visit in a window under 920 px wide (`EditorModeBar.WideQuery`).

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorModeBar, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

viewer.addPluginSync(new TweakpaneUiPlugin(true))
// TweakpaneEditorPlugin.DefaultLayout = 'classic' // before the plugin is made: the layout when none is stored
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
editor.frameOptions = {title: 'My app'} // before loadPlugins, which makes the frame
// the colour and icon of a mode (an SVG string), also before loadPlugins, which makes the mode bar
EditorModeBar.Looks['My mode'] = {color: '#0d99ff', icon: '<svg ...></svg>'}
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, TweakpaneEditorPlugin], // with the Editor folder
    ['Export']: [AssetExporterPlugin],
    ['My mode']: [MyPlugin],
})

editor.layout = 'floating'
editor.modeNames = false // icons only
editor.documentName = 'Ring.glb'
// a rename in the bar, or a change from the code
editor.addEventListener('documentNameChange', ({name}) => console.log('name', name))

// back to the mode tabs at the bottom
editor.layout = 'classic'
```

In the [Tweakpane Editor example](https://threepipe.org/examples/tweakpane-editor/), add `?layout=titlebar`, `?layout=statusbar`, `?layout=floating` or `?layout=classic` to the URL.

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

- `board`: each note is its own post-it. A post-it from "Add a note" opens by the dock, where the + button is: above it, or below it when the dock is at the top of the canvas, and inside the canvas. A note added in code (`notes.addNote`) goes below the last post-it in its column, inside the canvas and above the dock; when no column has room (a phone has room for one), the columns start again a little lower and to the right. "Arrange" puts all of them in columns by the same rule. "Stack" switches to the other layout.
- `stack`: the post-its lie on a pile, each one a little to the left of and above the one on it, so the pile stays on the canvas. A click on a post-it behind brings it to the top; the pile is dragged and sized as one. "Spread" switches back.

"Minimise" (the `minimized` layout) takes the post-its off the canvas. Only one button stays in the dock, with the number of notes; a click on it brings back the layout from before. The post-its start minimized on each page load, so they do not cover the canvas; the button brings back the layout set last. `new StickyNotesUiPlugin(storageKey, false)` starts in that layout instead.

In both layouts:

- The buttons are icons with a tooltip each (tippy.js, the `editor` theme; the plugin adds their CSS).
- "Add a note" (+) adds a note at once, in the store of new notes (`NotesPlugin.defaultStore`), with the cursor in it. The button next to it shows the icon of that store (a file, a browser window, or a cloud for a store of the app); a click opens a menu of the stores.
- The icon at the top left of a note shows its store; a click opens the same menu, to move the note.
- Each note has "Add the time and the selection" (the time, `contextProvider` and the objects selected in the `PickingPlugin`), "Copy the text" (the icon shows a check and "Copied" for a moment) and "Delete the note". Escape leaves the note. On a touch screen the text is 16 px, so a phone does not zoom in when the note gets the cursor.
- Drag a post-it by its bar, and size it from its bottom right corner. A click on a post-it brings it up.
- The buttons are `dock`, at the bottom left of the canvas. When that corner is taken, place it with its style, e.g. `sticky.dock.style.bottom = '56px'`.
- Drag the dock by its handle (the dots at its left) or its free part to move it out of the way; its buttons still click (a press that moves less than 3 px is a click). It stays inside the canvas, also when the canvas gets smaller. A double click on the handle, or Reset places, puts it back in its corner. The board and the pile keep their places above the corner. The move is the dock's `transform`, so do not set one on it.
- The post-its fill the nearest positioned ancestor, so the viewer container must be positioned (for example `position: relative`) for the post-its to stay inside the canvas.
- The post-its and the dock are above the loading screen and the overlays of the canvas (`z-index` 150), below the bars of the editor; their menus are with the popups (2000). With the open card of `PerfPanelPlugin` in the same layer, the one pressed last is in front (`raiseOnPress`): a press on a post-it or the dock brings the notes forward, opening or pressing the perf card brings it forward.

The layout, the colour, the places and sizes of the post-its and the place of the dock are kept in `localStorage` (the `storageKey` of the plugin), not in the file. Its UI folder (`Sticky Notes`) has the settings: Show, Layout, Colour (yellow, pink, blue, green, or `theme` for the Tweakpane theme), Arrange and Reset places.

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

Another view can show the same notes: read `notes.notes`, listen to the `notesChange` event (`change` is `add`, `update`, `remove` or `load`; `note` is the note added, changed or removed, and `notes` the notes that `clear` or a store replaced with `addStore` removed) and the `defaultStoreChange` event (the store of new notes changed), and change them with `addNote`, `updateNote` and `removeNote`. Set `StickyNotesUiPlugin.InjectStyles = false` before the plugin is made to style the `snp-` classes yourself.

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
- `showsStartView`: the view shows the saved start view now (in View when the preview is at it, not after a move, an auto rotation or a clamp of the orbit limits; in Edit when the editor camera is at the start view and the start camera is perspective, as the editor camera). A UI can take a picture of the start view from the canvas then.
- `EditorCameraPlugin.ControlProps`: the orbit controls of the editor camera.

The plugin is not saved with the viewer config (`serializeWithViewer = false`).

In the `TweakpaneEditorPlugin`, while the plugin is added (before or after the editor):
- A pill at the top centre of the canvas, in the style of the `PerfPanelPlugin` pill, names the camera: "Editor camera" (a grey camera icon) or "Scene camera" (a blue icon; green when `syncStartView` is on). An amber corner tells that a move in View is not saved. In View, a frame in the same colour is around the canvas. The pill shows the key of `hotkey` (none when it is `''`), and a click on it switches Edit and View, as the key. The pill and the frame are hidden while the plugin is disabled.
- A card under the pill opens on hover (with a mouse), on a tap on a touch screen or on keyboard focus, and stays open until a press outside it or Escape. It shows a picture of the saved start view. A click on the picture looks through the start view; in View after a move, it goes back to it. The Sync toggle over the picture is `syncStartView`. Under it: an Edit / View toggle; "Set as start view" in Edit; "Save" and "Reset" in View, on after a move that is not saved (they stay in the card when off, so it keeps its size). Ctrl+Z undoes a change of the start view.
- The picture is taken from the canvas right after a render, when the view shows the saved start view (`showsStartView`): after a load, in View before a move, after a save, a sync or "Set as start view". It is a small copy of the canvas (448 px wide); it is taken again when the render ends (progressive rendering), and shows faded while it is out of date.
- On the classic page on a phone, the pill is on the right, under the title bar of the settings panel, so it does not cover the view widget.
- `setupEditorCameraUi(viewer, plugin)` adds the pill, the card, the frame and their styles in another app (and the CSS of the tooltips). It returns a function that removes them. The [Tweakpane Editor](https://threepipe.org/examples/#tweakpane-editor/) example has the settings in the Viewer tab.

## GLTFContentsPlugin

[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/GLTFContentsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/GLTFContentsPlugin.html)

`GLTFContentsPlugin` shows what a glTF file holds, in its UI folder (`glTF Contents`, in the Debug mode of the [Tweakpane Editor](https://threepipe.org/examples/#tweakpane-editor/) example).

- **Check the export** makes the file that `AssetExporterPlugin` would download, with its export options, and lists what is in it, without a download: the models of the scene, and the viewer config with the settings of each plugin (the notes of `NotesPlugin`, the camera views, ...), so you see what all the dropped files and settings add to the file.
- **Loaded files**: each glTF or GLB file that is loaded (dropped, picked or from a URL) is read again from its file and listed. `Show` picks the export or a file.

For each file: the size of the file, its JSON and binary parts and the part in images; the generator; the counts of nodes, meshes and primitives, triangles, vertices, materials, textures, animations, cameras and lights; the viewer config (`WEBGI_viewer`), each plugin with the size of its settings (the largest first) and the resources by kind; and lists of the meshes (triangles, vertices), materials (their extensions), images (type, size), animations (channels, duration) and the extensions used.

```typescript
import {AssetExporterPlugin, ThreeViewer} from 'threepipe'
import {GLTFContentsPlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...plugins: [AssetExporterPlugin]})
const contents = viewer.addPluginSync(GLTFContentsPlugin)

const summary = await contents.checkExport()
console.log(summary?.counts.triangles, summary?.viewerConfig?.plugins)
```

An encrypted file (the exporter's Encrypt option) shows as encrypted, without counts: its JSON holds only the encryption metadata. A model loaded from a URL is fetched again with the same `queryString` as the importer.

The summary is `summarizeGLTF(name, parseGLTFBuffer(buffer), fileBytes)`, which an app can call for any glTF or GLB buffer. The plugin is not saved with the viewer config.
