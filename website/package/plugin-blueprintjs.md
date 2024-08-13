---
prev: 
    text: '@threepipe/plugin-tweakpane'
    link: './plugin-tweakpane'

next: 
    text: '@threepipe/plugin-tweakpane-editor'
    link: './plugin-tweakpane-editor'

---

# @threepipe/plugin-blueprintjs
[Blueprint.js](https://blueprintjs.com/) UI plugin for ThreePipe

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#blueprintjs-ui-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/blueprintjs/src/BlueprintJsUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/blueprintjs/docs/classes/BlueprintJsUiPlugin.html)


[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-blueprintjs.svg)](https://www.npmjs.com/package/@threepipe/plugin-blueprintjs)

```bash
npm install @threepipe/plugin-blueprintjs
```

BlueprintJsUiPlugin adds support for using [uiconfig-blueprint](https://github.com/repalash/uiconfig-blueprint)
to create a configuration UI in applications using the [BlueprintJs](https://blueprintjs.com/) library.

The plugin takes the [uiconfig](https://github.com/repalash/uiconfig.js)
that's defined in the viewer and all the objects to automatically render a UI in the browser.

```typescript
import {IObject3D, ThreeViewer, TonemapPlugin} from 'threepipe'
import {BlueprintJsUiPlugin} from '@threepipe/plugin-blueprintjs'

const viewer = new ThreeViewer({...})

// Add the plugin
const plugin = viewer.addPluginSync(new BlueprintJsUiPlugin(true)) // true to show expanded the UI by default

// Add the UI for the viewer
plugin.appendChild(viewer.uiConfig)
// Add UI for some plugins
plugin.setupPlugins(TonemapPlugin, DropzonePlugin)
```
