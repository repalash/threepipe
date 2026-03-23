export {defineNode, defineNodeType, defineGraph, connect, applyDefaults, resolveDefault, resolveUi, isPropDef, type NodeDef, type GraphDef, type Connection, type PropDef, type InputDef, type ResolvedInputs} from './graph'
export {createRuntime, type Runtime} from './runtime'
export {graphUiConfig, nodeUiConfig} from './ui'
export {createGraphOverlay} from './visualizer'
export type {GraphModule, GraphEntry, GeneratedInstance, OutputRef} from './module'

// Blender built-in utilities (pure math, no browser deps)
export {hash1, hash2, hash3, hash_to_float1, hash_to_float2, hash_to_float3} from '../blender/noise'
export {randomInt, randomFloat, randomBool, randomVector} from '../blender/random_value'
export {
    normalizeAngle, alignEulerToEdgeNormal, pointOnSegment,
    meshToCurveSplitTrim, resampleCurve,
    meshGrid, separateGeometry, storeNamedAttribute, inputNamedAttribute,
    fromLocRotScale, joinGeometry, transformPoints,
    type CurveSegment, type Vec2, type GridPoint,
} from '../blender/geometry_nodes'
export {
    mapRange, mapRangeStepped, mapRangeSmoothstep,
    clamp, mixFloat, mixVector,
    compare, compareFloat, booleanMath, mathOp,
} from '../blender/math_nodes'
