# Changelog for @threepipe/plugin-volume

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- First version: `VolumeObject`, `VolumeData` (extends three.js `Volume`), `VolumeMaterial` (composite, MIP, MinIP, average, isosurface and x-ray modes; replaceable shader hooks; clip planes and crop box; stops at opaque meshes with `GBufferPlugin`; jitter averaged by `ProgressivePlugin`; lower sampling rate while moving), `TransferFunction`, the VolView presets and colour maps, `VolumePlugin` (glTF saving as a link to the data file, `WEBGI_volume`), `NRRDLoadPlugin`. Example: `examples/volume-plugin`
- Empty space skipping (`VolumeMaterial.emptySpaceSkipping`, on by default; `skipBlockSize`): per-block value ranges (`MinMaxBlocks`) and a Chebyshev distance map of the empty blocks (`EmptySpaceMap`), built on the GPU by `VolumePlugin`; composite, x-ray and iso rays jump over empty space, MIP and MinIP rays over blocks that cannot change the result. The image is the same with and without it
- Derived fields: `DerivedField` and `VolumeKernel`, GLSL kernels run per voxel into 3D render targets, a few layers per frame within `VolumePlugin.kernelBudget`, cached on the field (`VolumeData.getDerived`) and rebuilt when their inputs change or the WebGL context is restored. `GradientField` and `VolumeMaterial.gradientTexture`
- Memory budget: `VolumeData.maxGpuBytes` / `defaultMaxGpuBytes` and `VolumeData.maxTextureSize` (set from the GPU by `VolumePlugin`); a larger field is uploaded downsampled (`textureSize`, `downsampled`). `VolumePlugin.gpuMemoryMiB`
- Lighting: `VolumeMaterial.shading` (`none`, `surface`, `volume`, `hybrid`) with the three.js lights of the scene and the environment as spherical harmonics (`VolumePlugin`); `gradientFactor`, `anisotropy`, `roughness`, `specular`
- Shadows of the volume on itself (`shadows`, `LightVolume`, light propagation on the GPU) and local ambient occlusion (`ambientOcclusion`, `aoRadius`, `AmbientOcclusionVolume`), at `lightingResolution`, double buffered
- Tricubic B-spline sampling (`sampling: 'cubic'`)
- Iso mode writes its depth and goes into the G-buffer (`VolumeGBufferMaterial`, `VolumeObject.customGBufferMaterial`). Example: `examples/volume-lighting`
- `VolumeMaterial.debugSteps`: shows the samples read per pixel. Example: `examples/volume-benchmark`, frame time and samples per pixel with skipping off and on
