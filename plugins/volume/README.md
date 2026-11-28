# @threepipe/plugin-volume

Volume rendering for [threepipe](https://threepipe.org): scans, microscopy, simulation data and effects as normal scene objects, with transfer functions and presets.

[Example](https://threepipe.org/examples/#volume-plugin/) &mdash;
[Benchmark](https://threepipe.org/examples/#volume-benchmark/) &mdash;
[Lighting](https://threepipe.org/examples/#volume-lighting/) &mdash;
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
| `VolumeData` | One field on a regular grid; extends three.js `Volume`, so `NRRDLoader` results and `VolumeSlice` work with it. Uploads as R8 (8-bit), R16F (default for everything else) or R32F, downsampled when it is over `maxGpuBytes` (512 MiB by default) or the GPU's 3D texture size |
| `VolumeMaterial` | The ray march. Modes: composite, MIP, MinIP, average, isosurface, x-ray. Opacity corrected for the step length, jittered ray start that `ProgressivePlugin` averages, lower sampling rate while moving, empty space skipping, lighting by the scene (surface, volume or hybrid shading), shadows, ambient occlusion, tricubic sampling |
| `TransferFunction` | Value to colour and opacity, as control points; baked into a lookup texture |
| `volumePresets` | The 30 VolView presets (CT, MR, ultrasound) and one preset per colour map (viridis, magma, inferno, plasma, grayscale, cool-warm, black-body, x-ray, jet) |
| `VolumePlugin` | glTF saving and loading, the quality switch while moving, building the derived fields before each frame |
| `MinMaxBlocks`, `EmptySpaceMap`, `GradientField` | Derived fields, computed on the GPU and cached: the value range of each block of voxels, the distance from each block to the nearest one that shows (for skipping), the gradient |
| `LightVolume`, `AmbientOcclusionVolume` | Derived fields for lighting: the light that reaches each point from the shadow light, and the local ambient occlusion |
| `VolumeGBufferMaterial` | Draws an isosurface into the G-buffer (depth, normal, flags), so SSAO and the other G-buffer effects see it |
| `DerivedField`, `VolumeKernel` | Make your own: a GLSL function run once per voxel into a 3D render target, a few layers per frame |
| `NRRDLoadPlugin` | `.nrrd` files through the three.js `NRRDLoader` |

### Notes

- **Depth**: add `GBufferPlugin` and rays stop at opaque meshes inside the volume. Without it, the volume box is depth tested as a whole.
- **Opacity** is per distance: the transfer function opacity is for `material.opacityUnitDistance` in the units of the field (the smallest voxel spacing by default), and each step is corrected for its physical length, so data with thick slices looks the same from every side.
- **Clip planes**: set `material.clippingPlanes` (three.js planes); as for any three.js material they apply only with `viewer.renderManager.webglRenderer.localClippingEnabled = true`. The planes shorten the rays; with `clipIntersection` a point is clipped only when all planes clip it. `material.cropMin` and `cropMax` crop the box in texture coordinates.
- **Shader hooks**: the march calls `volSample`, `volClassify`, `volShade` and `volBlend`. A material extension replaces one by defining `VOL_CUSTOM_SAMPLE`, `VOL_CUSTOM_CLASSIFY`, `VOL_CUSTOM_SHADE` or `VOL_CUSTOM_BLEND` and the function in its `parsFragmentSnippet`. See `src/shaders/volume.frag.glsl`.
- **Saving**: a volume is saved in a glb as a link to its data file (the `WEBGI_volume` node extension) with its material settings; the voxels are not embedded. A volume made in code has no file to link to, so only its box is saved.
- **Empty space skipping** (`material.emptySpaceSkipping`, on by default): rays jump over blocks of voxels (`skipBlockSize`, 8³ by default) that add nothing: all their values have zero opacity on the transfer function (composite, x-ray), they do not contain the iso value (iso), or they cannot change the result so far (MIP, MinIP). The jumps use a Chebyshev distance map of the empty blocks (Deakin and Knackstedt 2019). Only samples that add nothing are left out, so the image is the same. The maps are built on the GPU by `VolumePlugin` and rebuilt when the transfer function, range, mode or data change; without the plugin every sample is read. It is off with a material extension that replaces `volSample` or `volClassify`. Gains depend on the data: sparse data gains the most, dense data with nothing to skip pays a small cost per block. See the benchmark example, and `material.debugSteps` for the samples per pixel.
- **Memory**: a field larger than `VolumeData.maxGpuBytes` (default `VolumeData.defaultMaxGpuBytes`, 512 MiB) or the GPU's `MAX_3D_TEXTURE_SIZE` is uploaded downsampled, with a warning; `data.textureSize` gives the size on the GPU. `VolumePlugin` shows the GPU memory of the volumes and their derived fields.
- **Lighting** (`material.shading`): `surface` shades each sample as a surface with the gradient as its normal (Lambert and GGX, like a mesh), `volume` scatters the light with a phase function (`anisotropy`), `hybrid` mixes them by the gradient length (`gradientFactor`). The light comes from the three.js lights of the scene (directional, point, spot, hemisphere, ambient, light probes) and from `scene.environment`, which `VolumePlugin` turns into spherical harmonics. A volume next to a mesh of the same shape is lit the same. Iso mode is shaded as a surface. The shading model follows vtk.js and Exposure Render.
- **Shadows** (`material.shadows`): the volume shadows itself from one light: the first directional, spot or point light that casts shadows (else the first directional light). A light volume at `lightingResolution` (0.5 per axis by default) is built on the GPU by sweeping slices from the side of the light, rebuilt when the light, the transfer function or the data change, and kept double buffered so it does not flicker. Point and spot lights are taken as coming from the centre of the volume. The volume does not yet receive the shadows of meshes, or cast shadows on them.
- **Ambient occlusion** (`material.ambientOcclusion`, `aoRadius`): darkens the environment and ambient light in creases and inside dense parts, from a precomputed occlusion volume.
- **Tricubic sampling** (`material.sampling = 'cubic'`): a B-spline from 8 linear lookups, smoother surfaces and normals, about 8 times the texture reads.
- **Isosurfaces** write their depth, so they are depth tested with the scene, and are drawn into the G-buffer (`VolumeGBufferMaterial`, the `customGBufferMaterial` of the object) for SSAO, outlines and depth of field.
- **Gradient texture** (`material.gradientTexture`): shading reads a precomputed gradient (4 bytes per voxel) instead of six samples, which makes lit composite rendering cheaper.
- **Transparency with rgbm**: with `rgbm: true` (the viewer default), threepipe up to 0.6.1 blends transparent objects, volumes included, with their opacity applied twice, which darkens faint parts. Fixed in the next threepipe release; `rgbm: false` gives the correct result before.

### Not yet

More file formats (NIfTI, DICOM, TIFF), the transfer function editor, slice views, shadows between volumes and meshes. Planned in the next phases.

## License

Apache-2.0. Includes data and shader code from other projects, see [NOTICE](./NOTICE).
