---
next:
    text: 'Getting Started'
    link: './getting-started'
---

# Introduction

A new way to work with three.js, 3D models and rendering on the web.

[![NPM Package](https://img.shields.io/npm/v/threepipe.svg)](https://www.npmjs.com/package/threepipe)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)

[//]: # (todo image)

Threepipe provides a high-level API over three.js to create 3D model viewers, configurators. editors and other interactive 3D applications on websites. 

It can be used to quickly get into production-ready WebGL and 3D web graphics without getting into graphics and shaders. The framework is also fully customisable with an extensive API for experienced programmers to add features and make more cool stuff.

<div class="tip custom-block" style="padding-top: 8px">

Just want to try it out? Skip to the [Quickstart](./getting-started).

</div>

Key features include:
- Simple, intuitive API for creating 3D model viewers/configurators/editors on web pages, with many built-in presets for common workflows and use-cases.
- Companion [editor](https://editor.threepipe.org/) to create, edit and configure 3D scenes in the browser.
- Modular architecture that allows you to easily extend the viewer, scene objects, materials, shaders, rendering, post-processing and serialization with custom functionality.
- Plugin system along with a rich library of built-in plugins that allows you to easily add new features to the viewer.
- [uiconfig](https://github.com/repalash/uiconfig.js) compatibility to automatically generate configuration UIs in the browser.
- Modular rendering pipeline with built-in deferred rendering, post-processing, RGBM HDR rendering, etc.
- Material extension framework to modify/inject/build custom shader code into existing materials at runtime from plugins.
- Extendable asset import, export and management pipeline with built-in support for gltf, glb, obj+mtl, fbx, materials(pmat/bmat), json, zip, png, jpeg, svg, webp, ktx2, ply, 3dm and many more.
- Built-in undo/redo support for user actions.
- Automatic serialization of all viewer and plugin settings in GLB(with custom extensions) and JSON formats.
- Automatic disposal of all three.js resources with built-in reference management.

## Examples

Code samples and demos covering various usecases and test are present in the [examples](https://github.com/repalash/threepipe/tree/master/examples/) folder.

Try them: https://threepipe.org/examples/

View the source code by pressing the code button on the top left of the example page.

To make changes and run the example, click on the Codepen Button <input type="image" src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/t-1/cp-arrow-right.svg" width="35" height="35" style="margin-bottom: -0.6rem; cursor: unset;"> on the top right of the source code.

::: tip TUTORIALS

There are some step-by-step tutorials to get you started if you are new to 3D or Threepipe.
- [Create an interactive Device Showcase](https://tympanus.net/codrops/2024/08/07/interactive-3d-device-showcase-with-threepipe/) on codrops.

:::

### Sample

Here is what a sample `threepipe` code looks like -

```typescript
import {
  ContactShadowGroundPlugin,
  IObject3D,
  LoadingScreenPlugin,
  ProgressivePlugin,
  SSAAPlugin,
  ThreeViewer
} from 'threepipe';
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane';

async function init() {

  const viewer = new ThreeViewer({
    // The canvas element where the scene will be rendered
    canvas: document.getElementById('threepipe-canvas') as HTMLCanvasElement,
    // Enable/Disable MSAA (Multi-Sample Anti-Aliasing)
    msaa: false,
    // Set the render scale automatically based on the device pixel ratio
    renderScale: "auto",
    // Enable/Disable tone mapping
    tonemap: true,
    // Add some plugins
    plugins: [
        // Show a loading screen while the model is downloading
        LoadingScreenPlugin,
        // Enable progressive rendering and SSAA
        ProgressivePlugin, SSAAPlugin,
        // Add a ground with contact shadows
        ContactShadowGroundPlugin
    ]
  });

  // Add a plugin with a debug UI for tweaking parameters
  const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true));

  // Load an environment map
  await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
    // The environment map can also be used as the scene background
    setBackground: false,
  });

  // Load a 3D model with auto-center and auto-scale options
  const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
  });

  // Add some debug UI elements for tweaking parameters
  ui.setupPlugins(SSAAPlugin)
  ui.appendChild(viewer.scene.uiConfig)
  ui.appendChild(viewer.scene.mainCamera.uiConfig)

  // Every object, material, etc has a UI config that can be added to the UI to configure it.
  const model = result?.getObjectByName('node_damagedHelmet_-6514');
  if (model) ui.appendChild(model.uiConfig, {expanded: false});

}

init();
```

The `ThreeViewer` class is used to create a new 3D viewer instance. It includes several components including a `Scene`, `Camera`(with `OrbitControls`), `Renderer`, `RenderManager`, `AssetManager`, and some default plugins(like `TonemapPlugin`). It is set up to provide a quickstart to create a three.js app with all the required components. 

Additionally, plugins like `LoadingScreenPlugin`, `ProgressivePlugin`, `SSAAPlugin`, and `ContactShadowGroundPlugin` are added to extend the functionality of the viewer.

Check out this sample on CodePen: [threepipe-sample](https://codepen.io/repalash/pen/GRbEONZ?editors=0010)

## License
The core framework([src](https://github.com/repalash/threepipe/tree/master/src), [dist](https://github.com/repalash/threepipe/tree/master/dist), [examples](https://github.com/repalash/threepipe/tree/master/examples) folders) and any [plugins](https://github.com/repalash/threepipe/tree/master/plugins) without a separate license are under the Free [Apache 2.0 license](https://github.com/repalash/threepipe/tree/master/LICENSE).

Some plugins(in the [plugins](https://github.com/repalash/threepipe/tree/master/plugins) folder) might have different licenses. Check the individual plugin documentation and the source folder/files for more details.

## Status
The project is in `beta` stage and under active development. Many features and integrations will be added but the core API will not change significantly in future releases.

## API Reference/Docs

Check the list of all functions, classes and types in the [API Reference Docs](https://threepipe.org/docs/).

## Contributing

Contributions to ThreePipe are welcome and encouraged! Feel free to open issues and pull requests on the [GitHub repository](https://github.com/repalash/threepipe).


