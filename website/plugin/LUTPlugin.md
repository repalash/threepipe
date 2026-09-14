---
prev:
    text: 'FilmicGrainPlugin'
    link: './FilmicGrainPlugin'

next:
    text: 'ProgressivePlugin'
    link: './ProgressivePlugin'

---

# LUTPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#lut-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/LUTPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/LUTPlugin.html)

LUTPlugin adds a post-processing material extension to the `ScreenPass` in the render manager
that applies a 3D color look-up table (LUT) to the final render — useful for color grading.

It loads `.cube` files via [`LUTCubeLoader2`](./LUTCubeLoader2) and supports up to **three LUT
slots** simultaneously (`lutMap`, `lutMap1`, `lutMap2`). Individual materials can opt into a
specific slot via their `userData['LUTPlugin1']` config; the selection is packed into GBuffer
flags and read back per-pixel inside the shader.

## Basic usage

```typescript
import {ThreeViewer, LUTPlugin, LUTCubeTextureWrapper, GBufferPlugin} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    plugins: [GBufferPlugin],  // required for per-material selection (see note below)
})

const lut = viewer.addPluginSync(new LUTPlugin(true))

// Load a .cube LUT — returns a LUTCubeTextureWrapper
lut.lutMap = await viewer.load<LUTCubeTextureWrapper>(
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/luts/Bourbon 64.CUBE'
)

lut.intensity = 0.8          // 0..1 — blend between original and LUT-graded
lut.lutBackground = true     // apply LUT to skybox/background too (default: true)
```

## Multiple LUTs with per-material selection

```typescript
lut.lutMap  = await viewer.load(...)   // slot 0 — the default
lut.lutMap1 = await viewer.load(...)   // slot 1
lut.lutMap2 = await viewer.load(...)   // slot 2

// Assign material A to slot 1, material B to slot 2
materialA.userData['LUTPlugin1'] = { enable: true, index: 1 }
materialB.userData['LUTPlugin1'] = { enable: true, index: 2 }
// Materials without a config use slot 0 by default.
// Set enable: false to exclude a material from LUT grading.
```

The per-material UI (enable + slot dropdown) is also exposed in the material inspector
when the plugin is registered.

## Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Toggle the whole plugin |
| `intensity` | `number` | `1` | Blend factor between original and LUT-graded color (0..1) |
| `lutBackground` | `boolean` | `true` | Apply the LUT to background pixels (depth ≥ 0.9999) |
| `lutMap` | `LUTCubeTextureWrapper \| undefined` | `undefined` | Slot 0 — the default LUT applied to materials without a config |
| `lutMap1` | `LUTCubeTextureWrapper \| undefined` | `undefined` | Slot 1 |
| `lutMap2` | `LUTCubeTextureWrapper \| undefined` | `undefined` | Slot 2 |

## Notes

- **WebGL2 only** — uses `sampler3D`. Threepipe already requires WebGL2.
- **GBufferPlugin dependency**: the per-pixel per-material selection reads from GBuffer flags.
  Without `GBufferPlugin` active, `getGBufferFlags` returns all-1s and every pixel uses slot 0
  with LUT enabled — still useful as a global LUT.
- **PluginType** is `'LUTPlugin1'` (not `'LUTPlugin'`) — kept for wire-compat with legacy
  viewer configs exported from older toolchains.
- **Serialization**: LUTs loaded via `viewer.load()` are serialized into viewer configs
  with their full source bytes (via `LUTCubeTextureWrapper.toJSON`), so configs are
  portable without needing the original `.cube` file URL. See
  [`LUTCubeLoader2`](./LUTCubeLoader2).
