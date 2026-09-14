/**
 * BMesh operator parameter/result interfaces, extracted from Blender.
 *
 * GENERATED FILE - DO NOT EDIT.
 * Regenerate with: node extract-bmo-opdefines.mjs --blender-root <blender-src>
 *
 * Source:  source/blender/bmesh/intern/bmesh_opdefines.cc
 * Blender: 5.3.0 alpha @ e4e6c79a844306bb5deec9f14d5fe3c459bb1a39 (2026-06-11T04:24:28+02:00)
 * Contains 83 operators, 18 enum tables,
 * 353 input slots and 78 output slots.
 */

/* eslint-disable */

/*
 * Dependency-free by design: the element and math types below are declared structurally so this
 * file can be consumed before the real BMesh kernel exists, and so it never pulls in three.js.
 * Replace these declarations with `import type` lines once the kernel types land.
 */

/** Structural stand-in for `three.Vector3` / `{x, y, z}`. */
export interface Vector3Like { x: number; y: number; z: number }
/** Structural stand-in for `three.Matrix4`: 16 numbers, column-major, as in three.js and Blender. */
export interface Matrix4Like { elements: ArrayLike<number> }

/** Placeholder BMesh element types. */
export interface BMVert { readonly __bmElem: 'vert' }
export interface BMEdge { readonly __bmElem: 'edge' }
export interface BMLoop { readonly __bmElem: 'loop' }
export interface BMFace { readonly __bmElem: 'face' }
export type BMElem = BMVert | BMEdge | BMFace

/** Placeholders for Blender's `BMO_OP_SLOT_SUBTYPE_PTR_*` slots. */
export interface BMeshLike { readonly __bmesh: true }
/** Blender-only (`bpy.types.Scene`); no threepipe equivalent, kept so the table stays complete. */
export interface SceneLike { readonly __blenderScene: true }
/** Blender-only (`bpy.types.Object`). */
export interface ObjectLike { readonly __blenderObject: true }
/** Blender-only (`bpy.types.Mesh`). */
export interface MeshLike { readonly __blenderMesh: true }
/** Blender-only opaque struct pointer (`BMO_OP_SLOT_SUBTYPE_PTR_STRUCT`, used for `CurveProfile`). */
export interface StructLike { readonly __blenderStruct: true }

/*
 * Required vs optional: an input slot is required only when it is an element-buffer slot using one
 * of the primary geometry names documented in bmesh_opdefines.cc ("A word on slot names"):
 * verts, edges, faces, geom, input. Everything else is optional, because Blender
 * zero-initialises every slot. This is the only heuristic in the generator - see README.md.
 */

/**
 * Vertex Smooth.
 *
 * Smooths vertices by using a basic vertex averaging scheme.
 */
export interface SmoothVertParams {
    verts: BMVert[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    factor?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorClipX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorClipY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorClipZ?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    clipDist?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useAxisX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useAxisY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useAxisZ?: boolean
}

/** Output slots of `smooth_vert`. */
export interface SmoothVertResult {
    // this operator has no output slots
}

/**
 * Vertex Smooth Laplacian.
 *
 * Smooths vertices by using Laplacian smoothing proposed by
 * Desbrun, et al. Implicit Fairing of Irregular Meshes using Diffusion and Curvature Flow.
 */
export interface SmoothLaplacianVertParams {
    verts: BMVert[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    lambdaFactor?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    lambdaBorder?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useZ?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    preserveVolume?: boolean
}

/** Output slots of `smooth_laplacian_vert`. */
export interface SmoothLaplacianVertResult {
    // this operator has no output slots
}

/**
 * Right-Hand Faces.
 *
 * Computes an "outside" normal for the specified input faces.
 */
export interface RecalcFaceNormalsParams {
    faces: BMFace[]
}

/** Output slots of `recalc_face_normals`. */
export interface RecalcFaceNormalsResult {
    // this operator has no output slots
}

/**
 * Planar Faces.
 *
 * Iteratively flatten faces.
 */
export interface PlanarFacesParams {
    faces: BMFace[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    iterations?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    factor?: number
}

/** Output slots of `planar_faces`. */
export interface PlanarFacesResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Region Extend.
 *
 * Used to implement the select more/less tools.
 * Puts geometry surrounding regions of geometry in `geom` into `geom.out`.
 *
 * If `use_faces` is 0 then `geom.out` spits out verts and edges,
 * otherwise it spits out faces.
 */
export interface RegionExtendParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useContract?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useFaces?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useFaceStep?: boolean
}

/** Output slots of `region_extend`. */
export interface RegionExtendResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Edge Rotate.
 *
 * Rotates edges topologically. Also known as "spin edge" to some people.
 * Simple example: `[/] becomes [|] then [\]`.
 */
export interface RotateEdgesParams {
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCcw?: boolean
}

/** Output slots of `rotate_edges`. */
export interface RotateEdgesResult {
    edges: BMEdge[]
}

/**
 * Reverse Faces.
 *
 * Reverses the winding (vertex order) of faces.
 * This has the effect of flipping the normal.
 */
export interface ReverseFacesParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    flipMultires?: boolean
}

/** Output slots of `reverse_faces`. */
export interface ReverseFacesResult {
    // this operator has no output slots
}

/**
 * Flip Quad Tessellation
 *
 * Flip the tessellation direction of the selected quads.
 */
export interface FlipQuadTessellationParams {
    faces: BMFace[]
}

/** Output slots of `flip_quad_tessellation`. */
export interface FlipQuadTessellationResult {
    // this operator has no output slots
}

/**
 * Edge Bisect.
 *
 * Splits input edges (but doesn't do anything else).
 * This creates a 2-valence vert.
 */
export interface BisectEdgesParams {
    edges: BMEdge[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    cuts?: number
    /** default: empty map (bmo_op_slots_init allocates an empty GHash) */
    edgePercents?: Map<BMElem, number>
}

/** Output slots of `bisect_edges`. */
export interface BisectEdgesResult {
    geomSplit: (BMVert | BMEdge | BMFace)[]
}

/**
 * Mirror.
 *
 * Mirrors geometry along an axis. The resulting geometry is welded on using
 * `merge_dist`. Pairs of original/mirrored vertices are welded using the `merge_dist`
 * parameter (which defines the minimum distance for welding to happen).
 */
export interface MirrorParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    mergeDist?: number
    /**
     * default: "X" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_axis_xyz
     */
    axis?: "X" | "Y" | "Z"
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorU?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorV?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorUdim?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `mirror`. */
export interface MirrorResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Find Doubles.
 *
 * Takes input verts and finds vertices they should weld to.
 * Outputs a mapping slot suitable for use with the weld verts BMOP.
 *
 * If `keep_verts` is used, vertices outside that set can only be merged
 * with vertices in that set.
 */
export interface FindDoublesParams {
    verts: BMVert[]
    /** default: [] (slots are zero-initialised by BMO_op_init) */
    keepVerts?: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useConnected?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    dist?: number
}

/** Output slots of `find_doubles`. */
export interface FindDoublesResult {
    targetmap: Map<BMElem, BMElem>
}

/**
 * Remove Doubles.
 *
 * Finds groups of vertices closer than dist and merges them together,
 * using the weld verts BMOP.
 */
export interface RemoveDoublesParams {
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useConnected?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    dist?: number
}

/** Output slots of `remove_doubles`. */
export interface RemoveDoublesResult {
    // this operator has no output slots
}

/**
 * Circularize.
 *
 * Shape selected geometry into a circle.
 */
export interface CircularizeParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    factor?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    customRadius?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    angle?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    fitMethod?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    flatten?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    regular?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockZ?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    mirrorZ?: boolean
}

/** Output slots of `circularize`. */
export interface CircularizeResult {
    // this operator has no output slots
}

/**
 * Flatten.
 *
 * Flatten vertices on a best-fitting plane.
 */
export interface FlattenParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    factor?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    method?: number
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    viewNormal?: Vector3Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockZ?: boolean
}

