/**
 * Core enums and built-in attribute names for the mesh kernel.
 *
 * These mirror Blender so that a `.blend` file, a glTF round-trip and an operator port all speak the
 * same vocabulary. Ported from:
 * - `source/blender/blenkernel/BKE_attribute_enums.hh` (`AttrDomain`, `AttrType`)
 * - `source/blender/makesdna/DNA_mesh_types.h` (`Mesh`)
 * - `source/blender/bmesh/bmesh_class.hh` (`BM_VERT`/`BM_EDGE`/`BM_LOOP`/`BM_FACE`, `BM_ELEM_*` flags)
 */

/**
 * The four element domains an attribute can live on.
 *
 * A "corner" is one face-vertex incidence (Blender calls it a loop). Per-corner attributes are what
 * make UV seams and split normals representable without duplicating vertices.
 *
 * Values match Blender's `blender::bke::AttrDomain` so imported data needs no remapping.
 */
export enum AttrDomain {
    Point = 0,
    Edge = 1,
    Face = 2,
    Corner = 3,
}

export const ATTR_DOMAINS = [AttrDomain.Point, AttrDomain.Edge, AttrDomain.Face, AttrDomain.Corner] as const

export function attrDomainName(domain: AttrDomain): string {
    switch (domain) {
    case AttrDomain.Point: return 'point'
    case AttrDomain.Edge: return 'edge'
    case AttrDomain.Face: return 'face'
    case AttrDomain.Corner: return 'corner'
    default: return `unknown(${domain})`
    }
}

/**
 * Attribute value types. A subset of Blender's `AttrType`, limited to what mesh editing needs today.
 * Add cases here (and to {@link ATTR_TYPE_INFO}) rather than smuggling data through a wider type.
 */
export type AttrType =
    | 'bool'
    | 'int8'
    | 'int32'
    | 'int32x2'
    | 'int16x2'
    | 'float'
    | 'float2'
    | 'float3'
    | 'float4'
    | 'byteColor'
    | 'quaternion'

export interface AttrTypeInfo {
    /** Number of scalar components per element. */
    readonly components: number
    /** Typed-array constructor backing this type. */
    readonly array: ArrayConstructor2
    /** Value written into newly grown slots. */
    readonly defaultValue: number
}

export type TypedArray2 =
    Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array

export type ArrayConstructor2 = {
    new(length: number): TypedArray2
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): TypedArray2
    readonly BYTES_PER_ELEMENT: number
    readonly name: string
}

/**
 * Per-type layout. `bool` is stored as `Uint8Array` (0/1) rather than a bitfield: Blender does the same
 * (`CD_PROP_BOOL`), and it keeps attribute code uniform at the cost of 7 bits per element.
 */
export const ATTR_TYPE_INFO: Readonly<Record<AttrType, AttrTypeInfo>> = {
    bool: {components: 1, array: Uint8Array, defaultValue: 0},
    int8: {components: 1, array: Int8Array, defaultValue: 0},
    int32: {components: 1, array: Int32Array, defaultValue: 0},
    int32x2: {components: 2, array: Int32Array, defaultValue: 0},
    int16x2: {components: 2, array: Int16Array, defaultValue: 0},
    float: {components: 1, array: Float32Array, defaultValue: 0},
    float2: {components: 2, array: Float32Array, defaultValue: 0},
    float3: {components: 3, array: Float32Array, defaultValue: 0},
    float4: {components: 4, array: Float32Array, defaultValue: 0},
    byteColor: {components: 4, array: Uint8Array, defaultValue: 255},
    quaternion: {components: 4, array: Float32Array, defaultValue: 0},
}

export function isAttrType(v: string): v is AttrType {
    return Object.prototype.hasOwnProperty.call(ATTR_TYPE_INFO, v)
}

/**
 * Element type bits, matching `BM_VERT`/`BM_EDGE`/`BM_LOOP`/`BM_FACE` in `bmesh_class.hh`.
 * Used as a mask on operator slots that accept mixed geometry.
 */
export const ElemType = {
    Vert: 1,
    Edge: 2,
    Loop: 4,
    Face: 8,
} as const
export type ElemTypeMask = number

/**
 * Header flags on a BMesh element, matching `BM_ELEM_*` in `bmesh_class.hh`.
 * `Tag` and `InternalTag` are scratch bits for algorithms; never persist them.
 */
export const ElemFlag = {
    Select: 1,
    Hidden: 2,
    Seam: 4,
    Smooth: 8,
    Tag: 16,
    SelectUV: 32,
    TagAlt: 64,
    InternalTag: 128,
} as const

