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
- `'floating'`: the canvas fills the window. The panel and the mode bar float over it as one card (side by side, with a line between them), with the same gap to the window on every side (no gap on a phone in portrait, where the room is small). The actions are in the mode bar.
- `'classic'`: no frame. The page has the mode tabs at the bottom, as before.

In the frame:
- A click on a mode shows its panels. A click on the open mode hides the panel, and the canvas takes its room.
- The button at the bottom of the mode bar steps through three states: the mode names and the panel, the icons and the panel, the icons only (the panel hidden), then back. Ctrl+\\ (Cmd+\\ on a Mac) does the same. Its tooltip names the next step. A window without room for the names skips them. A click on the open mode still hides or shows the panel.
- Shift+T switches between the light and the dark theme of the same family (`clean` and `clean-dark`, `light` and `dark`, `white` and `black`).
- The layout button opens the layout menu, with Classic too.
- The bar has a slot for the name of the open file or project: the app sets it with `editor.documentName` (empty: no name), and it is kept when the frame is made again. A click on the name in the bar renames it (Enter or a click outside keeps it, Escape goes back). Each change sends the `documentNameChange` event (`{name}`), so the app can use the name elsewhere. The plugin does not follow the loads. The tweakpane-editor example shows `Untitled`, then the name of the first loaded model or viewer config file (a URL or a dropped file); later files, or a name that the person typed, do not change it. The example also names the exported file with it (`AssetExporterPlugin.exportOptions.name`).

The plugin has a UI folder, `Editor`, with the page layout and the mode names. Add `TweakpaneEditorPlugin` to a mode (`loadPlugins`) to show it; it works in the classic layout too.

The layout that the person picks (in the menu or the UI) is kept in `localStorage` (`TweakpaneEditorPlugin.LayoutStorageKey`), and so is the names setting of the mode bar (`EditorModeBar.StorageKey`; set a key to `null` to not keep it). A layout set from code (`editor.layout = 'floating'`) applies, but is not kept, so the person's pick is back at the next visit. `TweakpaneEditorPlugin.DefaultLayout` is the layout when none is stored. The plugin reads the stored layout when it is made, so set `TweakpaneEditorPlugin.LayoutStorageKey` and `TweakpaneEditorPlugin.DefaultLayout` before `new TweakpaneEditorPlugin()`. For the old page with the mode tabs at the bottom in an app, set `TweakpaneEditorPlugin.DefaultLayout = 'classic'`, or `editor.layout = 'classic'` (this one also replaces a layout that the person picked).

The frame applies in every window size. In a wide or a landscape window, the canvas, the panel and the mode bar are side by side. In a portrait window under 920 px wide (a phone), the layout keeps its bars (floating has no gap there). The canvas is on top at full width, and the panel and the mode bar are below it, with the same height. The CSS variable `--lay-split` is the part of the height for the canvas: `0.45`, set on `body.lay-frame`. To change it, use a more specific rule, like `html body.lay-frame { --lay-split: 0.5; }`. A mode bar taller than its room scrolls. When the panel is hidden, the mode bar is a row at the bottom, and a tap on a mode brings the panel back. The mode names are hidden at the first visit in a window under 920 px wide (`EditorModeBar.WideQuery`).

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorModeBar, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

viewer.addPluginSync(new TweakpaneUiPlugin(true))
// TweakpaneEditorPlugin.DefaultLayout = 'classic' // before the plugin is made: the layout when none is stored
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
editor.frameOptions = {title: 'My app'} // before loadPlugins, which makes the frame
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, TweakpaneEditorPlugin], // with the Editor folder
    ['Export']: [AssetExporterPlugin],
})

editor.layout = 'floating'
editor.modeNames = false // icons only
editor.documentName = 'Ring.glb'
// a rename in the bar, or a change from the code
editor.addEventListener('documentNameChange', ({name}) => console.log('name', name))

// the colour and icon of a mode (an SVG string)
EditorModeBar.Looks['My mode'] = {color: '#0d99ff', icon: '<svg ...></svg>'}

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

- `board`: each note is its own post-it. A new post-it goes below the last one in its column, inside the canvas and above the dock; when no column has room (a phone has room for one), the columns start again a little lower and to the right. "Arrange" puts all of them in columns by the same rule. "Stack" switches to the other layout.
- `stack`: the post-its lie on a pile, each one a little to the left of and above the one on it, so the pile stays on the canvas. A click on a post-it behind brings it to the top; the pile is dragged and sized as one. "Spread" switches back.

"Minimise" (the `minimized` layout) takes the post-its off the canvas. Only one button stays in the dock, with the number of notes; a click on it brings back the layout from before. The post-its start minimized on each page load, so they do not cover the canvas; the button brings back the layout set last. `new StickyNotesUiPlugin(storageKey, false)` starts in that layout instead.

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
