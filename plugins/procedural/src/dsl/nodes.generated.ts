/* eslint-disable */
// Generated from the node registry by `npm run generate:dsl` (src/dsl/generateTypes.ts). Do not edit.

import type {NodeHandle, Socket} from './builder'
import type {IDRef, SocketType} from '../runtime/types'

type Vec3 = [number, number, number]
type Vec4 = [number, number, number, number]

/** Socket types Blender converts implicitly into each socket type (`isConvertible`). */
export interface ConvertibleTo {
    GEOMETRY: "GEOMETRY"
    FLOAT: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA"
    INT: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA"
    BOOLEAN: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA"
    VECTOR: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION"
    RGBA: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA"
    ROTATION: "FLOAT" | "VECTOR" | "ROTATION" | "MATRIX"
    MATRIX: "ROTATION" | "MATRIX"
    STRING: "STRING"
    MENU: "MENU"
    OBJECT: "OBJECT"
    COLLECTION: "COLLECTION"
    MATERIAL: "MATERIAL"
    IMAGE: "IMAGE"
    TEXTURE: "TEXTURE"
    BUNDLE: "BUNDLE"
    CLOSURE: "CLOSURE"
    CUSTOM: "CUSTOM"
}

/** What an input of socket type `T` accepts: a linked socket of a convertible type, or a value. */
export type In<T extends SocketType> = Socket<ConvertibleTo[T]> | (T extends keyof Literals ? Literals[T] : never)

interface Literals {
    FLOAT: number
    INT: number
    BOOLEAN: boolean | number
    VECTOR: number | Vec3
    RGBA: number | Vec3 | Vec4
    ROTATION: Vec3
    STRING: string
    MENU: string
    OBJECT: IDRef | null
    COLLECTION: IDRef | null
    MATERIAL: IDRef | null
    IMAGE: IDRef | null
    TEXTURE: IDRef | null
}

/** `FunctionNodeAlignEulerToVector` (Align Euler to Vector). */
export interface AlignEulerToVectorArgs {
    axis?: "X" | "Y" | "Z"
    pivotAxis?: "AUTO" | "X" | "Y" | "Z"
    rotation?: In<"VECTOR">
    factor?: In<"FLOAT">
    vector?: In<"VECTOR">
    mute?: boolean
}
export type AlignEulerToVectorNode = NodeHandle & {
    readonly rotation: Socket<"VECTOR">
}

/** `FunctionNodeAlignRotationToVector` (Align Rotation to Vector). */
export interface AlignRotationToVectorArgs {
    axis?: "X" | "Y" | "Z"
    pivotAxis?: "AUTO" | "X" | "Y" | "Z"
    rotation?: In<"ROTATION">
    factor?: In<"FLOAT">
    vector?: In<"VECTOR">
    mute?: boolean
}
export type AlignRotationToVectorNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `GeometryNodeAttributeStatistic` (Attribute Statistic). */
export interface AttributeStatisticArgs {
    dataType?: "FLOAT" | "FLOAT_VECTOR"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    attribute?: (In<"FLOAT"> | In<"VECTOR">)
    mute?: boolean
}
export type AttributeStatisticNode = NodeHandle & {
    readonly mean: Socket<"FLOAT" | "VECTOR">
    readonly median: Socket<"FLOAT" | "VECTOR">
    readonly sum: Socket<"FLOAT" | "VECTOR">
    readonly min: Socket<"FLOAT" | "VECTOR">
    readonly max: Socket<"FLOAT" | "VECTOR">
    readonly range: Socket<"FLOAT" | "VECTOR">
    readonly standardDeviation: Socket<"FLOAT" | "VECTOR">
    readonly variance: Socket<"FLOAT" | "VECTOR">
}

/** `FunctionNodeAxisAngleToRotation` (Axis Angle to Rotation). */
export interface AxisAngleToRotationArgs {
    axis?: In<"VECTOR">
    angle?: In<"FLOAT">
    mute?: boolean
}
export type AxisAngleToRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `FunctionNodeInputBool` (Boolean). */
export interface BooleanArgs {
    boolean?: boolean
    mute?: boolean
}
export type BooleanNode = NodeHandle & {
    readonly boolean: Socket<"BOOLEAN">
}

/** `FunctionNodeBooleanMath` (Boolean Math). */
export interface BooleanMathArgs {
    operation?: "AND" | "OR" | "NOT" | "NAND" | "NOR" | "XNOR" | "XOR" | "IMPLY" | "NIMPLY"
    boolean?: In<"BOOLEAN">
    boolean1?: In<"BOOLEAN">
    mute?: boolean
}
export type BooleanMathNode = NodeHandle & {
    readonly boolean: Socket<"BOOLEAN">
}

/** `GeometryNodeBoundBox` (Bounding Box). */
export interface BoundingBoxArgs {
    geometry?: In<"GEOMETRY">
    useRadius?: In<"BOOLEAN">
    mute?: boolean
}
export type BoundingBoxNode = NodeHandle & {
    readonly boundingBox: Socket<"GEOMETRY">
    readonly min: Socket<"VECTOR">
    readonly max: Socket<"VECTOR">
}

/** `GeometryNodeCaptureAttribute` (Capture Attribute). */
export interface CaptureAttributeArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    activeIndex?: number
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    extend?: In<"CUSTOM">
    ""?: In<"CUSTOM">
    mute?: boolean
}
export type CaptureAttributeNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly selection: Socket<"BOOLEAN">
    readonly extend: Socket<"CUSTOM">
    readonly "": Socket<"CUSTOM">
}

/** `ShaderNodeClamp` (Clamp). */
export interface ClampArgs {
    clampType?: "MINMAX" | "RANGE"
    value?: In<"FLOAT">
    min?: In<"FLOAT">
    max?: In<"FLOAT">
    mute?: boolean
}
export type ClampNode = NodeHandle & {
    readonly result: Socket<"FLOAT">
}

/** `GeometryNodeCollectionInfo` (Collection Info). */
export interface CollectionInfoArgs {
    transformSpace?: "ORIGINAL" | "RELATIVE"
    collection?: In<"COLLECTION">
    separateChildren?: In<"BOOLEAN">
    resetChildren?: In<"BOOLEAN">
    mute?: boolean
}
export type CollectionInfoNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `FunctionNodeInputColor` (Color). */
export interface ColorArgs {
    value?: unknown
    mute?: boolean
}
export type ColorNode = NodeHandle & {
    readonly color: Socket<"RGBA">
}

