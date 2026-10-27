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

## Page frame and mode bar

`TweakpaneEditorPlugin.setFrame()` puts the editor in a page frame. The modes are then coloured icons on the right (`EditorModeBar`) instead of the tabs at the bottom.

- `'titlebar'`: a slim bar on top with the app name, the name of the last loaded file and the actions. The canvas and the panel are edge to edge below it.
- `'statusbar'`: the same bar at the bottom, like a code editor.
- `'floating'`: the canvas fills the window. The panel and the mode bar float over it, with the same gap on every side. The actions are in the mode bar.

In the frame:
- A click on a mode shows its panels. A click on the open mode hides the panel, and the canvas takes its room.
- The button at the bottom of the mode bar shows or hides the mode names.
- Shift+T switches between the light and the dark theme of the same family (`clean` and `clean-dark`, `light` and `dark`, `white` and `black`).
- The layout button changes the layout. The layout and the names setting are kept in `localStorage`. `setFrame('auto')` opens the layout picked last (else the title bar); a named layout always opens that layout.

The frame applies when the window is 920 px wide or more. In a narrower window, the page keeps the mode tabs and the editor's own layout.

```typescript
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorModeBar, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'

viewer.addPluginSync(new TweakpaneUiPlugin(true))
const editor = viewer.addPluginSync(new TweakpaneEditorPlugin())
editor.loadPlugins({
    ['Viewer']: [ViewerUiConfigPlugin],
    ['Export']: [AssetExporterPlugin],
})

editor.setFrame('titlebar', {title: 'My app'})
editor.frame?.setLayout('floating')
editor.frame?.modeBar.setExpanded(false) // icons only

// the colour and icon of a mode (an SVG string)
EditorModeBar.Looks['My mode'] = {color: '#0d99ff', icon: '<svg ...></svg>'}

// back to the mode tabs at the bottom
editor.setFrame(undefined)
```

In the [Tweakpane Editor example](https://threepipe.org/examples/tweakpane-editor/), add `?frame=titlebar`, `?frame=statusbar`, `?frame=floating` or `?frame=auto` to the URL.
