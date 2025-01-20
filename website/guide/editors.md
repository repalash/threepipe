---
prev:
    text: 'Getting Started'
    link: './getting-started'

next:
    text: 'Features'
    link: './features'
---

# Editors in Threepipe

Threepipe provides a set of editors to create, edit and configure 3D scenes in the browser. These editors are built on top of the core framework(as plugins) and provide a simple and intuitive way to interact with the 3D scene, materials, lights, cameras, and other objects.

The editors render `uiConfig` from the viewer, scene, and plugins along with several custom UI elements to provide a completely dynamic and extendable interface. 

A common workflow is drop a 3d model into the editor, enable the required plugins, set proper lighting, background, environment maps, set plugin properties like post-processing settings, materials, animations, camera views etc., and export a compressed glb file with scene settings and plugin data. This glb file can then be loaded into the viewer(with all the plugins) to get the same scene and settings. 

## Tweakpane Editor

[Tweakpane Editor](https://threepipe.org/examples/tweakpane-editor/) - A simple editor to simply tweak the scene and plugins. It provides a tab-bar to manage different plugin categories. It is built on top of the [Tweakpane](https://cocopon.github.io/tweakpane/) library with custom themes. This can be quickly added to any apps as a debug UI, to create scenes, presets etc.

## Threepipe Editor

[Threepipe Editor](https://editor.threepipe.org) - A more advanced editor to create, edit and configure 3D scenes in the browser. It provides a more traditional style of editor with a sidebar to manage different objects and properties and toolbars with tools managing various plugins. This is used to create and setup full scenes, configurators and experiences. It is built on top of the [React](https://react.dev) and [Blueprint.js](https://blueprintjs.com/) libraries.
