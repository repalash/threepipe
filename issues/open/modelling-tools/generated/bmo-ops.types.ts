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
 *
 * Blender operator: `smooth_vert` (exec: `bmo_smooth_vert_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface SmoothVertParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Smoothing factor.
     *
     * slot: `factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    factor?: number
    /**
     * Set vertices close to the x axis before the operation to 0.
     *
     * slot: `mirror_clip_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorClipX?: boolean
    /**
     * Set vertices close to the y axis before the operation to 0.
     *
     * slot: `mirror_clip_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorClipY?: boolean
    /**
     * Set vertices close to the z axis before the operation to 0.
     *
     * slot: `mirror_clip_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorClipZ?: boolean
    /**
     * Clipping threshold for the above three slots.
     *
     * slot: `clip_dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    clipDist?: number
    /**
     * Smooth vertices along X axis.
     *
     * slot: `use_axis_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useAxisX?: boolean
    /**
     * Smooth vertices along Y axis.
     *
     * slot: `use_axis_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useAxisY?: boolean
    /**
     * Smooth vertices along Z axis.
     *
     * slot: `use_axis_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `smooth_laplacian_vert` (exec: `bmo_smooth_laplacian_vert_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface SmoothLaplacianVertParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Lambda parameter.
     *
     * slot: `lambda_factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    lambdaFactor?: number
    /**
     * Lambda param in border.
     *
     * slot: `lambda_border` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    lambdaBorder?: number
    /**
     * Smooth object along X axis.
     *
     * slot: `use_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useX?: boolean
    /**
     * Smooth object along Y axis.
     *
     * slot: `use_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useY?: boolean
    /**
     * Smooth object along Z axis.
     *
     * slot: `use_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useZ?: boolean
    /**
     * Apply volume preservation after smooth.
     *
     * slot: `preserve_volume` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `recalc_face_normals` (exec: `bmo_recalc_face_normals_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface RecalcFaceNormalsParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `planar_faces` (exec: `bmo_planar_faces_exec`)
 * type flags: BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface PlanarFacesParams {
    /**
     * Input geometry.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Number of times to flatten faces (for when connected faces are used)
     *
     * slot: `iterations` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    iterations?: number
    /**
     * Influence for making planar each iteration
     *
     * slot: `factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    factor?: number
}

/** Output slots of `planar_faces`. */
export interface PlanarFacesResult {
    /**
     * Output slot, computed boundary geometry.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `region_extend` (exec: `bmo_region_extend_exec`)
 * type flags: BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface RegionExtendParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Find boundary inside the regions, not outside.
     *
     * slot: `use_contract` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useContract?: boolean
    /**
     * Extend from faces instead of edges.
     *
     * slot: `use_faces` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useFaces?: boolean
    /**
     * Step over connected faces.
     *
     * slot: `use_face_step` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useFaceStep?: boolean
}

/** Output slots of `region_extend`. */
export interface RegionExtendResult {
    /**
     * Output slot, computed boundary geometry.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Edge Rotate.
 *
 * Rotates edges topologically. Also known as "spin edge" to some people.
 * Simple example: `[/] becomes [|] then [\]`.
 *
 * Blender operator: `rotate_edges` (exec: `bmo_rotate_edges_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface RotateEdgesParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Rotate edge counter-clockwise if true, otherwise clockwise.
     *
     * slot: `use_ccw` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useCcw?: boolean
}

/** Output slots of `rotate_edges`. */
export interface RotateEdgesResult {
    /**
     * Newly spun edges.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Reverse Faces.
 *
 * Reverses the winding (vertex order) of faces.
 * This has the effect of flipping the normal.
 *
 * Blender operator: `reverse_faces` (exec: `bmo_reverse_faces_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface ReverseFacesParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Maintain multi-res offset.
     *
     * slot: `flip_multires` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `flip_quad_tessellation` (exec: `bmo_flip_quad_tessellation_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface FlipQuadTessellationParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `bisect_edges` (exec: `bmo_bisect_edges_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface BisectEdgesParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Number of cuts.
     *
     * slot: `cuts` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    cuts?: number
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edge_percents` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_FLT)
     * default: empty map (bmo_op_slots_init allocates an empty GHash)
     */
    edgePercents?: Map<BMElem, number>
}

/** Output slots of `bisect_edges`. */
export interface BisectEdgesResult {
    /**
     * Newly created vertices and edges.
     *
     * slot: `geom_split.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomSplit: (BMVert | BMEdge | BMFace)[]
}

/**
 * Mirror.
 *
 * Mirrors geometry along an axis. The resulting geometry is welded on using
 * `merge_dist`. Pairs of original/mirrored vertices are welded using the `merge_dist`
 * parameter (which defines the minimum distance for welding to happen).
 *
 * Blender operator: `mirror` (exec: `bmo_mirror_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface MirrorParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Matrix defining the mirror transformation.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Maximum distance for merging. does no merging if 0.
     *
     * slot: `merge_dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    mergeDist?: number
    /**
     * The axis to use.
     *
     * slot: `axis` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_axis_xyz`
     * default: "X" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    axis?: "X" | "Y" | "Z"
    /**
     * Mirror UVs across the u axis.
     *
     * slot: `mirror_u` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorU?: boolean
    /**
     * Mirror UVs across the v axis.
     *
     * slot: `mirror_v` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorV?: boolean
    /**
     * Mirror UVs in each tile.
     *
     * slot: `mirror_udim` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorUdim?: boolean
    /**
     * Transform shape keys too.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useShapekey?: boolean
}

/** Output slots of `mirror`. */
export interface MirrorResult {
    /**
     * Output geometry, mirrored.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `find_doubles` (exec: `bmo_find_doubles_exec`)
 */
export interface FindDoublesParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * List of verts to keep.
     *
     * slot: `keep_verts` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: [] (slots are zero-initialised by BMO_op_init)
     */
    keepVerts?: BMVert[]
    /**
     * Limit the search for doubles by connected geometry.
     *
     * slot: `use_connected` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useConnected?: boolean
    /**
     * Maximum distance.
     *
     * slot: `dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    dist?: number
}

/** Output slots of `find_doubles`. */
export interface FindDoublesResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `targetmap.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    targetmap: Map<BMElem, BMElem>
}

/**
 * Remove Doubles.
 *
 * Finds groups of vertices closer than dist and merges them together,
 * using the weld verts BMOP.
 *
 * Blender operator: `remove_doubles` (exec: `bmo_remove_doubles_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface RemoveDoublesParams {
    /**
     * Input verts.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Limit the search for doubles by connected geometry.
     *
     * slot: `use_connected` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useConnected?: boolean
    /**
     * Maximum distance.
     *
     * slot: `dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `circularize` (exec: `bmo_circularize_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface CircularizeParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Influence factor: spans from 0.0 to 1.0.
     *
     * slot: `factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    factor?: number
    /**
     * Custom radius.
     *
     * slot: `custom_radius` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    customRadius?: number
    /**
     * Rotation angle.
     *
     * slot: `angle` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    angle?: number
    /**
     * Method to fit the circle.
     *
     * slot: `fit_method` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    fitMethod?: number
    /**
     * Flatten factor: 0.0 projects onto the mesh, 1.0 flattens on the optimal plane.
     *
     * slot: `flatten` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    flatten?: number
    /**
     * Distributes vertices at constant distances, otherwise preserves original spacing.
     *
     * slot: `regular` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    regular?: boolean
    /**
     * Lock X-axis editing.
     *
     * slot: `lock_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockX?: boolean
    /**
     * Lock Y-axis editing.
     *
     * slot: `lock_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockY?: boolean
    /**
     * Lock Z-axis editing.
     *
     * slot: `lock_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockZ?: boolean
    /**
     * Use X axis of the mirror modifier.
     *
     * slot: `mirror_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorX?: boolean
    /**
     * Use Y axis of the mirror modifier.
     *
     * slot: `mirror_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    mirrorY?: boolean
    /**
     * Use Z axis of the mirror modifier.
     *
     * slot: `mirror_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `flatten` (exec: `bmo_flatten_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface FlattenParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Influence factor: spans from 0.0 to 1.0.
     *
     * slot: `factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    factor?: number
    /**
     * Plane on which vertices are flattened.
     *
     * slot: `method` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    method?: number
    /**
     * View direction in object local space.
     *
     * slot: `view_normal` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    viewNormal?: Vector3Like
    /**
     * Lock X axis editing.
     *
     * slot: `lock_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockX?: boolean
    /**
     * Lock Y axis editing.
     *
     * slot: `lock_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockY?: boolean
    /**
     * Lock Z axis editing.
     *
     * slot: `lock_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `collapse` (exec: `bmo_collapse_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface CollapseParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Also collapse UVs and such.
     *
     * slot: `uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `pointmerge_facedata` (exec: `bmo_pointmerge_facedata_exec`)
 */
export interface PointmergeFacedataParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Target vertex to merge into.
     *
     * slot: `vert_target` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `average_vert_facedata` (exec: `bmo_average_vert_facedata_exec`)
 */
export interface AverageVertFacedataParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `pointmerge` (exec: `bmo_pointmerge_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface PointmergeParams {
    /**
     * Input vertices (all verts will be merged into the first).
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Position to merge at.
     *
     * slot: `merge_co` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    mergeCo?: Vector3Like
    /**
     * Optional target vertex to merge into. Does not override merge_co.
     * Set this to preserve the custom data of the target vertex.
     *
     * slot: `vert_target` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `collapse_uvs` (exec: `bmo_collapse_uvs_exec`)
 */
export interface CollapseUvsParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `weld_verts` (exec: `bmo_weld_verts_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface WeldVertsParams {
    /**
     * Maps welded vertices to verts they should weld to.
     *
     * slot: `targetmap` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     * default: empty map (bmo_op_slots_init allocates an empty GHash)
     */
    targetmap?: Map<BMElem, BMElem>
    /**
     * Merge vertices to their centroid position,
     * otherwise use the position of the target vertex.
     *
     * slot: `use_centroid` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useCentroid?: boolean
    /**
     * Whether to average custom data of merged vertices.
     *
     * slot: `average_vert_data` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `create_vert` (exec: `bmo_create_vert_exec`)
 */
export interface CreateVertParams {
    /**
     * The coordinate of the new vert.
     *
     * slot: `co` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    co?: Vector3Like
}

/** Output slots of `create_vert`. */
export interface CreateVertResult {
    /**
     * The new vert.
     *
     * slot: `vert.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    vert: BMVert[]
}

/**
 * Join Triangles.
 *
 * Tries to intelligently join triangles according
 * to angle threshold and delimiters.
 *
 * Blender operator: `join_triangles` (exec: `bmo_join_triangles_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface JoinTrianglesParams {
    /**
     * Input geometry.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Compare seam
     *
     * slot: `cmp_seam` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    cmpSeam?: boolean
    /**
     * Compare sharp
     *
     * slot: `cmp_sharp` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    cmpSharp?: boolean
    /**
     * Compare UVs
     *
     * slot: `cmp_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    cmpUvs?: boolean
    /**
     * Compare VCols.
     *
     * slot: `cmp_vcols` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    cmpVcols?: boolean
    /**
     * Compare materials.
     *
     * slot: `cmp_materials` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    cmpMaterials?: boolean
    /**
     * Undocumented in the Blender source.
     *
     * slot: `angle_face_threshold` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    angleFaceThreshold?: number
    /**
     * Undocumented in the Blender source.
     *
     * slot: `angle_shape_threshold` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    angleShapeThreshold?: number
    /**
     * Undocumented in the Blender source.
     *
     * slot: `topology_influence` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    topologyInfluence?: number
    /**
     * Undocumented in the Blender source.
     *
     * slot: `deselect_joined` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    deselectJoined?: boolean
    /**
     * Undocumented in the Blender source.
     *
     * Only present when `USE_JOIN_TRIANGLE_INTERACTIVE_TESTING` is defined at build time.
     *
     * slot: `merge_limit` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    mergeLimit?: number
    /**
     * Undocumented in the Blender source.
     *
     * Only present when `USE_JOIN_TRIANGLE_INTERACTIVE_TESTING` is defined at build time.
     *
     * slot: `neighbor_debug` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    neighborDebug?: number
}

/** Output slots of `join_triangles`. */
export interface JoinTrianglesResult {
    /**
     * Joined faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `contextual_create` (exec: `bmo_contextual_create_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface ContextualCreateParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Material to use.
     *
     * slot: `mat_nr` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    matNr?: number
    /**
     * Set smooth shading on newly created faces.
     *
     * slot: `use_smooth` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSmooth?: boolean
}

/** Output slots of `contextual_create`. */
export interface ContextualCreateResult {
    /**
     * Newly-made face(s).
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Newly-made edge(s).
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Bridge edge loops with faces.
 *
 * Blender operator: `bridge_loops` (exec: `bmo_bridge_loops_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface BridgeLoopsParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `use_pairs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    usePairs?: boolean
    /**
     * Undocumented in the Blender source.
     *
     * slot: `use_cyclic` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useCyclic?: boolean
    /**
     * Merge rather than creating faces.
     *
     * slot: `use_merge` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useMerge?: boolean
    /**
     * Merge factor.
     *
     * slot: `merge_factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    mergeFactor?: number
    /**
     * Twist offset for closed loops.
     *
     * slot: `twist_offset` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    twistOffset?: number
}

/** Output slots of `bridge_loops`. */
export interface BridgeLoopsResult {
    /**
     * New faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * New edges.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Grid Fill.
 *
 * Create faces defined by 2 disconnected edge loops (which share edges).
 *
 * Blender operator: `grid_fill` (exec: `bmo_grid_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface GridFillParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Material to use.
     *
     * slot: `mat_nr` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    matNr?: number
    /**
     * Smooth state to use.
     *
     * slot: `use_smooth` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSmooth?: boolean
    /**
     * Use simple interpolation.
     *
     * slot: `use_interp_simple` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useInterpSimple?: boolean
}

/** Output slots of `grid_fill`. */
export interface GridFillResult {
    /**
     * New faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Fill Holes.
 *
 * Fill boundary edges with faces, copying surrounding custom-data.
 *
 * Blender operator: `holes_fill` (exec: `bmo_holes_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface HolesFillParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Maximum number of sides for holes to fill (holes with more edges are skipped).
     *
     * slot: `sides` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    sides?: number
}

/** Output slots of `holes_fill`. */
export interface HolesFillResult {
    /**
     * New faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Face Attribute Fill.
 *
 * Fill in faces with data from adjacent faces.
 *
 * Blender operator: `face_attribute_fill` (exec: `bmo_face_attribute_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface FaceAttributeFillParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Copy face winding.
     *
     * slot: `use_normals` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useNormals?: boolean
    /**
     * Copy face data.
     *
     * slot: `use_data` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useData?: boolean
}

/** Output slots of `face_attribute_fill`. */
export interface FaceAttributeFillResult {
    /**
     * Faces that could not be handled.
     *
     * slot: `faces_fail.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    facesFail: BMFace[]
}

/**
 * Edge Loop Fill.
 *
 * Create faces defined by one or more non overlapping edge loops.
 *
 * Blender operator: `edgeloop_fill` (exec: `bmo_edgeloop_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface EdgeloopFillParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Material to use.
     *
     * slot: `mat_nr` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    matNr?: number
    /**
     * Smooth state to use.
     *
     * slot: `use_smooth` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSmooth?: boolean
}

/** Output slots of `edgeloop_fill`. */
export interface EdgeloopFillResult {
    /**
     * New faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Edge Net Fill.
 *
 * Create faces defined by enclosed edges.
 *
 * Blender operator: `edgenet_fill` (exec: `bmo_edgenet_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface EdgenetFillParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Material to use.
     *
     * slot: `mat_nr` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    matNr?: number
    /**
     * Smooth state to use.
     *
     * slot: `use_smooth` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSmooth?: boolean
    /**
     * Maximum number of sides for created faces.
     *
     * slot: `sides` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    sides?: number
}

/** Output slots of `edgenet_fill`. */
export interface EdgenetFillResult {
    /**
     * New faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `edgenet_prepare` (exec: `bmo_edgenet_prepare_exec`)
 */
export interface EdgenetPrepareParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/** Output slots of `edgenet_prepare`. */
export interface EdgenetPrepareResult {
    /**
     * New edges.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Rotate.
 *
 * Rotate vertices around a center, using a 3x3 rotation matrix.
 *
 * Blender operator: `rotate` (exec: `bmo_rotate_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface RotateParams {
    /**
     * Center of rotation.
     *
     * slot: `cent` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    cent?: Vector3Like
    /**
     * Matrix defining rotation.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Matrix to define the space (typically object matrix).
     *
     * slot: `space` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    space?: Matrix4Like
    /**
     * Transform shape keys too.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `translate` (exec: `bmo_translate_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface TranslateParams {
    /**
     * Translation offset.
     *
     * slot: `vec` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    vec?: Vector3Like
    /**
     * Matrix to define the space (typically object matrix).
     *
     * slot: `space` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    space?: Matrix4Like
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Transform shape keys too.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `scale` (exec: `bmo_scale_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface ScaleParams {
    /**
     * Scale factor.
     *
     * slot: `vec` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    vec?: Vector3Like
    /**
     * Matrix to define the space (typically object matrix).
     *
     * slot: `space` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    space?: Matrix4Like
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Transform shape keys too.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `transform` (exec: `bmo_transform_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface TransformParams {
    /**
     * Transform matrix.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Matrix to define the space (typically object matrix).
     *
     * slot: `space` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    space?: Matrix4Like
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Transform shape keys too.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `object_load_bmesh` (exec: `bmo_object_load_bmesh_exec`)
 */
export interface ObjectLoadBmeshParams {
    /**
     * The scene.
     *
     * slot: `scene` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_SCENE)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    scene?: SceneLike | null
    /**
     * The object.
     *
     * slot: `object` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_OBJECT)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `bmesh_to_mesh` (exec: `bmo_bmesh_to_mesh_exec`)
 */
export interface BmeshToMeshParams {
    /**
     * The mesh to write into.
     *
     * slot: `mesh` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_MESH)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    mesh?: MeshLike | null
    /**
     * The object.
     *
     * slot: `object` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_OBJECT)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `mesh_to_bmesh` (exec: `bmo_mesh_to_bmesh_exec`)
 */
export interface MeshToBmeshParams {
    /**
     * The mesh to read from.
     *
     * slot: `mesh` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_MESH)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    mesh?: MeshLike | null
    /**
     * The object.
     *
     * slot: `object` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_OBJECT)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    object?: ObjectLike | null
    /**
     * Load active shapekey coordinates into verts.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `extrude_discrete_faces` (exec: `bmo_extrude_discrete_faces_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface ExtrudeDiscreteFacesParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Create faces with reversed direction.
     *
     * slot: `use_normal_flip` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useNormalFlip?: boolean
    /**
     * Preserve the selection history in the extruded geometry.
     *
     * slot: `use_select_history` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSelectHistory?: boolean
}

/** Output slots of `extrude_discrete_faces`. */
export interface ExtrudeDiscreteFacesResult {
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Extrude Only Edges.
 *
 * Extrudes Edges into faces, note that this is very simple, there's no fancy
 * winged extrusion.
 *
 * Blender operator: `extrude_edge_only` (exec: `bmo_extrude_edge_only_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface ExtrudeEdgeOnlyParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Create faces with reversed direction.
     *
     * slot: `use_normal_flip` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useNormalFlip?: boolean
    /**
     * Preserve the selection history in the extruded geometry.
     *
     * slot: `use_select_history` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSelectHistory?: boolean
}

/** Output slots of `extrude_edge_only`. */
export interface ExtrudeEdgeOnlyResult {
    /**
     * Output geometry.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Individual Vertex Extrude.
 *
 * Extrudes individual vertices, creating new vertices connected by wire edges.
 *
 * Blender operator: `extrude_vert_indiv` (exec: `bmo_extrude_vert_indiv_exec`)
 * type flags: BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface ExtrudeVertIndivParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Preserve the selection history in the extruded geometry.
     *
     * slot: `use_select_history` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSelectHistory?: boolean
}

/** Output slots of `extrude_vert_indiv`. */
export interface ExtrudeVertIndivResult {
    /**
     * Output wire edges.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Output vertices.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Connect Verts.
 *
 * Split faces by adding edges that connect `verts`.
 *
 * Blender operator: `connect_verts` (exec: `bmo_connect_verts_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface ConnectVertsParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Input faces to explicitly exclude from connecting.
     *
     * slot: `faces_exclude` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: [] (slots are zero-initialised by BMO_op_init)
     */
    facesExclude?: BMFace[]
    /**
     * Prevent splits with overlaps & intersections.
     *
     * slot: `check_degenerate` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    checkDegenerate?: boolean
}

/** Output slots of `connect_verts`. */
export interface ConnectVertsResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Connect Verts to form Convex Faces.
 *
 * Splits concave faces into convex faces.
 *
 * Blender operator: `connect_verts_concave` (exec: `bmo_connect_verts_concave_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface ConnectVertsConcaveParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/** Output slots of `connect_verts_concave`. */
export interface ConnectVertsConcaveResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Connect Verts Across non Planar Faces.
 *
 * Split faces by connecting edges along non planar `faces`.
 *
 * Blender operator: `connect_verts_nonplanar` (exec: `bmo_connect_verts_nonplanar_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface ConnectVertsNonplanarParams {
    /**
     * Maximum angle of non-planarity before splitting (radians).
     *
     * slot: `angle_limit` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    angleLimit?: number
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/** Output slots of `connect_verts_nonplanar`. */
export interface ConnectVertsNonplanarResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Connect Vert Pair.
 *
 * Connect a pair of vertices by splitting faces along the shortest path between them.
 *
 * Blender operator: `connect_vert_pair` (exec: `bmo_connect_vert_pair_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface ConnectVertPairParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Input vertices to explicitly exclude from connecting.
     *
     * slot: `verts_exclude` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: [] (slots are zero-initialised by BMO_op_init)
     */
    vertsExclude?: BMVert[]
    /**
     * Input faces to explicitly exclude from connecting.
     *
     * slot: `faces_exclude` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: [] (slots are zero-initialised by BMO_op_init)
     */
    facesExclude?: BMFace[]
}

/** Output slots of `connect_vert_pair`. */
export interface ConnectVertPairResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Extrude Faces.
 *
 * Extrude operator (does not transform)
 *
 * Blender operator: `extrude_face_region` (exec: `bmo_extrude_face_region_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface ExtrudeFaceRegionParams {
    /**
     * Edges and faces.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Input edges to explicitly exclude from extrusion.
     *
     * slot: `edges_exclude` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_EMPTY)
     * default: empty set (bmo_op_slots_init allocates an empty GHash)
     */
    edgesExclude?: Set<BMElem>
    /**
     * Keep original geometry (requires `geom` to include edges).
     *
     * slot: `use_keep_orig` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useKeepOrig?: boolean
    /**
     * Create faces with reversed direction.
     *
     * slot: `use_normal_flip` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useNormalFlip?: boolean
    /**
     * Use winding from surrounding faces instead of this region.
     *
     * slot: `use_normal_from_adjacent` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useNormalFromAdjacent?: boolean
    /**
     * Dissolve edges whose faces form a flat surface.
     *
     * slot: `use_dissolve_ortho_edges` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useDissolveOrthoEdges?: boolean
    /**
     * Preserve the selection history in the extruded geometry.
     *
     * slot: `use_select_history` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSelectHistory?: boolean
    /**
     * Skip flipping of input faces to preserve original orientation.
     *
     * slot: `skip_input_flip` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    skipInputFlip?: boolean
}

/** Output slots of `extrude_face_region`. */
export interface ExtrudeFaceRegionResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Dissolve Verts.
 *
 * Blender operator: `dissolve_verts` (exec: `bmo_dissolve_verts_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface DissolveVertsParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Split off face corners to maintain surrounding geometry.
     *
     * slot: `use_face_split` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useFaceSplit?: boolean
    /**
     * Split off face corners instead of merging faces.
     *
     * slot: `use_boundary_tear` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useBoundaryTear?: boolean
}

/** Output slots of `dissolve_verts`. */
export interface DissolveVertsResult {
    // this operator has no output slots
}

/**
 * Dissolve Edges.
 *
 * Blender operator: `dissolve_edges` (exec: `bmo_dissolve_edges_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface DissolveEdgesParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Dissolve verts left between only 2 edges.
     *
     * slot: `use_verts` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useVerts?: boolean
    /**
     * Split off face corners to maintain surrounding geometry.
     *
     * slot: `use_face_split` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useFaceSplit?: boolean
    /**
     * Do not dissolve verts between 2 edges when their angle exceeds this threshold.
     * Disabled by default.
     *
     * slot: `angle_threshold` (BMO_OP_SLOT_FLT)
     * default: M_PI (set by bmo_dissolve_edges_init, source/blender/bmesh/operators/bmo_dissolve.cc:452)
     */
    angleThreshold?: number
    /**
     * When dissolving the edge between 2 triangles, don't dissolve the verts.
     *
     * slot: `use_preserve_quads` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    usePreserveQuads?: boolean
}

/** Output slots of `dissolve_edges`. */
export interface DissolveEdgesResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `region.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    region: BMFace[]
}

/**
 * Dissolve Faces.
 *
 * Blender operator: `dissolve_faces` (exec: `bmo_dissolve_faces_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface DissolveFacesParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Dissolve verts left between only 2 edges.
     *
     * slot: `use_verts` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useVerts?: boolean
}

/** Output slots of `dissolve_faces`. */
export interface DissolveFacesResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `region.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    region: BMFace[]
}

/**
 * Limited Dissolve.
 *
 * Dissolve planar faces and co-linear edges.
 *
 * Blender operator: `dissolve_limit` (exec: `bmo_dissolve_limit_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface DissolveLimitParams {
    /**
     * Maximum angle (radians) between face normals for dissolving.
     *
     * slot: `angle_limit` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    angleLimit?: number
    /**
     * Dissolve all vertices in between face boundaries.
     *
     * slot: `use_dissolve_boundaries` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useDissolveBoundaries?: boolean
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Delimit dissolve operation.
     *
     * slot: `delimit` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_FLAG)
     * enum table: `bmo_enum_dissolve_limit_flags`
     * default: ["NORMAL"] (= 1; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    delimit?: ("NORMAL" | "MATERIAL" | "SEAM" | "SHARP" | "UV")[]
}

/** Output slots of `dissolve_limit`. */
export interface DissolveLimitResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `region.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    region: BMFace[]
}

/**
 * Degenerate Dissolve.
 *
 * Dissolve edges with no length, faces with no area.
 *
 * Blender operator: `dissolve_degenerate` (exec: `bmo_dissolve_degenerate_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface DissolveDegenerateParams {
    /**
     * Maximum distance to consider degenerate.
     *
     * slot: `dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    dist?: number
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `triangulate` (exec: `bmo_triangulate_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface TriangulateParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Method for splitting the quads into triangles.
     *
     * slot: `quad_method` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_triangulate_quad_method`
     * default: "BEAUTY" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    quadMethod?: "BEAUTY" | "FIXED" | "ALTERNATE" | "SHORT_EDGE" | "LONG_EDGE"
    /**
     * Method for splitting the polygons into triangles.
     *
     * slot: `ngon_method` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_triangulate_ngon_method`
     * default: "BEAUTY" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    ngonMethod?: "BEAUTY" | "EAR_CLIP"
}

/** Output slots of `triangulate`. */
export interface TriangulateResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `face_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    faceMap: Map<BMElem, BMElem>
    /**
     * Duplicate faces.
     *
     * slot: `face_map_double.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    faceMapDouble: Map<BMElem, BMElem>
}

/**
 * Un-Subdivide.
 *
 * Reduce detail in geometry containing grids.
 *
 * Blender operator: `unsubdivide` (exec: `bmo_unsubdivide_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface UnsubdivideParams {
    /**
     * Input vertices.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Number of times to unsubdivide.
     *
     * slot: `iterations` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `subdivide_edges` (exec: `bmo_subdivide_edges_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface SubdivideEdgesParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Smoothness factor.
     *
     * slot: `smooth` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    smooth?: number
    /**
     * Smooth falloff type.
     *
     * slot: `smooth_falloff` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_falloff_type`
     * default: "SMOOTH" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    smoothFalloff?: "SMOOTH" | "SPHERE" | "ROOT" | "SHARP" | "LINEAR" | "INVERSE_SQUARE"
    /**
     * Fractal randomness factor.
     *
     * slot: `fractal` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    fractal?: number
    /**
     * Factor (0 to 1) controlling how much fractal displacement is restricted to the normal.
     *
     * slot: `along_normal` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    alongNormal?: number
    /**
     * Number of cuts.
     *
     * slot: `cuts` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    cuts?: number
    /**
     * Seed for the random number generator.
     *
     * slot: `seed` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    seed?: number
    /**
     * Internal use only, not accessible from Python.
     *
     * slot: `custom_patterns` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_INTERNAL)
     * default: empty map (bmo_op_slots_init allocates an empty GHash)
     */
    customPatterns?: Map<BMElem, unknown>
    /**
     * Mapping of edges to a float (0 to 1) controlling the cut position along each edge.
     *
     * slot: `edge_percents` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_FLT)
     * default: empty map (bmo_op_slots_init allocates an empty GHash)
     */
    edgePercents?: Map<BMElem, number>
    /**
     * Quad corner type.
     *
     * slot: `quad_corner_type` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_subdivide_edges_quad_corner_type`
     * default: "STRAIGHT_CUT" (= 3; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    quadCornerType?: "STRAIGHT_CUT" | "INNER_VERT" | "PATH" | "FAN"
    /**
     * Fill in fully-selected faces with a grid.
     *
     * slot: `use_grid_fill` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useGridFill?: boolean
    /**
     * Tessellate the case of one edge selected in a quad or triangle.
     *
     * slot: `use_single_edge` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSingleEdge?: boolean
    /**
     * Only subdivide quads (for loop-cut).
     *
     * slot: `use_only_quads` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useOnlyQuads?: boolean
    /**
     * Project new vertices onto a sphere (used for spherical primitives).
     *
     * slot: `use_sphere` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSphere?: boolean
    /**
     * Maintain even offset when smoothing.
     *
     * slot: `use_smooth_even` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSmoothEven?: boolean
}

/** Output slots of `subdivide_edges`. */
export interface SubdivideEdgesResult {
    /**
     * Undocumented in the Blender source.
     *
     * NOTE: these next three can have multiple types of elements in them.
     *
     * slot: `geom_inner.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomInner: (BMVert | BMEdge | BMFace)[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom_split.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomSplit: (BMVert | BMEdge | BMFace)[]
    /**
     * Contains all output geometry.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Subdivide Edge-Ring.
 *
 * Take an edge-ring, and subdivide with interpolation options.
 *
 * Blender operator: `subdivide_edgering` (exec: `bmo_subdivide_edgering_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface SubdivideEdgeringParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Interpolation method.
     *
     * slot: `interp_mode` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_subdivide_edgering_interp_mode`
     * default: "LINEAR" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    interpMode?: "LINEAR" | "PATH" | "SURFACE"
    /**
     * Smoothness factor.
     *
     * slot: `smooth` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    smooth?: number
    /**
     * Number of cuts.
     *
     * slot: `cuts` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    cuts?: number
    /**
     * Profile shape type.
     *
     * slot: `profile_shape` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_falloff_type`
     * default: "SMOOTH" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    profileShape?: "SMOOTH" | "SPHERE" | "ROOT" | "SHARP" | "LINEAR" | "INVERSE_SQUARE"
    /**
     * How much intermediary new edges are shrunk/expanded.
     *
     * slot: `profile_shape_factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    profileShapeFactor?: number
}

/** Output slots of `subdivide_edgering`. */
export interface SubdivideEdgeringResult {
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Bisect Plane.
 *
 * Bisects the mesh by a plane (cut the mesh in half).
 *
 * Blender operator: `bisect_plane` (exec: `bmo_bisect_plane_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface BisectPlaneParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Minimum distance when testing if a vert is exactly on the plane.
     *
     * slot: `dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    dist?: number
    /**
     * Point on the plane.
     *
     * slot: `plane_co` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    planeCo?: Vector3Like
    /**
     * Normal of the plane.
     *
     * slot: `plane_no` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    planeNo?: Vector3Like
    /**
     * Snap axis aligned verts to the center.
     *
     * slot: `use_snap_center` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSnapCenter?: boolean
    /**
     * When enabled, remove all geometry on the positive side of the plane.
     *
     * slot: `clear_outer` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    clearOuter?: boolean
    /**
     * When enabled, remove all geometry on the negative side of the plane.
     *
     * slot: `clear_inner` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    clearInner?: boolean
}

/** Output slots of `bisect_plane`. */
export interface BisectPlaneResult {
    /**
     * Output geometry aligned with the plane (new and existing).
     *
     * slot: `geom_cut.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomCut: (BMVert | BMEdge)[]
    /**
     * Input and output geometry (result of cut).
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Delete Geometry.
 *
 * Utility operator to delete geometry.
 *
 * Blender operator: `delete` (exec: `bmo_delete_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface DeleteParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Geometry types to delete.
     *
     * slot: `context` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_delete_context`
     * default: "VERTS" (= 1; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
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
 *
 * Blender operator: `duplicate` (exec: `bmo_duplicate_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface DuplicateParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Destination bmesh, if None will use current one.
     *
     * slot: `dest` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_BMESH)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    dest?: BMeshLike | null
    /**
     * Preserve the selection history in the duplicated geometry.
     *
     * slot: `use_select_history` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useSelectHistory?: boolean
    /**
     * Copy edge flip state from connected faces.
     *
     * slot: `use_edge_flip_from_face` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useEdgeFlipFromFace?: boolean
}

/** Output slots of `duplicate`. */
export interface DuplicateResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom_orig.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomOrig: (BMVert | BMEdge | BMFace)[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Undocumented in the Blender source.
     *
     * NOTE: face_map maps from source faces to dupe faces,
     * and from dupe faces to source faces.
     *
     * slot: `vert_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    vertMap: Map<BMElem, BMElem>
    /**
     * Undocumented in the Blender source.
     *
     * slot: `edge_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    edgeMap: Map<BMElem, BMElem>
    /**
     * Undocumented in the Blender source.
     *
     * slot: `face_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    faceMap: Map<BMElem, BMElem>
    /**
     * Boundary edges from the split geometry that maps edges from the original geometry
     * to the destination edges.
     *
     * slot: `boundary_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    boundaryMap: Map<BMElem, BMElem>
    /**
     * Undocumented in the Blender source.
     *
     * slot: `isovert_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    isovertMap: Map<BMElem, BMElem>
}

/**
 * Split Off Geometry.
 *
 * Disconnect geometry from adjacent edges and faces,
 * optionally into a destination mesh.
 *
 * Blender operator: `split` (exec: `bmo_split_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface SplitParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Destination bmesh, if None will use current one.
     *
     * slot: `dest` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_BMESH)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    dest?: BMeshLike | null
    /**
     * When enabled, don't duplicate loose verts/edges.
     *
     * slot: `use_only_faces` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useOnlyFaces?: boolean
}

/** Output slots of `split`. */
export interface SplitResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Boundary edges from the split geometry that maps edges from the original geometry
     * to the destination edges.
     *
     * When the source edges have been deleted, the destination edge will be used
     * for both the key and the value.
     *
     * slot: `boundary_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    boundaryMap: Map<BMElem, BMElem>
    /**
     * Undocumented in the Blender source.
     *
     * slot: `isovert_map.out` (BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_MAP_ELEM)
     */
    isovertMap: Map<BMElem, BMElem>
}

/**
 * Spin.
 *
 * Extrude or duplicate geometry a number of times,
 * rotating and possibly translating after each step
 *
 * Blender operator: `spin` (exec: `bmo_spin_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface SpinParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Rotation center.
     *
     * slot: `cent` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    cent?: Vector3Like
    /**
     * Rotation axis.
     *
     * slot: `axis` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    axis?: Vector3Like
    /**
     * Translation delta per step.
     *
     * slot: `dvec` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    dvec?: Vector3Like
    /**
     * Total rotation angle (radians).
     *
     * slot: `angle` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    angle?: number
    /**
     * Matrix to define the space (typically object matrix).
     *
     * slot: `space` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    space?: Matrix4Like
    /**
     * Number of steps.
     *
     * slot: `steps` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    steps?: number
    /**
     * Merge first/last when the angle is a full revolution.
     *
     * slot: `use_merge` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useMerge?: boolean
    /**
     * Create faces with reversed direction.
     *
     * slot: `use_normal_flip` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useNormalFlip?: boolean
    /**
     * Duplicate the geometry, otherwise extrude.
     *
     * slot: `use_duplicate` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useDuplicate?: boolean
}

/** Output slots of `spin`. */
export interface SpinResult {
    /**
     * Result of last step.
     *
     * slot: `geom_last.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomLast: (BMVert | BMEdge | BMFace)[]
}

/**
 * UV Rotation.
 *
 * Cycle the loop UVs
 *
 * Blender operator: `rotate_uvs` (exec: `bmo_rotate_uvs_exec`)
 */
export interface RotateUvsParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Rotate counter-clockwise if true, otherwise clockwise.
     *
     * slot: `use_ccw` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `reverse_uvs` (exec: `bmo_reverse_uvs_exec`)
 */
export interface ReverseUvsParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `rotate_colors` (exec: `bmo_rotate_colors_exec`)
 */
export interface RotateColorsParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Rotate counter-clockwise if true, otherwise clockwise.
     *
     * slot: `use_ccw` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useCcw?: boolean
    /**
     * Index into color attribute list.
     *
     * slot: `color_index` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `reverse_colors` (exec: `bmo_reverse_colors_exec`)
 */
export interface ReverseColorsParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Index into color attribute list.
     *
     * slot: `color_index` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `split_edges` (exec: `bmo_split_edges_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface SplitEdgesParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Optional tag verts, use to have greater control of splits.
     *
     * slot: `verts` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Use `verts` for splitting, else just find verts to split from edges.
     *
     * slot: `use_verts` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useVerts?: boolean
}

/** Output slots of `split_edges`. */
export interface SplitEdgesResult {
    /**
     * The original edges that were disconnected.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Create Grid.
 *
 * Creates a grid with a variable number of subdivisions
 *
 * Blender operator: `create_grid` (exec: `bmo_create_grid_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateGridParams {
    /**
     * Number of x segments.
     *
     * slot: `x_segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    xSegments?: number
    /**
     * Number of y segments.
     *
     * slot: `y_segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    ySegments?: number
    /**
     * Size of the grid.
     *
     * slot: `size` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    size?: number
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_grid`. */
export interface CreateGridResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Create UV Sphere.
 *
 * Creates a UV sphere with a variable number of subdivisions.
 *
 * Blender operator: `create_uvsphere` (exec: `bmo_create_uvsphere_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateUvsphereParams {
    /**
     * Number of u segments.
     *
     * slot: `u_segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    uSegments?: number
    /**
     * Number of v segments.
     *
     * slot: `v_segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    vSegments?: number
    /**
     * Radius.
     *
     * slot: `radius` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    radius?: number
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_uvsphere`. */
export interface CreateUvsphereResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Create Ico-Sphere.
 *
 * Creates an ico-sphere with a variable number of subdivisions.
 *
 * Blender operator: `create_icosphere` (exec: `bmo_create_icosphere_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateIcosphereParams {
    /**
     * How many times to recursively subdivide the sphere.
     *
     * slot: `subdivisions` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    subdivisions?: number
    /**
     * Radius.
     *
     * slot: `radius` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    radius?: number
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_icosphere`. */
export interface CreateIcosphereResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Create Suzanne.
 *
 * Creates a monkey (standard blender primitive).
 *
 * Blender operator: `create_monkey` (exec: `bmo_create_monkey_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateMonkeyParams {
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_monkey`. */
export interface CreateMonkeyResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Create Cone.
 *
 * Creates a cone with variable radius at both ends
 *
 * Blender operator: `create_cone` (exec: `bmo_create_cone_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateConeParams {
    /**
     * Whether or not to fill in the ends with faces.
     *
     * slot: `cap_ends` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    capEnds?: boolean
    /**
     * Fill ends with triangles instead of ngons.
     *
     * slot: `cap_tris` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    capTris?: boolean
    /**
     * Number of vertices in the base circle.
     *
     * slot: `segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    segments?: number
    /**
     * Radius of one end.
     *
     * slot: `radius1` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    radius1?: number
    /**
     * Radius of the opposite end.
     *
     * slot: `radius2` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    radius2?: number
    /**
     * Distance between ends.
     *
     * slot: `depth` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    depth?: number
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_cone`. */
export interface CreateConeResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Creates a Circle.
 *
 * Blender operator: `create_circle` (exec: `bmo_create_circle_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateCircleParams {
    /**
     * Whether or not to fill in the circle with a face.
     *
     * slot: `cap_ends` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    capEnds?: boolean
    /**
     * Fill the circle with triangles instead of an n-gon.
     *
     * slot: `cap_tris` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    capTris?: boolean
    /**
     * Number of vertices in the circle.
     *
     * slot: `segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    segments?: number
    /**
     * Radius of the circle.
     *
     * slot: `radius` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    radius?: number
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_circle`. */
export interface CreateCircleResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Create Cube
 *
 * Creates a cube.
 *
 * Blender operator: `create_cube` (exec: `bmo_create_cube_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface CreateCubeParams {
    /**
     * Size of the cube.
     *
     * slot: `size` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    size?: number
    /**
     * Matrix to multiply the new geometry with.
     *
     * slot: `matrix` (BMO_OP_SLOT_MAT)
     * default: identity (BMO_slot_mat4_get returns unit_m4 for an unset slot)
     */
    matrix?: Matrix4Like
    /**
     * Calculate default UVs.
     *
     * slot: `calc_uvs` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    calcUvs?: boolean
}

/** Output slots of `create_cube`. */
export interface CreateCubeResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Bevel.
 *
 * Bevels edges and vertices
 *
 * Blender operator: `bevel` (exec: `bmo_bevel_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface BevelParams {
    /**
     * Input edges and vertices.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Amount to offset beveled edge.
     *
     * slot: `offset` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    offset?: number
    /**
     * How to measure the offset.
     *
     * slot: `offset_type` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_offset_type`
     * default: "OFFSET" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    offsetType?: "OFFSET" | "WIDTH" | "DEPTH" | "PERCENT" | "ABSOLUTE"
    /**
     * The profile type to use for bevel.
     *
     * slot: `profile_type` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_profile_type`
     * default: "SUPERELLIPSE" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    profileType?: "SUPERELLIPSE" | "CUSTOM"
    /**
     * Number of segments in bevel.
     *
     * slot: `segments` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    segments?: number
    /**
     * Profile shape, 0->1 (.5=>round).
     *
     * slot: `profile` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    profile?: number
    /**
     * Whether to bevel vertices or edges.
     *
     * slot: `affect` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_affect_type`
     * default: "VERTICES" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    affect?: "VERTICES" | "EDGES"
    /**
     * Do not allow beveled edges/vertices to overlap each other.
     *
     * slot: `clamp_overlap` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    clampOverlap?: boolean
    /**
     * Material for bevel faces, -1 means get from adjacent faces.
     *
     * slot: `material` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    material?: number
    /**
     * Prefer to slide along edges to having even widths.
     *
     * slot: `loop_slide` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    loopSlide?: boolean
    /**
     * Extend edge data to allow seams to run across bevels.
     *
     * slot: `mark_seam` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    markSeam?: boolean
    /**
     * Extend edge data to allow sharp edges to run across bevels.
     *
     * slot: `mark_sharp` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    markSharp?: boolean
    /**
     * Harden normals.
     *
     * slot: `harden_normals` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    hardenNormals?: boolean
    /**
     * Whether to set face strength, and which faces to set if so.
     *
     * slot: `face_strength_mode` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_face_strength_type`
     * default: "NONE" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    faceStrengthMode?: "NONE" | "NEW" | "AFFECTED" | "ALL"
    /**
     * Outer miter kind.
     *
     * slot: `miter_outer` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_miter_type`
     * default: "SHARP" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    miterOuter?: "SHARP" | "PATCH" | "ARC"
    /**
     * Inner miter kind.
     *
     * slot: `miter_inner` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_miter_type`
     * default: "SHARP" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    miterInner?: "SHARP" | "PATCH" | "ARC"
    /**
     * Amount to spread the miter.
     *
     * slot: `spread` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    spread?: number
    /**
     * CurveProfile, if None ignored
     *
     * slot: `custom_profile` (BMO_OP_SLOT_PTR, BMO_OP_SLOT_SUBTYPE_PTR_STRUCT)
     * default: null (slots are zero-initialised by BMO_op_init)
     */
    customProfile?: StructLike | null
    /**
     * The method to use to create meshes at intersections.
     *
     * slot: `vmesh_method` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_bevel_vmesh_method`
     * default: "ADJ" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    vmeshMethod?: "ADJ" | "CUTOFF"
}

/** Output slots of `bevel`. */
export interface BevelResult {
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Output edges.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
}

/**
 * Beautify Fill.
 *
 * Rotate edges to create more evenly spaced triangles.
 *
 * Blender operator: `beautify_fill` (exec: `bmo_beautify_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface BeautifyFillParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Edges that can be flipped.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Restrict edge rotation to mixed tagged vertices.
     *
     * slot: `use_restrict_tag` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useRestrictTag?: boolean
    /**
     * Method to define what is beautiful.
     *
     * slot: `method` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_beautify_fill_method`
     * default: "AREA" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    method?: "AREA" | "ANGLE"
}

/** Output slots of `beautify_fill`. */
export interface BeautifyFillResult {
    /**
     * New flipped faces and edges.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Triangle Fill.
 *
 * Fill edges with triangles
 *
 * Blender operator: `triangle_fill` (exec: `bmo_triangle_fill_exec`)
 * type flags: BMO_OPTYPE_FLAG_UNTAN_MULTIRES, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface TriangleFillParams {
    /**
     * Use best triangulation division.
     *
     * slot: `use_beauty` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useBeauty?: boolean
    /**
     * Dissolve resulting faces.
     *
     * slot: `use_dissolve` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useDissolve?: boolean
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Optionally pass the fill normal to use.
     *
     * slot: `normal` (BMO_OP_SLOT_VEC)
     * default: (0, 0, 0) (slots are zero-initialised by BMO_op_init)
     */
    normal?: Vector3Like
}

/** Output slots of `triangle_fill`. */
export interface TriangleFillResult {
    /**
     * New faces and edges.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Solidify.
 *
 * Turns a mesh into a shell with thickness
 *
 * Blender operator: `solidify` (exec: `bmo_solidify_face_region_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface SolidifyParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Thickness of the solidified shell.
     *
     * slot: `thickness` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    thickness?: number
}

/** Output slots of `solidify`. */
export interface SolidifyResult {
    /**
     * Output geometry (new shell faces, edges, and vertices).
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
}

/**
 * Face Inset (Individual).
 *
 * Insets individual faces.
 *
 * Blender operator: `inset_individual` (exec: `bmo_inset_individual_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface InsetIndividualParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Inset distance from the boundary.
     *
     * slot: `thickness` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    thickness?: number
    /**
     * Distance to raise or lower the inset face along its normal.
     *
     * slot: `depth` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    depth?: number
    /**
     * Scale the offset to give more even thickness.
     *
     * slot: `use_even_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useEvenOffset?: boolean
    /**
     * Blend face data across the inset.
     *
     * slot: `use_interpolate` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useInterpolate?: boolean
    /**
     * Scale the offset by surrounding geometry.
     *
     * slot: `use_relative_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useRelativeOffset?: boolean
}

/** Output slots of `inset_individual`. */
export interface InsetIndividualResult {
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Face Inset (Regions).
 *
 * Inset or outset face regions.
 *
 * Blender operator: `inset_region` (exec: `bmo_inset_region_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface InsetRegionParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Input faces to explicitly exclude from inset.
     *
     * slot: `faces_exclude` (BMO_OP_SLOT_ELEMENT_BUF)
     * default: [] (slots are zero-initialised by BMO_op_init)
     */
    facesExclude?: BMFace[]
    /**
     * Inset face boundaries.
     *
     * slot: `use_boundary` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useBoundary?: boolean
    /**
     * Scale the offset to give more even thickness.
     *
     * slot: `use_even_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useEvenOffset?: boolean
    /**
     * Blend face data across the inset.
     *
     * slot: `use_interpolate` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useInterpolate?: boolean
    /**
     * Scale the offset by surrounding geometry.
     *
     * slot: `use_relative_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useRelativeOffset?: boolean
    /**
     * Inset the region along existing edges.
     *
     * slot: `use_edge_rail` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useEdgeRail?: boolean
    /**
     * Inset distance from the boundary.
     *
     * slot: `thickness` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    thickness?: number
    /**
     * Distance to raise or lower the inset face along its normal.
     *
     * slot: `depth` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    depth?: number
    /**
     * Outset rather than inset.
     *
     * slot: `use_outset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useOutset?: boolean
}

/** Output slots of `inset_region`. */
export interface InsetRegionResult {
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Edge-loop Offset.
 *
 * Creates edge loops based on simple edge-outset method.
 *
 * Blender operator: `offset_edgeloops` (exec: `bmo_offset_edgeloops_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH
 */
export interface OffsetEdgeloopsParams {
    /**
     * Input edges.
     *
     * slot: `edges` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
    /**
     * Extend loop around end-points.
     *
     * slot: `use_cap_endpoint` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useCapEndpoint?: boolean
}

/** Output slots of `offset_edgeloops`. */
export interface OffsetEdgeloopsResult {
    /**
     * Output edges.
     *
     * slot: `edges.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    edges: BMEdge[]
}

/**
 * Wire Frame.
 *
 * Makes a wire-frame copy of faces.
 *
 * Blender operator: `wireframe` (exec: `bmo_wireframe_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface WireframeParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Wire thickness.
     *
     * slot: `thickness` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    thickness?: number
    /**
     * Offset the thickness from the center.
     *
     * slot: `offset` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    offset?: number
    /**
     * Remove original geometry.
     *
     * slot: `use_replace` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useReplace?: boolean
    /**
     * Inset face boundaries.
     *
     * slot: `use_boundary` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useBoundary?: boolean
    /**
     * Scale the offset to give more even thickness.
     *
     * slot: `use_even_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useEvenOffset?: boolean
    /**
     * Crease hub edges for improved subdivision surface.
     *
     * slot: `use_crease` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useCrease?: boolean
    /**
     * The mean crease weight for resulting edges.
     *
     * slot: `crease_weight` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    creaseWeight?: number
    /**
     * Scale the offset by surrounding geometry.
     *
     * slot: `use_relative_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useRelativeOffset?: boolean
    /**
     * Offset material index of generated faces.
     *
     * slot: `material_offset` (BMO_OP_SLOT_INT)
     * default: 0 (slots are zero-initialised by BMO_op_init)
     */
    materialOffset?: number
}

/** Output slots of `wireframe`. */
export interface WireframeResult {
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
}

/**
 * Pokes a face.
 *
 * Splits a face into a triangle fan.
 *
 * Blender operator: `poke` (exec: `bmo_poke_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface PokeParams {
    /**
     * Input faces.
     *
     * slot: `faces` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    faces: BMFace[]
    /**
     * Center vertex offset along normal.
     *
     * slot: `offset` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    offset?: number
    /**
     * Calculation mode for center vertex.
     *
     * slot: `center_mode` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_poke_center_mode`
     * default: "MEAN_WEIGHTED" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    centerMode?: "MEAN_WEIGHTED" | "MEAN" | "BOUNDS"
    /**
     * Apply offset.
     *
     * slot: `use_relative_offset` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useRelativeOffset?: boolean
}

/** Output slots of `poke`. */
export interface PokeResult {
    /**
     * Output verts.
     *
     * slot: `verts.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    verts: BMVert[]
    /**
     * Output faces.
     *
     * slot: `faces.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
 *
 * Blender operator: `convex_hull` (exec: `bmo_convex_hull_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 *
 * Only present when `WITH_BULLET` is defined at build time.
 */
export interface ConvexHullParams {
    /**
     * Input geometry.
     *
     * slot: `input` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    input: (BMVert | BMEdge | BMFace)[]
    /**
     * Skip hull triangles that are covered by a pre-existing face.
     *
     * slot: `use_existing_faces` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useExistingFaces?: boolean
}

/** Output slots of `convex_hull`. */
export interface ConvexHullResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: (BMVert | BMEdge | BMFace)[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom_interior.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomInterior: (BMVert | BMEdge | BMFace)[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom_unused.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomUnused: (BMVert | BMEdge | BMFace)[]
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom_holes.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geomHoles: (BMVert | BMEdge | BMFace)[]
}

/**
 * Space Evenly.
 *
 * Space the vertices in a regular distribution on the loop.
 *
 * Blender operator: `space_edge_loops_evenly` (exec: `bmo_space_edge_loops_evenly_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC
 */
export interface SpaceEdgeLoopsEvenlyParams {
    /**
     * Input geometry.
     *
     * slot: `geom` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    geom: BMEdge[]
    /**
     * Method used for interpolation.
     *
     * slot: `interpolation` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_space_edge_loops_evenly_interpolation_method`
     * default: "CUBIC" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    interpolation?: "CUBIC" | "LINEAR"
    /**
     * Influence factor: spans from 0.0 to 1.0.
     *
     * slot: `factor` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    factor?: number
    /**
     * Lock X-axis editing.
     *
     * slot: `lock_x` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockX?: boolean
    /**
     * Lock Y-axis editing.
     *
     * slot: `lock_y` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    lockY?: boolean
    /**
     * Lock Z-axis editing.
     *
     * slot: `lock_z` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
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
 *
 * Blender operator: `symmetrize` (exec: `bmo_symmetrize_exec`)
 * type flags: BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE
 */
export interface SymmetrizeParams {
    /**
     * Input geometry.
     *
     * slot: `input` (BMO_OP_SLOT_ELEMENT_BUF)
     */
    input: (BMVert | BMEdge | BMFace)[]
    /**
     * Axis to use.
     *
     * slot: `direction` (BMO_OP_SLOT_INT, BMO_OP_SLOT_SUBTYPE_INT_ENUM)
     * enum table: `bmo_enum_axis_neg_xyz_and_xyz`
     * default: "-X" (= 0; bmo_op_slots_init uses enum_flags[0].value, bmesh_operators.cc:109)
     */
    direction?: "-X" | "-Y" | "-Z" | "X" | "Y" | "Z"
    /**
     * Minimum distance.
     *
     * slot: `dist` (BMO_OP_SLOT_FLT)
     * default: 0.0 (slots are zero-initialised by BMO_op_init)
     */
    dist?: number
    /**
     * Transform shape keys too.
     *
     * slot: `use_shapekey` (BMO_OP_SLOT_BOOL)
     * default: false (slots are zero-initialised by BMO_op_init)
     */
    useShapekey?: boolean
}

/** Output slots of `symmetrize`. */
export interface SymmetrizeResult {
    /**
     * Undocumented in the Blender source.
     *
     * slot: `geom.out` (BMO_OP_SLOT_ELEMENT_BUF)
     */
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
