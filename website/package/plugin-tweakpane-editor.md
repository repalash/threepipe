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

## SelectionOutlinePlugin

[Example](https://threepipe.org/examples/#selection-outline-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane-editor/src/SelectionOutlinePlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane-editor/docs/classes/SelectionOutlinePlugin.html)

`SelectionOutlinePlugin` draws the outline of the selected and hovered objects in the render pipeline, as in Figma or Blender. A mask pass renders the meshes of these objects with their own depth. An extension of the screen pass then draws, after tonemapping:

- an anti-aliased outer outline around each selected object and the hovered object,
- thin lines between the parts of a selected object (`parts`; the parts come from `partsOf`),
- a dashed outline where the selection is behind other objects (`xray`, needs the `GBufferPlugin`, which the plugin adds),
- optionally, a fill tint (`fill`) and a dim of all other objects (`dimOthers`).

The mask follows the alpha of each material (`opacity`, the alpha of `map`, `alphaMap`, `alphaTest`), so a mesh that its texture cuts has the same shape in the outline. A change of the selection or the hover renders one more frame. It does not restart the progressive render. The mask is drawn once after each change, not in each frame of the progressive render.

```typescript
import {ThreeViewer, PickingPlugin} from 'threepipe'
import {SelectionOutlinePlugin} from '@threepipe/plugin-tweakpane-editor'

const viewer = new ThreeViewer({...})

// by default, the outline follows the selection and the hover of the PickingPlugin
const picking = viewer.addPluginSync(PickingPlugin)
picking.hoverEnabled = true
picking.widgetEnabled = false // the outline replaces the box widget

const outline = viewer.addPluginSync(SelectionOutlinePlugin)
outline.width = 2 // CSS pixels
outline.color.set('#0d99ff')
outline.redraw() // after a change of a color in place

// or set the objects yourself
outline.followPicking = false
outline.selected = [object1, object2]
outline.hovered = [object3]
```

The plugin is not saved with the viewer config (`serializeWithViewer = false`).