/** Output slots of `flatten`. */
export interface FlattenResult {
    // this operator has no output slots
}

/**
 * Collapse Connected.
 *
 * Collapses connected vertices
 */
export interface CollapseParams {
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    uvs?: boolean
}

/** Output slots of `collapse`. */
export interface CollapseResult {
    // this operator has no output slots
}

/**
 * Face-Data Point Merge.
 *
 * Merge uv/vcols at a specific vertex.
 */
export interface PointmergeFacedataParams {
    verts: BMVert[]
    /** default: null (slots are zero-initialised by BMO_op_init) */
    vertTarget?: (BMVert) | null
}

/** Output slots of `pointmerge_facedata`. */
export interface PointmergeFacedataResult {
    // this operator has no output slots
}

/**
 * Average Vertices Face-vert Data.
 *
 * Merge uv/vcols associated with the input vertices at
 * the bounding box center.
 */
export interface AverageVertFacedataParams {
    verts: BMVert[]
}

/** Output slots of `average_vert_facedata`. */
export interface AverageVertFacedataResult {
    // this operator has no output slots
}

/**
 * Point Merge.
 *
 * Merge verts together at a point.
 */
export interface PointmergeParams {
    verts: BMVert[]
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    mergeCo?: Vector3Like
    /** default: null (slots are zero-initialised by BMO_op_init) */
    vertTarget?: (BMVert) | null
}

/** Output slots of `pointmerge`. */
export interface PointmergeResult {
    // this operator has no output slots
}

/**
 * Collapse Connected UVs.
 *
 * Collapses connected UV vertices.
 */
export interface CollapseUvsParams {
    edges: BMEdge[]
}

/** Output slots of `collapse_uvs`. */
export interface CollapseUvsResult {
    // this operator has no output slots
}

/**
 * Weld Verts.
 *
 * Welds verts together (kind-of like remove doubles, merge, etc, all of which
 * use or will use this BMOP). You pass in mappings from vertices to the vertices
 * they weld with.
 */
export interface WeldVertsParams {
    /** default: empty map (bmo_op_slots_init allocates an empty GHash) */
    targetmap?: Map<BMElem, BMElem>
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCentroid?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    averageVertData?: boolean
}

/** Output slots of `weld_verts`. */
export interface WeldVertsResult {
    // this operator has no output slots
}

/**
 * Make Vertex.
 *
 * Creates a single vertex; this BMOP was necessary
 * for click-create-vertex.
 */
export interface CreateVertParams {
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    co?: Vector3Like
}

/** Output slots of `create_vert`. */
export interface CreateVertResult {
    vert: BMVert[]
}

/**
 * Join Triangles.
 *
 * Tries to intelligently join triangles according
 * to angle threshold and delimiters.
 */
export interface JoinTrianglesParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    cmpSeam?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    cmpSharp?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    cmpUvs?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    cmpVcols?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    cmpMaterials?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    angleFaceThreshold?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    angleShapeThreshold?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    topologyInfluence?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    deselectJoined?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    mergeLimit?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    neighborDebug?: number
}

/** Output slots of `join_triangles`. */
export interface JoinTrianglesResult {
    faces: BMFace[]
}

/**
 * Contextual Create.
 *
 * This is basically F-key, it creates
 * new faces from vertices, makes stuff from edge nets,
 * makes wire edges, etc. It also dissolves faces.
 *
 * Three verts become a triangle, four become a quad. Two
 * become a wire edge.
 */
export interface ContextualCreateParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    matNr?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSmooth?: boolean
}

