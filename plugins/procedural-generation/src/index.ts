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

// Blender built-in equivalents
export {hash1, hash2, hash3, hash_to_float1, hash_to_float2, hash_to_float3} from './blender/noise'
export {randomInt, randomFloat, randomBool, randomVector} from './blender/random_value'
export {
    normalizeAngle, alignEulerToEdgeNormal, pointOnSegment,
    meshToCurveSplitTrim, resampleCurve,
    meshGrid, separateGeometry, storeNamedAttribute, inputNamedAttribute,
    yUpToZUp, fromLocRotScale, joinGeometry, transformPoints,
    scatterToInstances, type ScatterToInstancesOptions,
    eulToMat3, axisAngleToMat3, mulMat3, mat3ToEul,
    rotateEulerAxisAngleLocal, rotateEulerAxisAngleObject,
    sampleImageTexture, colorRampLinear2, type ImageTextureData,
    interpolateScatterUVs,
    alignEulerToVectorAutoPivot,
    evaluateFloatCurve, type FloatCurvePoint,
    evaluateColorRamp, type ColorRampStop,
    type CurveSegment, type Vec2, type GridPoint,
} from './blender/geometry_nodes'
export {
    mapRange, mapRangeStepped, mapRangeSmoothstep,
    clamp, mixFloat, mixVector,
    compare, compareFloat, booleanMath, mathOp,
} from './blender/math_nodes'
export {
    distributePointsOnFaces,
    type DistributePointsOnFacesOptions,
    type DistributePointsOnFacesResult,
} from './blender/distribute_points_on_faces'
export {catmullClark, subdivisionSurface} from './blender/subdivision_surface'

// Graph system
export {defineNode, defineNodeType, defineGraph, connect, applyDefaults, resolveDefault, resolveUi, isPropDef, type NodeDef, type GraphDef, type Connection, type PropDef, type InputDef, type ResolvedInputs} from './graph/graph'
export {createRuntime, type Runtime} from './graph/runtime'
export {graphUiConfig, nodeUiConfig} from './graph/ui'
export type {GraphModule, GraphEntry, GeneratedInstance, OutputRef, ModuleData, ModuleMap} from './graph/module'
export {launchGraphViewer, loadAssets, getWorldGeometry, buildSceneFromInstances, graphVisualizerButton, type GraphViewerOptions} from './viewer/GraphViewer'

// Generators
export {TerrainGenerator, type TerrainParams} from './generators/TerrainGenerator'
export {VegetationScatterGenerator, type VegetationScatterParams} from './generators/VegetationScatterGenerator'
export {BuildingGenerator, type BuildingParams} from './generators/BuildingGenerator'
export {buildifyBuilding, buildifyToGroup, type BuildifyParams} from './generators/buildify_demo_1'
export {FlowerGenerator, type FlowerParams} from './generators/FlowerGenerator'
export {getParamsForRing, createPetalVertices, type PetalParams} from './generators/flower-math'
