export {defineNode, defineNodeType, defineGraph, connect, applyDefaults, resolveDefault, resolveUi, isPropDef, type NodeDef, type GraphDef, type Connection, type PropDef, type InputDef, type ResolvedInputs} from './graph'
export {createRuntime, type Runtime} from './runtime'
export {graphUiConfig, nodeUiConfig} from './ui'
export {createGraphOverlay} from './visualizer'
export type {GraphModule, GraphEntry, GeneratedInstance, OutputRef, ModuleData, ModuleMap} from './module'

// Blender built-in utilities (pure math, no browser deps)
export {hash1, hash2, hash3, hash_to_float1, hash_to_float2, hash_to_float3} from '../blender/noise'
export {randomInt, randomFloat, randomBool, randomVector} from '../blender/random_value'
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
} from '../blender/geometry_nodes'
export {
    mapRange, mapRangeStepped, mapRangeSmoothstep,
    clamp, mixFloat, mixVector,
    compare, compareFloat, booleanMath, mathOp,
} from '../blender/math_nodes'
export {
    distributePointsOnFaces,
    type DistributePointsOnFacesOptions,
    type DistributePointsOnFacesResult,
} from '../blender/distribute_points_on_faces'
export {catmullClark, subdivisionSurface} from '../blender/subdivision_surface'

// Point distribution & instancing (three.js types work in Node.js with polyfill)
export * as Distribute from '../points/Distribute'
export * as Instance from '../points/Instance'
export type {ProcPoint, PointCloud} from '../points/types'
export type {
    DistributeOnFacesOptions, DistributeOnGridOptions,
    DistributeAlongCurveOptions, DistributeOnWallGridOptions,
} from '../points/Distribute'

// Flower petal utilities (pure math, no browser deps)
export {getParamsForRing, createPetalVertices, type PetalParams} from '../generators/flower-math'