/** Output slots of `contextual_create`. */
export interface ContextualCreateResult {
    faces: BMFace[]
    edges: BMEdge[]
}

/** Bridge edge loops with faces. */
export interface BridgeLoopsParams {
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    usePairs?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCyclic?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useMerge?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    mergeFactor?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    twistOffset?: number
}

/** Output slots of `bridge_loops`. */
export interface BridgeLoopsResult {
    faces: BMFace[]
    edges: BMEdge[]
}

/**
 * Grid Fill.
 *
 * Create faces defined by 2 disconnected edge loops (which share edges).
 */
export interface GridFillParams {
    edges: BMEdge[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    matNr?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSmooth?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useInterpSimple?: boolean
}

/** Output slots of `grid_fill`. */
export interface GridFillResult {
    faces: BMFace[]
}

/**
 * Fill Holes.
 *
 * Fill boundary edges with faces, copying surrounding custom-data.
 */
export interface HolesFillParams {
    edges: BMEdge[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    sides?: number
}

/** Output slots of `holes_fill`. */
export interface HolesFillResult {
    faces: BMFace[]
}

/**
 * Face Attribute Fill.
 *
 * Fill in faces with data from adjacent faces.
 */
export interface FaceAttributeFillParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useNormals?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useData?: boolean
}

/** Output slots of `face_attribute_fill`. */
export interface FaceAttributeFillResult {
    facesFail: BMFace[]
}

/**
 * Edge Loop Fill.
 *
 * Create faces defined by one or more non overlapping edge loops.
 */
export interface EdgeloopFillParams {
    edges: BMEdge[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    matNr?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSmooth?: boolean
}

/** Output slots of `edgeloop_fill`. */
export interface EdgeloopFillResult {
    faces: BMFace[]
}

/**
 * Edge Net Fill.
 *
 * Create faces defined by enclosed edges.
 */
export interface EdgenetFillParams {
    edges: BMEdge[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    matNr?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSmooth?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    sides?: number
}

/** Output slots of `edgenet_fill`. */
export interface EdgenetFillResult {
    faces: BMFace[]
}

/**
 * Edge-net Prepare.
 *
 * Identifies several useful edge loop cases and modifies them so
 * they'll become a face when edgenet_fill is called. The cases covered are:
 *
 * - One single loop; an edge is added to connect the ends
 * - Two loops; two edges are added to connect the endpoints (based on the
 *   shortest distance between each endpoint).
 */
export interface EdgenetPrepareParams {
    edges: BMEdge[]
}

/** Output slots of `edgenet_prepare`. */
export interface EdgenetPrepareResult {
    edges: BMEdge[]
}

/**
 * Rotate.
 *
 * Rotate vertices around a center, using a 3x3 rotation matrix.
 */
export interface RotateParams {
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    cent?: Vector3Like
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    verts: BMVert[]
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    space?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `rotate`. */
export interface RotateResult {
    // this operator has no output slots
}

/**
 * Translate.
 *
 * Translate vertices by an offset.
 */
export interface TranslateParams {
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    vec?: Vector3Like
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    space?: Matrix4Like
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `translate`. */
export interface TranslateResult {
    // this operator has no output slots
}

/**
 * Scale.
 *
 * Scales vertices by a factor.
 */
export interface ScaleParams {
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    vec?: Vector3Like
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    space?: Matrix4Like
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `scale`. */
export interface ScaleResult {
    // this operator has no output slots
}

/**
 * Transform.
 *
 * Transforms a set of vertices by a matrix. Multiplies
 * the vertex coordinates with the matrix.
 */
export interface TransformParams {
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    space?: Matrix4Like
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `transform`. */
export interface TransformResult {
    // this operator has no output slots
}

/**
 * Object Load BMesh.
 *
 * Loads a bmesh into an object/mesh. This is a "private"
 * BMOP.
 */
export interface ObjectLoadBmeshParams {
    /** default: null (slots are zero-initialised by BMO_op_init) */
    scene?: SceneLike | null
    /** default: null (slots are zero-initialised by BMO_op_init) */
    object?: ObjectLike | null
}

/** Output slots of `object_load_bmesh`. */
export interface ObjectLoadBmeshResult {
    // this operator has no output slots
}

/**
 * BMesh to Mesh.
 *
 * Converts a bmesh to a Mesh. This is reserved for exiting edit-mode.
 */
export interface BmeshToMeshParams {
    /** default: null (slots are zero-initialised by BMO_op_init) */
    mesh?: MeshLike | null
    /** default: null (slots are zero-initialised by BMO_op_init) */
    object?: ObjectLike | null
}

/** Output slots of `bmesh_to_mesh`. */
export interface BmeshToMeshResult {
    // this operator has no output slots
}

/**
 * Mesh to BMesh.
 *
 * Load the contents of a mesh into the bmesh. this BMOP is private, it's
 * reserved exclusively for entering edit-mode.
 */
export interface MeshToBmeshParams {
    /** default: null (slots are zero-initialised by BMO_op_init) */
    mesh?: MeshLike | null
    /** default: null (slots are zero-initialised by BMO_op_init) */
    object?: ObjectLike | null
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `mesh_to_bmesh`. */
export interface MeshToBmeshResult {
    // this operator has no output slots
}

/**
 * Individual Face Extrude.
 *
 * Extrudes faces individually.
 */
export interface ExtrudeDiscreteFacesParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useNormalFlip?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSelectHistory?: boolean
}

/** Output slots of `extrude_discrete_faces`. */
export interface ExtrudeDiscreteFacesResult {
    faces: BMFace[]
}

/**
 * Extrude Only Edges.
 *
 * Extrudes Edges into faces, note that this is very simple, there's no fancy
 * winged extrusion.
 */
export interface ExtrudeEdgeOnlyParams {
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useNormalFlip?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSelectHistory?: boolean
}

/** Output slots of `extrude_edge_only`. */
export interface ExtrudeEdgeOnlyResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Individual Vertex Extrude.
 *
 * Extrudes individual vertices, creating new vertices connected by wire edges.
 */
export interface ExtrudeVertIndivParams {
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSelectHistory?: boolean
}

/** Output slots of `extrude_vert_indiv`. */
export interface ExtrudeVertIndivResult {
    edges: BMEdge[]
    verts: BMVert[]
}

/**
 * Connect Verts.
 *
 * Split faces by adding edges that connect `verts`.
 */
export interface ConnectVertsParams {
    verts: BMVert[]
    /** default: [] (slots are zero-initialised by BMO_op_init) */
    facesExclude?: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    checkDegenerate?: boolean
}

/** Output slots of `connect_verts`. */
export interface ConnectVertsResult {
    edges: BMEdge[]
}

/**
 * Connect Verts to form Convex Faces.
 *
 * Splits concave faces into convex faces.
 */
export interface ConnectVertsConcaveParams {
    faces: BMFace[]
}

/** Output slots of `connect_verts_concave`. */
export interface ConnectVertsConcaveResult {
    edges: BMEdge[]
    faces: BMFace[]
}

/**
 * Connect Verts Across non Planar Faces.
 *
 * Split faces by connecting edges along non planar `faces`.
 */
export interface ConnectVertsNonplanarParams {
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    angleLimit?: number
    faces: BMFace[]
}

/** Output slots of `connect_verts_nonplanar`. */
export interface ConnectVertsNonplanarResult {
    edges: BMEdge[]
    faces: BMFace[]
}

/**
 * Connect Vert Pair.
 *
 * Connect a pair of vertices by splitting faces along the shortest path between them.
 */
export interface ConnectVertPairParams {
    verts: BMVert[]
    /** default: [] (slots are zero-initialised by BMO_op_init) */
    vertsExclude?: BMVert[]
    /** default: [] (slots are zero-initialised by BMO_op_init) */
    facesExclude?: BMFace[]
}

/** Output slots of `connect_vert_pair`. */
export interface ConnectVertPairResult {
    edges: BMEdge[]
}

/**
 * Extrude Faces.
 *
 * Extrude operator (does not transform)
 */
export interface ExtrudeFaceRegionParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: empty set (bmo_op_slots_init allocates an empty GHash) */
    edgesExclude?: Set<BMElem>
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useKeepOrig?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useNormalFlip?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useNormalFromAdjacent?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useDissolveOrthoEdges?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSelectHistory?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    skipInputFlip?: boolean
}

/** Output slots of `extrude_face_region`. */
export interface ExtrudeFaceRegionResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/** Dissolve Verts. */
export interface DissolveVertsParams {
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useFaceSplit?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useBoundaryTear?: boolean
}

/** Output slots of `dissolve_verts`. */
export interface DissolveVertsResult {
    // this operator has no output slots
}

/** Dissolve Edges. */
export interface DissolveEdgesParams {
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useVerts?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useFaceSplit?: boolean
    /** default: M_PI (set by bmo_dissolve_edges_init, source/blender/bmesh/operators/bmo_dissolve.cc:452) */
    angleThreshold?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    usePreserveQuads?: boolean
}

/** Output slots of `dissolve_edges`. */
export interface DissolveEdgesResult {
    region: BMFace[]
}

/** Dissolve Faces. */
export interface DissolveFacesParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useVerts?: boolean
}

/** Output slots of `dissolve_faces`. */
export interface DissolveFacesResult {
    region: BMFace[]
}

/**
 * Limited Dissolve.
 *
 * Dissolve planar faces and co-linear edges.
 */
export interface DissolveLimitParams {
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    angleLimit?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useDissolveBoundaries?: boolean
    verts: BMVert[]
    edges: BMEdge[]
    /**
     * default: "NORMAL" (= 1; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_dissolve_limit_flags
     */
    delimit?: ("NORMAL" | "MATERIAL" | "SEAM" | "SHARP" | "UV")[]
}

/** Output slots of `dissolve_limit`. */
export interface DissolveLimitResult {
    region: BMFace[]
}

/**
 * Degenerate Dissolve.
 *
 * Dissolve edges with no length, faces with no area.
 */
export interface DissolveDegenerateParams {
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    dist?: number
    edges: BMEdge[]
}

/** Output slots of `dissolve_degenerate`. */
export interface DissolveDegenerateResult {
    // this operator has no output slots
}

/**
 * Triangulate.
 *
 * Triangulate faces, splitting quads and n-gons into triangles.
 */
export interface TriangulateParams {
    faces: BMFace[]
    /**
     * default: "BEAUTY" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_triangulate_quad_method
     */
    quadMethod?: "BEAUTY" | "FIXED" | "ALTERNATE" | "SHORT_EDGE" | "LONG_EDGE"
    /**
     * default: "BEAUTY" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_triangulate_ngon_method
     */
    ngonMethod?: "BEAUTY" | "EAR_CLIP"
}

/** Output slots of `triangulate`. */
export interface TriangulateResult {
    edges: BMEdge[]
    faces: BMFace[]
    faceMap: Map<BMElem, BMElem>
    faceMapDouble: Map<BMElem, BMElem>
}

/**
 * Un-Subdivide.
 *
 * Reduce detail in geometry containing grids.
 */
export interface UnsubdivideParams {
    verts: BMVert[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    iterations?: number
}

/** Output slots of `unsubdivide`. */
export interface UnsubdivideResult {
    // this operator has no output slots
}

/**
 * Subdivide Edges.
 *
 * Advanced operator for subdividing edges
 * with options for face patterns, smoothing and randomization.
 */
export interface SubdivideEdgesParams {
    edges: BMEdge[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    smooth?: number
    /**
     * default: "SMOOTH" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_falloff_type
     */
    smoothFalloff?: "SMOOTH" | "SPHERE" | "ROOT" | "SHARP" | "LINEAR" | "INVERSE_SQUARE"
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    fractal?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    alongNormal?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    cuts?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    seed?: number
    /** default: empty map (bmo_op_slots_init allocates an empty GHash) */
    customPatterns?: Map<BMElem, unknown>
    /** default: empty map (bmo_op_slots_init allocates an empty GHash) */
    edgePercents?: Map<BMElem, number>
    /**
     * default: "STRAIGHT_CUT" (= 3; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_subdivide_edges_quad_corner_type
     */
    quadCornerType?: "STRAIGHT_CUT" | "INNER_VERT" | "PATH" | "FAN"
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useGridFill?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSingleEdge?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useOnlyQuads?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSphere?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSmoothEven?: boolean
}

/** Output slots of `subdivide_edges`. */
export interface SubdivideEdgesResult {
    geomInner: (BMVert | BMEdge | BMFace)[]
    geomSplit: (BMVert | BMEdge | BMFace)[]
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Subdivide Edge-Ring.
 *
 * Take an edge-ring, and subdivide with interpolation options.
 */
export interface SubdivideEdgeringParams {
    edges: BMEdge[]
    /**
     * default: "LINEAR" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_subdivide_edgering_interp_mode
     */
    interpMode?: "LINEAR" | "PATH" | "SURFACE"
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    smooth?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    cuts?: number
    /**
     * default: "SMOOTH" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_falloff_type
     */
    profileShape?: "SMOOTH" | "SPHERE" | "ROOT" | "SHARP" | "LINEAR" | "INVERSE_SQUARE"
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    profileShapeFactor?: number
}

/** Output slots of `subdivide_edgering`. */
export interface SubdivideEdgeringResult {
    faces: BMFace[]
}

/**
 * Bisect Plane.
 *
 * Bisects the mesh by a plane (cut the mesh in half).
 */
export interface BisectPlaneParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    dist?: number
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    planeCo?: Vector3Like
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    planeNo?: Vector3Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSnapCenter?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    clearOuter?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    clearInner?: boolean
}

/** Output slots of `bisect_plane`. */
export interface BisectPlaneResult {
    geomCut: (BMVert | BMEdge)[]
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Delete Geometry.
 *
 * Utility operator to delete geometry.
 */
export interface DeleteParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * default: "VERTS" (= 1; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_delete_context
     */
    context?: "VERTS" | "EDGES" | "FACES_ONLY" | "EDGES_FACES" | "FACES" | "FACES_KEEP_BOUNDARY" | "TAGGED_ONLY"
}

/** Output slots of `delete`. */
export interface DeleteResult {
    // this operator has no output slots
}

/**
 * Duplicate Geometry.
 *
 * Utility operator to duplicate geometry,
 * optionally into a destination mesh.
 */
export interface DuplicateParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: null (slots are zero-initialised by BMO_op_init) */
    dest?: BMeshLike | null
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useSelectHistory?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useEdgeFlipFromFace?: boolean
}

/** Output slots of `duplicate`. */
export interface DuplicateResult {
    geomOrig: (BMVert | BMEdge | BMFace)[]
    geom: (BMVert | BMEdge | BMFace)[]
    vertMap: Map<BMElem, BMElem>
    edgeMap: Map<BMElem, BMElem>
    faceMap: Map<BMElem, BMElem>
    boundaryMap: Map<BMElem, BMElem>
    isovertMap: Map<BMElem, BMElem>
}

/**
 * Split Off Geometry.
 *
 * Disconnect geometry from adjacent edges and faces,
 * optionally into a destination mesh.
 */
export interface SplitParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: null (slots are zero-initialised by BMO_op_init) */
    dest?: BMeshLike | null
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useOnlyFaces?: boolean
}

/** Output slots of `split`. */
export interface SplitResult {
    geom: (BMVert | BMEdge | BMFace)[]
    boundaryMap: Map<BMElem, BMElem>
    isovertMap: Map<BMElem, BMElem>
}

/**
 * Spin.
 *
 * Extrude or duplicate geometry a number of times,
 * rotating and possibly translating after each step
 */
export interface SpinParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    cent?: Vector3Like
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    axis?: Vector3Like
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    dvec?: Vector3Like
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    angle?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    space?: Matrix4Like
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    steps?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useMerge?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useNormalFlip?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useDuplicate?: boolean
}

/** Output slots of `spin`. */
export interface SpinResult {
    geomLast: (BMVert | BMEdge | BMFace)[]
}

/**
 * UV Rotation.
 *
 * Cycle the loop UVs
 */
export interface RotateUvsParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCcw?: boolean
}

/** Output slots of `rotate_uvs`. */
export interface RotateUvsResult {
    // this operator has no output slots
}

/**
 * UV Reverse.
 *
 * Reverse the UVs
 */
export interface ReverseUvsParams {
    faces: BMFace[]
}

/** Output slots of `reverse_uvs`. */
export interface ReverseUvsResult {
    // this operator has no output slots
}

/**
 * Color Rotation.
 *
 * Cycle the loop colors
 */
export interface RotateColorsParams {
    faces: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCcw?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    colorIndex?: number
}

/** Output slots of `rotate_colors`. */
export interface RotateColorsResult {
    // this operator has no output slots
}

/**
 * Color Reverse
 *
 * Reverse the loop colors.
 */
export interface ReverseColorsParams {
    faces: BMFace[]
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    colorIndex?: number
}

/** Output slots of `reverse_colors`. */
export interface ReverseColorsResult {
    // this operator has no output slots
}

/**
 * Edge Split.
 *
 * Disconnects faces along input edges.
 */
export interface SplitEdgesParams {
    edges: BMEdge[]
    verts: BMVert[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useVerts?: boolean
}

/** Output slots of `split_edges`. */
export interface SplitEdgesResult {
    edges: BMEdge[]
}

/**
 * Create Grid.
 *
 * Creates a grid with a variable number of subdivisions
 */
export interface CreateGridParams {
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    xSegments?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    ySegments?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    size?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_grid`. */
export interface CreateGridResult {
    verts: BMVert[]
}

/**
 * Create UV Sphere.
 *
 * Creates a UV sphere with a variable number of subdivisions.
 */
export interface CreateUvsphereParams {
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    uSegments?: number
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    vSegments?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    radius?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_uvsphere`. */
export interface CreateUvsphereResult {
    verts: BMVert[]
}

/**
 * Create Ico-Sphere.
 *
 * Creates an ico-sphere with a variable number of subdivisions.
 */
export interface CreateIcosphereParams {
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    subdivisions?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    radius?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_icosphere`. */
export interface CreateIcosphereResult {
    verts: BMVert[]
}

/**
 * Create Suzanne.
 *
 * Creates a monkey (standard blender primitive).
 */
export interface CreateMonkeyParams {
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_monkey`. */
export interface CreateMonkeyResult {
    verts: BMVert[]
}

/**
 * Create Cone.
 *
 * Creates a cone with variable radius at both ends
 */
export interface CreateConeParams {
    /** default: false (slots are zero-initialised by BMO_op_init) */
    capEnds?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    capTris?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    segments?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    radius1?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    radius2?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    depth?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_cone`. */
export interface CreateConeResult {
    verts: BMVert[]
}

/** Creates a Circle. */
export interface CreateCircleParams {
    /** default: false (slots are zero-initialised by BMO_op_init) */
    capEnds?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    capTris?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    segments?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    radius?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_circle`. */
export interface CreateCircleResult {
    verts: BMVert[]
}

/**
 * Create Cube
 *
 * Creates a cube.
 */
export interface CreateCubeParams {
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    size?: number
    /** default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot) */
    matrix?: Matrix4Like
    /** default: false (slots are zero-initialised by BMO_op_init) */
    calcUvs?: boolean
}

/** Output slots of `create_cube`. */
export interface CreateCubeResult {
    verts: BMVert[]
}

/**
 * Bevel.
 *
 * Bevels edges and vertices
 */
export interface BevelParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    offset?: number
    /**
     * default: "OFFSET" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_offset_type
     */
    offsetType?: "OFFSET" | "WIDTH" | "DEPTH" | "PERCENT" | "ABSOLUTE"
    /**
     * default: "SUPERELLIPSE" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_profile_type
     */
    profileType?: "SUPERELLIPSE" | "CUSTOM"
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    segments?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    profile?: number
    /**
     * default: "VERTICES" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_affect_type
     */
    affect?: "VERTICES" | "EDGES"
    /** default: false (slots are zero-initialised by BMO_op_init) */
    clampOverlap?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    material?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    loopSlide?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    markSeam?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    markSharp?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    hardenNormals?: boolean
    /**
     * default: "NONE" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_face_strength_type
     */
    faceStrengthMode?: "NONE" | "NEW" | "AFFECTED" | "ALL"
    /**
     * default: "SHARP" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_miter_type
     */
    miterOuter?: "SHARP" | "PATCH" | "ARC"
    /**
     * default: "SHARP" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_miter_type
     */
    miterInner?: "SHARP" | "PATCH" | "ARC"
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    spread?: number
    /** default: null (slots are zero-initialised by BMO_op_init) */
    customProfile?: StructLike | null
    /**
     * default: "ADJ" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_bevel_vmesh_method
     */
    vmeshMethod?: "ADJ" | "CUTOFF"
}

/** Output slots of `bevel`. */
export interface BevelResult {
    faces: BMFace[]
    edges: BMEdge[]
    verts: BMVert[]
}

/**
 * Beautify Fill.
 *
 * Rotate edges to create more evenly spaced triangles.
 */
export interface BeautifyFillParams {
    faces: BMFace[]
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useRestrictTag?: boolean
    /**
     * default: "AREA" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_beautify_fill_method
     */
    method?: "AREA" | "ANGLE"
}

/** Output slots of `beautify_fill`. */
export interface BeautifyFillResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Triangle Fill.
 *
 * Fill edges with triangles
 */
export interface TriangleFillParams {
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useBeauty?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useDissolve?: boolean
    edges: BMEdge[]
    /** default: (0, 0, 0) (slots are zero-initialised by BMO_op_init) */
    normal?: Vector3Like
}

/** Output slots of `triangle_fill`. */
export interface TriangleFillResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Solidify.
 *
 * Turns a mesh into a shell with thickness
 */
export interface SolidifyParams {
    geom: (BMVert | BMEdge | BMFace)[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    thickness?: number
}

/** Output slots of `solidify`. */
export interface SolidifyResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Face Inset (Individual).
 *
 * Insets individual faces.
 */
export interface InsetIndividualParams {
    faces: BMFace[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    thickness?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    depth?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useEvenOffset?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useInterpolate?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useRelativeOffset?: boolean
}

/** Output slots of `inset_individual`. */
export interface InsetIndividualResult {
    faces: BMFace[]
}

/**
 * Face Inset (Regions).
 *
 * Inset or outset face regions.
 */
export interface InsetRegionParams {
    faces: BMFace[]
    /** default: [] (slots are zero-initialised by BMO_op_init) */
    facesExclude?: BMFace[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useBoundary?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useEvenOffset?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useInterpolate?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useRelativeOffset?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useEdgeRail?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    thickness?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    depth?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useOutset?: boolean
}

/** Output slots of `inset_region`. */
export interface InsetRegionResult {
    faces: BMFace[]
}

/**
 * Edge-loop Offset.
 *
 * Creates edge loops based on simple edge-outset method.
 */
export interface OffsetEdgeloopsParams {
    edges: BMEdge[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCapEndpoint?: boolean
}

/** Output slots of `offset_edgeloops`. */
export interface OffsetEdgeloopsResult {
    edges: BMEdge[]
}

/**
 * Wire Frame.
 *
 * Makes a wire-frame copy of faces.
 */
export interface WireframeParams {
    faces: BMFace[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    thickness?: number
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    offset?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useReplace?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useBoundary?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useEvenOffset?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useCrease?: boolean
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    creaseWeight?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useRelativeOffset?: boolean
    /** default: 0 (slots are zero-initialised by BMO_op_init) */
    materialOffset?: number
}

/** Output slots of `wireframe`. */
export interface WireframeResult {
    faces: BMFace[]
}

/**
 * Pokes a face.
 *
 * Splits a face into a triangle fan.
 */
export interface PokeParams {
    faces: BMFace[]
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    offset?: number
    /**
     * default: "MEAN_WEIGHTED" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_poke_center_mode
     */
    centerMode?: "MEAN_WEIGHTED" | "MEAN" | "BOUNDS"
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useRelativeOffset?: boolean
}

/** Output slots of `poke`. */
export interface PokeResult {
    verts: BMVert[]
    faces: BMFace[]
}

/**
 * Convex Hull
 *
 * Builds a convex hull from the vertices in `input`.
 *
 * If `use_existing_faces` is true, the hull will not output triangles
 * that are covered by a pre-existing face.
 *
 * All hull vertices, faces, and edges are added to `geom.out`. Any
 * input elements that end up inside the hull (i.e. are not used by an
 * output face) are added to the `geom_interior.out` slot. The
 * `geom_unused.out` slot will contain all interior geometry that is
 * completely unused. Lastly, `geom_holes.out` contains edges and faces
 * that were in the input and are part of the hull.
 */
export interface ConvexHullParams {
    input: (BMVert | BMEdge | BMFace)[]
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useExistingFaces?: boolean
}

/** Output slots of `convex_hull`. */
export interface ConvexHullResult {
    geom: (BMVert | BMEdge | BMFace)[]
    geomInterior: (BMVert | BMEdge | BMFace)[]
    geomUnused: (BMVert | BMEdge | BMFace)[]
    geomHoles: (BMVert | BMEdge | BMFace)[]
}

/**
 * Space Evenly.
 *
 * Space the vertices in a regular distribution on the loop.
 */
export interface SpaceEdgeLoopsEvenlyParams {
    geom: BMEdge[]
    /**
     * default: "CUBIC" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_space_edge_loops_evenly_interpolation_method
     */
    interpolation?: "CUBIC" | "LINEAR"
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    factor?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockX?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockY?: boolean
    /** default: false (slots are zero-initialised by BMO_op_init) */
    lockZ?: boolean
}

/** Output slots of `space_edge_loops_evenly`. */
export interface SpaceEdgeLoopsEvenlyResult {
    // this operator has no output slots
}

/**
 * Symmetrize.
 *
 * Makes the mesh elements in the `input` slot symmetrical. Unlike
 * normal mirroring, it only copies in one direction, as specified by
 * the `direction` slot. The edges and faces that cross the plane of
 * symmetry are split as needed to enforce symmetry.
 *
 * All new vertices, edges, and faces are added to the `geom.out` slot.
 */
export interface SymmetrizeParams {
    input: (BMVert | BMEdge | BMFace)[]
    /**
     * default: "-X" (= 0; bmo_op_slots_init uses enum_flags[0].value)
     * enum table: bmo_enum_axis_neg_xyz_and_xyz
     */
    direction?: "-X" | "-Y" | "-Z" | "X" | "Y" | "Z"
    /** default: 0.0 (slots are zero-initialised by BMO_op_init) */
    dist?: number
    /** default: false (slots are zero-initialised by BMO_op_init) */
    useShapekey?: boolean
}

/** Output slots of `symmetrize`. */
export interface SymmetrizeResult {
    geom: (BMVert | BMEdge | BMFace)[]
}

/** Operator name -> params/result pair, for a typed `bmo(op, params)` dispatcher. */
export interface BMOOperatorMap {
    "smooth_vert": {params: SmoothVertParams, result: SmoothVertResult}
    "smooth_laplacian_vert": {params: SmoothLaplacianVertParams, result: SmoothLaplacianVertResult}
    "recalc_face_normals": {params: RecalcFaceNormalsParams, result: RecalcFaceNormalsResult}
    "planar_faces": {params: PlanarFacesParams, result: PlanarFacesResult}
    "region_extend": {params: RegionExtendParams, result: RegionExtendResult}
    "rotate_edges": {params: RotateEdgesParams, result: RotateEdgesResult}
    "reverse_faces": {params: ReverseFacesParams, result: ReverseFacesResult}
    "flip_quad_tessellation": {params: FlipQuadTessellationParams, result: FlipQuadTessellationResult}
    "bisect_edges": {params: BisectEdgesParams, result: BisectEdgesResult}
    "mirror": {params: MirrorParams, result: MirrorResult}
    "find_doubles": {params: FindDoublesParams, result: FindDoublesResult}
    "remove_doubles": {params: RemoveDoublesParams, result: RemoveDoublesResult}
    "circularize": {params: CircularizeParams, result: CircularizeResult}
    "flatten": {params: FlattenParams, result: FlattenResult}
    "collapse": {params: CollapseParams, result: CollapseResult}
    "pointmerge_facedata": {params: PointmergeFacedataParams, result: PointmergeFacedataResult}
    "average_vert_facedata": {params: AverageVertFacedataParams, result: AverageVertFacedataResult}
    "pointmerge": {params: PointmergeParams, result: PointmergeResult}
    "collapse_uvs": {params: CollapseUvsParams, result: CollapseUvsResult}
    "weld_verts": {params: WeldVertsParams, result: WeldVertsResult}
    "create_vert": {params: CreateVertParams, result: CreateVertResult}
    "join_triangles": {params: JoinTrianglesParams, result: JoinTrianglesResult}
    "contextual_create": {params: ContextualCreateParams, result: ContextualCreateResult}
    "bridge_loops": {params: BridgeLoopsParams, result: BridgeLoopsResult}
    "grid_fill": {params: GridFillParams, result: GridFillResult}
    "holes_fill": {params: HolesFillParams, result: HolesFillResult}
    "face_attribute_fill": {params: FaceAttributeFillParams, result: FaceAttributeFillResult}
    "edgeloop_fill": {params: EdgeloopFillParams, result: EdgeloopFillResult}
    "edgenet_fill": {params: EdgenetFillParams, result: EdgenetFillResult}
    "edgenet_prepare": {params: EdgenetPrepareParams, result: EdgenetPrepareResult}
    "rotate": {params: RotateParams, result: RotateResult}
    "translate": {params: TranslateParams, result: TranslateResult}
    "scale": {params: ScaleParams, result: ScaleResult}
    "transform": {params: TransformParams, result: TransformResult}
    "object_load_bmesh": {params: ObjectLoadBmeshParams, result: ObjectLoadBmeshResult}
    "bmesh_to_mesh": {params: BmeshToMeshParams, result: BmeshToMeshResult}
    "mesh_to_bmesh": {params: MeshToBmeshParams, result: MeshToBmeshResult}
    "extrude_discrete_faces": {params: ExtrudeDiscreteFacesParams, result: ExtrudeDiscreteFacesResult}
    "extrude_edge_only": {params: ExtrudeEdgeOnlyParams, result: ExtrudeEdgeOnlyResult}
    "extrude_vert_indiv": {params: ExtrudeVertIndivParams, result: ExtrudeVertIndivResult}
    "connect_verts": {params: ConnectVertsParams, result: ConnectVertsResult}
    "connect_verts_concave": {params: ConnectVertsConcaveParams, result: ConnectVertsConcaveResult}
    "connect_verts_nonplanar": {params: ConnectVertsNonplanarParams, result: ConnectVertsNonplanarResult}
    "connect_vert_pair": {params: ConnectVertPairParams, result: ConnectVertPairResult}
    "extrude_face_region": {params: ExtrudeFaceRegionParams, result: ExtrudeFaceRegionResult}
    "dissolve_verts": {params: DissolveVertsParams, result: DissolveVertsResult}
    "dissolve_edges": {params: DissolveEdgesParams, result: DissolveEdgesResult}
    "dissolve_faces": {params: DissolveFacesParams, result: DissolveFacesResult}
    "dissolve_limit": {params: DissolveLimitParams, result: DissolveLimitResult}
    "dissolve_degenerate": {params: DissolveDegenerateParams, result: DissolveDegenerateResult}
    "triangulate": {params: TriangulateParams, result: TriangulateResult}
    "unsubdivide": {params: UnsubdivideParams, result: UnsubdivideResult}
    "subdivide_edges": {params: SubdivideEdgesParams, result: SubdivideEdgesResult}
    "subdivide_edgering": {params: SubdivideEdgeringParams, result: SubdivideEdgeringResult}
    "bisect_plane": {params: BisectPlaneParams, result: BisectPlaneResult}
    "delete": {params: DeleteParams, result: DeleteResult}
    "duplicate": {params: DuplicateParams, result: DuplicateResult}
    "split": {params: SplitParams, result: SplitResult}
    "spin": {params: SpinParams, result: SpinResult}
    "rotate_uvs": {params: RotateUvsParams, result: RotateUvsResult}
    "reverse_uvs": {params: ReverseUvsParams, result: ReverseUvsResult}
    "rotate_colors": {params: RotateColorsParams, result: RotateColorsResult}
    "reverse_colors": {params: ReverseColorsParams, result: ReverseColorsResult}
    "split_edges": {params: SplitEdgesParams, result: SplitEdgesResult}
    "create_grid": {params: CreateGridParams, result: CreateGridResult}
    "create_uvsphere": {params: CreateUvsphereParams, result: CreateUvsphereResult}
    "create_icosphere": {params: CreateIcosphereParams, result: CreateIcosphereResult}
    "create_monkey": {params: CreateMonkeyParams, result: CreateMonkeyResult}
    "create_cone": {params: CreateConeParams, result: CreateConeResult}
    "create_circle": {params: CreateCircleParams, result: CreateCircleResult}
    "create_cube": {params: CreateCubeParams, result: CreateCubeResult}
    "bevel": {params: BevelParams, result: BevelResult}
    "beautify_fill": {params: BeautifyFillParams, result: BeautifyFillResult}
    "triangle_fill": {params: TriangleFillParams, result: TriangleFillResult}
    "solidify": {params: SolidifyParams, result: SolidifyResult}
    "inset_individual": {params: InsetIndividualParams, result: InsetIndividualResult}
    "inset_region": {params: InsetRegionParams, result: InsetRegionResult}
    "offset_edgeloops": {params: OffsetEdgeloopsParams, result: OffsetEdgeloopsResult}
    "wireframe": {params: WireframeParams, result: WireframeResult}
    "poke": {params: PokeParams, result: PokeResult}
    "convex_hull": {params: ConvexHullParams, result: ConvexHullResult}
    "space_edge_loops_evenly": {params: SpaceEdgeLoopsEvenlyParams, result: SpaceEdgeLoopsEvenlyResult}
    "symmetrize": {params: SymmetrizeParams, result: SymmetrizeResult}
}

export type BMOOperatorName = keyof BMOOperatorMap