/** `ShaderNodeValToRGB` (Color Ramp). */
export interface ColorRampArgs {
    fac?: In<"FLOAT">
    factor?: In<"FLOAT">
    mute?: boolean
}
export type ColorRampNode = NodeHandle & {
    readonly color: Socket<"RGBA">
    readonly alpha: Socket<"FLOAT">
}

/** `FunctionNodeCombineColor` (Combine Color). */
export interface CombineColorArgs {
    mode?: "RGB" | "HSV" | "HSL"
    red?: In<"FLOAT">
    green?: In<"FLOAT">
    blue?: In<"FLOAT">
    alpha?: In<"FLOAT">
    mute?: boolean
}
export type CombineColorNode = NodeHandle & {
    readonly color: Socket<"RGBA">
}

/** `FunctionNodeCombineTransform` (Combine Transform). */
export interface CombineTransformArgs {
    translation?: In<"VECTOR">
    rotation?: In<"ROTATION">
    scale?: In<"VECTOR">
    mute?: boolean
}
export type CombineTransformNode = NodeHandle & {
    readonly transform: Socket<"MATRIX">
}

/** `ShaderNodeCombineXYZ` (Combine XYZ). */
export interface CombineXYZArgs {
    x?: In<"FLOAT">
    y?: In<"FLOAT">
    z?: In<"FLOAT">
    mute?: boolean
}
export type CombineXYZNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
}

/** `FunctionNodeCompare` (Compare). */
export interface CompareArgs {
    operation?: "LESS_THAN" | "LESS_EQUAL" | "GREATER_THAN" | "GREATER_EQUAL" | "EQUAL" | "NOT_EQUAL" | "BRIGHTER" | "DARKER"
    dataType?: "FLOAT" | "INT" | "VECTOR" | "RGBA" | "STRING" | "OBJECT" | "IMAGE" | "COLLECTION" | "MATERIAL" | "FONT" | "SOUND"
    mode?: "ELEMENT" | "LENGTH" | "AVERAGE" | "DOT_PRODUCT" | "DIRECTION"
    a?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR"> | In<"RGBA"> | In<"STRING"> | In<"OBJECT"> | In<"IMAGE"> | In<"COLLECTION"> | In<"MATERIAL">)
    b?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR"> | In<"RGBA"> | In<"STRING"> | In<"OBJECT"> | In<"IMAGE"> | In<"COLLECTION"> | In<"MATERIAL">)
    c?: In<"FLOAT">
    angle?: In<"FLOAT">
    epsilon?: In<"FLOAT">
    mute?: boolean
}
export type CompareNode = NodeHandle & {
    readonly result: Socket<"BOOLEAN">
}

