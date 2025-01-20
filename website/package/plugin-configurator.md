---
prev: 
    text: '@threepipe/plugin-tweakpane-editor'
    link: './plugin-tweakpane-editor'

next: 
    text: '@threepipe/plugin-geometry-generator'
    link: './plugin-geometry-generator'

---

# @threepipe/plugin-configurator

Configurator Plugin implementations with basic UI for Threepipe.

Includes Material Configurator and Switch Node Configurator Plugins.

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-configurator.svg)](https://www.npmjs.com/package/@threepipe/plugin-configurator)

```bash
npm install @threepipe/plugin-configurator
```

## MaterialConfiguratorPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#material-configurator-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/configurator/src/MaterialConfiguratorPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/configurator/docs/classes/MaterialConfiguratorPlugin.html)

MaterialConfiguratorPlugin adds a UI to configure and switch between different material variations.

The variations of materials are mapped to material names or uuids in the scene.
These variations can be applied to the materials in the scene. (This copies the properties to the same material instances instead of assigning new materials)
The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
This functionality is inherited from [MaterialConfiguratorBasePlugin](https://threepipe.org/docs/classes/MaterialConfiguratorBasePlugin.html).

Additionally, this plugin adds a simple Grid UI in the DOM over the viewer canvas to show various material variations and allow the user to apply them.
The UI can also be used in the editor to edit the variations and apply them.

To use, simply add the plugin in the viewer and configure using the created UI and UI Config. Note that `PickingPlugin` is required to be added before this to allow configurator.

To create a custom configurator UI, use the `MaterialConfiguratorBasePlugin` directly and call the function `applyVariation`, `getPreview` and `addVariation` to apply and add variations respectively.

[//]: # (TODO Add Example for custom UI)

### SwitchNodePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#switch-node-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/configurator/src/SwitchNodePlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/configurator/docs/classes/SwitchNodePlugin.html)

SwitchNodePlugin adds a UI to configure and switch between different object variations within a switch node object.

This plugin allows you to configure object variations with object names in a file and apply them in the scene.
Each SwitchNode is a parent object with multiple direct children. Only one child is visible at a time.
This works by toggling the `visible` property of the children of a parent object.
The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
It also provides a function to create snapshot previews of individual variations. This creates a limited render of the object with the selected child visible.
To get a proper render, it's better to render it offline and set the image as a preview.
This functionality is inherited from [SwitchNodeBasePlugin](https://threepipe.org/docs/classes/SwitchNodeBasePlugin.html).

Additionally, this plugin adds a simple Grid UI in the DOM over the viewer canvas to show various material variations and allow the user to apply them.
The UI can also be used in the editor to edit the variations and apply them.

To use, simply add the plugin in the viewer and configure using the created UI and UI Config. Note that `PickingPlugin` is required to be added before this to allow configurator.

To create a custom configurator UI, use the `SwitchNodeBasePlugin` directly and call the function `selectNode`, `getPreview` and `addNode` to apply and add variations respectively.

[//]: # (TODO Add Example for custom UI)
