---
prev: 
    text: '@threepipe/plugin-blend-importer'
    link: './plugin-blend-importer'

next: 
    text: '@threepipe/plugin-svg-renderer'
    link: './plugin-svg-renderer'

---

# @threepipe/plugin-gaussian-splatting

Exports [GaussianSplattingPlugin](https://threepipe.org/plugins/gaussian-splatting/docs/classes/GaussianSplattingPlugin.html) which adds support for loading .blend files.

It uses [`three-gaussian-splat`](https://github.com/repalash/threepipe/blob/master/plugins/gaussian-splatting/src/three-gaussian-splat), a rewrite of [@zappar/three-guassian-splat](https://github.com/zappar-xr/three-gaussian-splat) (and [gsplat.js](https://github.com/huggingface/gsplat.js) and [antimatter15/splat](https://github.com/antimatter15/splat)) for loading splat files and rendering gaussian splats.

[Example](https://threepipe.org/examples/#splat-load/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/gaussian-splatting/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/gaussian-splatting/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-gaussian-splatting.svg)](https://www.npmjs.com/package/@threepipe/plugin-gaussian-splatting)

```bash
npm install @threepipe/plugin-gaussian-splatting
```

::: warning Note
This is still a WIP.
:::

Currently working:
* Importing .splat files (just array buffer of gaussian splat attributes)
* ThreeGaussianSplatPlugin (Same as GaussianSplattingPlugin), add importer and update events to the viewer
* GaussianSplatMaterialExtension for adding gaussian splat functionality to any material like Unlit, Physical
* GaussianSplatMesh a subclass of Mesh2 for holding the gaussian splat geometry and a material with gaussian splat extension. also handles basic raycast in the splat geometry. (assuming simple points)
* GaussianSplatGeometry holds the geometry data and the sort worker. Computes correct bounding box and sphere.
* SplatLoader for loading splat files and creating the geometry and material.
* GaussianSplatMaterialUnlit, GaussianSplatMaterialRaw
* GaussianSplatMaterialPhysical, working but normals are hardcoded to 0,1,0

TBD:
* Exporting/embedding splat files into glb
* Rendering to depth/gbuffer
* Estimate normals/read from file
* Lighting in GaussianSplatMaterialPhysical

```typescript
import {ThreeViewer} from 'threepipe'
import {GaussianSplattingPlugin} from '@threepipe/plugin-gaussian-splatting'

const viewer = new ThreeViewer({...})
viewer.addPluginSync(GaussianSplattingPlugin)

// Now load any .splat file.
const model = await viewer.load<GaussianSplatMesh>('path/to/file.splat')

```
