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
    /** C name of the optional `init` callback that sets non-zero slot defaults. */
    initC?: string
    /** Slot defaults set by `initC`, keyed by Blender slot name. */
    initDefaults?: Record<string, {valueSrc: string, source: string}>
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "mirror_clip_x", tsName: "mirrorClipX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_clip_y", tsName: "mirrorClipY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_clip_z", tsName: "mirrorClipZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "clip_dist", tsName: "clipDist", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_axis_x", tsName: "useAxisX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_axis_y", tsName: "useAxisY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_axis_z", tsName: "useAxisZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_smooth_vert_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "lambda_factor", tsName: "lambdaFactor", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "lambda_border", tsName: "lambdaBorder", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_x", tsName: "useX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_y", tsName: "useY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_z", tsName: "useZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "preserve_volume", tsName: "preserveVolume", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_smooth_laplacian_vert_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_recalc_face_normals_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "iterations", tsName: "iterations", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_planar_faces_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "use_contract", tsName: "useContract", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_faces", tsName: "useFaces", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_face_step", tsName: "useFaceStep", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_region_extend_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "use_ccw", tsName: "useCcw", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_rotate_edges_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "flip_multires", tsName: "flipMultires", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_reverse_faces_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_flip_quad_tessellation_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "cuts", tsName: "cuts", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "edge_percents", tsName: "edgePercents", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_FLT"},
        ],
        slotsOut: [
            {name: "geom_split.out", tsName: "geomSplit", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bisect_edges_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "merge_dist", tsName: "mergeDist", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "axis", tsName: "axis", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_axis_xyz"},
            {name: "mirror_u", tsName: "mirrorU", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_v", tsName: "mirrorV", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_udim", tsName: "mirrorUdim", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_mirror_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "keep_verts", tsName: "keepVerts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_connected", tsName: "useConnected", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT"},
        ],
        slotsOut: [
            {name: "targetmap.out", tsName: "targetmap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: [],
        execC: "bmo_find_doubles_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_connected", tsName: "useConnected", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_remove_doubles_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "custom_radius", tsName: "customRadius", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "angle", tsName: "angle", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "fit_method", tsName: "fitMethod", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "flatten", tsName: "flatten", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "regular", tsName: "regular", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_x", tsName: "lockX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_y", tsName: "lockY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_z", tsName: "lockZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_x", tsName: "mirrorX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_y", tsName: "mirrorY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mirror_z", tsName: "mirrorZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_circularize_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "method", tsName: "method", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "view_normal", tsName: "viewNormal", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "lock_x", tsName: "lockX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_y", tsName: "lockY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_z", tsName: "lockZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_flatten_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "uvs", tsName: "uvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_collapse_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "vert_target", tsName: "vertTarget", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, isSingle: true},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_pointmerge_facedata_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_average_vert_facedata_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "merge_co", tsName: "mergeCo", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "vert_target", tsName: "vertTarget", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */, isSingle: true},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_pointmerge_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_collapse_uvs_exec",
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
            {name: "targetmap", tsName: "targetmap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "use_centroid", tsName: "useCentroid", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "average_vert_data", tsName: "averageVertData", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_weld_verts_exec",
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
            {name: "co", tsName: "co", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
        ],
        slotsOut: [
            {name: "vert.out", tsName: "vert", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: [],
        execC: "bmo_create_vert_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "cmp_seam", tsName: "cmpSeam", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "cmp_sharp", tsName: "cmpSharp", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "cmp_uvs", tsName: "cmpUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "cmp_vcols", tsName: "cmpVcols", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "cmp_materials", tsName: "cmpMaterials", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "angle_face_threshold", tsName: "angleFaceThreshold", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "angle_shape_threshold", tsName: "angleShapeThreshold", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "topology_influence", tsName: "topologyInfluence", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "deselect_joined", tsName: "deselectJoined", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "merge_limit", tsName: "mergeLimit", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "neighbor_debug", tsName: "neighborDebug", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_join_triangles_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_contextual_create_exec",
    },
    /** Bridge edge loops with faces. */
    "bridge_loops": {
        name: "bridge_loops",
        tsName: "bridgeLoops",
        doc: "Bridge edge loops with faces.",
        slotsIn: [
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "use_pairs", tsName: "usePairs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_cyclic", tsName: "useCyclic", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_merge", tsName: "useMerge", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "merge_factor", tsName: "mergeFactor", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "twist_offset", tsName: "twistOffset", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bridge_loops_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_interp_simple", tsName: "useInterpSimple", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_grid_fill_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "sides", tsName: "sides", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_holes_fill_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "use_normals", tsName: "useNormals", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_data", tsName: "useData", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces_fail.out", tsName: "facesFail", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_face_attribute_fill_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_edgeloop_fill_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "mat_nr", tsName: "matNr", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "use_smooth", tsName: "useSmooth", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "sides", tsName: "sides", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_edgenet_fill_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: [],
        execC: "bmo_edgenet_prepare_exec",
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
            {name: "cent", tsName: "cent", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_rotate_exec",
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
            {name: "vec", tsName: "vec", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_translate_exec",
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
            {name: "vec", tsName: "vec", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_scale_exec",
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
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_transform_exec",
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
            {name: "scene", tsName: "scene", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_SCENE"},
            {name: "object", tsName: "object", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_OBJECT"},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_object_load_bmesh_exec",
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
            {name: "mesh", tsName: "mesh", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_MESH"},
            {name: "object", tsName: "object", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_OBJECT"},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_bmesh_to_mesh_exec",
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
            {name: "mesh", tsName: "mesh", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_MESH"},
            {name: "object", tsName: "object", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_OBJECT"},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_mesh_to_bmesh_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_extrude_discrete_faces_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_extrude_edge_only_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_extrude_vert_indiv_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "faces_exclude", tsName: "facesExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "check_degenerate", tsName: "checkDegenerate", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_verts_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_verts_concave_exec",
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
            {name: "angle_limit", tsName: "angleLimit", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_verts_nonplanar_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "verts_exclude", tsName: "vertsExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "faces_exclude", tsName: "facesExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_connect_vert_pair_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "edges_exclude", tsName: "edgesExclude", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_EMPTY"},
            {name: "use_keep_orig", tsName: "useKeepOrig", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_normal_from_adjacent", tsName: "useNormalFromAdjacent", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_dissolve_ortho_edges", tsName: "useDissolveOrthoEdges", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "skip_input_flip", tsName: "skipInputFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_extrude_face_region_exec",
    },
    /** Dissolve Verts. */
    "dissolve_verts": {
        name: "dissolve_verts",
        tsName: "dissolveVerts",
        doc: "Dissolve Verts.",
        slotsIn: [
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_face_split", tsName: "useFaceSplit", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_boundary_tear", tsName: "useBoundaryTear", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_verts_exec",
    },
    /** Dissolve Edges. */
    "dissolve_edges": {
        name: "dissolve_edges",
        tsName: "dissolveEdges",
        doc: "Dissolve Edges.",
        slotsIn: [
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "use_verts", tsName: "useVerts", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_face_split", tsName: "useFaceSplit", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "angle_threshold", tsName: "angleThreshold", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_preserve_quads", tsName: "usePreserveQuads", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "region.out", tsName: "region", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_edges_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "use_verts", tsName: "useVerts", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "region.out", tsName: "region", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_faces_exec",
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
            {name: "angle_limit", tsName: "angleLimit", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_dissolve_boundaries", tsName: "useDissolveBoundaries", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "delimit", tsName: "delimit", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_FLAG", enumName: "bmo_enum_dissolve_limit_flags"},
        ],
        slotsOut: [
            {name: "region.out", tsName: "region", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_limit_exec",
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
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_dissolve_degenerate_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "quad_method", tsName: "quadMethod", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_triangulate_quad_method"},
            {name: "ngon_method", tsName: "ngonMethod", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_triangulate_ngon_method"},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "face_map.out", tsName: "faceMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "face_map_double.out", tsName: "faceMapDouble", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_triangulate_exec",
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
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "iterations", tsName: "iterations", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_unsubdivide_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "smooth", tsName: "smooth", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "smooth_falloff", tsName: "smoothFalloff", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_falloff_type"},
            {name: "fractal", tsName: "fractal", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "along_normal", tsName: "alongNormal", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "cuts", tsName: "cuts", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "seed", tsName: "seed", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "custom_patterns", tsName: "customPatterns", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_INTERNAL"},
            {name: "edge_percents", tsName: "edgePercents", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_FLT"},
            {name: "quad_corner_type", tsName: "quadCornerType", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_subdivide_edges_quad_corner_type"},
            {name: "use_grid_fill", tsName: "useGridFill", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_single_edge", tsName: "useSingleEdge", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_only_quads", tsName: "useOnlyQuads", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_sphere", tsName: "useSphere", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_smooth_even", tsName: "useSmoothEven", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom_inner.out", tsName: "geomInner", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_split.out", tsName: "geomSplit", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_subdivide_edges_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "interp_mode", tsName: "interpMode", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_subdivide_edgering_interp_mode"},
            {name: "smooth", tsName: "smooth", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "cuts", tsName: "cuts", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "profile_shape", tsName: "profileShape", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_falloff_type"},
            {name: "profile_shape_factor", tsName: "profileShapeFactor", type: "float", cType: "BMO_OP_SLOT_FLT"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_subdivide_edgering_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "plane_co", tsName: "planeCo", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "plane_no", tsName: "planeNo", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "use_snap_center", tsName: "useSnapCenter", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "clear_outer", tsName: "clearOuter", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "clear_inner", tsName: "clearInner", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom_cut.out", tsName: "geomCut", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 3 /* VERT|EDGE */},
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bisect_plane_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "context", tsName: "context", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_delete_context"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_delete_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "dest", tsName: "dest", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_BMESH"},
            {name: "use_select_history", tsName: "useSelectHistory", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_edge_flip_from_face", tsName: "useEdgeFlipFromFace", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom_orig.out", tsName: "geomOrig", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "vert_map.out", tsName: "vertMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "edge_map.out", tsName: "edgeMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "face_map.out", tsName: "faceMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "boundary_map.out", tsName: "boundaryMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "isovert_map.out", tsName: "isovertMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_duplicate_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "dest", tsName: "dest", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_BMESH"},
            {name: "use_only_faces", tsName: "useOnlyFaces", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "boundary_map.out", tsName: "boundaryMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
            {name: "isovert_map.out", tsName: "isovertMap", type: "map", cType: "BMO_OP_SLOT_MAPPING", subtype: "MAP_ELEM"},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_split_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "cent", tsName: "cent", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "axis", tsName: "axis", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "dvec", tsName: "dvec", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
            {name: "angle", tsName: "angle", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "space", tsName: "space", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "steps", tsName: "steps", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "use_merge", tsName: "useMerge", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_normal_flip", tsName: "useNormalFlip", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_duplicate", tsName: "useDuplicate", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom_last.out", tsName: "geomLast", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_spin_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "use_ccw", tsName: "useCcw", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_rotate_uvs_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_reverse_uvs_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "use_ccw", tsName: "useCcw", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "color_index", tsName: "colorIndex", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_rotate_colors_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "color_index", tsName: "colorIndex", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
        ],
        typeFlags: [],
        execC: "bmo_reverse_colors_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "verts", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "use_verts", tsName: "useVerts", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_split_edges_exec",
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
            {name: "x_segments", tsName: "xSegments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "y_segments", tsName: "ySegments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "size", tsName: "size", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_grid_exec",
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
            {name: "u_segments", tsName: "uSegments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "v_segments", tsName: "vSegments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "radius", tsName: "radius", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_uvsphere_exec",
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
            {name: "subdivisions", tsName: "subdivisions", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "radius", tsName: "radius", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_icosphere_exec",
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
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_monkey_exec",
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
            {name: "cap_ends", tsName: "capEnds", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "cap_tris", tsName: "capTris", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "segments", tsName: "segments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "radius1", tsName: "radius1", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "radius2", tsName: "radius2", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "depth", tsName: "depth", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_cone_exec",
    },
    /** Creates a Circle. */
    "create_circle": {
        name: "create_circle",
        tsName: "createCircle",
        doc: "Creates a Circle.",
        slotsIn: [
            {name: "cap_ends", tsName: "capEnds", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "cap_tris", tsName: "capTris", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "segments", tsName: "segments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "radius", tsName: "radius", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_circle_exec",
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
            {name: "size", tsName: "size", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "matrix", tsName: "matrix", type: "mat4", cType: "BMO_OP_SLOT_MAT"},
            {name: "calc_uvs", tsName: "calcUvs", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_create_cube_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "offset", tsName: "offset", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "offset_type", tsName: "offsetType", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_offset_type"},
            {name: "profile_type", tsName: "profileType", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_profile_type"},
            {name: "segments", tsName: "segments", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "profile", tsName: "profile", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "affect", tsName: "affect", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_affect_type"},
            {name: "clamp_overlap", tsName: "clampOverlap", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "material", tsName: "material", type: "int", cType: "BMO_OP_SLOT_INT"},
            {name: "loop_slide", tsName: "loopSlide", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mark_seam", tsName: "markSeam", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "mark_sharp", tsName: "markSharp", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "harden_normals", tsName: "hardenNormals", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "face_strength_mode", tsName: "faceStrengthMode", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_face_strength_type"},
            {name: "miter_outer", tsName: "miterOuter", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_miter_type"},
            {name: "miter_inner", tsName: "miterInner", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_miter_type"},
            {name: "spread", tsName: "spread", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "custom_profile", tsName: "customProfile", type: "ptr", cType: "BMO_OP_SLOT_PTR", subtype: "PTR_STRUCT"},
            {name: "vmesh_method", tsName: "vmeshMethod", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_bevel_vmesh_method"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_bevel_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "use_restrict_tag", tsName: "useRestrictTag", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "method", tsName: "method", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_beautify_fill_method"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_beautify_fill_exec",
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
            {name: "use_beauty", tsName: "useBeauty", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_dissolve", tsName: "useDissolve", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "normal", tsName: "normal", type: "vec3", cType: "BMO_OP_SLOT_VEC"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_UNTAN_MULTIRES", "BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_triangle_fill_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_solidify_face_region_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "depth", tsName: "depth", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_even_offset", tsName: "useEvenOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_interpolate", tsName: "useInterpolate", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_inset_individual_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "faces_exclude", tsName: "facesExclude", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "use_boundary", tsName: "useBoundary", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_even_offset", tsName: "useEvenOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_interpolate", tsName: "useInterpolate", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_edge_rail", tsName: "useEdgeRail", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "depth", tsName: "depth", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_outset", tsName: "useOutset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_inset_region_exec",
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
            {name: "edges", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "use_cap_endpoint", tsName: "useCapEndpoint", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "edges.out", tsName: "edges", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH"],
        execC: "bmo_offset_edgeloops_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "thickness", tsName: "thickness", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "offset", tsName: "offset", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_replace", tsName: "useReplace", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_boundary", tsName: "useBoundary", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_even_offset", tsName: "useEvenOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "use_crease", tsName: "useCrease", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "crease_weight", tsName: "creaseWeight", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "material_offset", tsName: "materialOffset", type: "int", cType: "BMO_OP_SLOT_INT"},
        ],
        slotsOut: [
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_wireframe_exec",
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
            {name: "faces", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
            {name: "offset", tsName: "offset", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "center_mode", tsName: "centerMode", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_poke_center_mode"},
            {name: "use_relative_offset", tsName: "useRelativeOffset", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "verts.out", tsName: "verts", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 1 /* VERT */},
            {name: "faces.out", tsName: "faces", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 8 /* FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_poke_exec",
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
     */
    "convex_hull": {
        name: "convex_hull",
        tsName: "convexHull",
        doc: "Convex Hull\n\nBuilds a convex hull from the vertices in `input`.\n\nIf `use_existing_faces` is true, the hull will not output triangles\nthat are covered by a pre-existing face.\n\nAll hull vertices, faces, and edges are added to `geom.out`. Any\ninput elements that end up inside the hull (i.e. are not used by an\noutput face) are added to the `geom_interior.out` slot. The\n`geom_unused.out` slot will contain all interior geometry that is\ncompletely unused. Lastly, `geom_holes.out` contains edges and faces\nthat were in the input and are part of the hull.",
        slotsIn: [
            {name: "input", tsName: "input", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "use_existing_faces", tsName: "useExistingFaces", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_interior.out", tsName: "geomInterior", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_unused.out", tsName: "geomUnused", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "geom_holes.out", tsName: "geomHoles", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_convex_hull_exec",
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
            {name: "geom", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 2 /* EDGE */},
            {name: "interpolation", tsName: "interpolation", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_space_edge_loops_evenly_interpolation_method"},
            {name: "factor", tsName: "factor", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "lock_x", tsName: "lockX", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_y", tsName: "lockY", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
            {name: "lock_z", tsName: "lockZ", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC"],
        execC: "bmo_space_edge_loops_evenly_exec",
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
            {name: "input", tsName: "input", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
            {name: "direction", tsName: "direction", type: "int", cType: "BMO_OP_SLOT_INT", subtype: "INT_ENUM", enumName: "bmo_enum_axis_neg_xyz_and_xyz"},
            {name: "dist", tsName: "dist", type: "float", cType: "BMO_OP_SLOT_FLT"},
            {name: "use_shapekey", tsName: "useShapekey", type: "bool", cType: "BMO_OP_SLOT_BOOL"},
        ],
        slotsOut: [
            {name: "geom.out", tsName: "geom", type: "elems", cType: "BMO_OP_SLOT_ELEMENT_BUF", elemMask: 11 /* VERT|EDGE|FACE */},
        ],
        typeFlags: ["BMO_OPTYPE_FLAG_NORMALS_CALC", "BMO_OPTYPE_FLAG_SELECT_FLUSH", "BMO_OPTYPE_FLAG_SELECT_VALIDATE"],
        execC: "bmo_symmetrize_exec",
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