/**
 * Select-mode bitmask, matching `SCE_SELECT_VERTEX`/`EDGE`/`FACE` in `DNA_scene_types.h`.
 * Modes combine: Blender allows vertex+edge, face-only, and so on.
 */
export const SelectMode = {
    Vertex: 1,
    Edge: 2,
    Face: 4,
} as const
export type SelectModeMask = number

/**
 * Names of the attributes the kernel itself understands.
 *
 * The dot-prefixed ones are Blender's "internal" names: they are topology or UI state rather than user
 * data, and are hidden from attribute lists in the UI. Keeping the exact strings means blend import and
 * export need no translation table.
 */
export const AttrName = {
    /** Point, float3. Vertex positions. Required. */
    position: 'position',
    /** Edge, int32x2. The two vertex indices of each edge. Required. */
    edgeVerts: '.edge_verts',
    /** Corner, int32. Vertex index used by each corner. Required. */
    cornerVert: '.corner_vert',
    /** Corner, int32. Edge from this corner to the next corner of the same face. Required. */
    cornerEdge: '.corner_edge',

    selectVert: '.select_vert',
    selectEdge: '.select_edge',
    selectFace: '.select_poly',
    hideVert: '.hide_vert',
    hideEdge: '.hide_edge',
    hideFace: '.hide_poly',

    /** Edge, bool. True means the edge splits normals (the inverse of BMesh's SMOOTH flag). */
    sharpEdge: 'sharp_edge',
    /** Face, bool. True means flat shading. */
    sharpFace: 'sharp_face',
    /** Edge, bool. UV seam. */
    uvSeam: 'uv_seam',
    /** Face, int32. Index into the mesh's material slot list. */
    materialIndex: 'material_index',

    creaseVert: 'crease_vert',
    creaseEdge: 'crease_edge',
    bevelWeightVert: 'bevel_weight_vert',
    bevelWeightEdge: 'bevel_weight_edge',
    /** Corner or point or face, float3. Custom normals. */
    customNormal: 'custom_normal',
} as const

/** Attributes without which a mesh is not well formed. See `BKE_mesh_attribute_required`. */
export const REQUIRED_ATTRS: ReadonlyArray<{name: string, domain: AttrDomain, type: AttrType}> = [
    {name: AttrName.position, domain: AttrDomain.Point, type: 'float3'},
    {name: AttrName.edgeVerts, domain: AttrDomain.Edge, type: 'int32x2'},
    {name: AttrName.cornerVert, domain: AttrDomain.Corner, type: 'int32'},
    {name: AttrName.cornerEdge, domain: AttrDomain.Corner, type: 'int32'},
]

/**
 * Domain and type of every built-in attribute, so importers and operators cannot create one with the
 * wrong shape. Anything not listed here is user data and may take any domain/type.
 */
export const BUILTIN_ATTRS: Readonly<Record<string, {domain: AttrDomain, type: AttrType}>> = {
    [AttrName.position]: {domain: AttrDomain.Point, type: 'float3'},
    [AttrName.edgeVerts]: {domain: AttrDomain.Edge, type: 'int32x2'},
    [AttrName.cornerVert]: {domain: AttrDomain.Corner, type: 'int32'},
    [AttrName.cornerEdge]: {domain: AttrDomain.Corner, type: 'int32'},
    [AttrName.selectVert]: {domain: AttrDomain.Point, type: 'bool'},
    [AttrName.selectEdge]: {domain: AttrDomain.Edge, type: 'bool'},
    [AttrName.selectFace]: {domain: AttrDomain.Face, type: 'bool'},
    [AttrName.hideVert]: {domain: AttrDomain.Point, type: 'bool'},
    [AttrName.hideEdge]: {domain: AttrDomain.Edge, type: 'bool'},
    [AttrName.hideFace]: {domain: AttrDomain.Face, type: 'bool'},
    [AttrName.sharpEdge]: {domain: AttrDomain.Edge, type: 'bool'},
    [AttrName.sharpFace]: {domain: AttrDomain.Face, type: 'bool'},
    [AttrName.uvSeam]: {domain: AttrDomain.Edge, type: 'bool'},
    [AttrName.materialIndex]: {domain: AttrDomain.Face, type: 'int32'},
    [AttrName.creaseVert]: {domain: AttrDomain.Point, type: 'float'},
    [AttrName.creaseEdge]: {domain: AttrDomain.Edge, type: 'float'},
    [AttrName.bevelWeightVert]: {domain: AttrDomain.Point, type: 'float'},
    [AttrName.bevelWeightEdge]: {domain: AttrDomain.Edge, type: 'float'},
}

/** True for attributes the kernel manages, which the UI hides from the user-attribute list. */
export function isInternalAttrName(name: string): boolean {
    return name.startsWith('.')
}
