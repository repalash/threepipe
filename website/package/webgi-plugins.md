---
prev:
  text: 'FrameFadePlugin'
  link: '../plugin/FrameFadePlugin'

next:
  text: 'TemporalAAPlugin'
  link: '../plugin/TemporalAAPlugin'

aside: false
pageClass: webgi-plugins-page
---

<div class="webgi-split">
<div class="webgi-split-left">

# @threepipe/webgi-plugins

<p class="tagline">Realtime photo-realistic 3D rendering <span class="badge">Free Forever</span></p>

`webgi` enables 3D rendering directly in the browser with advanced post-processing effects, global illumination, and easy-to-use APIs for building interactive 3D model viewers, configurators, and editors, making it ideal for e-commerce, product showcases, and creative applications.

The plugins are added to a [threepipe](../guide/introduction) viewer. The viewer on this page uses them: scroll down to see each plugin in action, or turn each effect on and off with the buttons at the top of the viewer.

[Examples](https://threepipe.org/examples/?q=webgi) &mdash;
[Source Code](https://github.com/repalash/threepipe/tree/dev/plugins/webgi-plugins) &mdash;
[API Reference](https://threepipe.org/plugins/webgi-plugins/docs/)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/webgi-plugins.svg)](https://www.npmjs.com/package/@threepipe/webgi-plugins)

```bash
npm install threepipe @threepipe/webgi-plugins
```

License: webgi Free Forever License, see the package LICENSE.

## Plugins

- [TemporalAAPlugin](../plugin/TemporalAAPlugin) - Temporal anti-aliasing when the camera or objects move ([demo](https://threepipe.org/examples/#temporalaa-plugin/))
- [VelocityBufferPlugin](../plugin/VelocityBufferPlugin) - Per-pixel motion vectors for TAA, motion blur, etc. ([demo](https://threepipe.org/examples/#velocity-buffer-plugin/))
- [BloomPlugin](../plugin/BloomPlugin) - Screen space HDR bloom ([demo](https://threepipe.org/examples/#bloom-plugin/))
- [SSReflectionPlugin](../plugin/SSReflectionPlugin) - Screen space reflections ([demo](https://threepipe.org/examples/#ssreflection-plugin/))
- [SSContactShadowsPlugin](../plugin/SSContactShadowsPlugin) - Screen space contact shadows ([demo](https://threepipe.org/examples/#sscontactshadows-plugin/))
- [DepthOfFieldPlugin](../plugin/DepthOfFieldPlugin) - Depth of field with focus control ([demo](https://threepipe.org/examples/#depthoffield-plugin/))
- [SSGIPlugin](../plugin/SSGIPlugin) - Screen space global illumination ([demo](https://threepipe.org/examples/#ssgi-plugin/))
- [AnisotropyPlugin](../plugin/AnisotropyPlugin) - Blender-like anisotropy material extension for metals ([demo](https://threepipe.org/examples/#anisotropy-plugin/))
- [AdvancedGroundPlugin](../plugin/AdvancedGroundPlugin) - Ground with baked shadows and planar or SSR reflections ([demo](https://threepipe.org/examples/#advanced-ground-plugin/))
- [OutlinePlugin](../plugin/OutlinePlugin) - Outline on the objects selected with the PickingPlugin ([demo](https://threepipe.org/examples/#outline-plugin/))
- [WatchHandsPlugin](../plugin/WatchHandsPlugin) - Animates the hands of a watch model to the current time ([demo](https://threepipe.org/examples/#watch-hands-plugin/))

More samples: [SSGI + SSR](https://threepipe.org/examples/#ssgi-ssr-plugin/), [r3f + webgi](https://threepipe.org/examples/#r3f-tsx-webgi/), [r3f SSR](https://threepipe.org/examples/#r3f-ssr-demo/), [Mesh Lines (SSR + Shadow)](https://threepipe.org/examples/#fat-lines-ssr/), and all the plugins in the [Tweakpane Editor](https://threepipe.org/examples/#tweakpane-editor/).

::: tip iJewel3D

Looking for 3D jewellery rendering for diamonds, metals and gemstones?

Check out the [iJewel3D](https://ijewel3d.com) suite of products including SDK, Viewer, Drive, TryOn and BatchX for all your jewellery 3D needs. Read more at [iJewel3D Docs](https://developer.ijewel3d.com).

- The jewellery rendering plugins for threepipe (diamonds, gemstones and more) are planned as a separate package, `@ijewel3d/threepipe-plugins`. See [WebGI Plugins and Packs](https://developer.ijewel3d.com/webgi/plugins.html).
- The webgi SDK v0 (earlier on webgi.xyz) is supported for existing projects. See [WebGI v0](https://developer.ijewel3d.com/webgi/v0/).

:::

## Quickstart

<div id="quickstart-top">

Let's create a model viewer with webgi plugins. You can see the preview on the right side.

We will start with creating a canvas and a [threepipe](https://threepipe.org) viewer to render the 3D models. `webgi` Plugins are added to the viewer to enhance the rendering quality and features.

Scroll down to see the plugins in action

::: details Installation

Threepipe can be used directly in the browser or with npm for projects with a bundler.

### Stackblitz

Get started with a ready to use template on stackblitz that you can edit live in your browser

- javascript <a href="https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-vanilla-webgi?file=package.json&title=Threepipe%20Starter">
  <input type="image" src="https://developer.stackblitz.com/img/open_in_stackblitz_small.svg" width="140" height="20" style="margin-bottom: -0.3rem; cursor: unset;">
  </a>

- typescript <a href="https://stackblitz.com/github/repalash/create-threepipe/tree/master/template-vanilla-webgi-ts?file=package.json&title=Threepipe%20Starter">
  <input type="image" src="https://developer.stackblitz.com/img/open_in_stackblitz_small.svg" width="140" height="20" style="margin-bottom: -0.3rem; cursor: unset;">
  </a>

### HTML
To use in a browser, simply define an import map in the HTML file. Now when you import the modules, the browser will fetch them from the specified URLs.
```html
<!-- Import maps polyfill, Remove this when import maps will be widely supported -->
<script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>
<script type="importmap">
{
  "imports": {
    "threepipe": "https://unpkg.com/threepipe@latest/dist/index.mjs",
    "@threepipe/webgi-plugins": "https://unpkg.com/@threepipe/webgi-plugins@latest/dist/index.mjs"
  }
}
</script>
```

### NPM
To use with npm, in an existing project, install the packages using npm or yarn.
```bash
npm install threepipe @threepipe/webgi-plugins
```
Or create a new project using [vite](https://vitejs.dev/)
```bash
npm create threepipe@latest
```
and pick the `vanilla` > `webgi` template with typescript or javascript.

:::

Add a container and a canvas to the HTML file. This canvas will render our 3D models. The container can be placed anywhere on the page and interacted with as needed. The canvas is set to fill the container.
```html
<div id="webgi-canvas-container" style="width: 1024px; height: 1024px;">
    <canvas id="webgi-canvas" style="width: 100%; height: 100%;"></canvas>
</div>
```

Add the following javascript code to create a viewer and load a model in it.

```javascript
import {ThreeViewer, LoadingScreenPlugin, GBufferPlugin, BaseGroundPlugin, SSAAPlugin, SSAOPlugin} from 'threepipe';
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin, DepthOfFieldPlugin} from '@threepipe/webgi-plugins';

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('webgi-canvas'),
        renderScale: 'auto',
        msaa: true,
        plugins: [
            LoadingScreenPlugin,
            GBufferPlugin,
            BloomPlugin,
            SSAAPlugin,
            SSAOPlugin,
            SSReflectionPlugin,
            TemporalAAPlugin,
            DepthOfFieldPlugin,
            BaseGroundPlugin,
        ],
    });
    await viewer.load('https://asset-samples.threepipe.org/demos/classic-watch.glb');
}
init()
```

::: details Usage
Add the above code either in a script tag in HTML
```html
<script type="module">
    // code
</script>
```
or in a javascript file and import it in the HTML file.
```html
<script type="module" src="path/to/your/script.js"></script>
```
:::

Now, let's check out all the plugins in action and how they change the look and feel of the rendering.

</div>

## Basic rendering

<div class="effect-toggle-row">Toggle All Plugins <EffectToggle id="basic-rendering-section-toggle"/></div>

The basic rendering of the model without any plugins.

<div id="basic-rendering-section" class="r-section">

</div>

## Reflections and Occlusion

<div class="effect-toggle-row">Toggle SSR + SSAO <EffectToggle id="ssrefl-plugin-toggle"/></div>

SSReflection Plugin adds screen space reflections to the scene, SSAO Plugin adds ambient occlusion to the scene.

<div id="ssrefl-plugin" class="r-section">

The plugins can be configured with many properties like radius, intensity, bias, etc.
```typescript
import {SSAOPlugin} from "threepipe"
import {SSReflectionPlugin} from "@threepipe/webgi-plugins"

// ...

const ssrefl = viewer.getPlugin(SSReflectionPlugin)
ssrefl.enabled = true
ssrefl.pass.intensity = 1
ssrefl.pass.objectRadius = 0.001
ssrefl.pass.tolerance = 0.8

const ssao = viewer.getPlugin(SSAOPlugin)
ssao.enabled = true
ssao.pass.intensity = 0.5
ssao.pass.bias = 0.001
ssao.pass.falloff = 1.25
ssao.pass.numSamples = 8
```

</div>

## Anti-Aliasing

<div class="effect-toggle-row">Toggle SSAA + TAA <EffectToggle id="ssaa-taa-plugin-toggle"/></div>

Let's enable the SSAA and TAA plugins to get anti-aliasing to reduce the jagged edges in the rendering.

The SSAA plugin adds super-sampling anti-aliasing when the camera is stopped, and TAA plugin adds temporal anti-aliasing when the camera is moving.

<div id="ssaa-taa-plugin" class="r-section">

The SSAA plugin can be configured to improve the anti-aliasing at the cost of performance.

The TAA plugin can be configured with `feedBack` to control the rate of blurring.

```typescript
import {SSAAPlugin} from "threepipe"
import {TemporalAAPlugin} from "@threepipe/webgi-plugins"

// ...

const ssaa = viewer.getPlugin(SSAAPlugin)
ssaa.enabled = true
ssaa.rendersPerFrame = 2
ssaa.jitterRenderCamera = true

const taa = viewer.getPlugin(TemporalAAPlugin)
taa.enabled = true
taa.pass.feedBack.set(0.88, 0.97)
```

</div>

## HDR Bloom

<div class="effect-toggle-row">Toggle Bloom <EffectToggle id="bloom-plugin-toggle"/></div>

Bloom Plugin adds object independent screen space HDR bloom to the scene.

<div id="bloom-plugin" class="r-section">

The plugin can be configured with many properties like bloomIterations, intensity, threshold, etc.
```typescript
import {BloomPlugin} from "@threepipe/webgi-plugins"

// ...

const bloom = viewer.getPlugin(BloomPlugin)
bloom.enabled = true
bloom.pass.intensity = 0.4
bloom.pass.threshold = 2
bloom.pass.bloomIterations = 4
```

</div>

## Depth of Field

<div class="effect-toggle-row">Toggle DoF <EffectToggle id="dof-plugin-toggle"/></div>

Depth of Field Plugin adds a depth of field effect to the scene.

<div id="dof-plugin" class="r-section">

The plugin can be configured with many properties like focusDistance, focusRange, etc.

```typescript
import {DepthOfFieldPlugin} from "@threepipe/webgi-plugins"

// ...

const dof = viewer.getPlugin(DepthOfFieldPlugin)
dof.enabled = true
dof.enableEdit = true
```

</div>

## Play around

<div id="play-around-section" class="r-section">

Try out different models by picking from the buttons at the bottom, or drag and drop your own 3D models on the canvas to load it in the viewer. [SketchFab](https://sketchfab.com) has some great 3D models to try out.

Move the mouse pointer over the model to see the post-processing split.

### What next?

Run `webgi` locally and start building awesome applications -
```bash
npm create threepipe@latest
```

Pick the `vanilla` > `webgi` template with typescript or javascript and run the project -
```bash
cd my-threepipe-project
npm install
npm run dev
```

You should see the same viewer as above with the watch model and all plugins configured.

Prefer simple html and javascript with CDN links?

Copy the following code into any HTML file
::: details Sample HTML
```html
<!-- Import maps polyfill, Remove this when import maps will be widely supported -->
<script async src="https://unpkg.com/es-module-shims@1.6.3/dist/es-module-shims.js"></script>
<script type="importmap">
{
  "imports": {
    "threepipe": "https://unpkg.com/threepipe@latest/dist/index.mjs",
    "@threepipe/webgi-plugins": "https://unpkg.com/@threepipe/webgi-plugins@latest/dist/index.mjs"
  }
}
</script>
<div id="webgi-canvas-container" style="width: 1024px; height: 1024px;">
    <canvas id="webgi-canvas" style="width: 100%; height: 100%;"></canvas>
</div>
<style>
html, body, #webgi-canvas-container{
    width: 100vw;
    height: 100vh;
    position: relative;
}
</style>
<script type="module">
import {ThreeViewer, LoadingScreenPlugin, GBufferPlugin, BaseGroundPlugin, SSAAPlugin, SSAOPlugin} from 'threepipe';
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin, DepthOfFieldPlugin} from '@threepipe/webgi-plugins';

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('webgi-canvas'),
        renderScale: 'auto',
        msaa: true,
        plugins: [
            LoadingScreenPlugin,
            GBufferPlugin,
            BloomPlugin,
            SSAAPlugin,
            SSAOPlugin,
            SSReflectionPlugin,
            TemporalAAPlugin,
            DepthOfFieldPlugin,
            BaseGroundPlugin,
        ],
    });
    await viewer.load('https://asset-samples.threepipe.org/demos/classic-watch.glb');
}
init()
</script>
```
:::

Or play around with the [codepen sample](https://codepen.io/repalash/pen/GgpqKGa?editors=0010)

Now, you can start building your own 3D applications with webgi plugins.

The realistic rendering and global illumination plugins are added to the [Threepipe Editor](https://editor.threepipe.org). Use it to configure 3d files and make them ready for e-commerce, configurators, games, etc.

To render high-quality jewellery, diamonds, metals and gemstones, check out [iJewel3D Playground](https://playground.ijewel3d.com/v2/index.html) which is packed with all webgi plugins, hand crafted environment maps, materials, textures and presets for luxury e-commerce.

### Configuring Plugins

To adjust the settings, drag and drop a 3d file in formats like glTF, OBJ, FBX, etc. in the editor, and configure the webgi plugins settings from the `Post-Processing` tab on the right side.

When exporting the scene as a `glb` file, the plugins will automatically be serialized inside the file. When loading it in the viewer, the plugins will automatically initialize and apply to the scene.

To keep the 3D Model and the plugin/viewer settings separate, you can export the settings (viewer and plugins) as a `vjson` file, or individual plugins as `json` files. These files can be loaded in the viewer using the `viewer.load('/path/to/file.json')` method.

The viewer settings and the plugins can also be configured in the code (like described above), at runtime using auto-generated configuration UIs or using any compatible threepipe editor.

</div>

</div>
<div class="webgi-split-right">

<ClientOnly>
<WebgiShowcase/>
</ClientOnly>

</div>
</div>
