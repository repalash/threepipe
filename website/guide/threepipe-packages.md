---
prev:
    text: 'Core Plugins'
    link: './core-plugins'

#next:
#    text: '@threepipe Packages'
#    link: './threepipe-packages'
next: false
aside: false
---

# @threepipe Packages

Additional packages and plugins are available with threepipe, and can be found in the [plugins](https://github.com/repalash/threepipe/tree/master/plugins) directory or in some external repository.

These add support for integrating with other libraries, adding new features, and other functionality with different licenses.

Checkout the [model-viewer](https://threepipe.org/examples/#model-viewer) or [tweakpane-editor](https://threepipe.org/examples/#tweakpane-editor) examples which use most of these plugins.

## List of all the packages

- [@threepipe/webgi-plugins](https://webgi.dev) - Web [Global Illumination](https://en.wikipedia.org/wiki/Global_illumination) - Realistic rendering plugin pack (SSR, SSRTAO, HDR Bloom, TAA, Depth of Field, SSGI, etc.)
- [@threepipe/plugin-tweakpane](../package/plugin-tweakpane) Tweakpane UI Plugin. Renders a [tweakpane](https://tweakpane.github.io/docs/) UI attached to the viewer for any ui config object.
- [@threepipe/plugin-blueprintjs](../package/plugin-blueprintjs) BlueprintJs UI Plugin. Renders a [blueprintjs](https://blueprintjs.com/) ([React](https://react.dev/)) UI attached to the viewer for any ui config object.
- [@threepipe/plugin-tweakpane-editor](../package/plugin-tweakpane-editor) - Tweakpane Editor Plugin. Uses the tweakpane ui plugin to create a [full editor](https://threepipe.org/examples/tweakpane-editor). 
- [@threepipe/plugin-configurator](../package/plugin-configurator) - Provides `MaterialConfiguratorPlugin` and `SwitchNodePlugin` to allow users to select variations
- [@threepipe/plugin-geometry-generator](../package/plugin-geometry-generator) - Generate parametric geometry types that can be re-generated from UI/API.
- [@threepipe/plugin-gltf-transform](../package/plugin-gltf-transform) - Plugin to transform gltf models like adding draco compression while exporting gltf files.
- [@threepipe/plugins-extra-importers](../package/plugins-extra-importers) - Plugin for loading more file types supported by various types of loaders in three.js.
- [@threepipe/plugin-network](../package/plugin-network) - Network/Cloud related plugin implementations for Threepipe - `AWSClientPlugin` and `TransfrSharePlugin`.
- [@threepipe/plugin-blend-importer](../package/plugin-blend-importer) - Add support for loading .blend file. (Partial/WIP) ([Blender](https://www.blender.org/))
- [@threepipe/plugin-gaussian-splatting](../package/plugin-gaussian-splatting) - [3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) plugin for loading and rendering splat files
- [@threepipe/plugin-svg-renderer](../package/plugin-svg-renderer) - Add support for exporting 3d scene as SVG (WIP) using [three-svg-renderer](https://www.npmjs.com/package/three-svg-renderer).
- [@threepipe/plugin-3d-tiles-renderer](https://threepipe.org/package/plugin-3d-tiles-renderer.html) - Plugins for [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS), b3dm, i3dm, cmpt, pnts importers.
- [@threepipe/plugin-path-tracing](https://threepipe.org/package/plugin-path-tracing.html) - Plugins for [path-tracing](https://en.wikipedia.org/wiki/Path_tracing). Using [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)
- [@threepipe/plugin-assimpjs](https://threepipe.org/package/plugin-assimpjs.html) - Plugin and helpers to load and use [assimpjs](https://github.com/kovacsv/assimpjs) (with fbx, other exporters) in the browser.
