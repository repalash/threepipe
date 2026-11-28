---
prev: 
    text: '@threepipe/plugin-gaussian-splatting'
    link: './plugin-gaussian-splatting'

next: 
    text: '@threepipe/plugin-svg-renderer'
    link: './plugin-svg-renderer'

---

# @threepipe/plugin-volume

Volume rendering for [threepipe](https://threepipe.org): scans, microscopy, simulation data and effects as normal scene objects, with transfer functions and presets.

[Example](https://threepipe.org/examples/#volume-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/volume/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/volume/docs)

```bash
npm install @threepipe/plugin-volume
```

```ts
import {ThreeViewer, ProgressivePlugin, GBufferPlugin} from 'threepipe'
import {NRRDLoadPlugin, VolumeObject} from '@threepipe/plugin-volume'

const viewer = new ThreeViewer({canvas, plugins: [ProgressivePlugin, GBufferPlugin, NRRDLoadPlugin]})

const volume = await viewer.load<VolumeObject>('https://threejs.org/examples/models/nrrd/stent.nrrd', {autoScale: true, autoCenter: true})
volume.material.mode = 'composite'          // 'mip' | 'minip' | 'average' | 'iso' | 'xray'
volume.material.setPreset('colormap:inferno') // or 'CT-Bone', 'MR-Default', ... (volumePresets)
volume.material.range.set(0.1, 1)           // value range shown, in data units
```

Your own data:

```ts
import {VolumeData, VolumeObject} from '@threepipe/plugin-volume'

const data = new VolumeData({data: new Uint8Array(64 ** 3), size: [64, 64, 64], spacing: [1, 1, 1], units: 'mm'})
viewer.scene.addObject(new VolumeObject(data))
```

## What is in it

| Class | What it is |
| --- | --- |
| `VolumeObject` | A volume in the scene: a three.js `BoxGeometry` mesh sized from the voxel count and spacing, with named fields (as a USD `UsdVolVolume`) and a `VolumeMaterial`. The object owns its fields; the material shows `material.sourceField` (else the active field), so one material can be shared. Move, select, copy and dispose it like any mesh |
| `VolumeData` | One field on a regular grid; extends three.js `Volume`, so `NRRDLoader` results and `VolumeSlice` work with it. Uploads as R8 (8-bit), R16F (default for everything else) or R32F |
| `VolumeMaterial` | The ray march. Modes: composite, MIP, MinIP, average, isosurface, x-ray. Opacity corrected for the step length, jittered ray start that `ProgressivePlugin` averages, lower sampling rate while moving |
| `TransferFunction` | Value to colour and opacity, as control points; baked into a lookup texture |
| `volumePresets` | The 30 VolView presets (CT, MR, ultrasound) and one preset per colour map (viridis, magma, inferno, plasma, grayscale, cool-warm, black-body, x-ray, jet) |
| `VolumePlugin` | glTF saving and loading, the quality switch while moving |
| `NRRDLoadPlugin` | `.nrrd` files through the three.js `NRRDLoader` |

### Notes

- **Depth**: add `GBufferPlugin` and rays stop at opaque meshes inside the volume. Without it, the volume box is depth tested as a whole.
- **Opacity** is per distance: the transfer function opacity is for `material.opacityUnitDistance` in the units of the field (the smallest voxel spacing by default), and each step is corrected for its physical length, so data with thick slices looks the same from every side.
- **Clip planes**: set `material.clippingPlanes` (three.js planes); as for any three.js material they apply only with `viewer.renderManager.webglRenderer.localClippingEnabled = true`. The planes shorten the rays; with `clipIntersection` a point is clipped only when all planes clip it. `material.cropMin` and `cropMax` crop the box in texture coordinates.
- **Shader hooks**: the march calls `volSample`, `volClassify`, `volShade` and `volBlend`. A material extension replaces one by defining `VOL_CUSTOM_SAMPLE`, `VOL_CUSTOM_CLASSIFY`, `VOL_CUSTOM_SHADE` or `VOL_CUSTOM_BLEND` and the function in its `parsFragmentSnippet`. See `src/shaders/volume.frag.glsl`.
- **Saving**: a volume is saved in a glb as a link to its data file (the `WEBGI_volume` node extension) with its material settings; the voxels are not embedded. A volume made in code has no file to link to, so only its box is saved.
- **Transparency with rgbm**: with `rgbm: true` (the viewer default), transparent objects, volumes included, are blended with their opacity applied twice, which darkens faint parts (a known threepipe issue). `rgbm: false` gives the correct result.

### Not yet

Lighting from scene lights, empty-space skipping, more file formats (NIfTI, DICOM, TIFF), the transfer function editor, slice views. Planned in the next phases.

## License

Apache-2.0. Includes data and shader code from other projects, see [NOTICE](https://github.com/repalash/threepipe/blob/master/plugins/volume/NOTICE).
