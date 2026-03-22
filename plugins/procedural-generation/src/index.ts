// @threepipe/plugin-procedural-generation
// Procedural generation framework for threepipe

// Core
export {AProceduralGenerator} from './AProceduralGenerator'
export {ProceduralGeneratorPlugin} from './ProceduralGeneratorPlugin'

// Utilities
export {SeededRandom} from './utils/SeededRandom'
export {createNoise2D, createNoise3D, fbm, ridged, createVoronoi2D, createDomainWarp, type FBMOptions} from './utils/Noise'

// Geometry primitives
export * as PrimGen from './geo/PrimGen'

// Geometry operations
export * as MeshOps from './geo/MeshOps'
export * as Displace from './geo/Displace'
export * as HeightmapOps from './geo/HeightmapOps'
export * as DerivedAttributes from './geo/DerivedAttributes'
export {
    classify as classifyFaces, extractFaces,
    BUILDING_RULES, TERRAIN_RULES,
    type FaceInfo, type FaceClassification, type ClassificationRule,
} from './geo/FaceClassifier'

// Point cloud system
export type {ProcPoint, PointCloud} from './points/types'
export * as Distribute from './points/Distribute'
export * as Instance from './points/Instance'
export type {InstanceSource, InstanceRule, InstanceOptions} from './points/Instance'
export type {
    DistributeOnFacesOptions, DistributeOnGridOptions,
    DistributeAlongCurveOptions, DistributeOnWallGridOptions,
} from './points/Distribute'

// Modules & composition
export {ModuleKit, type ModuleEntry, type ModuleMeta} from './modules/ModuleKit'
export * as ForEach from './compose/ForEach'

// Generators
export {TerrainGenerator, type TerrainParams} from './generators/TerrainGenerator'
export {VegetationScatterGenerator, type VegetationScatterParams} from './generators/VegetationScatterGenerator'
export {BuildingGenerator, type BuildingParams} from './generators/BuildingGenerator'