/** `GeometryNodeDeleteGeometry` (Delete Geometry). */
export interface DeleteGeometryArgs {
    mode?: "ALL" | "EDGE_FACE" | "ONLY_FACE"
    domain?: "POINT" | "EDGE" | "FACE" | "CURVE" | "INSTANCE" | "LAYER"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type DeleteGeometryNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeDistributePointsOnFaces` (Distribute Points on Faces). */
export interface DistributePointsOnFacesArgs {
    distributeMethod?: "RANDOM" | "POISSON"
    useLegacyNormal?: boolean
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    density?: In<"FLOAT">
    seed?: In<"INT">
    distanceMin?: In<"FLOAT">
    densityMax?: In<"FLOAT">
    densityFactor?: In<"FLOAT">
    mute?: boolean
}
export type DistributePointsOnFacesNode = NodeHandle & {
    readonly points: Socket<"GEOMETRY">
    readonly normal: Socket<"VECTOR">
    readonly rotation: Socket<"ROTATION">
}

/** `GeometryNodeDuplicateElements` (Duplicate Elements). */
export interface DuplicateElementsArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "SPLINE" | "LAYER" | "INSTANCE"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    amount?: In<"INT">
    mute?: boolean
}
export type DuplicateElementsNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly duplicateIndex: Socket<"INT">
}

/** `GeometryNodeInputMeshEdgeAngle` (Edge Angle). */
export interface EdgeAngleArgs {
    mute?: boolean
}
export type EdgeAngleNode = NodeHandle & {
    readonly unsignedAngle: Socket<"FLOAT">
    readonly signedAngle: Socket<"FLOAT">
}

/** `GeometryNodeInputMeshEdgeNeighbors` (Edge Neighbors). */
export interface EdgeNeighborsArgs {
    mute?: boolean
}
export type EdgeNeighborsNode = NodeHandle & {
    readonly faceCount: Socket<"INT">
}

/** `GeometryNodeInputMeshEdgeVertices` (Edge Vertices). */
export interface EdgeVerticesArgs {
    mute?: boolean
}
export type EdgeVerticesNode = NodeHandle & {
    readonly vertexIndex1: Socket<"INT">
    readonly vertexIndex2: Socket<"INT">
    readonly position1: Socket<"VECTOR">
    readonly position2: Socket<"VECTOR">
}

/** `FunctionNodeEulerToRotation` (Euler to Rotation). */
export interface EulerToRotationArgs {
    euler?: In<"VECTOR">
    mute?: boolean
}
export type EulerToRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `GeometryNodeExtrudeMesh` (Extrude Mesh). */
export interface ExtrudeMeshArgs {
    mode?: "VERTICES" | "EDGES" | "FACES"
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    offset?: In<"VECTOR">
    offsetScale?: In<"FLOAT">
    individual?: In<"BOOLEAN">
    mute?: boolean
}
export type ExtrudeMeshNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly top: Socket<"BOOLEAN">
    readonly side: Socket<"BOOLEAN">
}

/** `GeometryNodeInputMeshFaceArea` (Face Area). */
export interface FaceAreaArgs {
    mute?: boolean
}
export type FaceAreaNode = NodeHandle & {
    readonly area: Socket<"FLOAT">
}

/** `GeometryNodeInputMeshFaceNeighbors` (Face Neighbors). */
export interface FaceNeighborsArgs {
    mute?: boolean
}
export type FaceNeighborsNode = NodeHandle & {
    readonly vertexCount: Socket<"INT">
    readonly faceCount: Socket<"INT">
}

/** `ShaderNodeFloatCurve` (Float Curve). */
export interface FloatCurveArgs {
    factor?: In<"FLOAT">
    value?: In<"FLOAT">
    mute?: boolean
}
export type FloatCurveNode = NodeHandle & {
    readonly value: Socket<"FLOAT">
}

/** `GeometryNodeGeometryToInstance` (Geometry to Instance). */
export interface GeometryToInstanceArgs {
    geometry?: In<"GEOMETRY"> | In<"GEOMETRY">[]
    mute?: boolean
}
export type GeometryToInstanceNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `ShaderNodeTexGradient` (Gradient Texture). */
export interface GradientTextureArgs {
    gradientType?: "LINEAR" | "QUADRATIC" | "EASING" | "DIAGONAL" | "SPHERICAL" | "QUADRATIC_SPHERE" | "RADIAL"
    vector?: In<"VECTOR">
    mute?: boolean
}
export type GradientTextureNode = NodeHandle & {
    readonly color: Socket<"RGBA">
    readonly fac: Socket<"FLOAT">
    readonly factor: Socket<"FLOAT">
}

/** `FunctionNodeHashValue` (Hash Value). */
export interface HashValueArgs {
    dataType?: "FLOAT" | "INT" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING"
    value?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING">)
    seed?: In<"INT">
    mute?: boolean
}
export type HashValueNode = NodeHandle & {
    readonly hash: Socket<"INT">
}

/** `GeometryNodeInputID` (ID). */
export interface IDArgs {
    mute?: boolean
}
export type IDNode = NodeHandle & {
    readonly iD: Socket<"INT">
}

/** `GeometryNodeImageTexture` (Image Texture). */
export interface ImageTextureArgs {
    interpolation?: "Linear" | "Closest" | "Cubic"
    extension?: "REPEAT" | "EXTEND" | "CLIP" | "MIRROR"
    image?: In<"IMAGE">
    vector?: In<"VECTOR">
    frame?: In<"INT">
    mute?: boolean
}
export type ImageTextureNode = NodeHandle & {
    readonly color: Socket<"RGBA">
    readonly alpha: Socket<"FLOAT">
}

/** `GeometryNodeInputIndex` (Index). */
export interface IndexArgs {
    mute?: boolean
}
export type IndexNode = NodeHandle & {
    readonly index: Socket<"INT">
}

/** `GeometryNodeIndexSwitch` (Index Switch). */
export interface IndexSwitchArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL" | "BUNDLE" | "CLOSURE" | "FONT" | "SOUND"
    index?: In<"INT">
    item0?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    "0"?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    item1?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    "1"?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    extend?: In<"CUSTOM">
    ""?: In<"CUSTOM">
    mute?: boolean
}
export type IndexSwitchNode = NodeHandle & {
    readonly output: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL" | "BUNDLE" | "CLOSURE">
}

/** `GeometryNodeInstanceOnPoints` (Instance on Points). */
export interface InstanceOnPointsArgs {
    points?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    instance?: In<"GEOMETRY">
    pickInstance?: In<"BOOLEAN">
    instanceIndex?: In<"INT">
    rotation?: In<"ROTATION">
    scale?: In<"VECTOR">
    mute?: boolean
}
export type InstanceOnPointsNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `GeometryNodeInstancesToPoints` (Instances to Points). */
export interface InstancesToPointsArgs {
    instances?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    position?: In<"VECTOR">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type InstancesToPointsNode = NodeHandle & {
    readonly points: Socket<"GEOMETRY">
}

/** `FunctionNodeInputInt` (Integer). */
export interface IntegerArgs {
    integer?: number
    mute?: boolean
}
export type IntegerNode = NodeHandle & {
    readonly integer: Socket<"INT">
}

/** `FunctionNodeIntegerMath` (Integer Math). */
export interface IntegerMathArgs {
    operation?: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "MULTIPLY_ADD" | "ABSOLUTE" | "NEGATE" | "POWER" | "MINIMUM" | "MAXIMUM" | "SIGN" | "DIVIDE_ROUND" | "DIVIDE_FLOOR" | "DIVIDE_CEIL" | "FLOORED_MODULO" | "MODULO" | "GCD" | "LCM"
    value?: In<"INT">
    value1?: In<"INT">
    value2?: In<"INT">
    mute?: boolean
}
export type IntegerMathNode = NodeHandle & {
    readonly value: Socket<"INT">
}

/** `FunctionNodeInvertMatrix` (Invert Matrix). */
export interface InvertMatrixArgs {
    matrix?: In<"MATRIX">
    mute?: boolean
}
export type InvertMatrixNode = NodeHandle & {
    readonly matrix: Socket<"MATRIX">
    readonly invertible: Socket<"BOOLEAN">
}

/** `FunctionNodeInvertRotation` (Invert Rotation). */
export interface InvertRotationArgs {
    rotation?: In<"ROTATION">
    mute?: boolean
}
export type InvertRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `GeometryNodeInputEdgeSmooth` (Is Edge Smooth). */
export interface IsEdgeSmoothArgs {
    mute?: boolean
}
export type IsEdgeSmoothNode = NodeHandle & {
    readonly smooth: Socket<"BOOLEAN">
}

/** `GeometryNodeInputMeshFaceIsPlanar` (Is Face Planar). */
export interface IsFacePlanarArgs {
    threshold?: In<"FLOAT">
    mute?: boolean
}
export type IsFacePlanarNode = NodeHandle & {
    readonly planar: Socket<"BOOLEAN">
}

/** `GeometryNodeInputShadeSmooth` (Is Face Smooth). */
export interface IsFaceSmoothArgs {
    mute?: boolean
}
export type IsFaceSmoothNode = NodeHandle & {
    readonly smooth: Socket<"BOOLEAN">
}

/** `GeometryNodeJoinGeometry` (Join Geometry). */
export interface JoinGeometryArgs {
    geometry?: In<"GEOMETRY"> | In<"GEOMETRY">[]
    mute?: boolean
}
export type JoinGeometryNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `ShaderNodeMapRange` (Map Range). */
export interface MapRangeArgs {
    clamp?: boolean
    interpolationType?: "LINEAR" | "STEPPED" | "SMOOTHSTEP" | "SMOOTHERSTEP"
    dataType?: "FLOAT" | "FLOAT_VECTOR"
    value?: In<"FLOAT">
    fromMin?: (In<"FLOAT"> | In<"VECTOR">)
    fromMax?: (In<"FLOAT"> | In<"VECTOR">)
    toMin?: (In<"FLOAT"> | In<"VECTOR">)
    toMax?: (In<"FLOAT"> | In<"VECTOR">)
    vector?: In<"VECTOR">
    fromMinFLOAT3?: In<"VECTOR">
    fromMaxFLOAT3?: In<"VECTOR">
    toMinFLOAT3?: In<"VECTOR">
    toMaxFLOAT3?: In<"VECTOR">
    steps?: (In<"FLOAT"> | In<"VECTOR">)
    stepsFLOAT3?: In<"VECTOR">
    mute?: boolean
}
export type MapRangeNode = NodeHandle & {
    readonly result: Socket<"FLOAT">
    readonly vector: Socket<"VECTOR">
}

/** `GeometryNodeInputMaterialIndex` (Material Index). */
export interface MaterialIndexArgs {
    mute?: boolean
}
export type MaterialIndexNode = NodeHandle & {
    readonly materialIndex: Socket<"INT">
}

/** `ShaderNodeMath` (Math). */
export interface MathArgs {
    operation?: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "MULTIPLY_ADD" | "POWER" | "LOGARITHM" | "SQRT" | "INVERSE_SQRT" | "ABSOLUTE" | "EXPONENT" | "MINIMUM" | "MAXIMUM" | "LESS_THAN" | "GREATER_THAN" | "SIGN" | "COMPARE" | "SMOOTH_MIN" | "SMOOTH_MAX" | "ROUND" | "FLOOR" | "CEIL" | "TRUNC" | "FRACT" | "MODULO" | "FLOORED_MODULO" | "WRAP" | "SNAP" | "PINGPONG" | "SINE" | "COSINE" | "TANGENT" | "ARCSINE" | "ARCCOSINE" | "ARCTANGENT" | "ARCTAN2" | "SINH" | "COSH" | "TANH" | "RADIANS" | "DEGREES"
    useClamp?: boolean
    value?: In<"FLOAT">
    value1?: In<"FLOAT">
    value2?: In<"FLOAT">
    mute?: boolean
}
export type MathNode = NodeHandle & {
    readonly value: Socket<"FLOAT">
}

/** `GeometryNodeMenuSwitch` (Menu Switch). */
export interface MenuSwitchArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL" | "BUNDLE" | "CLOSURE" | "FONT" | "SOUND"
    activeIndex?: number
    menu?: In<"MENU">
    item0?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    a?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    item1?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    b?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    extend?: In<"CUSTOM">
    ""?: In<"CUSTOM">
    mute?: boolean
}
export type MenuSwitchNode = NodeHandle & {
    readonly output: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL" | "BUNDLE" | "CLOSURE">
    readonly item0: Socket<"BOOLEAN">
    readonly a: Socket<"BOOLEAN">
    readonly item1: Socket<"BOOLEAN">
    readonly b: Socket<"BOOLEAN">
}

/** `GeometryNodeMergeByDistance` (Merge by Distance). */
export interface MergeByDistanceArgs {
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mode?: In<"MENU">
    distance?: In<"FLOAT">
    mute?: boolean
}
export type MergeByDistanceNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeMeshCircle` (Mesh Circle). */
export interface MeshCircleArgs {
    fillType?: "NONE" | "NGON" | "TRIANGLE_FAN"
    vertices?: In<"INT">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type MeshCircleNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeMeshCone` (Cone). */
export interface MeshConeArgs {
    fillType?: "NONE" | "NGON" | "TRIANGLE_FAN"
    vertices?: In<"INT">
    sideSegments?: In<"INT">
    radiusTop?: In<"FLOAT">
    radiusBottom?: In<"FLOAT">
    depth?: In<"FLOAT">
    fillSegments?: In<"INT">
    mute?: boolean
}
export type MeshConeNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly top: Socket<"BOOLEAN">
    readonly bottom: Socket<"BOOLEAN">
    readonly side: Socket<"BOOLEAN">
    readonly uVMap: Socket<"VECTOR">
}

/** `GeometryNodeMeshCube` (Cube). */
export interface MeshCubeArgs {
    size?: In<"VECTOR">
    verticesX?: In<"INT">
    verticesY?: In<"INT">
    verticesZ?: In<"INT">
    mute?: boolean
}
export type MeshCubeNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly uVMap: Socket<"VECTOR">
}

/** `GeometryNodeMeshCylinder` (Cylinder). */
export interface MeshCylinderArgs {
    fillType?: "NONE" | "NGON" | "TRIANGLE_FAN"
    vertices?: In<"INT">
    sideSegments?: In<"INT">
    radius?: In<"FLOAT">
    depth?: In<"FLOAT">
    fillSegments?: In<"INT">
    mute?: boolean
}
export type MeshCylinderNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly top: Socket<"BOOLEAN">
    readonly side: Socket<"BOOLEAN">
    readonly bottom: Socket<"BOOLEAN">
    readonly uVMap: Socket<"VECTOR">
}

/** `GeometryNodeMeshGrid` (Grid). */
export interface MeshGridArgs {
    sizeX?: In<"FLOAT">
    sizeY?: In<"FLOAT">
    verticesX?: In<"INT">
    verticesY?: In<"INT">
    mute?: boolean
}
export type MeshGridNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly uVMap: Socket<"VECTOR">
}

/** `GeometryNodeInputMeshIsland` (Mesh Island). */
export interface MeshIslandArgs {
    mute?: boolean
}
export type MeshIslandNode = NodeHandle & {
    readonly islandIndex: Socket<"INT">
    readonly islandCount: Socket<"INT">
}

/** `GeometryNodeMeshLine` (Mesh Line). */
export interface MeshLineArgs {
    mode?: "OFFSET" | "END_POINTS"
    countMode?: "TOTAL" | "RESOLUTION"
    count?: In<"INT">
    startLocation?: In<"VECTOR">
    offset?: In<"VECTOR">
    resolution?: In<"FLOAT">
    mute?: boolean
}
export type MeshLineNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeMeshToPoints` (Mesh to Points). */
export interface MeshToPointsArgs {
    mode?: "VERTICES" | "EDGES" | "FACES" | "CORNERS"
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    position?: In<"VECTOR">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type MeshToPointsNode = NodeHandle & {
    readonly points: Socket<"GEOMETRY">
}

/** `GeometryNodeMeshUVSphere` (UV Sphere). */
export interface MeshUVSphereArgs {
    segments?: In<"INT">
    rings?: In<"INT">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type MeshUVSphereNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly uVMap: Socket<"VECTOR">
}

/** `ShaderNodeMix` (Mix). */
export interface MixArgs {
    dataType?: "FLOAT" | "VECTOR" | "RGBA" | "ROTATION"
    factorMode?: "UNIFORM" | "NON_UNIFORM"
    blendType?: "MIX" | "DARKEN" | "MULTIPLY" | "BURN" | "LIGHTEN" | "SCREEN" | "DODGE" | "ADD" | "OVERLAY" | "SOFT_LIGHT" | "LINEAR_LIGHT" | "DIFFERENCE" | "EXCLUSION" | "SUBTRACT" | "DIVIDE" | "HUE" | "SATURATION" | "COLOR" | "VALUE"
    clampFactor?: boolean
    clampResult?: boolean
    factorFloat?: In<"FLOAT">
    factor?: (In<"FLOAT"> | In<"VECTOR">)
    aFloat?: In<"FLOAT">
    a?: (In<"FLOAT"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION">)
    bFloat?: In<"FLOAT">
    b?: (In<"FLOAT"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION">)
    aVector?: In<"VECTOR">
    bVector?: In<"VECTOR">
    factorVector?: In<"VECTOR">
    aColor?: In<"RGBA">
    bColor?: In<"RGBA">
    aRotation?: In<"ROTATION">
    bRotation?: In<"ROTATION">
    mute?: boolean
}
export type MixNode = NodeHandle & {
    readonly resultFloat: Socket<"FLOAT">
    readonly result: Socket<"FLOAT" | "VECTOR" | "RGBA" | "ROTATION">
    readonly resultVector: Socket<"VECTOR">
    readonly resultColor: Socket<"RGBA">
    readonly resultRotation: Socket<"ROTATION">
}

/** `FunctionNodeMatrixMultiply` (Multiply Matrices). */
export interface MultiplyMatricesArgs {
    matrix?: In<"MATRIX">
    matrix1?: In<"MATRIX">
    mute?: boolean
}
export type MultiplyMatricesNode = NodeHandle & {
    readonly matrix: Socket<"MATRIX">
}

/** `GeometryNodeInputNamedAttribute` (Named Attribute). */
export interface NamedAttributeArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    name?: In<"STRING">
    mute?: boolean
}
export type NamedAttributeNode = NodeHandle & {
    readonly attribute: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
    readonly exists: Socket<"BOOLEAN">
}

/** `ShaderNodeTexNoise` (Noise Texture). */
export interface NoiseTextureArgs {
    noiseDimensions?: "1D" | "2D" | "3D" | "4D"
    noiseType?: "MULTIFRACTAL" | "RIDGED_MULTIFRACTAL" | "HYBRID_MULTIFRACTAL" | "FBM" | "HETERO_TERRAIN"
    normalize?: boolean
    w?: In<"FLOAT">
    scale?: In<"FLOAT">
    detail?: In<"FLOAT">
    roughness?: In<"FLOAT">
    lacunarity?: In<"FLOAT">
    distortion?: In<"FLOAT">
    offset?: In<"FLOAT">
    gain?: In<"FLOAT">
    vector?: In<"VECTOR">
    mute?: boolean
}
export type NoiseTextureNode = NodeHandle & {
    readonly fac: Socket<"FLOAT">
    readonly factor: Socket<"FLOAT">
    readonly color: Socket<"RGBA">
}

/** `GeometryNodeInputNormal` (Normal). */
export interface NormalArgs {
    legacyCornerNormals?: boolean
    mute?: boolean
}
export type NormalNode = NodeHandle & {
    readonly normal: Socket<"VECTOR">
    readonly trueNormal: Socket<"VECTOR">
}

/** `GeometryNodeObjectInfo` (Object Info). */
export interface ObjectInfoArgs {
    transformSpace?: "ORIGINAL" | "RELATIVE"
    object?: In<"OBJECT">
    asInstance?: In<"BOOLEAN">
    mute?: boolean
}
export type ObjectInfoNode = NodeHandle & {
    readonly transform: Socket<"MATRIX">
    readonly location: Socket<"VECTOR">
    readonly rotation: Socket<"ROTATION">
    readonly scale: Socket<"VECTOR">
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodePoints` (Points). */
export interface PointsArgs {
    count?: In<"INT">
    position?: In<"VECTOR">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type PointsNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly points: Socket<"GEOMETRY">
}

/** `GeometryNodePointsToVertices` (Points to Vertices). */
export interface PointsToVerticesArgs {
    points?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type PointsToVerticesNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeInputPosition` (Position). */
export interface PositionArgs {
    mute?: boolean
}
export type PositionNode = NodeHandle & {
    readonly position: Socket<"VECTOR">
}

/** `FunctionNodeQuaternionToRotation` (Quaternion to Rotation). */
export interface QuaternionToRotationArgs {
    w?: In<"FLOAT">
    x?: In<"FLOAT">
    y?: In<"FLOAT">
    z?: In<"FLOAT">
    mute?: boolean
}
export type QuaternionToRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `FunctionNodeRandomValue` (Random Value). */
export interface RandomValueArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR"
    min?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR">)
    max?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR">)
    iD?: In<"INT">
    seed?: In<"INT">
    probability?: In<"FLOAT">
    mute?: boolean
}
export type RandomValueNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR">
}

/** `GeometryNodeRealizeInstances` (Realize Instances). */
export interface RealizeInstancesArgs {
    realizeToPointDomain?: boolean
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    realizeAll?: In<"BOOLEAN">
    depth?: In<"INT">
    mute?: boolean
}
export type RealizeInstancesNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeRemoveAttribute` (Remove Named Attribute). */
export interface RemoveNamedAttributeArgs {
    geometry?: In<"GEOMETRY">
    patternMode?: In<"MENU">
    name?: In<"STRING">
    mute?: boolean
}
export type RemoveNamedAttributeNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `FunctionNodeRotateEuler` (Rotate Euler). */
export interface RotateEulerArgs {
    rotationType?: "AXIS_ANGLE" | "EULER"
    space?: "OBJECT" | "LOCAL"
    rotation?: In<"VECTOR">
    axis?: In<"VECTOR">
    angle?: In<"FLOAT">
    rotateBy?: In<"VECTOR">
    mute?: boolean
}
export type RotateEulerNode = NodeHandle & {
    readonly rotation: Socket<"VECTOR">
}

/** `GeometryNodeRotateInstances` (Rotate Instances). */
export interface RotateInstancesArgs {
    instances?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    rotation?: In<"ROTATION">
    pivotPoint?: In<"VECTOR">
    localSpace?: In<"BOOLEAN">
    mute?: boolean
}
export type RotateInstancesNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `FunctionNodeRotateRotation` (Rotate Rotation). */
export interface RotateRotationArgs {
    rotationSpace?: "GLOBAL" | "LOCAL"
    rotation?: In<"ROTATION">
    rotateBy?: In<"ROTATION">
    mute?: boolean
}
export type RotateRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `FunctionNodeRotateVector` (Rotate Vector). */
export interface RotateVectorArgs {
    vector?: In<"VECTOR">
    rotation?: In<"ROTATION">
    mute?: boolean
}
export type RotateVectorNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
}

/** `FunctionNodeInputRotation` (Rotation). */
export interface RotationArgs {
    rotationEuler?: unknown
    mute?: boolean
}
export type RotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `FunctionNodeRotationToAxisAngle` (Rotation to Axis Angle). */
export interface RotationToAxisAngleArgs {
    rotation?: In<"ROTATION">
    mute?: boolean
}
export type RotationToAxisAngleNode = NodeHandle & {
    readonly axis: Socket<"VECTOR">
    readonly angle: Socket<"FLOAT">
}

/** `FunctionNodeRotationToEuler` (Rotation to Euler). */
export interface RotationToEulerArgs {
    rotation?: In<"ROTATION">
    mute?: boolean
}
export type RotationToEulerNode = NodeHandle & {
    readonly euler: Socket<"VECTOR">
}

/** `FunctionNodeRotationToQuaternion` (Rotation to Quaternion). */
export interface RotationToQuaternionArgs {
    rotation?: In<"ROTATION">
    mute?: boolean
}
export type RotationToQuaternionNode = NodeHandle & {
    readonly w: Socket<"FLOAT">
    readonly x: Socket<"FLOAT">
    readonly y: Socket<"FLOAT">
    readonly z: Socket<"FLOAT">
}

/** `GeometryNodeSampleIndex` (Sample Index). */
export interface SampleIndexArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    clamp?: boolean
    geometry?: In<"GEOMETRY">
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    index?: In<"INT">
    mute?: boolean
}
export type SampleIndexNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
}

/** `GeometryNodeSampleNearest` (Sample Nearest). */
export interface SampleNearestArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER"
    geometry?: In<"GEOMETRY">
    samplePosition?: In<"VECTOR">
    mute?: boolean
}
export type SampleNearestNode = NodeHandle & {
    readonly index: Socket<"INT">
}

/** `GeometryNodeSampleNearestSurface` (Sample Nearest Surface). */
export interface SampleNearestSurfaceArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    mesh?: In<"GEOMETRY">
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    groupID?: In<"INT">
    samplePosition?: In<"VECTOR">
    sampleGroupID?: In<"INT">
    mute?: boolean
}
export type SampleNearestSurfaceNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
    readonly isValid: Socket<"BOOLEAN">
}

/** `GeometryNodeScaleInstances` (Scale Instances). */
export interface ScaleInstancesArgs {
    instances?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    scale?: In<"VECTOR">
    center?: In<"VECTOR">
    localSpace?: In<"BOOLEAN">
    mute?: boolean
}
export type ScaleInstancesNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `FunctionNodeSeparateColor` (Separate Color). */
export interface SeparateColorArgs {
    mode?: "RGB" | "HSV" | "HSL"
    color?: In<"RGBA">
    mute?: boolean
}
export type SeparateColorNode = NodeHandle & {
    readonly red: Socket<"FLOAT">
    readonly green: Socket<"FLOAT">
    readonly blue: Socket<"FLOAT">
    readonly alpha: Socket<"FLOAT">
}

/** `GeometryNodeSeparateGeometry` (Separate Geometry). */
export interface SeparateGeometryArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CURVE" | "INSTANCE" | "LAYER"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type SeparateGeometryNode = NodeHandle & {
    readonly selection: Socket<"GEOMETRY">
    readonly inverted: Socket<"GEOMETRY">
}

/** `FunctionNodeSeparateTransform` (Separate Transform). */
export interface SeparateTransformArgs {
    transform?: In<"MATRIX">
    mute?: boolean
}
export type SeparateTransformNode = NodeHandle & {
    readonly translation: Socket<"VECTOR">
    readonly rotation: Socket<"ROTATION">
    readonly scale: Socket<"VECTOR">
}

/** `ShaderNodeSeparateXYZ` (Separate XYZ). */
export interface SeparateXYZArgs {
    vector?: In<"VECTOR">
    mute?: boolean
}
export type SeparateXYZNode = NodeHandle & {
    readonly x: Socket<"FLOAT">
    readonly y: Socket<"FLOAT">
    readonly z: Socket<"FLOAT">
}

/** `GeometryNodeSetID` (Set ID). */
export interface SetIDArgs {
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    iD?: In<"INT">
    mute?: boolean
}
export type SetIDNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSetMaterial` (Set Material). */
export interface SetMaterialArgs {
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    material?: In<"MATERIAL">
    mute?: boolean
}
export type SetMaterialNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSetMaterialIndex` (Set Material Index). */
export interface SetMaterialIndexArgs {
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    materialIndex?: In<"INT">
    mute?: boolean
}
export type SetMaterialIndexNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSetPosition` (Set Position). */
export interface SetPositionArgs {
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    position?: In<"VECTOR">
    offset?: In<"VECTOR">
    mute?: boolean
}
export type SetPositionNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSetShadeSmooth` (Set Shade Smooth). */
export interface SetShadeSmoothArgs {
    domain?: "EDGE" | "FACE"
    geometry?: In<"GEOMETRY">
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    shadeSmooth?: In<"BOOLEAN">
    mute?: boolean
}
export type SetShadeSmoothNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeSplitEdges` (Split Edges). */
export interface SplitEdgesArgs {
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type SplitEdgesNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeStoreNamedAttribute` (Store Named Attribute). */
export interface StoreNamedAttributeArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4" | "INT8" | "FLOAT2" | "FLOAT4" | "BYTE_COLOR"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    name?: In<"STRING">
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    mute?: boolean
}
export type StoreNamedAttributeNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSwitch` (Switch). */
export interface SwitchArgs {
    inputType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL" | "BUNDLE" | "CLOSURE" | "FONT" | "SOUND"
    switch?: In<"BOOLEAN">
    false?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    true?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL"> | In<"BUNDLE"> | In<"CLOSURE">)
    mute?: boolean
}
export type SwitchNode = NodeHandle & {
    readonly output: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL" | "BUNDLE" | "CLOSURE">
}

/** `FunctionNodeTransformDirection` (Transform Direction). */
export interface TransformDirectionArgs {
    direction?: In<"VECTOR">
    transform?: In<"MATRIX">
    mute?: boolean
}
export type TransformDirectionNode = NodeHandle & {
    readonly direction: Socket<"VECTOR">
}

/** `GeometryNodeTransform` (Transform Geometry). */
export interface TransformGeometryArgs {
    geometry?: In<"GEOMETRY">
    mode?: In<"MENU">
    translation?: In<"VECTOR">
    rotation?: In<"ROTATION">
    scale?: In<"VECTOR">
    transform?: In<"MATRIX">
    mute?: boolean
}
export type TransformGeometryNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `FunctionNodeTransformPoint` (Transform Point). */
export interface TransformPointArgs {
    vector?: In<"VECTOR">
    transform?: In<"MATRIX">
    mute?: boolean
}
export type TransformPointNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
}

/** `GeometryNodeTranslateInstances` (Translate Instances). */
export interface TranslateInstancesArgs {
    instances?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    translation?: In<"VECTOR">
    localSpace?: In<"BOOLEAN">
    mute?: boolean
}
export type TranslateInstancesNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `ShaderNodeValue` (Value). */
export interface ValueArgs {
    mute?: boolean
}
export type ValueNode = NodeHandle & {
    readonly value: Socket<"FLOAT">
}

/** `FunctionNodeInputVector` (Vector). */
export interface VectorArgs {
    vector?: unknown
    vectorDimensions?: number
    mute?: boolean
}
export type VectorNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
}

/** `ShaderNodeVectorMath` (Vector Math). */
export interface VectorMathArgs {
    operation?: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE" | "MULTIPLY_ADD" | "CROSS_PRODUCT" | "PROJECT" | "REFLECT" | "REFRACT" | "FACEFORWARD" | "DOT_PRODUCT" | "DISTANCE" | "LENGTH" | "SCALE" | "NORMALIZE" | "ABSOLUTE" | "POWER" | "SIGN" | "MINIMUM" | "MAXIMUM" | "ROUND" | "FLOOR" | "CEIL" | "FRACTION" | "MODULO" | "WRAP" | "SNAP" | "SINE" | "COSINE" | "TANGENT"
    vector?: In<"VECTOR">
    vector1?: In<"VECTOR">
    vector2?: In<"VECTOR">
    scale?: In<"FLOAT">
    mute?: boolean
}
export type VectorMathNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
    readonly value: Socket<"FLOAT">
}

/** `ShaderNodeVectorRotate` (Vector Rotate). */
export interface VectorRotateArgs {
    rotationType?: "AXIS_ANGLE" | "X_AXIS" | "Y_AXIS" | "Z_AXIS" | "EULER_XYZ"
    invert?: boolean
    vector?: In<"VECTOR">
    center?: In<"VECTOR">
    axis?: In<"VECTOR">
    angle?: In<"FLOAT">
    rotation?: In<"VECTOR">
    mute?: boolean
}
export type VectorRotateNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
}

