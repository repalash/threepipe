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

## Page layout, frame and mode bar

`TweakpaneEditorPlugin.layout` sets the layout of the page. The first three layouts put the editor in a page frame (`EditorFrame`). In a frame, the modes are coloured icons on the right (`EditorModeBar`) instead of the tabs at the bottom.

- `'titlebar'` (the default): a slim bar on top with the app name, the file name and the actions. The canvas and the panel are edge to edge below it.
- `'statusbar'`: the same bar at the bottom, like a code editor.
- `'floating'`: the canvas fills the window. The panel and the mode bar float over it, with the same gap on every side. The actions are in the mode bar.
- `'classic'`: no frame. The page has the mode tabs at the bottom, as before.

In the frame:
- A click on a mode shows its panels. A click on the open mode hides the panel, and the canvas takes its room.
- The button at the bottom of the mode bar shows or hides the mode names.
- Shift+T switches between the light and the dark theme of the same family (`clean` and `clean-dark`, `light` and `dark`, `white` and `black`).
- The layout button opens the layout menu, with Classic too.
- The file name in the bar is the name of the last loaded file, `Untitled` before one loads. Set `editor.frame.fileName` to show another name.

The plugin has a UI folder, `Editor`, with the page layout and the mode names. Add `TweakpaneEditorPlugin` to a mode (`loadPlugins`) to show it; it works in the classic layout too.

The layout that the person picks (in the menu or the UI) is kept in `localStorage` (`TweakpaneEditorPlugin.LayoutStorageKey`), and so is the names setting of the mode bar (`EditorModeBar.StorageKey`; set a key to `null` to not keep it). `TweakpaneEditorPlugin.DefaultLayout` is the layout when none is stored.

The frame applies in every window size. In a wide or a landscape window, the canvas, the panel and the mode bar are side by side. In a portrait window under 920 px wide (a phone), the layout keeps its bars or cards. The canvas is on top at full width, and the panel and the mode bar are below it, with the same height; the CSS variable `--lay-split` (default `0.45`) is the part of the height for the canvas. A mode bar taller than its room scrolls. When the panel is hidden, the mode bar is a row at the bottom, and a tap on a mode brings the panel back. The mode names are hidden at the first visit in a window under 920 px wide (`EditorModeBar.WideQuery`).

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorModeBar, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

viewer.addPluginSync(new TweakpaneUiPlugin(true))
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
editor.frameOptions = {title: 'My app'} // before loadPlugins, which makes the frame
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin, TweakpaneEditorPlugin], // with the Editor folder
    ['Export']: [AssetExporterPlugin],
})

editor.layout = 'floating'
editor.modeNames = false // icons only
editor.frame!.fileName = 'Ring.glb'

// the colour and icon of a mode (an SVG string)
EditorModeBar.Looks['My mode'] = {color: '#0d99ff', icon: '<svg ...></svg>'}

// back to the mode tabs at the bottom
editor.layout = 'classic'
```

In the [Tweakpane Editor example](https://threepipe.org/examples/tweakpane-editor/), add `?layout=titlebar`, `?layout=statusbar`, `?layout=floating` or `?layout=classic` to the URL.
