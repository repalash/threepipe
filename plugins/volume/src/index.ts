/**
 * @threepipe/plugin-volume: volume rendering for threepipe.
 *
 * - {@link VolumeObject}: a volume in the scene, with named fields (as a USD volume) and a {@link VolumeMaterial}.
 * - {@link VolumeData}: one field on a regular grid; extends three.js `Volume`.
 * - {@link VolumeMaterial}: the ray march, built from replaceable shader hooks.
 * - {@link TransferFunction}: value to colour and opacity; presets in {@link volumePresets}.
 * - {@link VolumePlugin}: glTF saving and the quality switch while moving.
 * - {@link NRRDLoadPlugin}: `.nrrd` files through the three.js `NRRDLoader`.
 * - Derived fields, computed on the GPU: {@link MinMaxBlocks}, {@link EmptySpaceMap}, {@link GradientField},
 *   {@link LightVolume} (shadows), {@link AmbientOcclusionVolume}, and
 *   {@link DerivedField} / {@link VolumeKernel} for your own.
 */
export {VolumeData} from './VolumeData'
export type {VolumeDataOptions, VolumeGpuFormat, VolumeDataEventMap} from './VolumeData'
export {VolumeMaterial} from './VolumeMaterial'
export type {VolumeRenderMode, VolumeShading, VolumeDerivedContext} from './VolumeMaterial'
export {VolumeGBufferMaterial} from './VolumeGBufferMaterial'
export {VolumeObject, defaultUnitScale} from './VolumeObject'
export type {VolumeObjectOptions, VolumeFieldLink} from './VolumeObject'
export {TransferFunction} from './TransferFunction'
export type {TransferFunctionPreset, TransferFunctionEventMap} from './TransferFunction'
export {VolumePlugin} from './VolumePlugin'
export {NRRDLoadPlugin} from './loaders/NRRDLoadPlugin'
export type {NRRDLoadOptions} from './loaders/NRRDLoadPlugin'
export {volumeGLTFExtension, VOLUME_GLTF_EXTENSION} from './gltf'
export type {VolumeGltfExtensionData} from './gltf'
export {volumePresets, registerVolumePreset, defaultVolumePresetName, colorMaps, volViewPresets} from './library'
export {parseClut, toClut, parseNiiVueColormap} from './library/transferFormats'
export type {ParsedTransferFunction, NiiVueColormap} from './library/transferFormats'
export {VolumeKernel} from './derived/VolumeKernel'
export type {VolumeKernelOptions} from './derived/VolumeKernel'
export {DerivedField} from './derived/DerivedField'
export type {DerivedFieldPass, DerivedFieldEventMap, DerivedTargetOptions} from './derived/DerivedField'
export {MinMaxBlocks} from './derived/MinMaxBlocks'
export {EmptySpaceMap} from './derived/EmptySpaceMap'
export type {EmptySpaceMode, EmptySpaceParams} from './derived/EmptySpaceMap'
export {GradientField, gradientMaxLength} from './derived/GradientField'
export {LightVolume} from './derived/LightVolume'
export type {LightVolumeParams} from './derived/LightVolume'
export {AmbientOcclusionVolume} from './derived/AmbientOcclusionVolume'
export type {AmbientOcclusionParams} from './derived/AmbientOcclusionVolume'
export type {VolumeOpacityParams} from './derived/opacityParams'
export {generateVolume, volumeNoiseGLSL} from './procedural'
export {TransferFunctionEditor} from './ui/TransferFunctionEditor'
export type {TransferFunctionEditorOptions, TransferFunctionEditorUndo} from './ui/TransferFunctionEditor'
export type {ProceduralVolumeOptions} from './procedural'