/** `GeometryNodeInputMeshVertexNeighbors` (Vertex Neighbors). */
export interface VertexNeighborsArgs {
    mute?: boolean
}
export type VertexNeighborsNode = NodeHandle & {
    readonly vertexCount: Socket<"INT">
    readonly faceCount: Socket<"INT">
}

/** `ShaderNodeTexVoronoi` (Voronoi Texture). */
export interface VoronoiTextureArgs {
    voronoiDimensions?: "1D" | "2D" | "3D" | "4D"
    distance?: "EUCLIDEAN" | "MANHATTAN" | "CHEBYCHEV" | "MINKOWSKI"
    feature?: "F1" | "F2" | "SMOOTH_F1" | "DISTANCE_TO_EDGE" | "N_SPHERE_RADIUS"
    normalize?: boolean
    w?: In<"FLOAT">
    scale?: In<"FLOAT">
    detail?: In<"FLOAT">
    roughness?: In<"FLOAT">
    lacunarity?: In<"FLOAT">
    randomness?: In<"FLOAT">
    smoothness?: In<"FLOAT">
    vector?: In<"VECTOR">
    exponent?: In<"FLOAT">
    mute?: boolean
}
export type VoronoiTextureNode = NodeHandle & {
    readonly distance: Socket<"FLOAT">
    readonly color: Socket<"RGBA">
    readonly w: Socket<"FLOAT">
    readonly radius: Socket<"FLOAT">
    readonly position: Socket<"VECTOR">
}

