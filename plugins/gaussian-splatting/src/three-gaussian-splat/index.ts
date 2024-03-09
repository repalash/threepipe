/**
 * ThreeGaussianSplatPlugin: Threejs utilities and threepipe plugin and material extension for Gaussian Splatting
 *
 * @license
 * A port of -
 * https://github.com/zappar-xr/three-gaussian-splat
 * MIT License (c) 2023 Zappar Limited
 * Which is based on -
 * gsplat.js, MIT License (c) 2023 Dylan Ebert
 * antimatter15/splat, MIT License (c) 2023 Kevin Kwok
 */

export {GaussianSplatMaterialExtension} from './materials/GaussianSplatMaterialExtension'
export {GaussianSplatMaterialPhysical} from './materials/GaussianSplatMaterialPhysical'
export {GaussianSplatMaterialRaw} from './materials/GaussianSplatMaterialRaw'
export {GaussianSplatMaterialUnlit} from './materials/GaussianSplatMaterialUnlit'
export {computeFocalLengths} from './materials/util'
export {GaussianSplatGeometry} from './geometry/GaussianSplatGeometry'
export {GaussianSplatMesh} from './mesh/GaussianSplatMesh'
export {ThreeGaussianSplatPlugin} from './ThreeGaussianSplatPlugin'
export {SplatLoader} from './loaders/SplatLoader'
export {gaussianSplatShaders} from './shaders'
