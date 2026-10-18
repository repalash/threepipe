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

/** `GeometryNodeAccumulateField` (Accumulate Field). */
export interface AccumulateFieldArgs {
    dataType?: "FLOAT" | "INT" | "FLOAT_VECTOR" | "TRANSFORM"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    value?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR"> | In<"MATRIX">)
    groupIndex?: In<"INT">
    groupID?: In<"INT">
    mute?: boolean
}
export type AccumulateFieldNode = NodeHandle & {
    readonly leading: Socket<"FLOAT" | "INT" | "VECTOR" | "MATRIX">
    readonly trailing: Socket<"FLOAT" | "INT" | "VECTOR" | "MATRIX">
    readonly total: Socket<"FLOAT" | "INT" | "VECTOR" | "MATRIX">
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

/** `GeometryNodeCurveArc` (Arc). */
export interface ArcArgs {
    mode?: "POINTS" | "RADIUS"
    resolution?: In<"INT">
    start?: In<"VECTOR">
    middle?: In<"VECTOR">
    end?: In<"VECTOR">
    offsetAngle?: In<"FLOAT">
    connectCenter?: In<"BOOLEAN">
    invertArc?: In<"BOOLEAN">
    radius?: In<"FLOAT">
    startAngle?: In<"FLOAT">
    sweepAngle?: In<"FLOAT">
    mute?: boolean
}
export type ArcNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
    readonly center: Socket<"VECTOR">
    readonly normal: Socket<"VECTOR">
    readonly radius: Socket<"FLOAT">
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

/** `FunctionNodeAxesToRotation` (Axes to Rotation). */
export interface AxesToRotationArgs {
    primaryAxisEnum?: "X" | "Y" | "Z"
    secondaryAxisEnum?: "X" | "Y" | "Z"
    primaryAxis?: In<"VECTOR">
    secondaryAxis?: In<"VECTOR">
    mute?: boolean
}
export type AxesToRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
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

/** `GeometryNodeCurvePrimitiveBezierSegment` (Bézier Segment). */
export interface BezierSegmentArgs {
    mode?: "POSITION" | "OFFSET"
    resolution?: In<"INT">
    start?: In<"VECTOR">
    startHandle?: In<"VECTOR">
    endHandle?: In<"VECTOR">
    end?: In<"VECTOR">
    mute?: boolean
}
export type BezierSegmentNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `FunctionNodeBitMath` (Bit Math). */
export interface BitMathArgs {
    operation?: "AND" | "OR" | "XOR" | "NOT" | "SHIFT" | "ROTATE"
    a?: In<"INT">
    b?: In<"INT">
    shift?: In<"INT">
    mute?: boolean
}
export type BitMathNode = NodeHandle & {
    readonly value: Socket<"INT">
}

/** `GeometryNodeBlurAttribute` (Blur Attribute). */
export interface BlurAttributeArgs {
    dataType?: "FLOAT" | "INT" | "FLOAT_VECTOR" | "FLOAT_COLOR"
    value?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR"> | In<"RGBA">)
    iterations?: In<"INT">
    weight?: In<"FLOAT">
    mute?: boolean
}
export type BlurAttributeNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "VECTOR" | "RGBA">
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

/** `GeometryNodeClusterByConnected` (Cluster by Connected). */
export interface ClusterByConnectedArgs {
    selection?: In<"BOOLEAN">
    position?: In<"VECTOR">
    distance?: In<"FLOAT">
    mute?: boolean
}
export type ClusterByConnectedNode = NodeHandle & {
    readonly clusterID: Socket<"INT">
}

/** `GeometryNodeClusterByDistance` (Cluster by Distance). */
export interface ClusterByDistanceArgs {
    selection?: In<"BOOLEAN">
    groupID?: In<"INT">
    position?: In<"VECTOR">
    distance?: In<"FLOAT">
    mute?: boolean
}
export type ClusterByDistanceNode = NodeHandle & {
    readonly clusterID: Socket<"INT">
}

/** `GeometryNodeInputCollection` (Collection). */
export interface CollectionArgs {
    collection?: unknown
    mute?: boolean
}
export type CollectionNode = NodeHandle & {
    readonly collection: Socket<"COLLECTION">
}

/** `GeometryNodeCollectionChildren` (Collection Children). */
export interface CollectionChildrenArgs {
    collection?: In<"COLLECTION">
    recursive?: In<"BOOLEAN">
    mute?: boolean
}
export type CollectionChildrenNode = NodeHandle & {
    readonly collections: Socket<"COLLECTION">
    readonly objects: Socket<"OBJECT">
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

/** `FunctionNodeCombineMatrix` (Combine Matrix). */
export interface CombineMatrixArgs {
    column1Row1?: In<"FLOAT">
    column1Row2?: In<"FLOAT">
    column1Row3?: In<"FLOAT">
    column1Row4?: In<"FLOAT">
    column2Row1?: In<"FLOAT">
    column2Row2?: In<"FLOAT">
    column2Row3?: In<"FLOAT">
    column2Row4?: In<"FLOAT">
    column3Row1?: In<"FLOAT">
    column3Row2?: In<"FLOAT">
    column3Row3?: In<"FLOAT">
    column3Row4?: In<"FLOAT">
    column4Row1?: In<"FLOAT">
    column4Row2?: In<"FLOAT">
    column4Row3?: In<"FLOAT">
    column4Row4?: In<"FLOAT">
    mute?: boolean
}
export type CombineMatrixNode = NodeHandle & {
    readonly matrix: Socket<"MATRIX">
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

/** `GeometryNodeConvexHull` (Convex Hull). */
export interface ConvexHullArgs {
    geometry?: In<"GEOMETRY">
    mute?: boolean
}
export type ConvexHullNode = NodeHandle & {
    readonly convexHull: Socket<"GEOMETRY">
}

/** `GeometryNodeCornersOfEdge` (Corners of Edge). */
export interface CornersOfEdgeArgs {
    edgeIndex?: In<"INT">
    weights?: In<"FLOAT">
    sortIndex?: In<"INT">
    mute?: boolean
}
export type CornersOfEdgeNode = NodeHandle & {
    readonly cornerIndex: Socket<"INT">
    readonly total: Socket<"INT">
}

/** `GeometryNodeCornersOfFace` (Corners of Face). */
export interface CornersOfFaceArgs {
    faceIndex?: In<"INT">
    weights?: In<"FLOAT">
    sortIndex?: In<"INT">
    mute?: boolean
}
export type CornersOfFaceNode = NodeHandle & {
    readonly cornerIndex: Socket<"INT">
    readonly total: Socket<"INT">
}

/** `GeometryNodeCornersOfVertex` (Corners of Vertex). */
export interface CornersOfVertexArgs {
    vertexIndex?: In<"INT">
    weights?: In<"FLOAT">
    sortIndex?: In<"INT">
    mute?: boolean
}
export type CornersOfVertexNode = NodeHandle & {
    readonly cornerIndex: Socket<"INT">
    readonly total: Socket<"INT">
}

/** `GeometryNodeCurvePrimitiveCircle` (Curve Circle). */
export interface CurveCircleArgs {
    mode?: "POINTS" | "RADIUS"
    resolution?: In<"INT">
    point1?: In<"VECTOR">
    point2?: In<"VECTOR">
    point3?: In<"VECTOR">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type CurveCircleNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
    readonly center: Socket<"VECTOR">
}

/** `GeometryNodeInputCurveHandlePositions` (Curve Handle Positions). */
export interface CurveHandlePositionsArgs {
    relative?: In<"BOOLEAN">
    mute?: boolean
}
export type CurveHandlePositionsNode = NodeHandle & {
    readonly left: Socket<"VECTOR">
    readonly right: Socket<"VECTOR">
}

/** `GeometryNodeCurveLength` (Curve Length). */
export interface CurveLengthArgs {
    curve?: In<"GEOMETRY">
    mute?: boolean
}
export type CurveLengthNode = NodeHandle & {
    readonly length: Socket<"FLOAT">
}

/** `GeometryNodeCurvePrimitiveLine` (Curve Line). */
export interface CurveLineArgs {
    mode?: "POINTS" | "DIRECTION"
    start?: In<"VECTOR">
    end?: In<"VECTOR">
    direction?: In<"VECTOR">
    length?: In<"FLOAT">
    mute?: boolean
}
export type CurveLineNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeCurveOfPoint` (Curve of Point). */
export interface CurveOfPointArgs {
    pointIndex?: In<"INT">
    mute?: boolean
}
export type CurveOfPointNode = NodeHandle & {
    readonly curveIndex: Socket<"INT">
    readonly indexInCurve: Socket<"INT">
}

/** `GeometryNodeInputTangent` (Curve Tangent). */
export interface CurveTangentArgs {
    mute?: boolean
}
export type CurveTangentNode = NodeHandle & {
    readonly tangent: Socket<"VECTOR">
}

/** `GeometryNodeInputCurveTilt` (Curve Tilt). */
export interface CurveTiltArgs {
    mute?: boolean
}
export type CurveTiltNode = NodeHandle & {
    readonly tilt: Socket<"FLOAT">
}

/** `GeometryNodeCurveToMesh` (Curve to Mesh). */
export interface CurveToMeshArgs {
    curve?: In<"GEOMETRY">
    profileCurve?: In<"GEOMETRY">
    scale?: In<"FLOAT">
    fillCaps?: In<"BOOLEAN">
    mute?: boolean
}
export type CurveToMeshNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeCurveToPoints` (Curve to Points). */
export interface CurveToPointsArgs {
    mode?: "EVALUATED" | "COUNT" | "LENGTH"
    curve?: In<"GEOMETRY">
    count?: In<"INT">
    length?: In<"FLOAT">
    mute?: boolean
}
export type CurveToPointsNode = NodeHandle & {
    readonly points: Socket<"GEOMETRY">
    readonly tangent: Socket<"VECTOR">
    readonly normal: Socket<"VECTOR">
    readonly rotation: Socket<"ROTATION">
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

/** `GeometryNodeAttributeDomainSize` (Domain Size). */
export interface DomainSizeArgs {
    component?: "MESH" | "POINTCLOUD" | "CURVE" | "INSTANCES" | "GREASEPENCIL"
    geometry?: In<"GEOMETRY">
    mute?: boolean
}
export type DomainSizeNode = NodeHandle & {
    readonly pointCount: Socket<"INT">
    readonly edgeCount: Socket<"INT">
    readonly faceCount: Socket<"INT">
    readonly faceCornerCount: Socket<"INT">
    readonly splineCount: Socket<"INT">
    readonly instanceCount: Socket<"INT">
    readonly layerCount: Socket<"INT">
}

/** `GeometryNodeDualMesh` (Dual Mesh). */
export interface DualMeshArgs {
    mesh?: In<"GEOMETRY">
    keepBoundaries?: In<"BOOLEAN">
    mute?: boolean
}
export type DualMeshNode = NodeHandle & {
    readonly dualMesh: Socket<"GEOMETRY">
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

/** `GeometryNodeEdgePathsToCurves` (Edge Paths to Curves). */
export interface EdgePathsToCurvesArgs {
    mesh?: In<"GEOMETRY">
    startVertices?: In<"BOOLEAN">
    nextVertexIndex?: In<"INT">
    mute?: boolean
}
export type EdgePathsToCurvesNode = NodeHandle & {
    readonly curves: Socket<"GEOMETRY">
}

/** `GeometryNodeEdgePathsToSelection` (Edge Paths to Selection). */
export interface EdgePathsToSelectionArgs {
    startVertices?: In<"BOOLEAN">
    nextVertexIndex?: In<"INT">
    mute?: boolean
}
export type EdgePathsToSelectionNode = NodeHandle & {
    readonly selection: Socket<"BOOLEAN">
}

/** `GeometryNodeEdgesOfCorner` (Edges of Corner). */
export interface EdgesOfCornerArgs {
    cornerIndex?: In<"INT">
    mute?: boolean
}
export type EdgesOfCornerNode = NodeHandle & {
    readonly nextEdgeIndex: Socket<"INT">
    readonly previousEdgeIndex: Socket<"INT">
}

/** `GeometryNodeEdgesOfVertex` (Edges of Vertex). */
export interface EdgesOfVertexArgs {
    vertexIndex?: In<"INT">
    weights?: In<"FLOAT">
    sortIndex?: In<"INT">
    mute?: boolean
}
export type EdgesOfVertexNode = NodeHandle & {
    readonly edgeIndex: Socket<"INT">
    readonly total: Socket<"INT">
}

/** `GeometryNodeEdgesToFaceGroups` (Edges to Face Groups). */
export interface EdgesToFaceGroupsArgs {
    boundaryEdges?: In<"BOOLEAN">
    mute?: boolean
}
export type EdgesToFaceGroupsNode = NodeHandle & {
    readonly faceGroupID: Socket<"INT">
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

/** `GeometryNodeCurveEndpointSelection` (Endpoint Selection). */
export interface EndpointSelectionArgs {
    startSize?: In<"INT">
    endSize?: In<"INT">
    mute?: boolean
}
export type EndpointSelectionNode = NodeHandle & {
    readonly selection: Socket<"BOOLEAN">
}

/** `FunctionNodeEulerToRotation` (Euler to Rotation). */
export interface EulerToRotationArgs {
    euler?: In<"VECTOR">
    mute?: boolean
}
export type EulerToRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `GeometryNodeFieldAtIndex` (Evaluate at Index). */
export interface EvaluateAtIndexArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    index?: In<"INT">
    mute?: boolean
}
export type EvaluateAtIndexNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
}

/** `GeometryNodeFieldOnDomain` (Evaluate on Domain). */
export interface EvaluateOnDomainArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    mute?: boolean
}
export type EvaluateOnDomainNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
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

/** `GeometryNodeMeshFaceSetBoundaries` (Face Group Boundaries). */
export interface FaceGroupBoundariesArgs {
    faceSet?: In<"INT">
    faceGroupID?: In<"INT">
    mute?: boolean
}
export type FaceGroupBoundariesNode = NodeHandle & {
    readonly boundaryEdges: Socket<"BOOLEAN">
}

/** `GeometryNodeInputMeshFaceNeighbors` (Face Neighbors). */
export interface FaceNeighborsArgs {
    mute?: boolean
}
export type FaceNeighborsNode = NodeHandle & {
    readonly vertexCount: Socket<"INT">
    readonly faceCount: Socket<"INT">
}

/** `GeometryNodeFaceOfCorner` (Face of Corner). */
export interface FaceOfCornerArgs {
    cornerIndex?: In<"INT">
    mute?: boolean
}
export type FaceOfCornerNode = NodeHandle & {
    readonly faceIndex: Socket<"INT">
    readonly indexInFace: Socket<"INT">
}

/** `GeometryNodeFieldAverage` (Field Average). */
export interface FieldAverageArgs {
    dataType?: "FLOAT" | "FLOAT_VECTOR"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    value?: (In<"FLOAT"> | In<"VECTOR">)
    groupIndex?: In<"INT">
    groupID?: In<"INT">
    mute?: boolean
}
export type FieldAverageNode = NodeHandle & {
    readonly mean: Socket<"FLOAT" | "VECTOR">
    readonly median: Socket<"FLOAT" | "VECTOR">
}

/** `GeometryNodeFieldMinAndMax` (Field Min & Max). */
export interface FieldMinMaxArgs {
    dataType?: "FLOAT" | "INT" | "FLOAT_VECTOR"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    value?: (In<"FLOAT"> | In<"INT"> | In<"VECTOR">)
    groupIndex?: In<"INT">
    groupID?: In<"INT">
    mute?: boolean
}
export type FieldMinMaxNode = NodeHandle & {
    readonly min: Socket<"FLOAT" | "INT" | "VECTOR">
    readonly max: Socket<"FLOAT" | "INT" | "VECTOR">
}

/** `GeometryNodeFieldToList` (Field to List). */
export interface FieldToListArgs {
    activeIndex?: number
    count?: In<"INT">
    extend?: In<"CUSTOM">
    ""?: In<"CUSTOM">
    mute?: boolean
}
export type FieldToListNode = NodeHandle & {
    readonly extend: Socket<"CUSTOM">
    readonly "": Socket<"CUSTOM">
}

/** `GeometryNodeFieldVariance` (Field Variance). */
export interface FieldVarianceArgs {
    dataType?: "FLOAT" | "FLOAT_VECTOR"
    domain?: "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE" | "LAYER"
    value?: (In<"FLOAT"> | In<"VECTOR">)
    groupIndex?: In<"INT">
    groupID?: In<"INT">
    mute?: boolean
}
export type FieldVarianceNode = NodeHandle & {
    readonly standardDeviation: Socket<"FLOAT" | "VECTOR">
    readonly variance: Socket<"FLOAT" | "VECTOR">
}

/** `GeometryNodeFillCurve` (Fill Curve). */
export interface FillCurveArgs {
    curve?: In<"GEOMETRY">
    groupID?: In<"INT">
    mode?: In<"MENU">
    fillRule?: In<"MENU">
    mute?: boolean
}
export type FillCurveNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeFilletCurve` (Fillet Curve). */
export interface FilletCurveArgs {
    curve?: In<"GEOMETRY">
    radius?: In<"FLOAT">
    limitRadius?: In<"BOOLEAN">
    mode?: In<"MENU">
    count?: In<"INT">
    mute?: boolean
}
export type FilletCurveNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeFilterList` (Filter List). */
export interface FilterListArgs {
    socketType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL"
    list?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL">)
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type FilterListNode = NodeHandle & {
    readonly selection: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL">
    readonly inverted: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL">
}

/** `FunctionNodeFindInString` (Find in String). */
export interface FindInStringArgs {
    string?: In<"STRING">
    search?: In<"STRING">
    mode?: In<"MENU">
    mute?: boolean
}
export type FindInStringNode = NodeHandle & {
    readonly firstFound: Socket<"INT">
    readonly count: Socket<"INT">
}

/** `GeometryNodeFlipFaces` (Flip Faces). */
export interface FlipFacesArgs {
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type FlipFacesNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
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

/** `FunctionNodeFloatToInt` (Float to Integer). */
export interface FloatToIntegerArgs {
    roundingMode?: "ROUND" | "FLOOR" | "CEILING" | "TRUNCATE"
    float?: In<"FLOAT">
    mute?: boolean
}
export type FloatToIntegerNode = NodeHandle & {
    readonly integer: Socket<"INT">
}

/** `GeometryNodeProximity` (Geometry Proximity). */
export interface GeometryProximityArgs {
    targetElement?: "POINTS" | "EDGES" | "FACES"
    target?: In<"GEOMETRY">
    geometry?: In<"GEOMETRY">
    groupID?: In<"INT">
    sourcePosition?: In<"VECTOR">
    samplePosition?: In<"VECTOR">
    sampleGroupID?: In<"INT">
    mute?: boolean
}
export type GeometryProximityNode = NodeHandle & {
    readonly position: Socket<"VECTOR">
    readonly distance: Socket<"FLOAT">
    readonly isValid: Socket<"BOOLEAN">
}

/** `GeometryNodeGeometryToInstance` (Geometry to Instance). */
export interface GeometryToInstanceArgs {
    geometry?: In<"GEOMETRY"> | In<"GEOMETRY">[]
    mute?: boolean
}
export type GeometryToInstanceNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
}

/** `GeometryNodeGetAttributeNames` (Get Attribute Names). */
export interface GetAttributeNamesArgs {
    geometry?: In<"GEOMETRY">
    filterDataType?: In<"BOOLEAN">
    dataType?: In<"MENU">
    filterDomain?: In<"BOOLEAN">
    domain?: In<"MENU">
    mute?: boolean
}
export type GetAttributeNamesNode = NodeHandle & {
    readonly names: Socket<"STRING">
}

/** `GeometryNodeGetGeometryComponent` (Get Geometry Component). */
export interface GetGeometryComponentArgs {
    geometry?: In<"GEOMETRY">
    type?: In<"MENU">
    remove?: In<"BOOLEAN">
    mute?: boolean
}
export type GetGeometryComponentNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly component: Socket<"GEOMETRY">
    readonly exists: Socket<"BOOLEAN">
}

/** `GeometryNodeListGetItem` (Get List Item). */
export interface GetListItemArgs {
    socketType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL"
    structureType?: "AUTO" | "DYNAMIC" | "FIELD" | "GRID" | "LIST" | "SINGLE"
    list?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL">)
    index?: In<"INT">
    mute?: boolean
}
export type GetListItemNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL">
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

/** `GeometryNodeCurveHandleTypeSelection` (Handle Type Selection). */
export interface HandleTypeSelectionArgs {
    handleType?: "FREE" | "AUTO" | "VECTOR" | "ALIGN"
    mode?: "LEFT" | "RIGHT"
    mute?: boolean
}
export type HandleTypeSelectionNode = NodeHandle & {
    readonly selection: Socket<"BOOLEAN">
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

/** `GeometryNodeInputImage` (Image). */
export interface ImageArgs {
    image?: unknown
    mute?: boolean
}
export type ImageNode = NodeHandle & {
    readonly image: Socket<"IMAGE">
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

/** `GeometryNodeIndexOfNearest` (Index of Nearest). */
export interface IndexOfNearestArgs {
    position?: In<"VECTOR">
    groupID?: In<"INT">
    mute?: boolean
}
export type IndexOfNearestNode = NodeHandle & {
    readonly index: Socket<"INT">
    readonly hasNeighbor: Socket<"BOOLEAN">
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

/** `GeometryNodeInputInstanceBounds` (Instance Bounds). */
export interface InstanceBoundsArgs {
    useRadius?: In<"BOOLEAN">
    mute?: boolean
}
export type InstanceBoundsNode = NodeHandle & {
    readonly min: Socket<"VECTOR">
    readonly max: Socket<"VECTOR">
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

/** `GeometryNodeInputInstanceReference` (Instance Reference). */
export interface InstanceReferenceArgs {
    mute?: boolean
}
export type InstanceReferenceNode = NodeHandle & {
    readonly referenceIndex: Socket<"INT">
}

/** `GeometryNodeInputInstanceRotation` (Instance Rotation). */
export interface InstanceRotationArgs {
    mute?: boolean
}
export type InstanceRotationNode = NodeHandle & {
    readonly rotation: Socket<"ROTATION">
}

/** `GeometryNodeInputInstanceScale` (Instance Scale). */
export interface InstanceScaleArgs {
    mute?: boolean
}
export type InstanceScaleNode = NodeHandle & {
    readonly scale: Socket<"VECTOR">
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

/** `GeometryNodeInstanceTransform` (Instance Transform). */
export interface InstanceTransformArgs {
    mute?: boolean
}
export type InstanceTransformNode = NodeHandle & {
    readonly transform: Socket<"MATRIX">
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

/** `GeometryNodeInterpolateCurves` (Interpolate Curves). */
export interface InterpolateCurvesArgs {
    guideCurves?: In<"GEOMETRY">
    guideUp?: In<"VECTOR">
    guideGroupID?: In<"INT">
    points?: In<"GEOMETRY">
    pointUp?: In<"VECTOR">
    pointGroupID?: In<"INT">
    maxNeighbors?: In<"INT">
    mute?: boolean
}
export type InterpolateCurvesNode = NodeHandle & {
    readonly curves: Socket<"GEOMETRY">
    readonly closestIndex: Socket<"INT">
    readonly closestWeight: Socket<"FLOAT">
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

/** `GeometryNodeInputSplineCyclic` (Is Spline Cyclic). */
export interface IsSplineCyclicArgs {
    mute?: boolean
}
export type IsSplineCyclicNode = NodeHandle & {
    readonly cyclic: Socket<"BOOLEAN">
}

/** `GeometryNodeIsViewport` (Is Viewport). */
export interface IsViewportArgs {
    mute?: boolean
}
export type IsViewportNode = NodeHandle & {
    readonly isViewport: Socket<"BOOLEAN">
}

/** `GeometryNodeJoinGeometry` (Join Geometry). */
export interface JoinGeometryArgs {
    geometry?: In<"GEOMETRY"> | In<"GEOMETRY">[]
    mute?: boolean
}
export type JoinGeometryNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeStringJoin` (Join Strings). */
export interface JoinStringsArgs {
    delimiter?: In<"STRING">
    strings?: In<"STRING"> | In<"STRING">[]
    mute?: boolean
}
export type JoinStringsNode = NodeHandle & {
    readonly string: Socket<"STRING">
}

/** `GeometryNodeListLength` (List Length). */
export interface ListLengthArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL"
    list?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL">)
    mute?: boolean
}
export type ListLengthNode = NodeHandle & {
    readonly length: Socket<"INT">
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

/** `FunctionNodeMatchString` (Match String). */
export interface MatchStringArgs {
    string?: In<"STRING">
    operation?: In<"MENU">
    key?: In<"STRING">
    mute?: boolean
}
export type MatchStringNode = NodeHandle & {
    readonly result: Socket<"BOOLEAN">
}

/** `GeometryNodeInputMaterial` (Material). */
export interface MaterialArgs {
    material?: unknown
    mute?: boolean
}
export type MaterialNode = NodeHandle & {
    readonly material: Socket<"MATERIAL">
}

/** `GeometryNodeInputMaterialIndex` (Material Index). */
export interface MaterialIndexArgs {
    mute?: boolean
}
export type MaterialIndexNode = NodeHandle & {
    readonly materialIndex: Socket<"INT">
}

/** `GeometryNodeMaterialSelection` (Material Selection). */
export interface MaterialSelectionArgs {
    material?: In<"MATERIAL">
    mute?: boolean
}
export type MaterialSelectionNode = NodeHandle & {
    readonly selection: Socket<"BOOLEAN">
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

/** `FunctionNodeMatrixDeterminant` (Matrix Determinant). */
export interface MatrixDeterminantArgs {
    matrix?: In<"MATRIX">
    mute?: boolean
}
export type MatrixDeterminantNode = NodeHandle & {
    readonly determinant: Socket<"FLOAT">
}

/** `FunctionNodeMatrixSVD` (Matrix SVD). */
export interface MatrixSVDArgs {
    matrix?: In<"MATRIX">
    mute?: boolean
}
export type MatrixSVDNode = NodeHandle & {
    readonly u: Socket<"MATRIX">
    readonly s: Socket<"VECTOR">
    readonly v: Socket<"MATRIX">
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

/** `GeometryNodeMergePoints` (Merge Points). */
export interface MergePointsArgs {
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mergeID?: In<"INT">
    mute?: boolean
}
export type MergePointsNode = NodeHandle & {
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

/** `GeometryNodeMeshIcoSphere` (Ico Sphere). */
export interface MeshIcoSphereArgs {
    radius?: In<"FLOAT">
    subdivisions?: In<"INT">
    mute?: boolean
}
export type MeshIcoSphereNode = NodeHandle & {
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

/** `GeometryNodeMeshToCurve` (Mesh to Curve). */
export interface MeshToCurveArgs {
    mode?: "EDGES" | "FACES"
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type MeshToCurveNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
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

/** `GeometryNodeInputObject` (Object). */
export interface ObjectArgs {
    object?: unknown
    mute?: boolean
}
export type ObjectNode = NodeHandle & {
    readonly object: Socket<"OBJECT">
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

/** `GeometryNodeOffsetCornerInFace` (Offset Corner in Face). */
export interface OffsetCornerInFaceArgs {
    cornerIndex?: In<"INT">
    offset?: In<"INT">
    mute?: boolean
}
export type OffsetCornerInFaceNode = NodeHandle & {
    readonly cornerIndex: Socket<"INT">
}

/** `GeometryNodeOffsetPointInCurve` (Offset Point in Curve). */
export interface OffsetPointInCurveArgs {
    pointIndex?: In<"INT">
    offset?: In<"INT">
    mute?: boolean
}
export type OffsetPointInCurveNode = NodeHandle & {
    readonly isValidOffset: Socket<"BOOLEAN">
    readonly pointIndex: Socket<"INT">
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

/** `GeometryNodePointsOfCurve` (Points of Curve). */
export interface PointsOfCurveArgs {
    curveIndex?: In<"INT">
    weights?: In<"FLOAT">
    sortIndex?: In<"INT">
    mute?: boolean
}
export type PointsOfCurveNode = NodeHandle & {
    readonly pointIndex: Socket<"INT">
    readonly total: Socket<"INT">
}

/** `GeometryNodePointsToCurves` (Points to Curves). */
export interface PointsToCurvesArgs {
    points?: In<"GEOMETRY">
    curveGroupID?: In<"INT">
    weight?: In<"FLOAT">
    mute?: boolean
}
export type PointsToCurvesNode = NodeHandle & {
    readonly curves: Socket<"GEOMETRY">
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

/** `FunctionNodeProjectPoint` (Project Point). */
export interface ProjectPointArgs {
    vector?: In<"VECTOR">
    transform?: In<"MATRIX">
    mute?: boolean
}
export type ProjectPointNode = NodeHandle & {
    readonly vector: Socket<"VECTOR">
}

/** `GeometryNodeCurveQuadraticBezier` (Quadratic Bézier). */
export interface QuadraticBezierArgs {
    resolution?: In<"INT">
    start?: In<"VECTOR">
    middle?: In<"VECTOR">
    end?: In<"VECTOR">
    mute?: boolean
}
export type QuadraticBezierNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeCurvePrimitiveQuadrilateral` (Quadrilateral). */
export interface QuadrilateralArgs {
    mode?: "RECTANGLE" | "PARALLELOGRAM" | "TRAPEZOID" | "KITE" | "POINTS"
    width?: In<"FLOAT">
    height?: In<"FLOAT">
    offset?: In<"FLOAT">
    bottomWidth?: In<"FLOAT">
    topWidth?: In<"FLOAT">
    bottomHeight?: In<"FLOAT">
    topHeight?: In<"FLOAT">
    point1?: In<"VECTOR">
    point2?: In<"VECTOR">
    point3?: In<"VECTOR">
    point4?: In<"VECTOR">
    mute?: boolean
}
export type QuadrilateralNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
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

/** `GeometryNodeInputRadius` (Radius). */
export interface RadiusArgs {
    mute?: boolean
}
export type RadiusNode = NodeHandle & {
    readonly radius: Socket<"FLOAT">
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

/** `GeometryNodeRaycast` (Raycast). */
export interface RaycastArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    targetGeometry?: In<"GEOMETRY">
    attribute?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    interpolation?: In<"MENU">
    sourcePosition?: In<"VECTOR">
    rayDirection?: In<"VECTOR">
    rayLength?: In<"FLOAT">
    mute?: boolean
}
export type RaycastNode = NodeHandle & {
    readonly isHit: Socket<"BOOLEAN">
    readonly hitPosition: Socket<"VECTOR">
    readonly hitNormal: Socket<"VECTOR">
    readonly hitDistance: Socket<"FLOAT">
    readonly attribute: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
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

/** `GeometryNodeRenameAttribute` (Rename Attribute). */
export interface RenameAttributeArgs {
    geometry?: In<"GEOMETRY">
    mode?: In<"MENU">
    old?: In<"STRING">
    new?: In<"STRING">
    overwrite?: In<"BOOLEAN">
    mute?: boolean
}
export type RenameAttributeNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeReplaceMaterial` (Replace Material). */
export interface ReplaceMaterialArgs {
    geometry?: In<"GEOMETRY">
    old?: In<"MATERIAL">
    new?: In<"MATERIAL">
    mute?: boolean
}
export type ReplaceMaterialNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `FunctionNodeReplaceString` (Replace String). */
export interface ReplaceStringArgs {
    string?: In<"STRING">
    find?: In<"STRING">
    replace?: In<"STRING">
    mute?: boolean
}
export type ReplaceStringNode = NodeHandle & {
    readonly string: Socket<"STRING">
}

/** `GeometryNodeResampleCurve` (Resample Curve). */
export interface ResampleCurveArgs {
    keepLastSegment?: boolean
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mode?: In<"MENU">
    count?: In<"INT">
    length?: In<"FLOAT">
    mute?: boolean
}
export type ResampleCurveNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeReverseCurve` (Reverse Curve). */
export interface ReverseCurveArgs {
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type ReverseCurveNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `FunctionNodeReverseString` (Reverse String). */
export interface ReverseStringArgs {
    string?: In<"STRING">
    mute?: boolean
}
export type ReverseStringNode = NodeHandle & {
    readonly string: Socket<"STRING">
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

/** `GeometryNodeSampleCurve` (Sample Curve). */
export interface SampleCurveArgs {
    mode?: "FACTOR" | "LENGTH"
    useAllCurves?: boolean
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    curves?: In<"GEOMETRY">
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    factor?: In<"FLOAT">
    curveIndex?: In<"INT">
    length?: In<"FLOAT">
    mute?: boolean
}
export type SampleCurveNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
    readonly position: Socket<"VECTOR">
    readonly tangent: Socket<"VECTOR">
    readonly normal: Socket<"VECTOR">
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

/** `GeometryNodeSampleUVSurface` (Sample UV Surface). */
export interface SampleUVSurfaceArgs {
    dataType?: "FLOAT" | "INT" | "BOOLEAN" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "QUATERNION" | "FLOAT4X4"
    mesh?: In<"GEOMETRY">
    value?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX">)
    sourceUVMap?: In<"VECTOR">
    uVMap?: In<"VECTOR">
    sampleUV?: In<"VECTOR">
    mute?: boolean
}
export type SampleUVSurfaceNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX">
    readonly isValid: Socket<"BOOLEAN">
}

/** `GeometryNodeScaleElements` (Scale Elements). */
export interface ScaleElementsArgs {
    domain?: "FACE" | "EDGE"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    scale?: In<"FLOAT">
    center?: In<"VECTOR">
    scaleMode?: In<"MENU">
    axis?: In<"VECTOR">
    mute?: boolean
}
export type ScaleElementsNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
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

/** `GeometryNodeInputSceneTime` (Scene Time). */
export interface SceneTimeArgs {
    mute?: boolean
}
export type SceneTimeNode = NodeHandle & {
    readonly seconds: Socket<"FLOAT">
    readonly frame: Socket<"FLOAT">
}

/** `GeometryNodeSelfObject` (Self Object). */
export interface SelfObjectArgs {
    mute?: boolean
}
export type SelfObjectNode = NodeHandle & {
    readonly selfObject: Socket<"OBJECT">
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

/** `GeometryNodeSeparateComponents` (Separate Components). */
export interface SeparateComponentsArgs {
    geometry?: In<"GEOMETRY">
    mute?: boolean
}
export type SeparateComponentsNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly curve: Socket<"GEOMETRY">
    readonly greasePencil: Socket<"GEOMETRY">
    readonly pointCloud: Socket<"GEOMETRY">
    readonly volume: Socket<"GEOMETRY">
    readonly instances: Socket<"GEOMETRY">
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

/** `FunctionNodeSeparateMatrix` (Separate Matrix). */
export interface SeparateMatrixArgs {
    matrix?: In<"MATRIX">
    mute?: boolean
}
export type SeparateMatrixNode = NodeHandle & {
    readonly column1Row1: Socket<"FLOAT">
    readonly column1Row2: Socket<"FLOAT">
    readonly column1Row3: Socket<"FLOAT">
    readonly column1Row4: Socket<"FLOAT">
    readonly column2Row1: Socket<"FLOAT">
    readonly column2Row2: Socket<"FLOAT">
    readonly column2Row3: Socket<"FLOAT">
    readonly column2Row4: Socket<"FLOAT">
    readonly column3Row1: Socket<"FLOAT">
    readonly column3Row2: Socket<"FLOAT">
    readonly column3Row3: Socket<"FLOAT">
    readonly column3Row4: Socket<"FLOAT">
    readonly column4Row1: Socket<"FLOAT">
    readonly column4Row2: Socket<"FLOAT">
    readonly column4Row3: Socket<"FLOAT">
    readonly column4Row4: Socket<"FLOAT">
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

/** `GeometryNodeSetCurveNormal` (Set Curve Normal). */
export interface SetCurveNormalArgs {
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mode?: In<"MENU">
    normal?: In<"VECTOR">
    mute?: boolean
}
export type SetCurveNormalNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeSetCurveRadius` (Set Curve Radius). */
export interface SetCurveRadiusArgs {
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type SetCurveRadiusNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeSetCurveTilt` (Set Curve Tilt). */
export interface SetCurveTiltArgs {
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    tilt?: In<"FLOAT">
    mute?: boolean
}
export type SetCurveTiltNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeSetGeometryName` (Set Geometry Name). */
export interface SetGeometryNameArgs {
    geometry?: In<"GEOMETRY">
    name?: In<"STRING">
    mute?: boolean
}
export type SetGeometryNameNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSetCurveHandlePositions` (Set Handle Positions). */
export interface SetHandlePositionsArgs {
    mode?: "LEFT" | "RIGHT"
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    position?: In<"VECTOR">
    offset?: In<"VECTOR">
    mute?: boolean
}
export type SetHandlePositionsNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeCurveSetHandles` (Set Handle Type). */
export interface SetHandleTypeArgs {
    handleType?: "FREE" | "AUTO" | "VECTOR" | "ALIGN"
    mode?: "LEFT" | "RIGHT"
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type SetHandleTypeNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
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

/** `GeometryNodeSetInstanceTransform` (Set Instance Transform). */
export interface SetInstanceTransformArgs {
    instances?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    transform?: In<"MATRIX">
    mute?: boolean
}
export type SetInstanceTransformNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
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

/** `GeometryNodeSetNURBSOrder` (Set NURBS Order). */
export interface SetNURBSOrderArgs {
    curves?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    order?: In<"INT">
    mute?: boolean
}
export type SetNURBSOrderNode = NodeHandle & {
    readonly curves: Socket<"GEOMETRY">
}

/** `GeometryNodeSetNURBSWeight` (Set NURBS Weight). */
export interface SetNURBSWeightArgs {
    curves?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    weight?: In<"FLOAT">
    mute?: boolean
}
export type SetNURBSWeightNode = NodeHandle & {
    readonly curves: Socket<"GEOMETRY">
}

/** `GeometryNodeSetPointRadius` (Set Point Radius). */
export interface SetPointRadiusArgs {
    points?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    radius?: In<"FLOAT">
    mute?: boolean
}
export type SetPointRadiusNode = NodeHandle & {
    readonly points: Socket<"GEOMETRY">
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

/** `GeometryNodeSetSplineCyclic` (Set Spline Cyclic). */
export interface SetSplineCyclicArgs {
    geometry?: In<"GEOMETRY">
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    cyclic?: In<"BOOLEAN">
    mute?: boolean
}
export type SetSplineCyclicNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeSetSplineResolution` (Set Spline Resolution). */
export interface SetSplineResolutionArgs {
    geometry?: In<"GEOMETRY">
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    resolution?: In<"INT">
    mute?: boolean
}
export type SetSplineResolutionNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeCurveSplineType` (Set Spline Type). */
export interface SetSplineTypeArgs {
    splineType?: "CATMULL_ROM" | "POLY" | "BEZIER" | "NURBS"
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    mute?: boolean
}
export type SetSplineTypeNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `FunctionNodeSetStringCase` (Set String Case). */
export interface SetStringCaseArgs {
    string?: In<"STRING">
    case?: In<"MENU">
    mute?: boolean
}
export type SetStringCaseNode = NodeHandle & {
    readonly string: Socket<"STRING">
}

/** `GeometryNodeInputShortestEdgePaths` (Shortest Edge Paths). */
export interface ShortestEdgePathsArgs {
    endVertex?: In<"BOOLEAN">
    edgeCost?: In<"FLOAT">
    mute?: boolean
}
export type ShortestEdgePathsNode = NodeHandle & {
    readonly nextVertexIndex: Socket<"INT">
    readonly totalCost: Socket<"FLOAT">
}

/** `FunctionNodeSliceString` (Slice String). */
export interface SliceStringArgs {
    string?: In<"STRING">
    position?: In<"INT">
    length?: In<"INT">
    mute?: boolean
}
export type SliceStringNode = NodeHandle & {
    readonly string: Socket<"STRING">
}

/** `GeometryNodeSortElements` (Sort Elements). */
export interface SortElementsArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CURVE" | "INSTANCE"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    groupID?: In<"INT">
    sortWeight?: In<"FLOAT">
    mute?: boolean
}
export type SortElementsNode = NodeHandle & {
    readonly geometry: Socket<"GEOMETRY">
}

/** `GeometryNodeSortList` (Sort List). */
export interface SortListArgs {
    socketType?: "FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL"
    list?: (In<"FLOAT"> | In<"INT"> | In<"BOOLEAN"> | In<"VECTOR"> | In<"RGBA"> | In<"ROTATION"> | In<"MATRIX"> | In<"STRING"> | In<"MENU"> | In<"OBJECT"> | In<"IMAGE"> | In<"GEOMETRY"> | In<"COLLECTION"> | In<"MATERIAL">)
    selection?: In<"BOOLEAN">
    groupID?: In<"INT">
    sortWeight?: In<"FLOAT">
    mute?: boolean
}
export type SortListNode = NodeHandle & {
    readonly list: Socket<"FLOAT" | "INT" | "BOOLEAN" | "VECTOR" | "RGBA" | "ROTATION" | "MATRIX" | "STRING" | "MENU" | "OBJECT" | "IMAGE" | "GEOMETRY" | "COLLECTION" | "MATERIAL">
}

/** `FunctionNodeInputSpecialCharacters` (Special Characters). */
export interface SpecialCharactersArgs {
    mute?: boolean
}
export type SpecialCharactersNode = NodeHandle & {
    readonly lineBreak: Socket<"STRING">
    readonly tab: Socket<"STRING">
}

/** `GeometryNodeCurveSpiral` (Spiral). */
export interface SpiralArgs {
    resolution?: In<"INT">
    rotations?: In<"FLOAT">
    startRadius?: In<"FLOAT">
    endRadius?: In<"FLOAT">
    height?: In<"FLOAT">
    reverse?: In<"BOOLEAN">
    mute?: boolean
}
export type SpiralNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeSplineLength` (Spline Length). */
export interface SplineLengthArgs {
    mute?: boolean
}
export type SplineLengthNode = NodeHandle & {
    readonly length: Socket<"FLOAT">
    readonly pointCount: Socket<"INT">
}

/** `GeometryNodeSplineParameter` (Spline Parameter). */
export interface SplineParameterArgs {
    mute?: boolean
}
export type SplineParameterNode = NodeHandle & {
    readonly factor: Socket<"FLOAT">
    readonly length: Socket<"FLOAT">
    readonly index: Socket<"INT">
}

/** `GeometryNodeInputSplineResolution` (Spline Resolution). */
export interface SplineResolutionArgs {
    mute?: boolean
}
export type SplineResolutionNode = NodeHandle & {
    readonly resolution: Socket<"INT">
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

/** `FunctionNodeSplitString` (Split String). */
export interface SplitStringArgs {
    string?: In<"STRING">
    separator?: In<"STRING">
    mute?: boolean
}
export type SplitStringNode = NodeHandle & {
    readonly list: Socket<"STRING">
}

/** `GeometryNodeSplitToInstances` (Split to Instances). */
export interface SplitToInstancesArgs {
    domain?: "POINT" | "EDGE" | "FACE" | "CURVE" | "INSTANCE" | "LAYER"
    geometry?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    groupID?: In<"INT">
    mute?: boolean
}
export type SplitToInstancesNode = NodeHandle & {
    readonly instances: Socket<"GEOMETRY">
    readonly groupID: Socket<"INT">
}

/** `GeometryNodeCurveStar` (Star). */
export interface StarArgs {
    points?: In<"INT">
    innerRadius?: In<"FLOAT">
    outerRadius?: In<"FLOAT">
    twist?: In<"FLOAT">
    mute?: boolean
}
export type StarNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
    readonly outerPoints: Socket<"BOOLEAN">
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

/** `FunctionNodeInputString` (String). */
export interface StringArgs {
    string?: string
    mute?: boolean
}
export type StringNode = NodeHandle & {
    readonly string: Socket<"STRING">
}

/** `FunctionNodeStringLength` (String Length). */
export interface StringLengthArgs {
    string?: In<"STRING">
    mute?: boolean
}
export type StringLengthNode = NodeHandle & {
    readonly length: Socket<"INT">
}

/** `FunctionNodeStringToValue` (String to Value). */
export interface StringToValueArgs {
    dataType?: "FLOAT" | "INT"
    string?: In<"STRING">
    base?: In<"INT">
    mute?: boolean
}
export type StringToValueNode = NodeHandle & {
    readonly value: Socket<"FLOAT" | "INT">
    readonly length: Socket<"INT">
}

/** `GeometryNodeSubdivideCurve` (Subdivide Curve). */
export interface SubdivideCurveArgs {
    curve?: In<"GEOMETRY">
    cuts?: In<"INT">
    mute?: boolean
}
export type SubdivideCurveNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `GeometryNodeSubdivideMesh` (Subdivide Mesh). */
export interface SubdivideMeshArgs {
    mesh?: In<"GEOMETRY">
    level?: In<"INT">
    mute?: boolean
}
export type SubdivideMeshNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
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

/** `GeometryNodeTagFilter` (Tag Filter). */
export interface TagFilterArgs {
    tagFilter?: In<"STRING">
    tags?: In<"STRING">
    mute?: boolean
}
export type TagFilterNode = NodeHandle & {
    readonly match: Socket<"BOOLEAN">
}

/** `ThreepipeErosion` (Erosion (threepipe)). */
export interface ThreepipeErosionArgs {
    mesh?: In<"GEOMETRY">
    hydraulic?: In<"BOOLEAN">
    dropletsPerCell?: In<"FLOAT">
    seed?: In<"INT">
    radius?: In<"INT">
    inertia?: In<"FLOAT">
    capacity?: In<"FLOAT">
    minCapacity?: In<"FLOAT">
    erodeSpeed?: In<"FLOAT">
    depositSpeed?: In<"FLOAT">
    evaporateSpeed?: In<"FLOAT">
    gravity?: In<"FLOAT">
    lifetime?: In<"INT">
    thermal?: In<"BOOLEAN">
    thermalAngle?: In<"FLOAT">
    thermalIterations?: In<"INT">
    weight?: In<"FLOAT">
    mute?: boolean
}
export type ThreepipeErosionNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
    readonly flow: Socket<"FLOAT">
    readonly deposit: Socket<"FLOAT">
    readonly eroded: Socket<"FLOAT">
    readonly talus: Socket<"FLOAT">
}

/** `GeometryNodeTransferAttributes` (Transfer Attributes). */
export interface TransferAttributesArgs {
    target?: In<"GEOMETRY">
    targetPointID?: In<"INT">
    targetEdgeID?: In<"INT">
    targetFaceID?: In<"INT">
    targetCornerID?: In<"INT">
    targetCurveID?: In<"INT">
    targetInstanceID?: In<"INT">
    source?: In<"GEOMETRY">
    sourcePointID?: In<"INT">
    sourceEdgeID?: In<"INT">
    sourceFaceID?: In<"INT">
    sourceCornerID?: In<"INT">
    sourceCurveID?: In<"INT">
    sourceInstanceID?: In<"INT">
    patternMode?: In<"MENU">
    attributeNames?: In<"STRING">
    excludeNames?: In<"BOOLEAN">
    mute?: boolean
}
export type TransferAttributesNode = NodeHandle & {
    readonly target: Socket<"GEOMETRY">
    readonly transferredNames: Socket<"STRING">
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

/** `FunctionNodeTransposeMatrix` (Transpose Matrix). */
export interface TransposeMatrixArgs {
    matrix?: In<"MATRIX">
    mute?: boolean
}
export type TransposeMatrixNode = NodeHandle & {
    readonly matrix: Socket<"MATRIX">
}

/** `GeometryNodeTriangulate` (Triangulate). */
export interface TriangulateArgs {
    mesh?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    quadMethod?: In<"MENU">
    nGonMethod?: In<"MENU">
    mute?: boolean
}
export type TriangulateNode = NodeHandle & {
    readonly mesh: Socket<"GEOMETRY">
}

/** `GeometryNodeTrimCurve` (Trim Curve). */
export interface TrimCurveArgs {
    mode?: "FACTOR" | "LENGTH"
    curve?: In<"GEOMETRY">
    selection?: In<"BOOLEAN">
    start?: In<"FLOAT">
    end?: In<"FLOAT">
    start1?: In<"FLOAT">
    end1?: In<"FLOAT">
    mute?: boolean
}
export type TrimCurveNode = NodeHandle & {
    readonly curve: Socket<"GEOMETRY">
}

/** `FunctionNodeTrimString` (Trim String). */
export interface TrimStringArgs {
    string?: In<"STRING">
    characters?: In<"STRING">
    whitespace?: In<"BOOLEAN">
    start?: In<"BOOLEAN">
    end?: In<"BOOLEAN">
    mute?: boolean
}
export type TrimStringNode = NodeHandle & {
    readonly string: Socket<"STRING">
}

/** `ShaderNodeValue` (Value). */
export interface ValueArgs {
    mute?: boolean
}
export type ValueNode = NodeHandle & {
    readonly value: Socket<"FLOAT">
}

/** `FunctionNodeValueToString` (Value to String). */
export interface ValueToStringArgs {
    dataType?: "FLOAT" | "INT"
    value?: (In<"FLOAT"> | In<"INT">)
    decimals?: In<"INT">
    base?: In<"INT">
    padding?: In<"INT">
    mute?: boolean
}
export type ValueToStringNode = NodeHandle & {
    readonly string: Socket<"STRING">
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

/** `GeometryNodeVertexOfCorner` (Vertex of Corner). */
export interface VertexOfCornerArgs {
    cornerIndex?: In<"INT">
    mute?: boolean
}
export type VertexOfCornerNode = NodeHandle & {
    readonly vertexIndex: Socket<"INT">
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

/** `GeometryNodeWarning` (Warning). */
export interface WarningArgs {
    warningType?: "ERROR" | "WARNING" | "INFO"
    show?: In<"BOOLEAN">
    message?: In<"STRING">
    mute?: boolean
}
export type WarningNode = NodeHandle & {
    readonly show: Socket<"BOOLEAN">
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
    AccumulateField(args?: AccumulateFieldArgs): AccumulateFieldNode
    AlignEulerToVector(args?: AlignEulerToVectorArgs): AlignEulerToVectorNode
    AlignRotationToVector(args?: AlignRotationToVectorArgs): AlignRotationToVectorNode
    Arc(args?: ArcArgs): ArcNode
    AttributeStatistic(args?: AttributeStatisticArgs): AttributeStatisticNode
    AxesToRotation(args?: AxesToRotationArgs): AxesToRotationNode
    AxisAngleToRotation(args?: AxisAngleToRotationArgs): AxisAngleToRotationNode
    BezierSegment(args?: BezierSegmentArgs): BezierSegmentNode
    BitMath(args?: BitMathArgs): BitMathNode
    BlurAttribute(args?: BlurAttributeArgs): BlurAttributeNode
    Boolean(args?: BooleanArgs): BooleanNode
    BooleanMath(args?: BooleanMathArgs): BooleanMathNode
    BoundingBox(args?: BoundingBoxArgs): BoundingBoxNode
    CaptureAttribute(args?: CaptureAttributeArgs): CaptureAttributeNode
    Clamp(args?: ClampArgs): ClampNode
    ClusterByConnected(args?: ClusterByConnectedArgs): ClusterByConnectedNode
    ClusterByDistance(args?: ClusterByDistanceArgs): ClusterByDistanceNode
    Collection(args?: CollectionArgs): CollectionNode
    CollectionChildren(args?: CollectionChildrenArgs): CollectionChildrenNode
    CollectionInfo(args?: CollectionInfoArgs): CollectionInfoNode
    Color(args?: ColorArgs): ColorNode
    ColorRamp(args?: ColorRampArgs): ColorRampNode
    CombineColor(args?: CombineColorArgs): CombineColorNode
    CombineMatrix(args?: CombineMatrixArgs): CombineMatrixNode
    CombineTransform(args?: CombineTransformArgs): CombineTransformNode
    CombineXYZ(args?: CombineXYZArgs): CombineXYZNode
    Compare(args?: CompareArgs): CompareNode
    ConvexHull(args?: ConvexHullArgs): ConvexHullNode
    CornersOfEdge(args?: CornersOfEdgeArgs): CornersOfEdgeNode
    CornersOfFace(args?: CornersOfFaceArgs): CornersOfFaceNode
    CornersOfVertex(args?: CornersOfVertexArgs): CornersOfVertexNode
    CurveCircle(args?: CurveCircleArgs): CurveCircleNode
    CurveHandlePositions(args?: CurveHandlePositionsArgs): CurveHandlePositionsNode
    CurveLength(args?: CurveLengthArgs): CurveLengthNode
    CurveLine(args?: CurveLineArgs): CurveLineNode
    CurveOfPoint(args?: CurveOfPointArgs): CurveOfPointNode
    CurveTangent(args?: CurveTangentArgs): CurveTangentNode
    CurveTilt(args?: CurveTiltArgs): CurveTiltNode
    CurveToMesh(args?: CurveToMeshArgs): CurveToMeshNode
    CurveToPoints(args?: CurveToPointsArgs): CurveToPointsNode
    DeleteGeometry(args?: DeleteGeometryArgs): DeleteGeometryNode
    DistributePointsOnFaces(args?: DistributePointsOnFacesArgs): DistributePointsOnFacesNode
    DomainSize(args?: DomainSizeArgs): DomainSizeNode
    DualMesh(args?: DualMeshArgs): DualMeshNode
    DuplicateElements(args?: DuplicateElementsArgs): DuplicateElementsNode
    EdgeAngle(args?: EdgeAngleArgs): EdgeAngleNode
    EdgeNeighbors(args?: EdgeNeighborsArgs): EdgeNeighborsNode
    EdgePathsToCurves(args?: EdgePathsToCurvesArgs): EdgePathsToCurvesNode
    EdgePathsToSelection(args?: EdgePathsToSelectionArgs): EdgePathsToSelectionNode
    EdgesOfCorner(args?: EdgesOfCornerArgs): EdgesOfCornerNode
    EdgesOfVertex(args?: EdgesOfVertexArgs): EdgesOfVertexNode
    EdgesToFaceGroups(args?: EdgesToFaceGroupsArgs): EdgesToFaceGroupsNode
    EdgeVertices(args?: EdgeVerticesArgs): EdgeVerticesNode
    EndpointSelection(args?: EndpointSelectionArgs): EndpointSelectionNode
    EulerToRotation(args?: EulerToRotationArgs): EulerToRotationNode
    EvaluateAtIndex(args?: EvaluateAtIndexArgs): EvaluateAtIndexNode
    EvaluateOnDomain(args?: EvaluateOnDomainArgs): EvaluateOnDomainNode
    ExtrudeMesh(args?: ExtrudeMeshArgs): ExtrudeMeshNode
    FaceArea(args?: FaceAreaArgs): FaceAreaNode
    FaceGroupBoundaries(args?: FaceGroupBoundariesArgs): FaceGroupBoundariesNode
    FaceNeighbors(args?: FaceNeighborsArgs): FaceNeighborsNode
    FaceOfCorner(args?: FaceOfCornerArgs): FaceOfCornerNode
    FieldAverage(args?: FieldAverageArgs): FieldAverageNode
    FieldMinMax(args?: FieldMinMaxArgs): FieldMinMaxNode
    FieldToList(args?: FieldToListArgs): FieldToListNode
    FieldVariance(args?: FieldVarianceArgs): FieldVarianceNode
    FillCurve(args?: FillCurveArgs): FillCurveNode
    FilletCurve(args?: FilletCurveArgs): FilletCurveNode
    FilterList(args?: FilterListArgs): FilterListNode
    FindInString(args?: FindInStringArgs): FindInStringNode
    FlipFaces(args?: FlipFacesArgs): FlipFacesNode
    FloatCurve(args?: FloatCurveArgs): FloatCurveNode
    FloatToInteger(args?: FloatToIntegerArgs): FloatToIntegerNode
    GeometryProximity(args?: GeometryProximityArgs): GeometryProximityNode
    GeometryToInstance(args?: GeometryToInstanceArgs): GeometryToInstanceNode
    GetAttributeNames(args?: GetAttributeNamesArgs): GetAttributeNamesNode
    GetGeometryComponent(args?: GetGeometryComponentArgs): GetGeometryComponentNode
    GetListItem(args?: GetListItemArgs): GetListItemNode
    GradientTexture(args?: GradientTextureArgs): GradientTextureNode
    HandleTypeSelection(args?: HandleTypeSelectionArgs): HandleTypeSelectionNode
    HashValue(args?: HashValueArgs): HashValueNode
    ID(args?: IDArgs): IDNode
    Image(args?: ImageArgs): ImageNode
    ImageTexture(args?: ImageTextureArgs): ImageTextureNode
    Index(args?: IndexArgs): IndexNode
    IndexOfNearest(args?: IndexOfNearestArgs): IndexOfNearestNode
    IndexSwitch(args?: IndexSwitchArgs): IndexSwitchNode
    InstanceBounds(args?: InstanceBoundsArgs): InstanceBoundsNode
    InstanceOnPoints(args?: InstanceOnPointsArgs): InstanceOnPointsNode
    InstanceReference(args?: InstanceReferenceArgs): InstanceReferenceNode
    InstanceRotation(args?: InstanceRotationArgs): InstanceRotationNode
    InstanceScale(args?: InstanceScaleArgs): InstanceScaleNode
    InstancesToPoints(args?: InstancesToPointsArgs): InstancesToPointsNode
    InstanceTransform(args?: InstanceTransformArgs): InstanceTransformNode
    Integer(args?: IntegerArgs): IntegerNode
    IntegerMath(args?: IntegerMathArgs): IntegerMathNode
    InterpolateCurves(args?: InterpolateCurvesArgs): InterpolateCurvesNode
    InvertMatrix(args?: InvertMatrixArgs): InvertMatrixNode
    InvertRotation(args?: InvertRotationArgs): InvertRotationNode
    IsEdgeSmooth(args?: IsEdgeSmoothArgs): IsEdgeSmoothNode
    IsFacePlanar(args?: IsFacePlanarArgs): IsFacePlanarNode
    IsFaceSmooth(args?: IsFaceSmoothArgs): IsFaceSmoothNode
    IsSplineCyclic(args?: IsSplineCyclicArgs): IsSplineCyclicNode
    IsViewport(args?: IsViewportArgs): IsViewportNode
    JoinGeometry(args?: JoinGeometryArgs): JoinGeometryNode
    JoinStrings(args?: JoinStringsArgs): JoinStringsNode
    ListLength(args?: ListLengthArgs): ListLengthNode
    MapRange(args?: MapRangeArgs): MapRangeNode
    MatchString(args?: MatchStringArgs): MatchStringNode
    Material(args?: MaterialArgs): MaterialNode
    MaterialIndex(args?: MaterialIndexArgs): MaterialIndexNode
    MaterialSelection(args?: MaterialSelectionArgs): MaterialSelectionNode
    Math(args?: MathArgs): MathNode
    MatrixDeterminant(args?: MatrixDeterminantArgs): MatrixDeterminantNode
    MatrixSVD(args?: MatrixSVDArgs): MatrixSVDNode
    MenuSwitch(args?: MenuSwitchArgs): MenuSwitchNode
    MergeByDistance(args?: MergeByDistanceArgs): MergeByDistanceNode
    MergePoints(args?: MergePointsArgs): MergePointsNode
    MeshCircle(args?: MeshCircleArgs): MeshCircleNode
    MeshCone(args?: MeshConeArgs): MeshConeNode
    MeshCube(args?: MeshCubeArgs): MeshCubeNode
    MeshCylinder(args?: MeshCylinderArgs): MeshCylinderNode
    MeshGrid(args?: MeshGridArgs): MeshGridNode
    MeshIcoSphere(args?: MeshIcoSphereArgs): MeshIcoSphereNode
    MeshIsland(args?: MeshIslandArgs): MeshIslandNode
    MeshLine(args?: MeshLineArgs): MeshLineNode
    MeshToCurve(args?: MeshToCurveArgs): MeshToCurveNode
    MeshToPoints(args?: MeshToPointsArgs): MeshToPointsNode
    MeshUVSphere(args?: MeshUVSphereArgs): MeshUVSphereNode
    Mix(args?: MixArgs): MixNode
    MultiplyMatrices(args?: MultiplyMatricesArgs): MultiplyMatricesNode
    NamedAttribute(args?: NamedAttributeArgs): NamedAttributeNode
    NoiseTexture(args?: NoiseTextureArgs): NoiseTextureNode
    Normal(args?: NormalArgs): NormalNode
    Object(args?: ObjectArgs): ObjectNode
    ObjectInfo(args?: ObjectInfoArgs): ObjectInfoNode
    OffsetCornerInFace(args?: OffsetCornerInFaceArgs): OffsetCornerInFaceNode
    OffsetPointInCurve(args?: OffsetPointInCurveArgs): OffsetPointInCurveNode
    Points(args?: PointsArgs): PointsNode
    PointsOfCurve(args?: PointsOfCurveArgs): PointsOfCurveNode
    PointsToCurves(args?: PointsToCurvesArgs): PointsToCurvesNode
    PointsToVertices(args?: PointsToVerticesArgs): PointsToVerticesNode
    Position(args?: PositionArgs): PositionNode
    ProjectPoint(args?: ProjectPointArgs): ProjectPointNode
    QuadraticBezier(args?: QuadraticBezierArgs): QuadraticBezierNode
    Quadrilateral(args?: QuadrilateralArgs): QuadrilateralNode
    QuaternionToRotation(args?: QuaternionToRotationArgs): QuaternionToRotationNode
    Radius(args?: RadiusArgs): RadiusNode
    RandomValue(args?: RandomValueArgs): RandomValueNode
    Raycast(args?: RaycastArgs): RaycastNode
    RealizeInstances(args?: RealizeInstancesArgs): RealizeInstancesNode
    RemoveNamedAttribute(args?: RemoveNamedAttributeArgs): RemoveNamedAttributeNode
    RenameAttribute(args?: RenameAttributeArgs): RenameAttributeNode
    ReplaceMaterial(args?: ReplaceMaterialArgs): ReplaceMaterialNode
    ReplaceString(args?: ReplaceStringArgs): ReplaceStringNode
    ResampleCurve(args?: ResampleCurveArgs): ResampleCurveNode
    ReverseCurve(args?: ReverseCurveArgs): ReverseCurveNode
    ReverseString(args?: ReverseStringArgs): ReverseStringNode
    RotateEuler(args?: RotateEulerArgs): RotateEulerNode
    RotateInstances(args?: RotateInstancesArgs): RotateInstancesNode
    RotateRotation(args?: RotateRotationArgs): RotateRotationNode
    RotateVector(args?: RotateVectorArgs): RotateVectorNode
    Rotation(args?: RotationArgs): RotationNode
    RotationToAxisAngle(args?: RotationToAxisAngleArgs): RotationToAxisAngleNode
    RotationToEuler(args?: RotationToEulerArgs): RotationToEulerNode
    RotationToQuaternion(args?: RotationToQuaternionArgs): RotationToQuaternionNode
    SampleCurve(args?: SampleCurveArgs): SampleCurveNode
    SampleIndex(args?: SampleIndexArgs): SampleIndexNode
    SampleNearest(args?: SampleNearestArgs): SampleNearestNode
    SampleNearestSurface(args?: SampleNearestSurfaceArgs): SampleNearestSurfaceNode
    SampleUVSurface(args?: SampleUVSurfaceArgs): SampleUVSurfaceNode
    ScaleElements(args?: ScaleElementsArgs): ScaleElementsNode
    ScaleInstances(args?: ScaleInstancesArgs): ScaleInstancesNode
    SceneTime(args?: SceneTimeArgs): SceneTimeNode
    SelfObject(args?: SelfObjectArgs): SelfObjectNode
    SeparateColor(args?: SeparateColorArgs): SeparateColorNode
    SeparateComponents(args?: SeparateComponentsArgs): SeparateComponentsNode
    SeparateGeometry(args?: SeparateGeometryArgs): SeparateGeometryNode
    SeparateMatrix(args?: SeparateMatrixArgs): SeparateMatrixNode
    SeparateTransform(args?: SeparateTransformArgs): SeparateTransformNode
    SeparateXYZ(args?: SeparateXYZArgs): SeparateXYZNode
    SetCurveNormal(args?: SetCurveNormalArgs): SetCurveNormalNode
    SetCurveRadius(args?: SetCurveRadiusArgs): SetCurveRadiusNode
    SetCurveTilt(args?: SetCurveTiltArgs): SetCurveTiltNode
    SetGeometryName(args?: SetGeometryNameArgs): SetGeometryNameNode
    SetHandlePositions(args?: SetHandlePositionsArgs): SetHandlePositionsNode
    SetHandleType(args?: SetHandleTypeArgs): SetHandleTypeNode
    SetID(args?: SetIDArgs): SetIDNode
    SetInstanceTransform(args?: SetInstanceTransformArgs): SetInstanceTransformNode
    SetMaterial(args?: SetMaterialArgs): SetMaterialNode
    SetMaterialIndex(args?: SetMaterialIndexArgs): SetMaterialIndexNode
    SetNURBSOrder(args?: SetNURBSOrderArgs): SetNURBSOrderNode
    SetNURBSWeight(args?: SetNURBSWeightArgs): SetNURBSWeightNode
    SetPointRadius(args?: SetPointRadiusArgs): SetPointRadiusNode
    SetPosition(args?: SetPositionArgs): SetPositionNode
    SetShadeSmooth(args?: SetShadeSmoothArgs): SetShadeSmoothNode
    SetSplineCyclic(args?: SetSplineCyclicArgs): SetSplineCyclicNode
    SetSplineResolution(args?: SetSplineResolutionArgs): SetSplineResolutionNode
    SetSplineType(args?: SetSplineTypeArgs): SetSplineTypeNode
    SetStringCase(args?: SetStringCaseArgs): SetStringCaseNode
    ShortestEdgePaths(args?: ShortestEdgePathsArgs): ShortestEdgePathsNode
    SliceString(args?: SliceStringArgs): SliceStringNode
    SortElements(args?: SortElementsArgs): SortElementsNode
    SortList(args?: SortListArgs): SortListNode
    SpecialCharacters(args?: SpecialCharactersArgs): SpecialCharactersNode
    Spiral(args?: SpiralArgs): SpiralNode
    SplineLength(args?: SplineLengthArgs): SplineLengthNode
    SplineParameter(args?: SplineParameterArgs): SplineParameterNode
    SplineResolution(args?: SplineResolutionArgs): SplineResolutionNode
    SplitEdges(args?: SplitEdgesArgs): SplitEdgesNode
    SplitString(args?: SplitStringArgs): SplitStringNode
    SplitToInstances(args?: SplitToInstancesArgs): SplitToInstancesNode
    Star(args?: StarArgs): StarNode
    StoreNamedAttribute(args?: StoreNamedAttributeArgs): StoreNamedAttributeNode
    String(args?: StringArgs): StringNode
    StringLength(args?: StringLengthArgs): StringLengthNode
    StringToValue(args?: StringToValueArgs): StringToValueNode
    SubdivideCurve(args?: SubdivideCurveArgs): SubdivideCurveNode
    SubdivideMesh(args?: SubdivideMeshArgs): SubdivideMeshNode
    Switch(args?: SwitchArgs): SwitchNode
    TagFilter(args?: TagFilterArgs): TagFilterNode
    ThreepipeErosion(args?: ThreepipeErosionArgs): ThreepipeErosionNode
    TransferAttributes(args?: TransferAttributesArgs): TransferAttributesNode
    TransformDirection(args?: TransformDirectionArgs): TransformDirectionNode
    TransformGeometry(args?: TransformGeometryArgs): TransformGeometryNode
    TransformPoint(args?: TransformPointArgs): TransformPointNode
    TranslateInstances(args?: TranslateInstancesArgs): TranslateInstancesNode
    TransposeMatrix(args?: TransposeMatrixArgs): TransposeMatrixNode
    Triangulate(args?: TriangulateArgs): TriangulateNode
    TrimCurve(args?: TrimCurveArgs): TrimCurveNode
    TrimString(args?: TrimStringArgs): TrimStringNode
    Value(args?: ValueArgs): ValueNode
    ValueToString(args?: ValueToStringArgs): ValueToStringNode
    Vector(args?: VectorArgs): VectorNode
    VectorMath(args?: VectorMathArgs): VectorMathNode
    VectorRotate(args?: VectorRotateArgs): VectorRotateNode
    VertexNeighbors(args?: VertexNeighborsArgs): VertexNeighborsNode
    VertexOfCorner(args?: VertexOfCornerArgs): VertexOfCornerNode
    VoronoiTexture(args?: VoronoiTextureArgs): VoronoiTextureNode
    Warning(args?: WarningArgs): WarningNode
    WaveTexture(args?: WaveTextureArgs): WaveTextureNode
    WhiteNoiseTexture(args?: WhiteNoiseTextureArgs): WhiteNoiseTextureNode
}