/** `ShaderNodeTexWave` (Wave Texture). */
export interface WaveTextureArgs {
    waveType?: "BANDS" | "RINGS"
    bandsDirection?: "X" | "Y" | "Z" | "DIAGONAL"
    ringsDirection?: "X" | "Y" | "Z" | "SPHERICAL"
    waveProfile?: "SIN" | "SAW" | "TRI"
    vector?: In<"VECTOR">
    scale?: In<"FLOAT">
    distortion?: In<"FLOAT">
    detail?: In<"FLOAT">
    detailScale?: In<"FLOAT">
    detailRoughness?: In<"FLOAT">
    phaseOffset?: In<"FLOAT">
    mute?: boolean
}
export type WaveTextureNode = NodeHandle & {
    readonly color: Socket<"RGBA">
    readonly fac: Socket<"FLOAT">
    readonly factor: Socket<"FLOAT">
}

/** `ShaderNodeTexWhiteNoise` (White Noise Texture). */
export interface WhiteNoiseTextureArgs {
    noiseDimensions?: "1D" | "2D" | "3D" | "4D"
    w?: In<"FLOAT">
    vector?: In<"VECTOR">
    mute?: boolean
}
export type WhiteNoiseTextureNode = NodeHandle & {
    readonly value: Socket<"FLOAT">
    readonly color: Socket<"RGBA">
}

