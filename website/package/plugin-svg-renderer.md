---
prev: 
    text: '@threepipe/plugin-gaussian-splatting'
    link: './plugin-gaussian-splatting'

next:
    text: '@threepipe/plugin-3d-tiles-renderer'
    link: './plugin-3d-tiles-renderer'

aside: false
---

# @threepipe/plugin-svg-renderer

Exports [ThreeSVGRendererPlugin](https://threepipe.org/plugins/svg-renderer/docs/classes/ThreeSVGRendererPlugin.html) and [BasicSVGRendererPlugin](https://threepipe.org/plugins/svg-renderer/docs/classes/BasicSVGRendererPlugin.html) which provide support for rendering the 3d scene as [SVG(Scalable Vector Graphics)](https://developer.mozilla.org/en-US/docs/Web/SVG). The generated SVG is compatible with browser rendering and other software like figma, illustrator etc.

[Example](https://threepipe.org/examples/#three-svg-renderer-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/svg-renderer/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/svg-renderer/docs) &mdash;
[GPLv3 License](https://github.com/repalash/threepipe/blob/master/plugins/svg-renderer/LICENSE)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-network.svg)](https://www.npmjs.com/package/@threepipe/plugin-svg-renderer)

```bash
npm install @threepipe/plugin-svg-renderer
```

<iframe src="https://threepipe.org/examples/three-svg-renderer-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe SVG Renderer Plugin"></iframe>

::: warning Note
This is still a WIP. API might change a bit
:::

`ThreeSVGRendererPlugin` uses [`three-svg-renderer`](https://github.com/repalash/threepipe/blob/master/plugins/svg-renderer/src/three-svg-renderer), which is a modified version of [three-svg-renderer](https://www.npmjs.com/package/three-svg-renderer) (GPLV3 Licenced).
The plugin renderers meshes in the viewer scene to svg objects by computing polygons and contours of the geometry in view space. Check [LokiResearch/three-svg-renderer](https://github.com/LokiResearch/three-svg-renderer?tab=readme-ov-file#references) for more details.
In the modified version that is used here, support for some types of geometries is added and a rendered image in screen-space is used to create raster fill images for paths along with some other small changes. Check out the [Example](https://threepipe.org/examples/#three-svg-renderer/) for demo. See also [svg-geometry-playground example](https://threepipe.org/examples/#svg-geometry-playground/) for usage with other plugins `PickingPlugin`, `TransformControlsPlugin` and `GeometryGeneratorPlugin`.

Note that this does not support all the features of three.js and may not work with all types of materials and geometries. Check the examples for a list of sample models that do and don't work.

`BasicSVGRendererPlugin` is a sample plugin using [SVGRenderer](https://threejs.org/docs/index.html?q=svg#examples/en/renderers/SVGRenderer) from three.js addons. This renders all triangles in the scene to separate svg paths. Check the three.js docs for more details. Check out the [Example](https://threepipe.org/examples/#basic-svg-renderer/) for demo.

```typescript
import {ThreeViewer} from 'threepipe'
import {ThreeSVGRendererPlugin} from '@threepipe/plugin-svg-renderer'

const viewer = new ThreeViewer({
  ...,
  rgbm: false, // this is required
})
const svgRender = viewer.addPluginSync(ThreeSVGRendererPlugin)
svgRender.autoRender = true // automatically render when camera or any object changes.
svgRender.autoMakeSvgObjects = true // automatically create SVG objects for all meshes in the scene.
// svgRender.makeSVGObject(object) // manually create SVG object for an object. (if autoMakeSvgObjects is false) 

// Now load or generate any 3d model. Make sure its not very big. And the meshes are optimized.
const model = await viewer.load<IOBject3D>('path/to/file.glb')

// clear the background of the viewer 
viewer.scene.backgroundColor = null
viewer.scene.background = null
        
// disable damping to get better experience.
viewer.scene.mainCamera.controls!.enableDamping = false

// hide the canvas to see the underlying svg node.
// note: do not set the display to none or remove the canvas as OrbitControls and other plugins might still be tracking the canvas.
viewer.canvas.style.opacity = '0'

// 3d pipeline can also be disabled like this if `drawImageFills` is `false` to get better performance. Do this only after loading the model.
// await viewer.doOnce('postFrame') // wait for the first frame to be rendered (for autoScale etc)
// viewer.renderManager.autoBuildPipeline = false
// viewer.renderManager.pipeline = [] // this will disable main viewer rendering
```
