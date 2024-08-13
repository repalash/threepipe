---
prev: false
next: 
    text: '@threepipe/plugin-blueprintjs'
    link: './plugin-blueprintjs'

---

# @threepipe/plugin-tweakpane

[Tweakpane](https://tweakpane.github.io/docs/) UI plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tweakpane-ui-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/tweakpane/src/TweakpaneUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/tweakpane/docs/classes/TweakpaneUiPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-tweakpane.svg)](https://www.npmjs.com/package/@threepipe/plugin-tweakpane)

```bash
npm install @threepipe/plugin-tweakpane
```

TweakpaneUiPlugin adds support for using [uiconfig-tweakpane](https://github.com/repalash/uiconfig-tweakpane)
to create a configuration UI in applications using the [Tweakpane](https://tweakpane.github.io/docs/) library.

The plugin takes the [uiconfig](https://github.com/repalash/uiconfig.js)
that's defined in the viewer and all the objects to automatically render a UI in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({...})

// Add the plugin
const plugin = viewer.addPluginSync(new TweakpaneUiPlugin(true)) // true to show expanded the UI by default

// Add the UI for the viewer
plugin.appendChild(viewer.uiConfig)
// Add UI for some plugins
plugin.setupPlugins(TonemapPlugin, DropzonePlugin)
```
