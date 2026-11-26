/**
 * BMesh operator schema, extracted from Blender.
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

/** Slot value kinds, mapped from Blender's `eBMOpSlotType`. */
export type BMOSlotType = "bool" | "elems" | "float" | "int" | "map" | "mat4" | "ptr" | "vec3"

/** Slot subtype, mapped from `eBMOpSlotSubType_{Map,Ptr,Int}` (the `BMO_OP_SLOT_SUBTYPE_` prefix is stripped). */
export type BMOSlotSubtype = "MAP_EMPTY" | "MAP_ELEM" | "MAP_FLT" | "MAP_INT" | "MAP_BOOL" | "MAP_INTERNAL" | "PTR_BMESH" | "PTR_SCENE" | "PTR_OBJECT" | "PTR_MESH" | "PTR_STRUCT" | "INT_ENUM" | "INT_FLAG"

/** Post-execution behaviour declared by the operator (`BMOpDefine.type_flag`). */
export type BMOTypeFlag = "BMO_OPTYPE_FLAG_UNTAN_MULTIRES" | "BMO_OPTYPE_FLAG_NORMALS_CALC" | "BMO_OPTYPE_FLAG_SELECT_FLUSH" | "BMO_OPTYPE_FLAG_SELECT_VALIDATE" | "BMO_OPTYPE_FLAG_INVALIDATE_CLNOR_ALL"

/** Element-type bitmask for `elems` and `map` slots. Values are Blender's `BMHeader.htype`. */
export const BM_VERT = 1 as const
export const BM_EDGE = 2 as const
export const BM_LOOP = 4 as const
export const BM_FACE = 8 as const
/** `BMO_OP_SLOT_SUBTYPE_ELEM_IS_SINGLE` - carried separately as `BMOSlotDef.isSingle`. */
export const BM_ELEM_IS_SINGLE = 16 as const
export type BMOElemMask = number

/** Numeric `eBMOpSlotType` values, for interop with a C-compatible runtime. */
export const BMO_SLOT_TYPE_VALUES: Readonly<Record<BMOSlotType, number>> = {
    bool: 1, // BMO_OP_SLOT_BOOL
    int: 2, // BMO_OP_SLOT_INT
    float: 3, // BMO_OP_SLOT_FLT
    ptr: 4, // BMO_OP_SLOT_PTR
    mat4: 5, // BMO_OP_SLOT_MAT
    vec3: 8, // BMO_OP_SLOT_VEC
    elems: 9, // BMO_OP_SLOT_ELEMENT_BUF
    map: 10, // BMO_OP_SLOT_MAPPING
}

/** Numeric `BMOpTypeFlag` bits. */
export const BMO_TYPE_FLAG_VALUES: Readonly<Record<BMOTypeFlag, number>> = {
    BMO_OPTYPE_FLAG_UNTAN_MULTIRES: 1,
    BMO_OPTYPE_FLAG_NORMALS_CALC: 2,
    BMO_OPTYPE_FLAG_SELECT_FLUSH: 4,
    BMO_OPTYPE_FLAG_SELECT_VALIDATE: 8,
    BMO_OPTYPE_FLAG_INVALIDATE_CLNOR_ALL: 16,
}

export interface BMOEnumEntry {
    /** Blender's string identifier, e.g. `"BEAUTY"`. */
    name: string
    /** The C value the identifier expands to. */
    value: number
}

export interface BMOSlotDef {
    /** Blender slot name, verbatim (output slots keep their `.out` qualifier). */
    name: string
    /** camelCase name, `.out`/`.in` stripped. See the naming rules in README.md. */
    tsName: string
    type: BMOSlotType
    /** Blender's `eBMOpSlotType` enumerator name. */
    cType: string
    /** Subtype for `int`, `ptr` and `map` slots. `elems` slots use `elemMask`/`isSingle` instead. */
    subtype?: BMOSlotSubtype
    /** Bitmask of BM_VERT|BM_EDGE|BM_FACE accepted by an `elems` slot. */
    elemMask?: BMOElemMask
    /** True when the `elems` slot holds a single element rather than a buffer. */
    isSingle?: boolean
    /** Key into {@link BMO_ENUMS} for `INT_ENUM`/`INT_FLAG` slots. */
    enumName?: string
    /** Slot documentation from the C source (reStructuredText). */
    doc?: string
    /** `NOTE:` implementation comment attached to the slot (Blender's doc generator drops these). */
    note?: string
    /** Set when the slot only exists under a build-time `#ifdef` in bmesh_opdefines.cc. */
    condition?: string
}

export interface BMOOpDef {
    /** Blender operator name, e.g. `"extrude_face_region"`. */
    name: string
    /** camelCase operator name, e.g. `"extrudeFaceRegion"`. */
    tsName: string
    /** Operator documentation from the C source. First line is the title. */
    doc: string
    slotsIn: BMOSlotDef[]
    slotsOut: BMOSlotDef[]
    typeFlags: BMOTypeFlag[]
    /** C name of the `exec` callback - the function a port has to reimplement. */
    execC: string
    /** Blender source file implementing `execC`; doubles as the operator's category. */
    execFile?: string
    /** C name of the optional `init` callback that sets non-zero slot defaults. */
    initC?: string
    /** Slot defaults set by `initC`, keyed by Blender slot name. */
    initDefaults?: Record<string, {valueSrc: string, source: string}>
    /** Set when the operator only exists under a build-time `#ifdef` in bmesh_opdefines.cc. */
    condition?: string
}

/** Every `static BMO_FlagSet bmo_enum_*[]` table, keyed by its C name. */
export const BMO_ENUMS: Readonly<Record<string, readonly BMOEnumEntry[]>> = {
    "bmo_enum_axis_xyz": [
        {name: "X", value: 0},
        {name: "Y", value: 1},
        {name: "Z", value: 2},
    ],
    "bmo_enum_axis_neg_xyz_and_xyz": [
        {name: "-X", value: 0},
        {name: "-Y", value: 1},
        {name: "-Z", value: 2},
        {name: "X", value: 3},
        {name: "Y", value: 4},
        {name: "Z", value: 5},
    ],
    "bmo_enum_falloff_type": [
        {name: "SMOOTH", value: 0}, // SUBD_FALLOFF_SMOOTH
        {name: "SPHERE", value: 1}, // SUBD_FALLOFF_SPHERE
        {name: "ROOT", value: 2}, // SUBD_FALLOFF_ROOT
        {name: "SHARP", value: 3}, // SUBD_FALLOFF_SHARP
        {name: "LINEAR", value: 4}, // SUBD_FALLOFF_LIN
        {name: "INVERSE_SQUARE", value: 7}, // SUBD_FALLOFF_INVSQUARE
    ],
    "bmo_enum_dissolve_limit_flags": [
        {name: "NORMAL", value: 1}, // BMO_DELIM_NORMAL
        {name: "MATERIAL", value: 2}, // BMO_DELIM_MATERIAL
        {name: "SEAM", value: 4}, // BMO_DELIM_SEAM
        {name: "SHARP", value: 8}, // BMO_DELIM_SHARP
        {name: "UV", value: 16}, // BMO_DELIM_UV
    ],
    "bmo_enum_triangulate_quad_method": [
        {name: "BEAUTY", value: 0}, // MOD_TRIANGULATE_QUAD_BEAUTY
        {name: "FIXED", value: 1}, // MOD_TRIANGULATE_QUAD_FIXED
        {name: "ALTERNATE", value: 2}, // MOD_TRIANGULATE_QUAD_ALTERNATE
        {name: "SHORT_EDGE", value: 3}, // MOD_TRIANGULATE_QUAD_SHORTEDGE
        {name: "LONG_EDGE", value: 4}, // MOD_TRIANGULATE_QUAD_LONGEDGE
    ],
    "bmo_enum_triangulate_ngon_method": [
        {name: "BEAUTY", value: 0}, // MOD_TRIANGULATE_NGON_BEAUTY
        {name: "EAR_CLIP", value: 1}, // MOD_TRIANGULATE_NGON_EARCLIP
    ],
    "bmo_enum_subdivide_edges_quad_corner_type": [
        {name: "STRAIGHT_CUT", value: 3}, // SUBD_CORNER_STRAIGHT_CUT
        {name: "INNER_VERT", value: 0}, // SUBD_CORNER_INNERVERT
        {name: "PATH", value: 1}, // SUBD_CORNER_PATH
        {name: "FAN", value: 2}, // SUBD_CORNER_FAN
    ],
    "bmo_enum_subdivide_edgering_interp_mode": [
        {name: "LINEAR", value: 0}, // SUBD_RING_INTERP_LINEAR
        {name: "PATH", value: 1}, // SUBD_RING_INTERP_PATH
        {name: "SURFACE", value: 2}, // SUBD_RING_INTERP_SURF
    ],
    "bmo_enum_delete_context": [
        {name: "VERTS", value: 1}, // DEL_VERTS
        {name: "EDGES", value: 2}, // DEL_EDGES
        {name: "FACES_ONLY", value: 3}, // DEL_ONLYFACES
        {name: "EDGES_FACES", value: 4}, // DEL_EDGESFACES
        {name: "FACES", value: 5}, // DEL_FACES
        {name: "FACES_KEEP_BOUNDARY", value: 6}, // DEL_FACES_KEEP_BOUNDARY
        {name: "TAGGED_ONLY", value: 7}, // DEL_ONLYTAGGED
    ],
    "bmo_enum_bevel_offset_type": [
        {name: "OFFSET", value: 0}, // BEVEL_AMT_OFFSET
        {name: "WIDTH", value: 1}, // BEVEL_AMT_WIDTH
        {name: "DEPTH", value: 2}, // BEVEL_AMT_DEPTH
        {name: "PERCENT", value: 3}, // BEVEL_AMT_PERCENT
        {name: "ABSOLUTE", value: 4}, // BEVEL_AMT_ABSOLUTE
    ],
    "bmo_enum_bevel_profile_type": [
        {name: "SUPERELLIPSE", value: 0}, // BEVEL_PROFILE_SUPERELLIPSE
        {name: "CUSTOM", value: 1}, // BEVEL_PROFILE_CUSTOM
    ],
    "bmo_enum_bevel_face_strength_type": [
        {name: "NONE", value: 0}, // BEVEL_FACE_STRENGTH_NONE
        {name: "NEW", value: 1}, // BEVEL_FACE_STRENGTH_NEW
        {name: "AFFECTED", value: 2}, // BEVEL_FACE_STRENGTH_AFFECTED
        {name: "ALL", value: 3}, // BEVEL_FACE_STRENGTH_ALL
    ],
    "bmo_enum_bevel_miter_type": [
        {name: "SHARP", value: 0}, // BEVEL_MITER_SHARP
        {name: "PATCH", value: 1}, // BEVEL_MITER_PATCH
        {name: "ARC", value: 2}, // BEVEL_MITER_ARC
    ],
    "bmo_enum_bevel_vmesh_method": [
        {name: "ADJ", value: 0}, // BEVEL_VMESH_ADJ
        {name: "CUTOFF", value: 1}, // BEVEL_VMESH_CUTOFF
    ],
    "bmo_enum_bevel_affect_type": [
        {name: "VERTICES", value: 0}, // BEVEL_AFFECT_VERTICES
        {name: "EDGES", value: 1}, // BEVEL_AFFECT_EDGES
    ],
    "bmo_enum_beautify_fill_method": [
        {name: "AREA", value: 0},
        {name: "ANGLE", value: 1},
    ],
    "bmo_enum_poke_center_mode": [
        {name: "MEAN_WEIGHTED", value: 0}, // BMOP_POKE_MEDIAN_WEIGHTED
        {name: "MEAN", value: 1}, // BMOP_POKE_MEDIAN
        {name: "BOUNDS", value: 2}, // BMOP_POKE_BOUNDS
    ],
    "bmo_enum_space_edge_loops_evenly_interpolation_method": [
        {name: "CUBIC", value: 0}, // SPACE_EDGE_LOOPS_EVENLY_INTERP_CUBIC
        {name: "LINEAR", value: 1}, // SPACE_EDGE_LOOPS_EVENLY_INTERP_LINEAR
    ],
}

