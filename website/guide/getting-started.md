---
prev:
    text: 'What is Threepipe?'
    link: './introduction'

next:
    text: 'Editors in Threepipe'
    link: './editors'
---

# Getting Started

Getting started with Threepipe is easy. You can use it in your HTML/JS, React, Vue.js, Svelte, or any other web framework. The best way to use it is as an ES module in your project. Simply install the package `threepipe` from npm, or include it in html from any CDN like [esm.sh](https://esm.sh/threepipe) or [jsdelivr](https://cdn.jsdelivr.net/npm/threepipe@latest).

[![NPM Package](https://img.shields.io/npm/v/threepipe.svg)](https://www.npmjs.com/package/threepipe)

## What you need

- A 3D Model (GLTF, GLB, OBJ, FBX, etc). Optionally, the model, scene, and plugins can be configured, compressed and exported using the [Threepipe Editor](https://editor.threepipe.org) or [Tweakpane Editor](https://threepipe.org/examples/tweakpane-editor/). A sample is used in examples below.
- A modern browser that supports [WebGL2](https://caniuse.com/webgl2) and [WebAssembly](https://caniuse.com/webassembly) (for some plugins).
- Node.js (for local development). Node 18+ is recommended.
- An existing project or willingness to start a new one
- Basic knowledge of JavaScript/TypeScript

## Quickstart

### Codepen
You can quickly prototype in JavaScript on Codepen. Here is a starter pen with the basic setup: [Threepipe Starter Codepen](https://codepen.io/repalash/pen/GRbEONZ?editors=0010)

Simply fork the pen and start coding.

Each example on [Threepipe Examples](https://threepipe.org/examples) also has a Codepen Button <input type="image" src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/t-1/cp-arrow-right.svg" width="35" height="35" style="margin-bottom: -0.6rem; cursor: unset;"> to open the example directly in Codepen.

### Local Setup

To get started with a new project using Threepipe locally, you need to have Node.js installed on your machine. 

A new project can be quickly created using the `npm create` command. Open your terminal and run the following command:
```bash
npm create threepipe@latest
```
and follow the prompts to pick a project name, select a template/framework and pick between JavaScript or TypeScript. Supported templates - 
- `vanilla`
- `vanilla-ts`

This will create a ready-to-use project with all the necessary dependencies and configurations.

Now, code from any of the examples on the [Threepipe Examples](https://threepipe.org/examples) page can be copied and pasted into the project to get started.

## Install in existing projects

### HTML/JS

```html
<canvas id="three-canvas" style="width: 800px; height: 600px;"></canvas>
<script type="module">
  import {ThreeViewer, DepthBufferPlugin} from 'https://threepipe.org/dist/index.mjs'
  // or 
  // import {ThreeViewer, DepthBufferPlugin} from 'https://cdn.jsdelivr.net/npm/threepipe@latest/dist/index.mjs'
  // import {ThreeViewer, DepthBufferPlugin} from 'https://esm.sh/threepipe'
  // import {ThreeViewer, DepthBufferPlugin} from 'threepipe' // using npm or importmaps

  const viewer = new ThreeViewer({canvas: document.getElementById('three-canvas')})

  // Add some plugins 
  viewer.addPluginSync(new DepthBufferPlugin())
  
  // Load an environment map
  const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
  const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
  })

  Promise.all([envPromise, modelPromise]).then(([env, model]) => {
    console.log('Loaded', model, env, viewer)
  })
</script>
```
Check it in action: [html-js-sample](https://threepipe.org/examples/#html-js-sample/)

Check out the details about [ThreeViewer API](#viewer-api) and more [plugins](#threepipe-plugins).

### NPM

#### Installation

```bash
npm install threepipe
```

#### Loading a 3D Model

First, create a canvas element in your HTML page:
```html
<canvas id="three-canvas" style="width: 800px; height: 600px;"></canvas>
```

Then, import the viewer and create a new instance:

```typescript
import {ThreeViewer, IObject3D} from 'threepipe'

// Create a viewer
const viewer = new ThreeViewer({canvas: document.getElementById('three-canvas') as HTMLCanvasElement})

// Load an environment map
await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

// Load a model
const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
    autoCenter: true,
    autoScale: true,
})
```

That's it! You should now see a 3D model on your page.

The 3D model can be opened in the [editor](https://threepipe.org/examples/tweakpane-editor/) to view and edit the scene settings, objects, materials, lights, cameras, post-processing, etc. and exported as a GLB file. All settings are automatically serialized and saved in the GLB file, which can be loaded into the viewer. Any plugins used in the editor can be added to the viewer to add the same functionality. The plugin data is automatically loaded(if the plugin is added) when the model is added to the scene.

The viewer initializes with a Scene, Camera, Camera controls(Orbit Controls), several importers, exporters and a default rendering pipeline. Additional functionality can be added with plugins.

Check out the GLTF Load example to see it in action or to check the JS equivalent code: [Example: gltf-load](https://threepipe.org/examples/#gltf-load/)

Check out the [Plugins](#plugin-system) section below to learn how to add additional functionality to the viewer.

### React

A sample [react](https://react.dev) component in tsx to render a model with an environment map.

```tsx
import React from 'react'
function ThreeViewerComponent({src, env}: {src: string, env: string}) {
  const canvasRef = React.useRef(null)
  React.useEffect(() => {
    const viewer = new ThreeViewer({canvas: canvasRef.current})

    const envPromise = viewer.setEnvironmentMap(env)
    const modelPromise = viewer.load(src)
    Promise.all([envPromise, modelPromise]).then(([env, model]) => {
      console.log('Loaded', model, env, viewer)
    })
    
    return () => {
      viewer.dispose()
    }
  }, [])
  return (
     <canvas id="three-canvas" style={{width: 800, height: 600}} ref={canvasRef} />
  )
}
```

Check it in action: [react-tsx-sample](https://threepipe.org/examples/#react-tsx-sample/)

Other examples in js: [react-js-sample](https://threepipe.org/examples/#react-js-sample/) and jsx: [react-jsx-sample](https://threepipe.org/examples/#react-jsx-sample/)

### Vue.js

A sample [vue.js](https://vuejs.org/) component in js to render a model with an environment map.

```js
const ThreeViewerComponent = {
  setup() {
    const canvasRef = ref(null);

    onMounted(() => {
      const viewer = new ThreeViewer({ canvas: canvasRef.value });

      const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
      const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf');

      Promise.all([envPromise, modelPromise]).then(([env, model]) => {
        console.log('Loaded', model, env, viewer)
      })

      onBeforeUnmount(() => {
        viewer.dispose();
      });
    });

    return { canvasRef };
  },
};
```

Check it in action: [vue-html-sample](https://threepipe.org/examples/#vue-html-sample/)

Another example with Vue SFC(Single file component): [Example: vue-sfc-sample](https://threepipe.org/examples/#vue-sfc-sample/)

### Svelte

A sample [svelte](https://svelte.dev/) component in js to render a model with an environment map.

```html
<script>
    import {onDestroy, onMount} from 'svelte';
    import {ThreeViewer} from 'threepipe'; 

    let canvasRef;
    let viewer;
    onMount(() => {
        viewer = new ThreeViewer({canvas: canvasRef});

        const envPromise = viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr');
        const modelPromise = viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf');

        Promise.all([envPromise, modelPromise]).then(([env, model]) => {
          console.log('Loaded', model, env, viewer)
        })
    });
    onDestroy(() => viewer.dispose())
</script>

<canvas bind:this={canvasRef} id="three-canvas" style="width: 800px; height: 600px"></canvas>
```

Check it in action: [svelte-sample](https://threepipe.org/examples/#svelte-sample/)