/** `n.*`: one constructor per ported node type. */
export interface NodeConstructors {
    AlignEulerToVector(args?: AlignEulerToVectorArgs): AlignEulerToVectorNode
    AlignRotationToVector(args?: AlignRotationToVectorArgs): AlignRotationToVectorNode
    AttributeStatistic(args?: AttributeStatisticArgs): AttributeStatisticNode
    AxisAngleToRotation(args?: AxisAngleToRotationArgs): AxisAngleToRotationNode
    Boolean(args?: BooleanArgs): BooleanNode
    BooleanMath(args?: BooleanMathArgs): BooleanMathNode
    BoundingBox(args?: BoundingBoxArgs): BoundingBoxNode
    CaptureAttribute(args?: CaptureAttributeArgs): CaptureAttributeNode
    Clamp(args?: ClampArgs): ClampNode
    CollectionInfo(args?: CollectionInfoArgs): CollectionInfoNode
    Color(args?: ColorArgs): ColorNode
    ColorRamp(args?: ColorRampArgs): ColorRampNode
    CombineColor(args?: CombineColorArgs): CombineColorNode
    CombineTransform(args?: CombineTransformArgs): CombineTransformNode
    CombineXYZ(args?: CombineXYZArgs): CombineXYZNode
    Compare(args?: CompareArgs): CompareNode
    DeleteGeometry(args?: DeleteGeometryArgs): DeleteGeometryNode
    DistributePointsOnFaces(args?: DistributePointsOnFacesArgs): DistributePointsOnFacesNode
    DuplicateElements(args?: DuplicateElementsArgs): DuplicateElementsNode
    EdgeAngle(args?: EdgeAngleArgs): EdgeAngleNode
    EdgeNeighbors(args?: EdgeNeighborsArgs): EdgeNeighborsNode
    EdgeVertices(args?: EdgeVerticesArgs): EdgeVerticesNode
    EulerToRotation(args?: EulerToRotationArgs): EulerToRotationNode
    ExtrudeMesh(args?: ExtrudeMeshArgs): ExtrudeMeshNode
    FaceArea(args?: FaceAreaArgs): FaceAreaNode
    FaceNeighbors(args?: FaceNeighborsArgs): FaceNeighborsNode
    FloatCurve(args?: FloatCurveArgs): FloatCurveNode
    GeometryToInstance(args?: GeometryToInstanceArgs): GeometryToInstanceNode
    GradientTexture(args?: GradientTextureArgs): GradientTextureNode
    HashValue(args?: HashValueArgs): HashValueNode
    ID(args?: IDArgs): IDNode
    ImageTexture(args?: ImageTextureArgs): ImageTextureNode
    Index(args?: IndexArgs): IndexNode
    IndexSwitch(args?: IndexSwitchArgs): IndexSwitchNode
    InstanceOnPoints(args?: InstanceOnPointsArgs): InstanceOnPointsNode
    InstancesToPoints(args?: InstancesToPointsArgs): InstancesToPointsNode
    Integer(args?: IntegerArgs): IntegerNode
    IntegerMath(args?: IntegerMathArgs): IntegerMathNode
    InvertMatrix(args?: InvertMatrixArgs): InvertMatrixNode
    InvertRotation(args?: InvertRotationArgs): InvertRotationNode
    IsEdgeSmooth(args?: IsEdgeSmoothArgs): IsEdgeSmoothNode
    IsFacePlanar(args?: IsFacePlanarArgs): IsFacePlanarNode
    IsFaceSmooth(args?: IsFaceSmoothArgs): IsFaceSmoothNode
    JoinGeometry(args?: JoinGeometryArgs): JoinGeometryNode
    MapRange(args?: MapRangeArgs): MapRangeNode
    MaterialIndex(args?: MaterialIndexArgs): MaterialIndexNode
    Math(args?: MathArgs): MathNode
    MenuSwitch(args?: MenuSwitchArgs): MenuSwitchNode
    MergeByDistance(args?: MergeByDistanceArgs): MergeByDistanceNode
    MeshCircle(args?: MeshCircleArgs): MeshCircleNode
    MeshCone(args?: MeshConeArgs): MeshConeNode
    MeshCube(args?: MeshCubeArgs): MeshCubeNode
    MeshCylinder(args?: MeshCylinderArgs): MeshCylinderNode
    MeshGrid(args?: MeshGridArgs): MeshGridNode
    MeshIsland(args?: MeshIslandArgs): MeshIslandNode
    MeshLine(args?: MeshLineArgs): MeshLineNode
    MeshToPoints(args?: MeshToPointsArgs): MeshToPointsNode
    MeshUVSphere(args?: MeshUVSphereArgs): MeshUVSphereNode
    Mix(args?: MixArgs): MixNode
    MultiplyMatrices(args?: MultiplyMatricesArgs): MultiplyMatricesNode
    NamedAttribute(args?: NamedAttributeArgs): NamedAttributeNode
    NoiseTexture(args?: NoiseTextureArgs): NoiseTextureNode
    Normal(args?: NormalArgs): NormalNode
    ObjectInfo(args?: ObjectInfoArgs): ObjectInfoNode
    Points(args?: PointsArgs): PointsNode
    PointsToVertices(args?: PointsToVerticesArgs): PointsToVerticesNode
    Position(args?: PositionArgs): PositionNode
    QuaternionToRotation(args?: QuaternionToRotationArgs): QuaternionToRotationNode
    RandomValue(args?: RandomValueArgs): RandomValueNode
    RealizeInstances(args?: RealizeInstancesArgs): RealizeInstancesNode
    RemoveNamedAttribute(args?: RemoveNamedAttributeArgs): RemoveNamedAttributeNode
    RotateEuler(args?: RotateEulerArgs): RotateEulerNode
    RotateInstances(args?: RotateInstancesArgs): RotateInstancesNode
    RotateRotation(args?: RotateRotationArgs): RotateRotationNode
    RotateVector(args?: RotateVectorArgs): RotateVectorNode
    Rotation(args?: RotationArgs): RotationNode
    RotationToAxisAngle(args?: RotationToAxisAngleArgs): RotationToAxisAngleNode
    RotationToEuler(args?: RotationToEulerArgs): RotationToEulerNode
    RotationToQuaternion(args?: RotationToQuaternionArgs): RotationToQuaternionNode
    SampleIndex(args?: SampleIndexArgs): SampleIndexNode
    SampleNearest(args?: SampleNearestArgs): SampleNearestNode
    SampleNearestSurface(args?: SampleNearestSurfaceArgs): SampleNearestSurfaceNode
    ScaleInstances(args?: ScaleInstancesArgs): ScaleInstancesNode
    SeparateColor(args?: SeparateColorArgs): SeparateColorNode
    SeparateGeometry(args?: SeparateGeometryArgs): SeparateGeometryNode
    SeparateTransform(args?: SeparateTransformArgs): SeparateTransformNode
    SeparateXYZ(args?: SeparateXYZArgs): SeparateXYZNode
    SetID(args?: SetIDArgs): SetIDNode
    SetMaterial(args?: SetMaterialArgs): SetMaterialNode
    SetMaterialIndex(args?: SetMaterialIndexArgs): SetMaterialIndexNode
    SetPosition(args?: SetPositionArgs): SetPositionNode
    SetShadeSmooth(args?: SetShadeSmoothArgs): SetShadeSmoothNode
    SplitEdges(args?: SplitEdgesArgs): SplitEdgesNode
    StoreNamedAttribute(args?: StoreNamedAttributeArgs): StoreNamedAttributeNode
    Switch(args?: SwitchArgs): SwitchNode
    TransformDirection(args?: TransformDirectionArgs): TransformDirectionNode
    TransformGeometry(args?: TransformGeometryArgs): TransformGeometryNode
    TransformPoint(args?: TransformPointArgs): TransformPointNode
    TranslateInstances(args?: TranslateInstancesArgs): TranslateInstancesNode
    Value(args?: ValueArgs): ValueNode
    Vector(args?: VectorArgs): VectorNode
    VectorMath(args?: VectorMathArgs): VectorMathNode
    VectorRotate(args?: VectorRotateArgs): VectorRotateNode
    VertexNeighbors(args?: VertexNeighborsArgs): VertexNeighborsNode
    VoronoiTexture(args?: VoronoiTextureArgs): VoronoiTextureNode
    WaveTexture(args?: WaveTextureArgs): WaveTextureNode
    WhiteNoiseTexture(args?: WhiteNoiseTextureArgs): WhiteNoiseTextureNode
}