/** Every operator in `bmo_opdefines[]`, keyed by its Blender name. */
export const BMO_OPS: Readonly<Record<string, BMOOpDef>> = {
    /**
     * Vertex Smooth.
     *
     * Smooths vertices by using a basic vertex averaging scheme.
     */
    "smooth_vert": {
        name: "smooth_vert",
        tsName: "smoothVert",
        doc: "Vertex Smooth.\n\nSmooths vertices by using a basic vertex averaging scheme.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Smoothing factor. */
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Smoothing factor."},
            /** Set vertices close to the x axis before the operation to 0. */
            {name: "mirror_clip_x", tsName: "mirrorClipX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Set vertices close to the x axis before the operation to 0."},
            /** Set vertices close to the y axis before the operation to 0. */
            {name: "mirror_clip_y", tsName: "mirrorClipY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Set vertices close to the y axis before the operation to 0."},
            /** Set vertices close to the z axis before the operation to 0. */
            {name: "mirror_clip_z", tsName: "mirrorClipZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Set vertices close to the z axis before the operation to 0."},
            /** Clipping threshold for the above three slots. */
            {name: "clip_dist", tsName: "clipDist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Clipping threshold for the above three slots."},
            /** Smooth vertices along X axis. */
            {name: "use_axis_x", tsName: "useAxisX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth vertices along X axis."},
            /** Smooth vertices along Y axis. */
            {name: "use_axis_y", tsName: "useAxisY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth vertices along Y axis."},
            /** Smooth vertices along Z axis. */
            {name: "use_axis_z", tsName: "useAxisZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth vertices along Z axis."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_smooth_vert_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Vertex Smooth Laplacian.
     *
     * Smooths vertices by using Laplacian smoothing proposed by
     * Desbrun, et al. Implicit Fairing of Irregular Meshes using Diffusion and Curvature Flow.
     */
    "smooth_laplacian_vert": {
        name: "smooth_laplacian_vert",
        tsName: "smoothLaplacianVert",
        doc: "Vertex Smooth Laplacian.\n\nSmooths vertices by using Laplacian smoothing proposed by\nDesbrun, et al. Implicit Fairing of Irregular Meshes using Diffusion and Curvature Flow.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Lambda parameter. */
            {name: "lambda_factor", tsName: "lambdaFactor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Lambda parameter."},
            /** Lambda param in border. */
            {name: "lambda_border", tsName: "lambdaBorder", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Lambda param in border."},
            /** Smooth object along X axis. */
            {name: "use_x", tsName: "useX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth object along X axis."},
            /** Smooth object along Y axis. */
            {name: "use_y", tsName: "useY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth object along Y axis."},
            /** Smooth object along Z axis. */
            {name: "use_z", tsName: "useZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth object along Z axis."},
            /** Apply volume preservation after smooth. */
            {name: "preserve_volume", tsName: "preserveVolume", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Apply volume preservation after smooth."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_smooth_laplacian_vert_exec",
        execFile: "source/blender/bmesh/operators/bmo_smooth_laplacian.cc",
    },
    /**
     * Right-Hand Faces.
     *
     * Computes an "outside" normal for the specified input faces.
     */
    "recalc_face_normals": {
        name: "recalc_face_normals",
        tsName: "recalcFaceNormals",
        doc: "Right-Hand Faces.\n\nComputes an \"outside\" normal for the specified input faces.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_recalc_face_normals_exec",
        execFile: "source/blender/bmesh/operators/bmo_normals.cc",
    },
    /**
     * Planar Faces.
     *
     * Iteratively flatten faces.
     */
    "planar_faces": {
        name: "planar_faces",
        tsName: "planarFaces",
        doc: "Planar Faces.\n\nIteratively flatten faces.",
        slotsIn: [
            /** Input geometry. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input geometry."},
            /** Number of times to flatten faces (for when connected faces are used) */
            {name: "iterations", tsName: "iterations", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of times to flatten faces (for when connected faces are used)"},
            /** Influence for making planar each iteration */
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Influence for making planar each iteration"},
        ],
        slotsOut: [
            /** Output slot, computed boundary geometry. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Output slot, computed boundary geometry."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_planar_faces_exec",
        execFile: "source/blender/bmesh/operators/bmo_planar_faces.cc",
    },
    /**
     * Region Extend.
     *
     * Used to implement the select more/less tools.
     * Puts geometry surrounding regions of geometry in `geom` into `geom.out`.
     *
     * If `use_faces` is 0 then `geom.out` spits out verts and edges,
     * otherwise it spits out faces.
     */
    "region_extend": {
        name: "region_extend",
        tsName: "regionExtend",
        doc: "Region Extend.\n\nUsed to implement the select more/less tools.\nPuts geometry surrounding regions of geometry in `geom` into `geom.out`.\n\nIf `use_faces` is 0 then `geom.out` spits out verts and edges,\notherwise it spits out faces.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Find boundary inside the regions, not outside. */
            {name: "use_contract", tsName: "useContract", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Find boundary inside the regions, not outside."},
            /** Extend from faces instead of edges. */
            {name: "use_faces", tsName: "useFaces", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Extend from faces instead of edges."},
            /** Step over connected faces. */
            {name: "use_face_step", tsName: "useFaceStep", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Step over connected faces."},
        ],
        slotsOut: [
            /** Output slot, computed boundary geometry. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Output slot, computed boundary geometry."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_region_extend_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Edge Rotate.
     *
     * Rotates edges topologically. Also known as "spin edge" to some people.
     * Simple example: `[/] becomes [|] then [\]`.
     */
    "rotate_edges": {
        name: "rotate_edges",
        tsName: "rotateEdges",
        doc: "Edge Rotate.\n\nRotates edges topologically. Also known as \"spin edge\" to some people.\nSimple example: `[/] becomes [|] then [\\]`.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Rotate edge counter-clockwise if true, otherwise clockwise. */
            {name: "use_ccw", tsName: "useCcw", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Rotate edge counter-clockwise if true, otherwise clockwise."},
        ],
        slotsOut: [
            /** Newly spun edges. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Newly spun edges."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_rotate_edges_exec",
        execFile: "source/blender/bmesh/operators/bmo_rotate_edges.cc",
    },
    /**
     * Reverse Faces.
     *
     * Reverses the winding (vertex order) of faces.
     * This has the effect of flipping the normal.
     */
    "reverse_faces": {
        name: "reverse_faces",
        tsName: "reverseFaces",
        doc: "Reverse Faces.\n\nReverses the winding (vertex order) of faces.\nThis has the effect of flipping the normal.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Maintain multi-res offset. */
            {name: "flip_multires", tsName: "flipMultires", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Maintain multi-res offset."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_reverse_faces_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Flip Quad Tessellation
     *
     * Flip the tessellation direction of the selected quads.
     */
    "flip_quad_tessellation": {
        name: "flip_quad_tessellation",
        tsName: "flipQuadTessellation",
        doc: "Flip Quad Tessellation\n\nFlip the tessellation direction of the selected quads.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_flip_quad_tessellation_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Edge Bisect.
     *
     * Splits input edges (but doesn't do anything else).
     * This creates a 2-valence vert.
     */
    "bisect_edges": {
        name: "bisect_edges",
        tsName: "bisectEdges",
        doc: "Edge Bisect.\n\nSplits input edges (but doesn't do anything else).\nThis creates a 2-valence vert.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Number of cuts. */
            {name: "cuts", tsName: "cuts", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of cuts."},
            {name: "edge_percents", tsName: "edgePercents", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_FLT"},
        ],
        slotsOut: [
            /** Newly created vertices and edges. */
            {name: "geom_split.out", tsName: "geomSplit", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Newly created vertices and edges."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bisect_edges_exec",
        execFile: "source/blender/bmesh/operators/bmo_subdivide.cc",
    },
    /**
     * Mirror.
     *
     * Mirrors geometry along an axis. The resulting geometry is welded on using
     * `merge_dist`. Pairs of original/mirrored vertices are welded using the `merge_dist`
     * parameter (which defines the minimum distance for welding to happen).
     */
    "mirror": {
        name: "mirror",
        tsName: "mirror",
        doc: "Mirror.\n\nMirrors geometry along an axis. The resulting geometry is welded on using\n`merge_dist`. Pairs of original/mirrored vertices are welded using the `merge_dist`\nparameter (which defines the minimum distance for welding to happen).",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Matrix defining the mirror transformation. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix defining the mirror transformation."},
            /** Maximum distance for merging. does no merging if 0. */
            {name: "merge_dist", tsName: "mergeDist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Maximum distance for merging. does no merging if 0."},
            /** The axis to use. */
            {name: "axis", tsName: "axis", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_axis_xyz", doc: "The axis to use."},
            /** Mirror UVs across the u axis. */
            {name: "mirror_u", tsName: "mirrorU", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Mirror UVs across the u axis."},
            /** Mirror UVs across the v axis. */
            {name: "mirror_v", tsName: "mirrorV", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Mirror UVs across the v axis."},
            /** Mirror UVs in each tile. */
            {name: "mirror_udim", tsName: "mirrorUdim", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Mirror UVs in each tile."},
            /** Transform shape keys too. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Transform shape keys too."},
        ],
        slotsOut: [
            /** Output geometry, mirrored. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Output geometry, mirrored."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_mirror_exec",
        execFile: "source/blender/bmesh/operators/bmo_mirror.cc",
    },
    /**
     * Find Doubles.
     *
     * Takes input verts and finds vertices they should weld to.
     * Outputs a mapping slot suitable for use with the weld verts BMOP.
     *
     * If `keep_verts` is used, vertices outside that set can only be merged
     * with vertices in that set.
     */
    "find_doubles": {
        name: "find_doubles",
        tsName: "findDoubles",
        doc: "Find Doubles.\n\nTakes input verts and finds vertices they should weld to.\nOutputs a mapping slot suitable for use with the weld verts BMOP.\n\nIf `keep_verts` is used, vertices outside that set can only be merged\nwith vertices in that set.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** List of verts to keep. */
            {name: "keep_verts", tsName: "keepVerts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "List of verts to keep."},
            /** Limit the search for doubles by connected geometry. */
            {name: "use_connected", tsName: "useConnected", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Limit the search for doubles by connected geometry."},
            /** Maximum distance. */
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Maximum distance."},
        ],
        slotsOut: [
            {name: "targetmap.out", tsName: "targetmap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: [],
        execC: "bmo_find_doubles_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Remove Doubles.
     *
     * Finds groups of vertices closer than dist and merges them together,
     * using the weld verts BMOP.
     */
    "remove_doubles": {
        name: "remove_doubles",
        tsName: "removeDoubles",
        doc: "Remove Doubles.\n\nFinds groups of vertices closer than dist and merges them together,\nusing the weld verts BMOP.",
        slotsIn: [
            /** Input verts. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input verts."},
            /** Limit the search for doubles by connected geometry. */
            {name: "use_connected", tsName: "useConnected", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Limit the search for doubles by connected geometry."},
            /** Maximum distance. */
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Maximum distance."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_remove_doubles_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Circularize.
     *
     * Shape selected geometry into a circle.
     */
    "circularize": {
        name: "circularize",
        tsName: "circularize",
        doc: "Circularize.\n\nShape selected geometry into a circle.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Influence factor: spans from 0.0 to 1.0. */
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Influence factor: spans from 0.0 to 1.0."},
            /** Custom radius. */
            {name: "custom_radius", tsName: "customRadius", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Custom radius."},
            /** Rotation angle. */
            {name: "angle", tsName: "angle", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Rotation angle."},
            /** Method to fit the circle. */
            {name: "fit_method", tsName: "fitMethod", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Method to fit the circle."},
            /** Flatten factor: 0.0 projects onto the mesh, 1.0 flattens on the optimal plane. */
            {name: "flatten", tsName: "flatten", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Flatten factor: 0.0 projects onto the mesh, 1.0 flattens on the optimal plane."},
            /** Distributes vertices at constant distances, otherwise preserves original spacing. */
            {name: "regular", tsName: "regular", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Distributes vertices at constant distances, otherwise preserves original spacing."},
            /** Lock X-axis editing. */
            {name: "lock_x", tsName: "lockX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock X-axis editing."},
            /** Lock Y-axis editing. */
            {name: "lock_y", tsName: "lockY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock Y-axis editing."},
            /** Lock Z-axis editing. */
            {name: "lock_z", tsName: "lockZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock Z-axis editing."},
            /** Use X axis of the mirror modifier. */
            {name: "mirror_x", tsName: "mirrorX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use X axis of the mirror modifier."},
            /** Use Y axis of the mirror modifier. */
            {name: "mirror_y", tsName: "mirrorY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use Y axis of the mirror modifier."},
            /** Use Z axis of the mirror modifier. */
            {name: "mirror_z", tsName: "mirrorZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use Z axis of the mirror modifier."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_circularize_exec",
        execFile: "source/blender/bmesh/operators/bmo_circularize.cc",
    },
    /**
     * Flatten.
     *
     * Flatten vertices on a best-fitting plane.
     */
    "flatten": {
        name: "flatten",
        tsName: "flatten",
        doc: "Flatten.\n\nFlatten vertices on a best-fitting plane.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Influence factor: spans from 0.0 to 1.0. */
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Influence factor: spans from 0.0 to 1.0."},
            /** Plane on which vertices are flattened. */
            {name: "method", tsName: "method", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Plane on which vertices are flattened."},
            /** View direction in object local space. */
            {name: "view_normal", tsName: "viewNormal", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "View direction in object local space."},
            /** Lock X axis editing. */
            {name: "lock_x", tsName: "lockX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock X axis editing."},
            /** Lock Y axis editing. */
            {name: "lock_y", tsName: "lockY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock Y axis editing."},
            /** Lock Z axis editing. */
            {name: "lock_z", tsName: "lockZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock Z axis editing."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_flatten_exec",
        execFile: "source/blender/bmesh/operators/bmo_flatten.cc",
    },
    /**
     * Collapse Connected.
     *
     * Collapses connected vertices
     */
    "collapse": {
        name: "collapse",
        tsName: "collapse",
        doc: "Collapse Connected.\n\nCollapses connected vertices",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Also collapse UVs and such. */
            {name: "uvs", tsName: "uvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Also collapse UVs and such."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_collapse_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Face-Data Point Merge.
     *
     * Merge uv/vcols at a specific vertex.
     */
    "pointmerge_facedata": {
        name: "pointmerge_facedata",
        tsName: "pointmergeFacedata",
        doc: "Face-Data Point Merge.\n\nMerge uv/vcols at a specific vertex.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Target vertex to merge into. */
            {name: "vert_target", tsName: "vertTarget", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, isSingle: true, doc: "Target vertex to merge into."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_pointmerge_facedata_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Average Vertices Face-vert Data.
     *
     * Merge uv/vcols associated with the input vertices at
     * the bounding box center.
     */
    "average_vert_facedata": {
        name: "average_vert_facedata",
        tsName: "averageVertFacedata",
        doc: "Average Vertices Face-vert Data.\n\nMerge uv/vcols associated with the input vertices at\nthe bounding box center.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_average_vert_facedata_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Point Merge.
     *
     * Merge verts together at a point.
     */
    "pointmerge": {
        name: "pointmerge",
        tsName: "pointmerge",
        doc: "Point Merge.\n\nMerge verts together at a point.",
        slotsIn: [
            /** Input vertices (all verts will be merged into the first). */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices (all verts will be merged into the first)."},
            /** Position to merge at. */
            {name: "merge_co", tsName: "mergeCo", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Position to merge at."},
            /**
             * Optional target vertex to merge into. Does not override merge_co.
             * Set this to preserve the custom data of the target vertex.
             */
            {name: "vert_target", tsName: "vertTarget", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, isSingle: true, doc: "Optional target vertex to merge into. Does not override merge_co.\nSet this to preserve the custom data of the target vertex."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_pointmerge_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Collapse Connected UVs.
     *
     * Collapses connected UV vertices.
     */
    "collapse_uvs": {
        name: "collapse_uvs",
        tsName: "collapseUvs",
        doc: "Collapse Connected UVs.\n\nCollapses connected UV vertices.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_collapse_uvs_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Weld Verts.
     *
     * Welds verts together (kind-of like remove doubles, merge, etc, all of which
     * use or will use this BMOP). You pass in mappings from vertices to the vertices
     * they weld with.
     */
    "weld_verts": {
        name: "weld_verts",
        tsName: "weldVerts",
        doc: "Weld Verts.\n\nWelds verts together (kind-of like remove doubles, merge, etc, all of which\nuse or will use this BMOP). You pass in mappings from vertices to the vertices\nthey weld with.",
        slotsIn: [
            /** Maps welded vertices to verts they should weld to. */
            {name: "targetmap", tsName: "targetmap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM", doc: "Maps welded vertices to verts they should weld to."},
            /**
             * Merge vertices to their centroid position,
             * otherwise use the position of the target vertex.
             */
            {name: "use_centroid", tsName: "useCentroid", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Merge vertices to their centroid position,\notherwise use the position of the target vertex."},
            /** Whether to average custom data of merged vertices. */
            {name: "average_vert_data", tsName: "averageVertData", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Whether to average custom data of merged vertices."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_weld_verts_exec",
        execFile: "source/blender/bmesh/operators/bmo_removedoubles.cc",
    },
    /**
     * Make Vertex.
     *
     * Creates a single vertex; this BMOP was necessary
     * for click-create-vertex.
     */
    "create_vert": {
        name: "create_vert",
        tsName: "createVert",
        doc: "Make Vertex.\n\nCreates a single vertex; this BMOP was necessary\nfor click-create-vertex.",
        slotsIn: [
            /** The coordinate of the new vert. */
            {name: "co", tsName: "co", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "The coordinate of the new vert."},
        ],
        slotsOut: [
            /** The new vert. */
            {name: "vert.out", tsName: "vert", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "The new vert."},
        ],
        typeFlags: [],
        execC: "bmo_create_vert_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Join Triangles.
     *
     * Tries to intelligently join triangles according
     * to angle threshold and delimiters.
     */
    "join_triangles": {
        name: "join_triangles",
        tsName: "joinTriangles",
        doc: "Join Triangles.\n\nTries to intelligently join triangles according\nto angle threshold and delimiters.",
        slotsIn: [
            /** Input geometry. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input geometry."},
            /** Compare seam */
            {name: "cmp_seam", tsName: "cmpSeam", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Compare seam"},
            /** Compare sharp */
            {name: "cmp_sharp", tsName: "cmpSharp", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Compare sharp"},
            /** Compare UVs */
            {name: "cmp_uvs", tsName: "cmpUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Compare UVs"},
            /** Compare VCols. */
            {name: "cmp_vcols", tsName: "cmpVcols", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Compare VCols."},
            /** Compare materials. */
            {name: "cmp_materials", tsName: "cmpMaterials", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Compare materials."},
            {name: "angle_face_threshold", tsName: "angleFaceThreshold", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "angle_shape_threshold", tsName: "angleShapeThreshold", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "topology_influence", tsName: "topologyInfluence", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "deselect_joined", tsName: "deselectJoined", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            /** Only present when `USE_JOIN_TRIANGLE_INTERACTIVE_TESTING` is defined. */
            {name: "merge_limit", tsName: "mergeLimit", type: "int", cType: "BMO_OP_SLOT_INT", condition: "USE_JOIN_TRIANGLE_INTERACTIVE_TESTING"},
            /** Only present when `USE_JOIN_TRIANGLE_INTERACTIVE_TESTING` is defined. */
            {name: "neighbor_debug", tsName: "neighborDebug", type: "int", cType: "BMO_OP_SLOT_INT", condition: "USE_JOIN_TRIANGLE_INTERACTIVE_TESTING"},
        ],
        slotsOut: [
            /** Joined faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Joined faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_join_triangles_exec",
        execFile: "source/blender/bmesh/operators/bmo_join_triangles.cc",
    },
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
    "contextual_create": {
        name: "contextual_create",
        tsName: "contextualCreate",
        doc: "Contextual Create.\n\nThis is basically F-key, it creates\nnew faces from vertices, makes stuff from edge nets,\nmakes wire edges, etc. It also dissolves faces.\n\nThree verts become a triangle, four become a quad. Two\nbecome a wire edge.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Material to use. */
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Material to use."},
            /** Set smooth shading on newly created faces. */
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Set smooth shading on newly created faces."},
        ],
        slotsOut: [
            /** Newly-made face(s). */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Newly-made face(s)."},
            /** Newly-made edge(s). */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Newly-made edge(s)."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_contextual_create_exec",
        execFile: "source/blender/bmesh/operators/bmo_create.cc",
    },
    /** Bridge edge loops with faces. */
    "bridge_loops": {
        name: "bridge_loops",
        tsName: "bridgeLoops",
        doc: "Bridge edge loops with faces.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            {name: "use_pairs", tsName: "usePairs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_cyclic", tsName: "useCyclic", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            /** Merge rather than creating faces. */
            {name: "use_merge", tsName: "useMerge", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Merge rather than creating faces."},
            /** Merge factor. */
            {name: "merge_factor", tsName: "mergeFactor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Merge factor."},
            /** Twist offset for closed loops. */
            {name: "twist_offset", tsName: "twistOffset", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Twist offset for closed loops."},
        ],
        slotsOut: [
            /** New faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "New faces."},
            /** New edges. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "New edges."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bridge_loops_exec",
        execFile: "source/blender/bmesh/operators/bmo_bridge.cc",
    },
    /**
     * Grid Fill.
     *
     * Create faces defined by 2 disconnected edge loops (which share edges).
     */
    "grid_fill": {
        name: "grid_fill",
        tsName: "gridFill",
        doc: "Grid Fill.\n\nCreate faces defined by 2 disconnected edge loops (which share edges).",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Material to use. */
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Material to use."},
            /** Smooth state to use. */
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth state to use."},
            /** Use simple interpolation. */
            {name: "use_interp_simple", tsName: "useInterpSimple", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use simple interpolation."},
        ],
        slotsOut: [
            /** New faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "New faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_grid_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_fill_grid.cc",
    },
    /**
     * Fill Holes.
     *
     * Fill boundary edges with faces, copying surrounding custom-data.
     */
    "holes_fill": {
        name: "holes_fill",
        tsName: "holesFill",
        doc: "Fill Holes.\n\nFill boundary edges with faces, copying surrounding custom-data.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Maximum number of sides for holes to fill (holes with more edges are skipped). */
            {name: "sides", tsName: "sides", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Maximum number of sides for holes to fill (holes with more edges are skipped)."},
        ],
        slotsOut: [
            /** New faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "New faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_holes_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_fill_holes.cc",
    },
    /**
     * Face Attribute Fill.
     *
     * Fill in faces with data from adjacent faces.
     */
    "face_attribute_fill": {
        name: "face_attribute_fill",
        tsName: "faceAttributeFill",
        doc: "Face Attribute Fill.\n\nFill in faces with data from adjacent faces.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Copy face winding. */
            {name: "use_normals", tsName: "useNormals", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Copy face winding."},
            /** Copy face data. */
            {name: "use_data", tsName: "useData", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Copy face data."},
        ],
        slotsOut: [
            /** Faces that could not be handled. */
            {name: "faces_fail.out", tsName: "facesFail", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Faces that could not be handled."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_face_attribute_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_fill_attribute.cc",
    },
    /**
     * Edge Loop Fill.
     *
     * Create faces defined by one or more non overlapping edge loops.
     */
    "edgeloop_fill": {
        name: "edgeloop_fill",
        tsName: "edgeloopFill",
        doc: "Edge Loop Fill.\n\nCreate faces defined by one or more non overlapping edge loops.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Material to use. */
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Material to use."},
            /** Smooth state to use. */
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth state to use."},
        ],
        slotsOut: [
            /** New faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "New faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_edgeloop_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_fill_edgeloop.cc",
    },
    /**
     * Edge Net Fill.
     *
     * Create faces defined by enclosed edges.
     */
    "edgenet_fill": {
        name: "edgenet_fill",
        tsName: "edgenetFill",
        doc: "Edge Net Fill.\n\nCreate faces defined by enclosed edges.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Material to use. */
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Material to use."},
            /** Smooth state to use. */
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Smooth state to use."},
            /** Maximum number of sides for created faces. */
            {name: "sides", tsName: "sides", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Maximum number of sides for created faces."},
        ],
        slotsOut: [
            /** New faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "New faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_edgenet_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_edgenet.cc",
    },
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
    "edgenet_prepare": {
        name: "edgenet_prepare",
        tsName: "edgenetPrepare",
        doc: "Edge-net Prepare.\n\nIdentifies several useful edge loop cases and modifies them so\nthey'll become a face when edgenet_fill is called. The cases covered are:\n\n- One single loop; an edge is added to connect the ends\n- Two loops; two edges are added to connect the endpoints (based on the\n  shortest distance between each endpoint).",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
        ],
        slotsOut: [
            /** New edges. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "New edges."},
        ],
        typeFlags: [],
        execC: "bmo_edgenet_prepare_exec",
        execFile: "source/blender/bmesh/operators/bmo_edgenet.cc",
    },
    /**
     * Rotate.
     *
     * Rotate vertices around a center, using a 3x3 rotation matrix.
     */
    "rotate": {
        name: "rotate",
        tsName: "rotate",
        doc: "Rotate.\n\nRotate vertices around a center, using a 3x3 rotation matrix.",
        slotsIn: [
            /** Center of rotation. */
            {name: "cent", tsName: "cent", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Center of rotation."},
            /** Matrix defining rotation. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix defining rotation."},
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Matrix to define the space (typically object matrix). */
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to define the space (typically object matrix)."},
            /** Transform shape keys too. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Transform shape keys too."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_rotate_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Translate.
     *
     * Translate vertices by an offset.
     */
    "translate": {
        name: "translate",
        tsName: "translate",
        doc: "Translate.\n\nTranslate vertices by an offset.",
        slotsIn: [
            /** Translation offset. */
            {name: "vec", tsName: "vec", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Translation offset."},
            /** Matrix to define the space (typically object matrix). */
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to define the space (typically object matrix)."},
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Transform shape keys too. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Transform shape keys too."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_translate_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Scale.
     *
     * Scales vertices by a factor.
     */
    "scale": {
        name: "scale",
        tsName: "scale",
        doc: "Scale.\n\nScales vertices by a factor.",
        slotsIn: [
            /** Scale factor. */
            {name: "vec", tsName: "vec", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Scale factor."},
            /** Matrix to define the space (typically object matrix). */
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to define the space (typically object matrix)."},
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Transform shape keys too. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Transform shape keys too."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_scale_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Transform.
     *
     * Transforms a set of vertices by a matrix. Multiplies
     * the vertex coordinates with the matrix.
     */
    "transform": {
        name: "transform",
        tsName: "transform",
        doc: "Transform.\n\nTransforms a set of vertices by a matrix. Multiplies\nthe vertex coordinates with the matrix.",
        slotsIn: [
            /** Transform matrix. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Transform matrix."},
            /** Matrix to define the space (typically object matrix). */
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to define the space (typically object matrix)."},
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Transform shape keys too. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Transform shape keys too."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_transform_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Object Load BMesh.
     *
     * Loads a bmesh into an object/mesh. This is a "private"
     * BMOP.
     */
    "object_load_bmesh": {
        name: "object_load_bmesh",
        tsName: "objectLoadBmesh",
        doc: "Object Load BMesh.\n\nLoads a bmesh into an object/mesh. This is a \"private\"\nBMOP.",
        slotsIn: [
            /** The scene. */
            {name: "scene", tsName: "scene", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_SCENE", doc: "The scene."},
            /** The object. */
            {name: "object", tsName: "object", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_OBJECT", doc: "The object."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_object_load_bmesh_exec",
        execFile: "source/blender/bmesh/operators/bmo_mesh_convert.cc",
    },
    /**
     * BMesh to Mesh.
     *
     * Converts a bmesh to a Mesh. This is reserved for exiting edit-mode.
     */
    "bmesh_to_mesh": {
        name: "bmesh_to_mesh",
        tsName: "bmeshToMesh",
        doc: "BMesh to Mesh.\n\nConverts a bmesh to a Mesh. This is reserved for exiting edit-mode.",
        slotsIn: [
            /** The mesh to write into. */
            {name: "mesh", tsName: "mesh", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_MESH", doc: "The mesh to write into."},
            /** The object. */
            {name: "object", tsName: "object", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_OBJECT", doc: "The object."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_bmesh_to_mesh_exec",
        execFile: "source/blender/bmesh/operators/bmo_mesh_convert.cc",
    },
    /**
     * Mesh to BMesh.
     *
     * Load the contents of a mesh into the bmesh. this BMOP is private, it's
     * reserved exclusively for entering edit-mode.
     */
    "mesh_to_bmesh": {
        name: "mesh_to_bmesh",
        tsName: "meshToBmesh",
        doc: "Mesh to BMesh.\n\nLoad the contents of a mesh into the bmesh. this BMOP is private, it's\nreserved exclusively for entering edit-mode.",
        slotsIn: [
            /** The mesh to read from. */
            {name: "mesh", tsName: "mesh", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_MESH", doc: "The mesh to read from."},
            /** The object. */
            {name: "object", tsName: "object", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_OBJECT", doc: "The object."},
            /** Load active shapekey coordinates into verts. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Load active shapekey coordinates into verts."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_mesh_to_bmesh_exec",
        execFile: "source/blender/bmesh/operators/bmo_mesh_convert.cc",
    },
    /**
     * Individual Face Extrude.
     *
     * Extrudes faces individually.
     */
    "extrude_discrete_faces": {
        name: "extrude_discrete_faces",
        tsName: "extrudeDiscreteFaces",
        doc: "Individual Face Extrude.\n\nExtrudes faces individually.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Create faces with reversed direction. */
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Create faces with reversed direction."},
            /** Preserve the selection history in the extruded geometry. */
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Preserve the selection history in the extruded geometry."},
        ],
        slotsOut: [
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_extrude_discrete_faces_exec",
        execFile: "source/blender/bmesh/operators/bmo_extrude.cc",
    },
    /**
     * Extrude Only Edges.
     *
     * Extrudes Edges into faces, note that this is very simple, there's no fancy
     * winged extrusion.
     */
    "extrude_edge_only": {
        name: "extrude_edge_only",
        tsName: "extrudeEdgeOnly",
        doc: "Extrude Only Edges.\n\nExtrudes Edges into faces, note that this is very simple, there's no fancy\nwinged extrusion.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Create faces with reversed direction. */
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Create faces with reversed direction."},
            /** Preserve the selection history in the extruded geometry. */
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Preserve the selection history in the extruded geometry."},
        ],
        slotsOut: [
            /** Output geometry. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Output geometry."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_extrude_edge_only_exec",
        execFile: "source/blender/bmesh/operators/bmo_extrude.cc",
    },
    /**
     * Individual Vertex Extrude.
     *
     * Extrudes individual vertices, creating new vertices connected by wire edges.
     */
    "extrude_vert_indiv": {
        name: "extrude_vert_indiv",
        tsName: "extrudeVertIndiv",
        doc: "Individual Vertex Extrude.\n\nExtrudes individual vertices, creating new vertices connected by wire edges.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Preserve the selection history in the extruded geometry. */
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Preserve the selection history in the extruded geometry."},
        ],
        slotsOut: [
            /** Output wire edges. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Output wire edges."},
            /** Output vertices. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output vertices."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_extrude_vert_indiv_exec",
        execFile: "source/blender/bmesh/operators/bmo_extrude.cc",
    },
    /**
     * Connect Verts.
     *
     * Split faces by adding edges that connect `verts`.
     */
    "connect_verts": {
        name: "connect_verts",
        tsName: "connectVerts",
        doc: "Connect Verts.\n\nSplit faces by adding edges that connect `verts`.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Input faces to explicitly exclude from connecting. */
            {name: "faces_exclude", tsName: "facesExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces to explicitly exclude from connecting."},
            /** Prevent splits with overlaps & intersections. */
            {name: "check_degenerate", tsName: "checkDegenerate", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Prevent splits with overlaps & intersections."},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_verts_exec",
        execFile: "source/blender/bmesh/operators/bmo_connect.cc",
    },
    /**
     * Connect Verts to form Convex Faces.
     *
     * Splits concave faces into convex faces.
     */
    "connect_verts_concave": {
        name: "connect_verts_concave",
        tsName: "connectVertsConcave",
        doc: "Connect Verts to form Convex Faces.\n\nSplits concave faces into convex faces.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_verts_concave_exec",
        execFile: "source/blender/bmesh/operators/bmo_connect_concave.cc",
    },
    /**
     * Connect Verts Across non Planar Faces.
     *
     * Split faces by connecting edges along non planar `faces`.
     */
    "connect_verts_nonplanar": {
        name: "connect_verts_nonplanar",
        tsName: "connectVertsNonplanar",
        doc: "Connect Verts Across non Planar Faces.\n\nSplit faces by connecting edges along non planar `faces`.",
        slotsIn: [
            /** Maximum angle of non-planarity before splitting (radians). */
            {name: "angle_limit", tsName: "angleLimit", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Maximum angle of non-planarity before splitting (radians)."},
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_verts_nonplanar_exec",
        execFile: "source/blender/bmesh/operators/bmo_connect_nonplanar.cc",
    },
    /**
     * Connect Vert Pair.
     *
     * Connect a pair of vertices by splitting faces along the shortest path between them.
     */
    "connect_vert_pair": {
        name: "connect_vert_pair",
        tsName: "connectVertPair",
        doc: "Connect Vert Pair.\n\nConnect a pair of vertices by splitting faces along the shortest path between them.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Input vertices to explicitly exclude from connecting. */
            {name: "verts_exclude", tsName: "vertsExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices to explicitly exclude from connecting."},
            /** Input faces to explicitly exclude from connecting. */
            {name: "faces_exclude", tsName: "facesExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces to explicitly exclude from connecting."},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_vert_pair_exec",
        execFile: "source/blender/bmesh/operators/bmo_connect_pair.cc",
    },
    /**
     * Extrude Faces.
     *
     * Extrude operator (does not transform)
     */
    "extrude_face_region": {
        name: "extrude_face_region",
        tsName: "extrudeFaceRegion",
        doc: "Extrude Faces.\n\nExtrude operator (does not transform)",
        slotsIn: [
            /** Edges and faces. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Edges and faces."},
            /** Input edges to explicitly exclude from extrusion. */
            {name: "edges_exclude", tsName: "edgesExclude", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_EMPTY", doc: "Input edges to explicitly exclude from extrusion."},
            /** Keep original geometry (requires `geom` to include edges). */
            {name: "use_keep_orig", tsName: "useKeepOrig", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Keep original geometry (requires `geom` to include edges)."},
            /** Create faces with reversed direction. */
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Create faces with reversed direction."},
            /** Use winding from surrounding faces instead of this region. */
            {name: "use_normal_from_adjacent", tsName: "useNormalFromAdjacent", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use winding from surrounding faces instead of this region."},
            /** Dissolve edges whose faces form a flat surface. */
            {name: "use_dissolve_ortho_edges", tsName: "useDissolveOrthoEdges", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Dissolve edges whose faces form a flat surface."},
            /** Preserve the selection history in the extruded geometry. */
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Preserve the selection history in the extruded geometry."},
            /** Skip flipping of input faces to preserve original orientation. */
            {name: "skip_input_flip", tsName: "skipInputFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Skip flipping of input faces to preserve original orientation."},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_extrude_face_region_exec",
        execFile: "source/blender/bmesh/operators/bmo_extrude.cc",
    },
    /** Dissolve Verts. */
    "dissolve_verts": {
        name: "dissolve_verts",
        tsName: "dissolveVerts",
        doc: "Dissolve Verts.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Split off face corners to maintain surrounding geometry. */
            {name: "use_face_split", tsName: "useFaceSplit", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Split off face corners to maintain surrounding geometry."},
            /** Split off face corners instead of merging faces. */
            {name: "use_boundary_tear", tsName: "useBoundaryTear", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Split off face corners instead of merging faces."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_verts_exec",
        execFile: "source/blender/bmesh/operators/bmo_dissolve.cc",
    },
    /** Dissolve Edges. */
    "dissolve_edges": {
        name: "dissolve_edges",
        tsName: "dissolveEdges",
        doc: "Dissolve Edges.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Dissolve verts left between only 2 edges. */
            {name: "use_verts", tsName: "useVerts", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Dissolve verts left between only 2 edges."},
            /** Split off face corners to maintain surrounding geometry. */
            {name: "use_face_split", tsName: "useFaceSplit", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Split off face corners to maintain surrounding geometry."},
            /**
             * Do not dissolve verts between 2 edges when their angle exceeds this threshold.
             * Disabled by default.
             */
            {name: "angle_threshold", tsName: "angleThreshold", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Do not dissolve verts between 2 edges when their angle exceeds this threshold.\nDisabled by default."},
            /** When dissolving the edge between 2 triangles, don't dissolve the verts. */
            {name: "use_preserve_quads", tsName: "usePreserveQuads", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "When dissolving the edge between 2 triangles, don't dissolve the verts."},
        ],
        slotsOut: [
            {name: "region.out", tsName: "region", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_edges_exec",
        execFile: "source/blender/bmesh/operators/bmo_dissolve.cc",
        initC: "bmo_dissolve_edges_init",
        initDefaults: {
            "angle_threshold": {valueSrc: "M_PI", source: "source/blender/bmesh/operators/bmo_dissolve.cc:452"},
        },
    },
    /** Dissolve Faces. */
    "dissolve_faces": {
        name: "dissolve_faces",
        tsName: "dissolveFaces",
        doc: "Dissolve Faces.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Dissolve verts left between only 2 edges. */
            {name: "use_verts", tsName: "useVerts", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Dissolve verts left between only 2 edges."},
        ],
        slotsOut: [
            {name: "region.out", tsName: "region", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_faces_exec",
        execFile: "source/blender/bmesh/operators/bmo_dissolve.cc",
    },
    /**
     * Limited Dissolve.
     *
     * Dissolve planar faces and co-linear edges.
     */
    "dissolve_limit": {
        name: "dissolve_limit",
        tsName: "dissolveLimit",
        doc: "Limited Dissolve.\n\nDissolve planar faces and co-linear edges.",
        slotsIn: [
            /** Maximum angle (radians) between face normals for dissolving. */
            {name: "angle_limit", tsName: "angleLimit", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Maximum angle (radians) between face normals for dissolving."},
            /** Dissolve all vertices in between face boundaries. */
            {name: "use_dissolve_boundaries", tsName: "useDissolveBoundaries", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Dissolve all vertices in between face boundaries."},
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Delimit dissolve operation. */
            {name: "delimit", tsName: "delimit", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_FLAG", enumName: "bmo_enum_dissolve_limit_flags", doc: "Delimit dissolve operation."},
        ],
        slotsOut: [
            {name: "region.out", tsName: "region", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_limit_exec",
        execFile: "source/blender/bmesh/operators/bmo_dissolve.cc",
    },
    /**
     * Degenerate Dissolve.
     *
     * Dissolve edges with no length, faces with no area.
     */
    "dissolve_degenerate": {
        name: "dissolve_degenerate",
        tsName: "dissolveDegenerate",
        doc: "Degenerate Dissolve.\n\nDissolve edges with no length, faces with no area.",
        slotsIn: [
            /** Maximum distance to consider degenerate. */
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Maximum distance to consider degenerate."},
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_degenerate_exec",
        execFile: "source/blender/bmesh/operators/bmo_dissolve.cc",
    },
    /**
     * Triangulate.
     *
     * Triangulate faces, splitting quads and n-gons into triangles.
     */
    "triangulate": {
        name: "triangulate",
        tsName: "triangulate",
        doc: "Triangulate.\n\nTriangulate faces, splitting quads and n-gons into triangles.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Method for splitting the quads into triangles. */
            {name: "quad_method", tsName: "quadMethod", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_triangulate_quad_method", doc: "Method for splitting the quads into triangles."},
            /** Method for splitting the polygons into triangles. */
            {name: "ngon_method", tsName: "ngonMethod", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_triangulate_ngon_method", doc: "Method for splitting the polygons into triangles."},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "face_map.out", tsName: "faceMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            /** Duplicate faces. */
            {name: "face_map_double.out", tsName: "faceMapDouble", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM", doc: "Duplicate faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_triangulate_exec",
        execFile: "source/blender/bmesh/operators/bmo_triangulate.cc",
    },
    /**
     * Un-Subdivide.
     *
     * Reduce detail in geometry containing grids.
     */
    "unsubdivide": {
        name: "unsubdivide",
        tsName: "unsubdivide",
        doc: "Un-Subdivide.\n\nReduce detail in geometry containing grids.",
        slotsIn: [
            /** Input vertices. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Input vertices."},
            /** Number of times to unsubdivide. */
            {name: "iterations", tsName: "iterations", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of times to unsubdivide."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_unsubdivide_exec",
        execFile: "source/blender/bmesh/operators/bmo_unsubdivide.cc",
    },
    /**
     * Subdivide Edges.
     *
     * Advanced operator for subdividing edges
     * with options for face patterns, smoothing and randomization.
     */
    "subdivide_edges": {
        name: "subdivide_edges",
        tsName: "subdivideEdges",
        doc: "Subdivide Edges.\n\nAdvanced operator for subdividing edges\nwith options for face patterns, smoothing and randomization.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Smoothness factor. */
            {name: "smooth", tsName: "smooth", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Smoothness factor."},
            /** Smooth falloff type. */
            {name: "smooth_falloff", tsName: "smoothFalloff", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_falloff_type", doc: "Smooth falloff type."},
            /** Fractal randomness factor. */
            {name: "fractal", tsName: "fractal", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Fractal randomness factor."},
            /** Factor (0 to 1) controlling how much fractal displacement is restricted to the normal. */
            {name: "along_normal", tsName: "alongNormal", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Factor (0 to 1) controlling how much fractal displacement is restricted to the normal."},
            /** Number of cuts. */
            {name: "cuts", tsName: "cuts", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of cuts."},
            /** Seed for the random number generator. */
            {name: "seed", tsName: "seed", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Seed for the random number generator."},
            /** Internal use only, not accessible from Python. */
            {name: "custom_patterns", tsName: "customPatterns", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_INTERNAL", doc: "Internal use only, not accessible from Python."},
            /** Mapping of edges to a float (0 to 1) controlling the cut position along each edge. */
            {name: "edge_percents", tsName: "edgePercents", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_FLT", doc: "Mapping of edges to a float (0 to 1) controlling the cut position along each edge."},
            /** Quad corner type. */
            {name: "quad_corner_type", tsName: "quadCornerType", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_subdivide_edges_quad_corner_type", doc: "Quad corner type."},
            /** Fill in fully-selected faces with a grid. */
            {name: "use_grid_fill", tsName: "useGridFill", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Fill in fully-selected faces with a grid."},
            /** Tessellate the case of one edge selected in a quad or triangle. */
            {name: "use_single_edge", tsName: "useSingleEdge", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Tessellate the case of one edge selected in a quad or triangle."},
            /** Only subdivide quads (for loop-cut). */
            {name: "use_only_quads", tsName: "useOnlyQuads", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Only subdivide quads (for loop-cut)."},
            /** Project new vertices onto a sphere (used for spherical primitives). */
            {name: "use_sphere", tsName: "useSphere", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Project new vertices onto a sphere (used for spherical primitives)."},
            /** Maintain even offset when smoothing. */
            {name: "use_smooth_even", tsName: "useSmoothEven", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Maintain even offset when smoothing."},
        ],
        slotsOut: [
            /** NOTE: these next three can have multiple types of elements in them. */
            {name: "geom_inner.out", tsName: "geomInner", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, note: "NOTE: these next three can have multiple types of elements in them."},
            {name: "geom_split.out", tsName: "geomSplit", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            /** Contains all output geometry. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Contains all output geometry."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_subdivide_edges_exec",
        execFile: "source/blender/bmesh/operators/bmo_subdivide.cc",
    },
    /**
     * Subdivide Edge-Ring.
     *
     * Take an edge-ring, and subdivide with interpolation options.
     */
    "subdivide_edgering": {
        name: "subdivide_edgering",
        tsName: "subdivideEdgering",
        doc: "Subdivide Edge-Ring.\n\nTake an edge-ring, and subdivide with interpolation options.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Interpolation method. */
            {name: "interp_mode", tsName: "interpMode", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_subdivide_edgering_interp_mode", doc: "Interpolation method."},
            /** Smoothness factor. */
            {name: "smooth", tsName: "smooth", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Smoothness factor."},
            /** Number of cuts. */
            {name: "cuts", tsName: "cuts", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of cuts."},
            /** Profile shape type. */
            {name: "profile_shape", tsName: "profileShape", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_falloff_type", doc: "Profile shape type."},
            /** How much intermediary new edges are shrunk/expanded. */
            {name: "profile_shape_factor", tsName: "profileShapeFactor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "How much intermediary new edges are shrunk/expanded."},
        ],
        slotsOut: [
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_subdivide_edgering_exec",
        execFile: "source/blender/bmesh/operators/bmo_subdivide_edgering.cc",
    },
    /**
     * Bisect Plane.
     *
     * Bisects the mesh by a plane (cut the mesh in half).
     */
    "bisect_plane": {
        name: "bisect_plane",
        tsName: "bisectPlane",
        doc: "Bisect Plane.\n\nBisects the mesh by a plane (cut the mesh in half).",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Minimum distance when testing if a vert is exactly on the plane. */
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Minimum distance when testing if a vert is exactly on the plane."},
            /** Point on the plane. */
            {name: "plane_co", tsName: "planeCo", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Point on the plane."},
            /** Normal of the plane. */
            {name: "plane_no", tsName: "planeNo", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Normal of the plane."},
            /** Snap axis aligned verts to the center. */
            {name: "use_snap_center", tsName: "useSnapCenter", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Snap axis aligned verts to the center."},
            /** When enabled, remove all geometry on the positive side of the plane. */
            {name: "clear_outer", tsName: "clearOuter", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "When enabled, remove all geometry on the positive side of the plane."},
            /** When enabled, remove all geometry on the negative side of the plane. */
            {name: "clear_inner", tsName: "clearInner", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "When enabled, remove all geometry on the negative side of the plane."},
        ],
        slotsOut: [
            /** Output geometry aligned with the plane (new and existing). */
            {name: "geom_cut.out", tsName: "geomCut", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 3 /* VERT|EDGE */, doc: "Output geometry aligned with the plane (new and existing)."},
            /** Input and output geometry (result of cut). */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input and output geometry (result of cut)."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bisect_plane_exec",
        execFile: "source/blender/bmesh/operators/bmo_bisect_plane.cc",
    },
    /**
     * Delete Geometry.
     *
     * Utility operator to delete geometry.
     */
    "delete": {
        name: "delete",
        tsName: "delete",
        doc: "Delete Geometry.\n\nUtility operator to delete geometry.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Geometry types to delete. */
            {name: "context", tsName: "context", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_delete_context", doc: "Geometry types to delete."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_delete_exec",
        execFile: "source/blender/bmesh/operators/bmo_dupe.cc",
    },
    /**
     * Duplicate Geometry.
     *
     * Utility operator to duplicate geometry,
     * optionally into a destination mesh.
     */
    "duplicate": {
        name: "duplicate",
        tsName: "duplicate",
        doc: "Duplicate Geometry.\n\nUtility operator to duplicate geometry,\noptionally into a destination mesh.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Destination bmesh, if None will use current one. */
            {name: "dest", tsName: "dest", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_BMESH", doc: "Destination bmesh, if None will use current one."},
            /** Preserve the selection history in the duplicated geometry. */
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Preserve the selection history in the duplicated geometry."},
            /** Copy edge flip state from connected faces. */
            {name: "use_edge_flip_from_face", tsName: "useEdgeFlipFromFace", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Copy edge flip state from connected faces."},
        ],
        slotsOut: [
            {name: "geom_orig.out", tsName: "geomOrig", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            /**
             * NOTE: face_map maps from source faces to dupe faces,
             * and from dupe faces to source faces.
             */
            {name: "vert_map.out", tsName: "vertMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM", note: "NOTE: face_map maps from source faces to dupe faces,\nand from dupe faces to source faces."},
            {name: "edge_map.out", tsName: "edgeMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "face_map.out", tsName: "faceMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            /**
             * Boundary edges from the split geometry that maps edges from the original geometry
             * to the destination edges.
             */
            {name: "boundary_map.out", tsName: "boundaryMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM", doc: "Boundary edges from the split geometry that maps edges from the original geometry\nto the destination edges."},
            {name: "isovert_map.out", tsName: "isovertMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_duplicate_exec",
        execFile: "source/blender/bmesh/operators/bmo_dupe.cc",
    },
    /**
     * Split Off Geometry.
     *
     * Disconnect geometry from adjacent edges and faces,
     * optionally into a destination mesh.
     */
    "split": {
        name: "split",
        tsName: "split",
        doc: "Split Off Geometry.\n\nDisconnect geometry from adjacent edges and faces,\noptionally into a destination mesh.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Destination bmesh, if None will use current one. */
            {name: "dest", tsName: "dest", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_BMESH", doc: "Destination bmesh, if None will use current one."},
            /** When enabled, don't duplicate loose verts/edges. */
            {name: "use_only_faces", tsName: "useOnlyFaces", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "When enabled, don't duplicate loose verts/edges."},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            /**
             * Boundary edges from the split geometry that maps edges from the original geometry
             * to the destination edges.
             *
             * When the source edges have been deleted, the destination edge will be used
             * for both the key and the value.
             */
            {name: "boundary_map.out", tsName: "boundaryMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM", doc: "Boundary edges from the split geometry that maps edges from the original geometry\nto the destination edges.\n\nWhen the source edges have been deleted, the destination edge will be used\nfor both the key and the value."},
            {name: "isovert_map.out", tsName: "isovertMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_split_exec",
        execFile: "source/blender/bmesh/operators/bmo_dupe.cc",
    },
    /**
     * Spin.
     *
     * Extrude or duplicate geometry a number of times,
     * rotating and possibly translating after each step
     */
    "spin": {
        name: "spin",
        tsName: "spin",
        doc: "Spin.\n\nExtrude or duplicate geometry a number of times,\nrotating and possibly translating after each step",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Rotation center. */
            {name: "cent", tsName: "cent", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Rotation center."},
            /** Rotation axis. */
            {name: "axis", tsName: "axis", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Rotation axis."},
            /** Translation delta per step. */
            {name: "dvec", tsName: "dvec", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Translation delta per step."},
            /** Total rotation angle (radians). */
            {name: "angle", tsName: "angle", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Total rotation angle (radians)."},
            /** Matrix to define the space (typically object matrix). */
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to define the space (typically object matrix)."},
            /** Number of steps. */
            {name: "steps", tsName: "steps", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of steps."},
            /** Merge first/last when the angle is a full revolution. */
            {name: "use_merge", tsName: "useMerge", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Merge first/last when the angle is a full revolution."},
            /** Create faces with reversed direction. */
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Create faces with reversed direction."},
            /** Duplicate the geometry, otherwise extrude. */
            {name: "use_duplicate", tsName: "useDuplicate", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Duplicate the geometry, otherwise extrude."},
        ],
        slotsOut: [
            /** Result of last step. */
            {name: "geom_last.out", tsName: "geomLast", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Result of last step."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_spin_exec",
        execFile: "source/blender/bmesh/operators/bmo_dupe.cc",
    },
    /**
     * UV Rotation.
     *
     * Cycle the loop UVs
     */
    "rotate_uvs": {
        name: "rotate_uvs",
        tsName: "rotateUvs",
        doc: "UV Rotation.\n\nCycle the loop UVs",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Rotate counter-clockwise if true, otherwise clockwise. */
            {name: "use_ccw", tsName: "useCcw", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Rotate counter-clockwise if true, otherwise clockwise."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_rotate_uvs_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * UV Reverse.
     *
     * Reverse the UVs
     */
    "reverse_uvs": {
        name: "reverse_uvs",
        tsName: "reverseUvs",
        doc: "UV Reverse.\n\nReverse the UVs",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_reverse_uvs_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Color Rotation.
     *
     * Cycle the loop colors
     */
    "rotate_colors": {
        name: "rotate_colors",
        tsName: "rotateColors",
        doc: "Color Rotation.\n\nCycle the loop colors",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Rotate counter-clockwise if true, otherwise clockwise. */
            {name: "use_ccw", tsName: "useCcw", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Rotate counter-clockwise if true, otherwise clockwise."},
            /** Index into color attribute list. */
            {name: "color_index", tsName: "colorIndex", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Index into color attribute list."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_rotate_colors_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Color Reverse
     *
     * Reverse the loop colors.
     */
    "reverse_colors": {
        name: "reverse_colors",
        tsName: "reverseColors",
        doc: "Color Reverse\n\nReverse the loop colors.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Index into color attribute list. */
            {name: "color_index", tsName: "colorIndex", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Index into color attribute list."},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_reverse_colors_exec",
        execFile: "source/blender/bmesh/operators/bmo_utils.cc",
    },
    /**
     * Edge Split.
     *
     * Disconnects faces along input edges.
     */
    "split_edges": {
        name: "split_edges",
        tsName: "splitEdges",
        doc: "Edge Split.\n\nDisconnects faces along input edges.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Optional tag verts, use to have greater control of splits. */
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Optional tag verts, use to have greater control of splits."},
            /** Use `verts` for splitting, else just find verts to split from edges. */
            {name: "use_verts", tsName: "useVerts", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use `verts` for splitting, else just find verts to split from edges."},
        ],
        slotsOut: [
            /** The original edges that were disconnected. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "The original edges that were disconnected."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_split_edges_exec",
        execFile: "source/blender/bmesh/operators/bmo_split_edges.cc",
    },
    /**
     * Create Grid.
     *
     * Creates a grid with a variable number of subdivisions
     */
    "create_grid": {
        name: "create_grid",
        tsName: "createGrid",
        doc: "Create Grid.\n\nCreates a grid with a variable number of subdivisions",
        slotsIn: [
            /** Number of x segments. */
            {name: "x_segments", tsName: "xSegments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of x segments."},
            /** Number of y segments. */
            {name: "y_segments", tsName: "ySegments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of y segments."},
            /** Size of the grid. */
            {name: "size", tsName: "size", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Size of the grid."},
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_grid_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /**
     * Create UV Sphere.
     *
     * Creates a UV sphere with a variable number of subdivisions.
     */
    "create_uvsphere": {
        name: "create_uvsphere",
        tsName: "createUvsphere",
        doc: "Create UV Sphere.\n\nCreates a UV sphere with a variable number of subdivisions.",
        slotsIn: [
            /** Number of u segments. */
            {name: "u_segments", tsName: "uSegments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of u segments."},
            /** Number of v segments. */
            {name: "v_segments", tsName: "vSegments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of v segments."},
            /** Radius. */
            {name: "radius", tsName: "radius", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Radius."},
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_uvsphere_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /**
     * Create Ico-Sphere.
     *
     * Creates an ico-sphere with a variable number of subdivisions.
     */
    "create_icosphere": {
        name: "create_icosphere",
        tsName: "createIcosphere",
        doc: "Create Ico-Sphere.\n\nCreates an ico-sphere with a variable number of subdivisions.",
        slotsIn: [
            /** How many times to recursively subdivide the sphere. */
            {name: "subdivisions", tsName: "subdivisions", type: "int", cType: "BMO_OP_SLOT_INT", doc: "How many times to recursively subdivide the sphere."},
            /** Radius. */
            {name: "radius", tsName: "radius", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Radius."},
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_icosphere_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /**
     * Create Suzanne.
     *
     * Creates a monkey (standard blender primitive).
     */
    "create_monkey": {
        name: "create_monkey",
        tsName: "createMonkey",
        doc: "Create Suzanne.\n\nCreates a monkey (standard blender primitive).",
        slotsIn: [
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_monkey_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /**
     * Create Cone.
     *
     * Creates a cone with variable radius at both ends
     */
    "create_cone": {
        name: "create_cone",
        tsName: "createCone",
        doc: "Create Cone.\n\nCreates a cone with variable radius at both ends",
        slotsIn: [
            /** Whether or not to fill in the ends with faces. */
            {name: "cap_ends", tsName: "capEnds", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Whether or not to fill in the ends with faces."},
            /** Fill ends with triangles instead of ngons. */
            {name: "cap_tris", tsName: "capTris", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Fill ends with triangles instead of ngons."},
            /** Number of vertices in the base circle. */
            {name: "segments", tsName: "segments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of vertices in the base circle."},
            /** Radius of one end. */
            {name: "radius1", tsName: "radius1", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Radius of one end."},
            /** Radius of the opposite end. */
            {name: "radius2", tsName: "radius2", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Radius of the opposite end."},
            /** Distance between ends. */
            {name: "depth", tsName: "depth", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Distance between ends."},
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_cone_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /** Creates a Circle. */
    "create_circle": {
        name: "create_circle",
        tsName: "createCircle",
        doc: "Creates a Circle.",
        slotsIn: [
            /** Whether or not to fill in the circle with a face. */
            {name: "cap_ends", tsName: "capEnds", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Whether or not to fill in the circle with a face."},
            /** Fill the circle with triangles instead of an n-gon. */
            {name: "cap_tris", tsName: "capTris", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Fill the circle with triangles instead of an n-gon."},
            /** Number of vertices in the circle. */
            {name: "segments", tsName: "segments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of vertices in the circle."},
            /** Radius of the circle. */
            {name: "radius", tsName: "radius", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Radius of the circle."},
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_circle_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /**
     * Create Cube
     *
     * Creates a cube.
     */
    "create_cube": {
        name: "create_cube",
        tsName: "createCube",
        doc: "Create Cube\n\nCreates a cube.",
        slotsIn: [
            /** Size of the cube. */
            {name: "size", tsName: "size", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Size of the cube."},
            /** Matrix to multiply the new geometry with. */
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT", doc: "Matrix to multiply the new geometry with."},
            /** Calculate default UVs. */
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Calculate default UVs."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_cube_exec",
        execFile: "source/blender/bmesh/operators/bmo_primitive.cc",
    },
    /**
     * Bevel.
     *
     * Bevels edges and vertices
     */
    "bevel": {
        name: "bevel",
        tsName: "bevel",
        doc: "Bevel.\n\nBevels edges and vertices",
        slotsIn: [
            /** Input edges and vertices. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input edges and vertices."},
            /** Amount to offset beveled edge. */
            {name: "offset", tsName: "offset", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Amount to offset beveled edge."},
            /** How to measure the offset. */
            {name: "offset_type", tsName: "offsetType", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_offset_type", doc: "How to measure the offset."},
            /** The profile type to use for bevel. */
            {name: "profile_type", tsName: "profileType", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_profile_type", doc: "The profile type to use for bevel."},
            /** Number of segments in bevel. */
            {name: "segments", tsName: "segments", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Number of segments in bevel."},
            /** Profile shape, 0->1 (.5=>round). */
            {name: "profile", tsName: "profile", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Profile shape, 0->1 (.5=>round)."},
            /** Whether to bevel vertices or edges. */
            {name: "affect", tsName: "affect", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_affect_type", doc: "Whether to bevel vertices or edges."},
            /** Do not allow beveled edges/vertices to overlap each other. */
            {name: "clamp_overlap", tsName: "clampOverlap", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Do not allow beveled edges/vertices to overlap each other."},
            /** Material for bevel faces, -1 means get from adjacent faces. */
            {name: "material", tsName: "material", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Material for bevel faces, -1 means get from adjacent faces."},
            /** Prefer to slide along edges to having even widths. */
            {name: "loop_slide", tsName: "loopSlide", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Prefer to slide along edges to having even widths."},
            /** Extend edge data to allow seams to run across bevels. */
            {name: "mark_seam", tsName: "markSeam", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Extend edge data to allow seams to run across bevels."},
            /** Extend edge data to allow sharp edges to run across bevels. */
            {name: "mark_sharp", tsName: "markSharp", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Extend edge data to allow sharp edges to run across bevels."},
            /** Harden normals. */
            {name: "harden_normals", tsName: "hardenNormals", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Harden normals."},
            /** Whether to set face strength, and which faces to set if so. */
            {name: "face_strength_mode", tsName: "faceStrengthMode", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_face_strength_type", doc: "Whether to set face strength, and which faces to set if so."},
            /** Outer miter kind. */
            {name: "miter_outer", tsName: "miterOuter", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_miter_type", doc: "Outer miter kind."},
            /** Inner miter kind. */
            {name: "miter_inner", tsName: "miterInner", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_miter_type", doc: "Inner miter kind."},
            /** Amount to spread the miter. */
            {name: "spread", tsName: "spread", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Amount to spread the miter."},
            /** CurveProfile, if None ignored */
            {name: "custom_profile", tsName: "customProfile", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_STRUCT", doc: "CurveProfile, if None ignored"},
            /** The method to use to create meshes at intersections. */
            {name: "vmesh_method", tsName: "vmeshMethod", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_vmesh_method", doc: "The method to use to create meshes at intersections."},
        ],
        slotsOut: [
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
            /** Output edges. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Output edges."},
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bevel_exec",
        execFile: "source/blender/bmesh/operators/bmo_bevel.cc",
    },
    /**
     * Beautify Fill.
     *
     * Rotate edges to create more evenly spaced triangles.
     */
    "beautify_fill": {
        name: "beautify_fill",
        tsName: "beautifyFill",
        doc: "Beautify Fill.\n\nRotate edges to create more evenly spaced triangles.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Edges that can be flipped. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Edges that can be flipped."},
            /** Restrict edge rotation to mixed tagged vertices. */
            {name: "use_restrict_tag", tsName: "useRestrictTag", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Restrict edge rotation to mixed tagged vertices."},
            /** Method to define what is beautiful. */
            {name: "method", tsName: "method", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_beautify_fill_method", doc: "Method to define what is beautiful."},
        ],
        slotsOut: [
            /** New flipped faces and edges. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "New flipped faces and edges."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_beautify_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_beautify.cc",
    },
    /**
     * Triangle Fill.
     *
     * Fill edges with triangles
     */
    "triangle_fill": {
        name: "triangle_fill",
        tsName: "triangleFill",
        doc: "Triangle Fill.\n\nFill edges with triangles",
        slotsIn: [
            /** Use best triangulation division. */
            {name: "use_beauty", tsName: "useBeauty", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Use best triangulation division."},
            /** Dissolve resulting faces. */
            {name: "use_dissolve", tsName: "useDissolve", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Dissolve resulting faces."},
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Optionally pass the fill normal to use. */
            {name: "normal", tsName: "normal", type: "vec3", cType: "BMO_OP_SLOT_VEC", doc: "Optionally pass the fill normal to use."},
        ],
        slotsOut: [
            /** New faces and edges. */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "New faces and edges."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_triangle_fill_exec",
        execFile: "source/blender/bmesh/operators/bmo_triangulate.cc",
    },
    /**
     * Solidify.
     *
     * Turns a mesh into a shell with thickness
     */
    "solidify": {
        name: "solidify",
        tsName: "solidify",
        doc: "Solidify.\n\nTurns a mesh into a shell with thickness",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Thickness of the solidified shell. */
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Thickness of the solidified shell."},
        ],
        slotsOut: [
            /** Output geometry (new shell faces, edges, and vertices). */
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Output geometry (new shell faces, edges, and vertices)."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_solidify_face_region_exec",
        execFile: "source/blender/bmesh/operators/bmo_extrude.cc",
    },
    /**
     * Face Inset (Individual).
     *
     * Insets individual faces.
     */
    "inset_individual": {
        name: "inset_individual",
        tsName: "insetIndividual",
        doc: "Face Inset (Individual).\n\nInsets individual faces.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Inset distance from the boundary. */
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Inset distance from the boundary."},
            /** Distance to raise or lower the inset face along its normal. */
            {name: "depth", tsName: "depth", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Distance to raise or lower the inset face along its normal."},
            /** Scale the offset to give more even thickness. */
            {name: "use_even_offset", tsName: "useEvenOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Scale the offset to give more even thickness."},
            /** Blend face data across the inset. */
            {name: "use_interpolate", tsName: "useInterpolate", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Blend face data across the inset."},
            /** Scale the offset by surrounding geometry. */
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Scale the offset by surrounding geometry."},
        ],
        slotsOut: [
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_inset_individual_exec",
        execFile: "source/blender/bmesh/operators/bmo_inset.cc",
    },
    /**
     * Face Inset (Regions).
     *
     * Inset or outset face regions.
     */
    "inset_region": {
        name: "inset_region",
        tsName: "insetRegion",
        doc: "Face Inset (Regions).\n\nInset or outset face regions.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Input faces to explicitly exclude from inset. */
            {name: "faces_exclude", tsName: "facesExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces to explicitly exclude from inset."},
            /** Inset face boundaries. */
            {name: "use_boundary", tsName: "useBoundary", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Inset face boundaries."},
            /** Scale the offset to give more even thickness. */
            {name: "use_even_offset", tsName: "useEvenOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Scale the offset to give more even thickness."},
            /** Blend face data across the inset. */
            {name: "use_interpolate", tsName: "useInterpolate", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Blend face data across the inset."},
            /** Scale the offset by surrounding geometry. */
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Scale the offset by surrounding geometry."},
            /** Inset the region along existing edges. */
            {name: "use_edge_rail", tsName: "useEdgeRail", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Inset the region along existing edges."},
            /** Inset distance from the boundary. */
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Inset distance from the boundary."},
            /** Distance to raise or lower the inset face along its normal. */
            {name: "depth", tsName: "depth", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Distance to raise or lower the inset face along its normal."},
            /** Outset rather than inset. */
            {name: "use_outset", tsName: "useOutset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Outset rather than inset."},
        ],
        slotsOut: [
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_inset_region_exec",
        execFile: "source/blender/bmesh/operators/bmo_inset.cc",
    },
    /**
     * Edge-loop Offset.
     *
     * Creates edge loops based on simple edge-outset method.
     */
    "offset_edgeloops": {
        name: "offset_edgeloops",
        tsName: "offsetEdgeloops",
        doc: "Edge-loop Offset.\n\nCreates edge loops based on simple edge-outset method.",
        slotsIn: [
            /** Input edges. */
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input edges."},
            /** Extend loop around end-points. */
            {name: "use_cap_endpoint", tsName: "useCapEndpoint", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Extend loop around end-points."},
        ],
        slotsOut: [
            /** Output edges. */
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Output edges."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_offset_edgeloops_exec",
        execFile: "source/blender/bmesh/operators/bmo_offset_edgeloops.cc",
    },
    /**
     * Wire Frame.
     *
     * Makes a wire-frame copy of faces.
     */
    "wireframe": {
        name: "wireframe",
        tsName: "wireframe",
        doc: "Wire Frame.\n\nMakes a wire-frame copy of faces.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Wire thickness. */
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Wire thickness."},
            /** Offset the thickness from the center. */
            {name: "offset", tsName: "offset", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Offset the thickness from the center."},
            /** Remove original geometry. */
            {name: "use_replace", tsName: "useReplace", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Remove original geometry."},
            /** Inset face boundaries. */
            {name: "use_boundary", tsName: "useBoundary", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Inset face boundaries."},
            /** Scale the offset to give more even thickness. */
            {name: "use_even_offset", tsName: "useEvenOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Scale the offset to give more even thickness."},
            /** Crease hub edges for improved subdivision surface. */
            {name: "use_crease", tsName: "useCrease", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Crease hub edges for improved subdivision surface."},
            /** The mean crease weight for resulting edges. */
            {name: "crease_weight", tsName: "creaseWeight", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "The mean crease weight for resulting edges."},
            /** Scale the offset by surrounding geometry. */
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Scale the offset by surrounding geometry."},
            /** Offset material index of generated faces. */
            {name: "material_offset", tsName: "materialOffset", type: "int", cType: "BMO_OP_SLOT_INT", doc: "Offset material index of generated faces."},
        ],
        slotsOut: [
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_wireframe_exec",
        execFile: "source/blender/bmesh/operators/bmo_wireframe.cc",
    },
    /**
     * Pokes a face.
     *
     * Splits a face into a triangle fan.
     */
    "poke": {
        name: "poke",
        tsName: "poke",
        doc: "Pokes a face.\n\nSplits a face into a triangle fan.",
        slotsIn: [
            /** Input faces. */
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Input faces."},
            /** Center vertex offset along normal. */
            {name: "offset", tsName: "offset", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Center vertex offset along normal."},
            /** Calculation mode for center vertex. */
            {name: "center_mode", tsName: "centerMode", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_poke_center_mode", doc: "Calculation mode for center vertex."},
            /** Apply offset. */
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Apply offset."},
        ],
        slotsOut: [
            /** Output verts. */
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, doc: "Output verts."},
            /** Output faces. */
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */, doc: "Output faces."},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_poke_exec",
        execFile: "source/blender/bmesh/operators/bmo_poke.cc",
    },
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
     * Build-time conditional: only present when `WITH_BULLET` is defined.
     */
    "convex_hull": {
        name: "convex_hull",
        tsName: "convexHull",
        doc: "Convex Hull\n\nBuilds a convex hull from the vertices in `input`.\n\nIf `use_existing_faces` is true, the hull will not output triangles\nthat are covered by a pre-existing face.\n\nAll hull vertices, faces, and edges are added to `geom.out`. Any\ninput elements that end up inside the hull (i.e. are not used by an\noutput face) are added to the `geom_interior.out` slot. The\n`geom_unused.out` slot will contain all interior geometry that is\ncompletely unused. Lastly, `geom_holes.out` contains edges and faces\nthat were in the input and are part of the hull.",
        condition: "WITH_BULLET",
        slotsIn: [
            /** Input geometry. */
            {name: "input", tsName: "input", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Skip hull triangles that are covered by a pre-existing face. */
            {name: "use_existing_faces", tsName: "useExistingFaces", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Skip hull triangles that are covered by a pre-existing face."},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_interior.out", tsName: "geomInterior", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_unused.out", tsName: "geomUnused", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_holes.out", tsName: "geomHoles", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_convex_hull_exec",
        execFile: "source/blender/bmesh/operators/bmo_hull.cc",
    },
    /**
     * Space Evenly.
     *
     * Space the vertices in a regular distribution on the loop.
     */
    "space_edge_loops_evenly": {
        name: "space_edge_loops_evenly",
        tsName: "spaceEdgeLoopsEvenly",
        doc: "Space Evenly.\n\nSpace the vertices in a regular distribution on the loop.",
        slotsIn: [
            /** Input geometry. */
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */, doc: "Input geometry."},
            /** Method used for interpolation. */
            {name: "interpolation", tsName: "interpolation", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_space_edge_loops_evenly_interpolation_method", doc: "Method used for interpolation."},
            /** Influence factor: spans from 0.0 to 1.0. */
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Influence factor: spans from 0.0 to 1.0."},
            /** Lock X-axis editing. */
            {name: "lock_x", tsName: "lockX", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock X-axis editing."},
            /** Lock Y-axis editing. */
            {name: "lock_y", tsName: "lockY", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock Y-axis editing."},
            /** Lock Z-axis editing. */
            {name: "lock_z", tsName: "lockZ", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Lock Z-axis editing."},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_space_edge_loops_evenly_exec",
        execFile: "source/blender/bmesh/operators/bmo_space_edge_loops_evenly.cc",
    },
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
    "symmetrize": {
        name: "symmetrize",
        tsName: "symmetrize",
        doc: "Symmetrize.\n\nMakes the mesh elements in the `input` slot symmetrical. Unlike\nnormal mirroring, it only copies in one direction, as specified by\nthe `direction` slot. The edges and faces that cross the plane of\nsymmetry are split as needed to enforce symmetry.\n\nAll new vertices, edges, and faces are added to the `geom.out` slot.",
        slotsIn: [
            /** Input geometry. */
            {name: "input", tsName: "input", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */, doc: "Input geometry."},
            /** Axis to use. */
            {name: "direction", tsName: "direction", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_axis_neg_xyz_and_xyz", doc: "Axis to use."},
            /** Minimum distance. */
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT", doc: "Minimum distance."},
            /** Transform shape keys too. */
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL", doc: "Transform shape keys too."},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_symmetrize_exec",
        execFile: "source/blender/bmesh/operators/bmo_symmetrize.cc",
    },
}

/** camelCase operator name -> Blender operator name. */
export const BMO_OP_NAME_BY_TS: Readonly<Record<string, string>> = {
    "smoothVert": "smooth_vert",
    "smoothLaplacianVert": "smooth_laplacian_vert",
    "recalcFaceNormals": "recalc_face_normals",
    "planarFaces": "planar_faces",
    "regionExtend": "region_extend",
    "rotateEdges": "rotate_edges",
    "reverseFaces": "reverse_faces",
    "flipQuadTessellation": "flip_quad_tessellation",
    "bisectEdges": "bisect_edges",
    "mirror": "mirror",
    "findDoubles": "find_doubles",
    "removeDoubles": "remove_doubles",
    "circularize": "circularize",
    "flatten": "flatten",
    "collapse": "collapse",
    "pointmergeFacedata": "pointmerge_facedata",
    "averageVertFacedata": "average_vert_facedata",
    "pointmerge": "pointmerge",
    "collapseUvs": "collapse_uvs",
    "weldVerts": "weld_verts",
    "createVert": "create_vert",
    "joinTriangles": "join_triangles",
    "contextualCreate": "contextual_create",
    "bridgeLoops": "bridge_loops",
    "gridFill": "grid_fill",
    "holesFill": "holes_fill",
    "faceAttributeFill": "face_attribute_fill",
    "edgeloopFill": "edgeloop_fill",
    "edgenetFill": "edgenet_fill",
    "edgenetPrepare": "edgenet_prepare",
    "rotate": "rotate",
    "translate": "translate",
    "scale": "scale",
    "transform": "transform",
    "objectLoadBmesh": "object_load_bmesh",
    "bmeshToMesh": "bmesh_to_mesh",
    "meshToBmesh": "mesh_to_bmesh",
    "extrudeDiscreteFaces": "extrude_discrete_faces",
    "extrudeEdgeOnly": "extrude_edge_only",
    "extrudeVertIndiv": "extrude_vert_indiv",
    "connectVerts": "connect_verts",
    "connectVertsConcave": "connect_verts_concave",
    "connectVertsNonplanar": "connect_verts_nonplanar",
    "connectVertPair": "connect_vert_pair",
    "extrudeFaceRegion": "extrude_face_region",
    "dissolveVerts": "dissolve_verts",
    "dissolveEdges": "dissolve_edges",
    "dissolveFaces": "dissolve_faces",
    "dissolveLimit": "dissolve_limit",
    "dissolveDegenerate": "dissolve_degenerate",
    "triangulate": "triangulate",
    "unsubdivide": "unsubdivide",
    "subdivideEdges": "subdivide_edges",
    "subdivideEdgering": "subdivide_edgering",
    "bisectPlane": "bisect_plane",
    "delete": "delete",
    "duplicate": "duplicate",
    "split": "split",
    "spin": "spin",
    "rotateUvs": "rotate_uvs",
    "reverseUvs": "reverse_uvs",
    "rotateColors": "rotate_colors",
    "reverseColors": "reverse_colors",
    "splitEdges": "split_edges",
    "createGrid": "create_grid",
    "createUvsphere": "create_uvsphere",
    "createIcosphere": "create_icosphere",
    "createMonkey": "create_monkey",
    "createCone": "create_cone",
    "createCircle": "create_circle",
    "createCube": "create_cube",
    "bevel": "bevel",
    "beautifyFill": "beautify_fill",
    "triangleFill": "triangle_fill",
    "solidify": "solidify",
    "insetIndividual": "inset_individual",
    "insetRegion": "inset_region",
    "offsetEdgeloops": "offset_edgeloops",
    "wireframe": "wireframe",
    "poke": "poke",
    "convexHull": "convex_hull",
    "spaceEdgeLoopsEvenly": "space_edge_loops_evenly",
    "symmetrize": "symmetrize",
}

/** `"<op>.<tsSlot>"` -> Blender slot name, for slots whose tsName differs from their name. */
export const BMO_SLOT_NAME_BY_TS: Readonly<Record<string, string>> = {
    "smooth_vert.mirrorClipX": "mirror_clip_x",
    "smooth_vert.mirrorClipY": "mirror_clip_y",
    "smooth_vert.mirrorClipZ": "mirror_clip_z",
    "smooth_vert.clipDist": "clip_dist",
    "smooth_vert.useAxisX": "use_axis_x",
    "smooth_vert.useAxisY": "use_axis_y",
    "smooth_vert.useAxisZ": "use_axis_z",
    "smooth_laplacian_vert.lambdaFactor": "lambda_factor",
    "smooth_laplacian_vert.lambdaBorder": "lambda_border",
    "smooth_laplacian_vert.useX": "use_x",
    "smooth_laplacian_vert.useY": "use_y",
    "smooth_laplacian_vert.useZ": "use_z",
    "smooth_laplacian_vert.preserveVolume": "preserve_volume",
    "planar_faces.geom": "geom.out",
    "region_extend.useContract": "use_contract",
    "region_extend.useFaces": "use_faces",
    "region_extend.useFaceStep": "use_face_step",
    "region_extend.geom": "geom.out",
    "rotate_edges.useCcw": "use_ccw",
    "rotate_edges.edges": "edges.out",
    "reverse_faces.flipMultires": "flip_multires",
    "bisect_edges.edgePercents": "edge_percents",
    "bisect_edges.geomSplit": "geom_split.out",
    "mirror.mergeDist": "merge_dist",
    "mirror.mirrorU": "mirror_u",
    "mirror.mirrorV": "mirror_v",
    "mirror.mirrorUdim": "mirror_udim",
    "mirror.useShapekey": "use_shapekey",
    "mirror.geom": "geom.out",
    "find_doubles.keepVerts": "keep_verts",
    "find_doubles.useConnected": "use_connected",
    "find_doubles.targetmap": "targetmap.out",
    "remove_doubles.useConnected": "use_connected",
    "circularize.customRadius": "custom_radius",
    "circularize.fitMethod": "fit_method",
    "circularize.lockX": "lock_x",
    "circularize.lockY": "lock_y",
    "circularize.lockZ": "lock_z",
    "circularize.mirrorX": "mirror_x",
    "circularize.mirrorY": "mirror_y",
    "circularize.mirrorZ": "mirror_z",
    "flatten.viewNormal": "view_normal",
    "flatten.lockX": "lock_x",
    "flatten.lockY": "lock_y",
    "flatten.lockZ": "lock_z",
    "pointmerge_facedata.vertTarget": "vert_target",
    "pointmerge.mergeCo": "merge_co",
    "pointmerge.vertTarget": "vert_target",
    "weld_verts.useCentroid": "use_centroid",
    "weld_verts.averageVertData": "average_vert_data",
    "create_vert.vert": "vert.out",
    "join_triangles.cmpSeam": "cmp_seam",
    "join_triangles.cmpSharp": "cmp_sharp",
    "join_triangles.cmpUvs": "cmp_uvs",
    "join_triangles.cmpVcols": "cmp_vcols",
    "join_triangles.cmpMaterials": "cmp_materials",
    "join_triangles.angleFaceThreshold": "angle_face_threshold",
    "join_triangles.angleShapeThreshold": "angle_shape_threshold",
    "join_triangles.topologyInfluence": "topology_influence",
    "join_triangles.deselectJoined": "deselect_joined",
    "join_triangles.mergeLimit": "merge_limit",
    "join_triangles.neighborDebug": "neighbor_debug",
    "join_triangles.faces": "faces.out",
    "contextual_create.matNr": "mat_nr",
    "contextual_create.useSmooth": "use_smooth",
    "contextual_create.faces": "faces.out",
    "contextual_create.edges": "edges.out",
    "bridge_loops.usePairs": "use_pairs",
    "bridge_loops.useCyclic": "use_cyclic",
    "bridge_loops.useMerge": "use_merge",
    "bridge_loops.mergeFactor": "merge_factor",
    "bridge_loops.twistOffset": "twist_offset",
    "bridge_loops.faces": "faces.out",
    "bridge_loops.edges": "edges.out",
    "grid_fill.matNr": "mat_nr",
    "grid_fill.useSmooth": "use_smooth",
    "grid_fill.useInterpSimple": "use_interp_simple",
    "grid_fill.faces": "faces.out",
    "holes_fill.faces": "faces.out",
    "face_attribute_fill.useNormals": "use_normals",
    "face_attribute_fill.useData": "use_data",
    "face_attribute_fill.facesFail": "faces_fail.out",
    "edgeloop_fill.matNr": "mat_nr",
    "edgeloop_fill.useSmooth": "use_smooth",
    "edgeloop_fill.faces": "faces.out",
    "edgenet_fill.matNr": "mat_nr",
    "edgenet_fill.useSmooth": "use_smooth",
    "edgenet_fill.faces": "faces.out",
    "edgenet_prepare.edges": "edges.out",
    "rotate.useShapekey": "use_shapekey",
    "translate.useShapekey": "use_shapekey",
    "scale.useShapekey": "use_shapekey",
    "transform.useShapekey": "use_shapekey",
    "mesh_to_bmesh.useShapekey": "use_shapekey",
    "extrude_discrete_faces.useNormalFlip": "use_normal_flip",
    "extrude_discrete_faces.useSelectHistory": "use_select_history",
    "extrude_discrete_faces.faces": "faces.out",
    "extrude_edge_only.useNormalFlip": "use_normal_flip",
    "extrude_edge_only.useSelectHistory": "use_select_history",
    "extrude_edge_only.geom": "geom.out",
    "extrude_vert_indiv.useSelectHistory": "use_select_history",
    "extrude_vert_indiv.edges": "edges.out",
    "extrude_vert_indiv.verts": "verts.out",
    "connect_verts.facesExclude": "faces_exclude",
    "connect_verts.checkDegenerate": "check_degenerate",
    "connect_verts.edges": "edges.out",
    "connect_verts_concave.edges": "edges.out",
    "connect_verts_concave.faces": "faces.out",
    "connect_verts_nonplanar.angleLimit": "angle_limit",
    "connect_verts_nonplanar.edges": "edges.out",
    "connect_verts_nonplanar.faces": "faces.out",
    "connect_vert_pair.vertsExclude": "verts_exclude",
    "connect_vert_pair.facesExclude": "faces_exclude",
    "connect_vert_pair.edges": "edges.out",
    "extrude_face_region.edgesExclude": "edges_exclude",
    "extrude_face_region.useKeepOrig": "use_keep_orig",
    "extrude_face_region.useNormalFlip": "use_normal_flip",
    "extrude_face_region.useNormalFromAdjacent": "use_normal_from_adjacent",
    "extrude_face_region.useDissolveOrthoEdges": "use_dissolve_ortho_edges",
    "extrude_face_region.useSelectHistory": "use_select_history",
    "extrude_face_region.skipInputFlip": "skip_input_flip",
    "extrude_face_region.geom": "geom.out",
    "dissolve_verts.useFaceSplit": "use_face_split",
    "dissolve_verts.useBoundaryTear": "use_boundary_tear",
    "dissolve_edges.useVerts": "use_verts",
    "dissolve_edges.useFaceSplit": "use_face_split",
    "dissolve_edges.angleThreshold": "angle_threshold",
    "dissolve_edges.usePreserveQuads": "use_preserve_quads",
    "dissolve_edges.region": "region.out",
    "dissolve_faces.useVerts": "use_verts",
    "dissolve_faces.region": "region.out",
    "dissolve_limit.angleLimit": "angle_limit",
    "dissolve_limit.useDissolveBoundaries": "use_dissolve_boundaries",
    "dissolve_limit.region": "region.out",
    "triangulate.quadMethod": "quad_method",
    "triangulate.ngonMethod": "ngon_method",
    "triangulate.edges": "edges.out",
    "triangulate.faces": "faces.out",
    "triangulate.faceMap": "face_map.out",
    "triangulate.faceMapDouble": "face_map_double.out",
    "subdivide_edges.smoothFalloff": "smooth_falloff",
    "subdivide_edges.alongNormal": "along_normal",
    "subdivide_edges.customPatterns": "custom_patterns",
    "subdivide_edges.edgePercents": "edge_percents",
    "subdivide_edges.quadCornerType": "quad_corner_type",
    "subdivide_edges.useGridFill": "use_grid_fill",
    "subdivide_edges.useSingleEdge": "use_single_edge",
    "subdivide_edges.useOnlyQuads": "use_only_quads",
    "subdivide_edges.useSphere": "use_sphere",
    "subdivide_edges.useSmoothEven": "use_smooth_even",
    "subdivide_edges.geomInner": "geom_inner.out",
    "subdivide_edges.geomSplit": "geom_split.out",
    "subdivide_edges.geom": "geom.out",
    "subdivide_edgering.interpMode": "interp_mode",
    "subdivide_edgering.profileShape": "profile_shape",
    "subdivide_edgering.profileShapeFactor": "profile_shape_factor",
    "subdivide_edgering.faces": "faces.out",
    "bisect_plane.planeCo": "plane_co",
    "bisect_plane.planeNo": "plane_no",
    "bisect_plane.useSnapCenter": "use_snap_center",
    "bisect_plane.clearOuter": "clear_outer",
    "bisect_plane.clearInner": "clear_inner",
    "bisect_plane.geomCut": "geom_cut.out",
    "bisect_plane.geom": "geom.out",
    "duplicate.useSelectHistory": "use_select_history",
    "duplicate.useEdgeFlipFromFace": "use_edge_flip_from_face",
    "duplicate.geomOrig": "geom_orig.out",
    "duplicate.geom": "geom.out",
    "duplicate.vertMap": "vert_map.out",
    "duplicate.edgeMap": "edge_map.out",
    "duplicate.faceMap": "face_map.out",
    "duplicate.boundaryMap": "boundary_map.out",
    "duplicate.isovertMap": "isovert_map.out",
    "split.useOnlyFaces": "use_only_faces",
    "split.geom": "geom.out",
    "split.boundaryMap": "boundary_map.out",
    "split.isovertMap": "isovert_map.out",
    "spin.useMerge": "use_merge",
    "spin.useNormalFlip": "use_normal_flip",
    "spin.useDuplicate": "use_duplicate",
    "spin.geomLast": "geom_last.out",
    "rotate_uvs.useCcw": "use_ccw",
    "rotate_colors.useCcw": "use_ccw",
    "rotate_colors.colorIndex": "color_index",
    "reverse_colors.colorIndex": "color_index",
    "split_edges.useVerts": "use_verts",
    "split_edges.edges": "edges.out",
    "create_grid.xSegments": "x_segments",
    "create_grid.ySegments": "y_segments",
    "create_grid.calcUvs": "calc_uvs",
    "create_grid.verts": "verts.out",
    "create_uvsphere.uSegments": "u_segments",
    "create_uvsphere.vSegments": "v_segments",
    "create_uvsphere.calcUvs": "calc_uvs",
    "create_uvsphere.verts": "verts.out",
    "create_icosphere.calcUvs": "calc_uvs",
    "create_icosphere.verts": "verts.out",
    "create_monkey.calcUvs": "calc_uvs",
    "create_monkey.verts": "verts.out",
    "create_cone.capEnds": "cap_ends",
    "create_cone.capTris": "cap_tris",
    "create_cone.calcUvs": "calc_uvs",
    "create_cone.verts": "verts.out",
    "create_circle.capEnds": "cap_ends",
    "create_circle.capTris": "cap_tris",
    "create_circle.calcUvs": "calc_uvs",
    "create_circle.verts": "verts.out",
    "create_cube.calcUvs": "calc_uvs",
    "create_cube.verts": "verts.out",
    "bevel.offsetType": "offset_type",
    "bevel.profileType": "profile_type",
    "bevel.clampOverlap": "clamp_overlap",
    "bevel.loopSlide": "loop_slide",
    "bevel.markSeam": "mark_seam",
    "bevel.markSharp": "mark_sharp",
    "bevel.hardenNormals": "harden_normals",
    "bevel.faceStrengthMode": "face_strength_mode",
    "bevel.miterOuter": "miter_outer",
    "bevel.miterInner": "miter_inner",
    "bevel.customProfile": "custom_profile",
    "bevel.vmeshMethod": "vmesh_method",
    "bevel.faces": "faces.out",
    "bevel.edges": "edges.out",
    "bevel.verts": "verts.out",
    "beautify_fill.useRestrictTag": "use_restrict_tag",
    "beautify_fill.geom": "geom.out",
    "triangle_fill.useBeauty": "use_beauty",
    "triangle_fill.useDissolve": "use_dissolve",
    "triangle_fill.geom": "geom.out",
    "solidify.geom": "geom.out",
    "inset_individual.useEvenOffset": "use_even_offset",
    "inset_individual.useInterpolate": "use_interpolate",
    "inset_individual.useRelativeOffset": "use_relative_offset",
    "inset_individual.faces": "faces.out",
    "inset_region.facesExclude": "faces_exclude",
    "inset_region.useBoundary": "use_boundary",
    "inset_region.useEvenOffset": "use_even_offset",
    "inset_region.useInterpolate": "use_interpolate",
    "inset_region.useRelativeOffset": "use_relative_offset",
    "inset_region.useEdgeRail": "use_edge_rail",
    "inset_region.useOutset": "use_outset",
    "inset_region.faces": "faces.out",
    "offset_edgeloops.useCapEndpoint": "use_cap_endpoint",
    "offset_edgeloops.edges": "edges.out",
    "wireframe.useReplace": "use_replace",
    "wireframe.useBoundary": "use_boundary",
    "wireframe.useEvenOffset": "use_even_offset",
    "wireframe.useCrease": "use_crease",
    "wireframe.creaseWeight": "crease_weight",
    "wireframe.useRelativeOffset": "use_relative_offset",
    "wireframe.materialOffset": "material_offset",
    "wireframe.faces": "faces.out",
    "poke.centerMode": "center_mode",
    "poke.useRelativeOffset": "use_relative_offset",
    "poke.verts": "verts.out",
    "poke.faces": "faces.out",
    "convex_hull.useExistingFaces": "use_existing_faces",
    "convex_hull.geom": "geom.out",
    "convex_hull.geomInterior": "geom_interior.out",
    "convex_hull.geomUnused": "geom_unused.out",
    "convex_hull.geomHoles": "geom_holes.out",
    "space_edge_loops_evenly.lockX": "lock_x",
    "space_edge_loops_evenly.lockY": "lock_y",
    "space_edge_loops_evenly.lockZ": "lock_z",
    "symmetrize.useShapekey": "use_shapekey",
    "symmetrize.geom": "geom.out",
}
