/**
 * Blender `Mesh` datablock -> `MeshData` (`@threepipe/mesh-kernel`).
 *
 * Blender's `Mesh` and the kernel's `MeshData` are the same shape on purpose: struct-of-arrays, n-gon
 * faces addressed by an offsets array, and everything else a named attribute on one of four domains
 * (`DNA_mesh_types.h`, `BKE_attribute_storage.hh`). So importing is a transcription, not a conversion
 * - the faces come across as the n-gons they are, and the per-corner data stays per corner.
 *
 * Three on-disk layouts have to be read, because `.blend` files of all three ages reach this importer:
 *
 * | layout | Blender | topology | attributes |
 * | --- | --- | --- | --- |
 * | `MPoly`/`MLoop`/`MVert`/`MEdge` | <= 3.5 | `MPoly.loopstart`/`totloop`, `MLoop.v`/`.e` | struct bit-flags + `CustomData` layers |
 * | `CustomData` + `poly_offset_indices` | 3.6 - 4.x | `.corner_vert`/`.corner_edge` layers | named `CustomData` layers |
 * | `attribute_storage` | 5.0+ | same names, different container | `Attribute` records |
 *
 * All three carry real n-gons (the pre-3.6 corpus has faces up to 30 sides), and all three store a real
 * edge domain, so none of them needs an edge set re-derived from faces - which is why
 * {@link MeshData.calculateEdges} is never called here: it would discard `sharp_edge`, `uv_seam` and
 * the creases along with the authored edge order.
 *
 * Positions are rotated from Blender's Z-up to three's Y-up here, `(x, y, z) -> (x, z, -y)`, matching
 * `loader/index.ts`'s object transforms. That is a proper rotation, so face winding is unchanged.
 *
 * Node-safe: no three, no threepipe, no DOM. `loader/geometry.ts` bakes the result for rendering.
 */

import {AttrDomain, AttrName, AttrType, MeshData} from '@threepipe/mesh-kernel'

// `CD_*` values from `DNA_customdata_types.h`. Read as: what the layer must be, not what we hope.
const CD_PROP_FLOAT = 10
const CD_PROP_INT32 = 11
const CD_MLOOPUV = 16
const CD_PROP_BYTE_COLOR = 17
const CD_BWEIGHT = 29
const CD_CREASE = 30
const CD_PROP_INT32_2D = 46
const CD_PROP_COLOR = 47
const CD_PROP_FLOAT3 = 48
const CD_PROP_FLOAT2 = 49
const CD_PROP_BOOL = 50

// `bke::AttrType` from `BKE_attribute_enums.hh` - the 5.0 `attribute_storage` type tags. These are a
// different enum from the `CD_*` numbers above and must not be mixed up (the old 5.0 `sharp_face`
// lookup used `50`, a `CD_` value, and so never matched - see `issues/open/`).
const AT_BOOL = 0
const AT_INT8 = 1
const AT_INT32 = 3
const AT_INT32_2D = 4
const AT_FLOAT = 5
const AT_FLOAT2 = 6
const AT_FLOAT3 = 7
const AT_COLOR_BYTE = 9
const AT_COLOR_FLOAT = 10

// `bke::AttrDomain`, which the kernel's `AttrDomain` already mirrors value for value.
const DOMAIN_POINT = 0, DOMAIN_CORNER = 3

// Legacy struct bit-flags, `DNA_meshdata_types.h` "Deprecated Structs". Blender converts these to
// named attributes on file read (`mesh_legacy_convert.cc`); we do the same conversion here.
const SELECT = 1 << 0
const ME_SEAM = 1 << 2      // MEdge.flag
const ME_HIDE = 1 << 4      // MVert/MEdge/MPoly.flag
const ME_SHARP = 1 << 9     // MEdge.flag
const ME_SMOOTH = 1 << 0    // MPoly.flag - note this is the INVERSE of `sharp_face`

/** Upper bound on face/corner counts we will attempt, so a corrupt header cannot allocate gigabytes. */
const MAX_ELEMENTS = 1 << 27

/**
 * Called with the reason a datablock could not be decoded, so the caller can say why it fell back
 * instead of silently producing different geometry. Never called on success.
 */
export type MeshDataSkipReporter = (reason: string) => void

/** Records the reason and returns null, so every rejection inside the decoders stays one line. */
type Skip = (reason: string) => null

/** One attribute ready to be added to a {@link MeshData}, already in kernel vocabulary. */
interface PendingLayer {
    name: string
    domain: AttrDomain
    type: AttrType
    data: ArrayLike<number>
}

/**
 * The four topology arrays plus everything else, decoded from whichever layout the file uses.
 * Positions are still in Blender's Z-up space at this point.
 */
interface RawMesh {
    vertsNum: number
    edgesNum: number
    facesNum: number
    cornersNum: number
    /** Flat xyz triples, Blender Z-up. */
    positions: ArrayLike<number>
    /** Flat vertex-index pairs. Blender always stores a real edge domain, so this is never derived. */
    edgeVerts: ArrayLike<number> | null
    cornerVerts: ArrayLike<number>
    /** Blender stores this itself (`.corner_edge` / `MLoop.e`); null only if the layer is missing. */
    cornerEdges: ArrayLike<number> | null
    faceOffsets: ArrayLike<number>
    layers: PendingLayer[]
    materials: string[]
}

// region low-level DNA access

/** `CustomData.layers` is a single object when `totlayer === 1`, an array otherwise. */
function getLayer(layers: any, i: number): any {
    if (!Array.isArray(layers)) return i === 0 ? layers : null
    return layers[i]
}

/** Every resolved layer of one `CustomData` domain, in file order. */
function customDataLayers(meshData: any, domain: string): any[] {
    const cd = meshData && meshData[domain]
    const total = cd && cd.totlayer | 0
    if (!cd || !cd.layers || total <= 0) return []
    const out: any[] = []
    for (let i = 0; i < total; i++) {
        const l = getLayer(cd.layers, i)
        if (l) out.push(l)
    }
    return out
}

/**
 * Resolve a layer's payload to the block that holds it.
 *
 * `layer.data` is a pointer to a DATA block, handed back either as an array of lazily decoded element
 * proxies (when the block's DNA struct is known, e.g. `MLoopUV`) or as a single raw block. Both carry
 * `__data_address__` and the block's `__byte_length__`, which is what a typed read needs.
 */
function layerBlock(layer: any): {file: any, address: number, byteLength: number} | null {
    const data = layer && layer.data
    if (!data) return null
    const block = Array.isArray(data) ? data[0] : data
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    const byteLength = block.__byte_length__
    if (typeof byteLength !== 'number' || byteLength <= 0) return null
    return {file: block.__blender_file__, address: block.__data_address__, byteLength}
}

/**
 * Read a `CustomData` layer as `count` scalars. Returns null when the block is shorter than that -
 * reading past its end would walk into whatever DATA block Blender happened to write next, which is
 * how a truncated layer turns into plausible-looking garbage rather than a failure.
 */
function readLayerArray(layer: any, Ctor: any, count: number): any | null {
    const block = layerBlock(layer)
    if (!block) return null
    if (block.byteLength < count * Ctor.BYTES_PER_ELEMENT) return null
    return block.file.readTypedArray(Ctor, block.address, count)
}

/** First layer of this domain with the given name (and type, when given). */
function findCdLayer(meshData: any, domain: string, name: string, type?: number): any {
    for (const l of customDataLayers(meshData, domain)) {
        if (l.name === name && (type === undefined || l.type === type)) return l
    }
    return null
}

// Read a NUL-terminated C string from a resolved pointer block (e.g. an Attribute.name char*).
function readCString(block: any): string | null {
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    const u8 = block.__blender_file__.byte
    let s = '', o = block.__data_address__
    while (o < u8.length && u8[o] !== 0 && s.length < 256) s += String.fromCharCode(u8[o++])
    return s
}

/**
 * Blender 5.0 (`file_format_version` 1) stores mesh attributes in `attribute_storage`
 * (`DNA_attribute_types.h`): `Attribute { char *name; int16 data_type; int8 domain; int8 storage_type;
 * AttributeArray *data; }`, where `AttributeArray { void *data; ...; int64 size; }`.
 */
function attributeStorageRecords(meshData: any): any[] {
    const as = meshData.attribute_storage
    if (!as) return []
    const attrs = as.dna_attributes
    if (!attrs) return []
    return (Array.isArray(attrs) || attrs.length !== undefined) ? Array.from(attrs) as any[] : [attrs]
}

/**
 * Element count actually stored for an attribute (`AttributeArray.size`). In Blender 5.0 the `Mesh`
 * `tot*` fields are runtime (post-geometry-nodes) counts and do NOT match the stored array sizes - a
 * geometry-nodes "Circle" can report `totvert=15` while only 4 base vertices are stored. So the
 * attribute's own size is authoritative.
 */
function attrSize(attr: any): number {
    const arr = attr && attr.data
    const n = arr && arr.size !== undefined ? Number(arr.size) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Read the packed array for an `Attribute` as `count` scalars (alignment-safe). */
function readAttrArray(attr: any, Ctor: any, count: number): any | null {
    const arr = attr && attr.data // AttributeArray
    const block = arr && arr.data // void* -> packed values
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    return block.__blender_file__.readTypedArray(Ctor, block.__data_address__, count)
}

// endregion

// region attribute name/type mapping

/**
 * Blender attribute name -> kernel name. Only entries whose Blender name differs are listed; every
 * other name is carried through unchanged, so a user attribute keeps the name it has in Blender.
 *
 * `.uv_seam` is the 4.x spelling; Blender itself renames it to `uv_seam` in `versioning_520.cc`, and
 * the kernel uses the modern name, so the rename happens here too.
 */
const RENAMED_ATTRS: Record<string, string> = {
    '.uv_seam': AttrName.uvSeam,
}

/** Attributes that are per-file UI state rather than mesh data, and are not worth carrying. */
const SKIPPED_ATTRS = new Set([
    '.uv_select_vert', '.uv_select_edge', '.uv_select_face', '.uv_pin',
    '.sculpt_mask', '.sculpt_face_set',
])

/** `CD_PROP_*` -> kernel attribute type. Layers of any other type are left behind. */
function cdPropType(cdType: number): AttrType | null {
    switch (cdType) {
    case CD_PROP_BOOL: return 'bool'
    case CD_PROP_FLOAT: return 'float'
    case CD_PROP_INT32: return 'int32'
    case CD_PROP_INT32_2D: return 'int32x2'
    case CD_PROP_FLOAT2: return 'float2'
    case CD_PROP_FLOAT3: return 'float3'
    case CD_PROP_COLOR: return 'float4'
    case CD_PROP_BYTE_COLOR: return 'byteColor'
    default: return null
    }
}

/** `bke::AttrType` -> kernel attribute type. */
function attrPropType(dataType: number): AttrType | null {
    switch (dataType) {
    case AT_BOOL: return 'bool'
    case AT_INT8: return 'int8'
    case AT_INT32: return 'int32'
    case AT_INT32_2D: return 'int32x2'
    case AT_FLOAT: return 'float'
    case AT_FLOAT2: return 'float2'
    case AT_FLOAT3: return 'float3'
    case AT_COLOR_BYTE: return 'byteColor'
    case AT_COLOR_FLOAT: return 'float4'
    default: return null
    }
}

/** Typed-array constructor and component count for a kernel attribute type. */
const TYPE_READ: Record<string, {ctor: any, components: number}> = {
    bool: {ctor: Uint8Array, components: 1},
    int8: {ctor: Int8Array, components: 1},
    int32: {ctor: Int32Array, components: 1},
    int32x2: {ctor: Int32Array, components: 2},
    float: {ctor: Float32Array, components: 1},
    float2: {ctor: Float32Array, components: 2},
    float3: {ctor: Float32Array, components: 3},
    float4: {ctor: Float32Array, components: 4},
    byteColor: {ctor: Uint8Array, components: 4},
}

// endregion

// region layout A: pre-3.6 MPoly / MLoop / MVert / MEdge

/**
 * The `MPoly` layout (Blender <= 3.5). Faces are `{loopstart, totloop}` rather than an offsets array,
 * but that is the same information: sorting is not needed because `mesh_legacy_convert.cc`'s
 * `BKE_mesh_legacy_convert_polys_to_offsets` assumes, as Blender's own writer guarantees, that the
 * loop ranges are contiguous and in order.
 *
 * `MLoop` carries `.v` **and** `.e`, so `.corner_edge` is authored here too and nothing is derived.
 */
function rawFromMPoly(meshData: any, skip: Skip): RawMesh | null {
    const polys: any[] = Array.isArray(meshData.mpoly) ? meshData.mpoly : (meshData.mpoly ? [meshData.mpoly] : [])
    const loops: any = meshData.mloop
    const verts: any = meshData.mvert
    if (!polys.length || !loops || !verts) return skip('MPoly layout is missing mvert/mloop/mpoly')

    const vertsNum = verts.length | 0
    const cornersNum = loops.length | 0
    const facesNum = polys.length
    if (vertsNum <= 0 || cornersNum <= 0 || cornersNum > MAX_ELEMENTS || facesNum > MAX_ELEMENTS) {
        return skip(`implausible element counts (v${vertsNum} f${facesNum} l${cornersNum})`)
    }

    const positions = new Float32Array(vertsNum * 3)
    for (let v = 0; v < vertsNum; v++) {
        const co = verts[v] && verts[v].co
        if (!co) return skip(`MVert ${v} has no co`)
        positions[v * 3] = co[0]
        positions[v * 3 + 1] = co[1]
        positions[v * 3 + 2] = co[2]
    }

    const cornerVerts = new Int32Array(cornersNum)
    const cornerEdges = new Int32Array(cornersNum)
    for (let c = 0; c < cornersNum; c++) {
        const l = loops[c]
        if (!l) return skip(`MLoop ${c} did not resolve`)
        cornerVerts[c] = l.v
        cornerEdges[c] = l.e
    }

    // Face offsets from `{loopstart, totloop}`. Any gap or reorder means this is not the contiguous
    // layout Blender writes, and a fabricated offsets array would silently mix up faces.
    const faceOffsets = new Int32Array(facesNum + 1)
    let running = 0
    for (let f = 0; f < facesNum; f++) {
        const p = polys[f]
        if (!p || p.loopstart !== running) return skip(`MPoly ${f} loopstart ${p && p.loopstart} breaks the contiguous run at ${running}`)
        faceOffsets[f] = running
        running += p.totloop | 0
    }
    if (running !== cornersNum) return skip(`MPoly loops sum to ${running}, but there are ${cornersNum} MLoops`)
    faceOffsets[facesNum] = running

    const layers: PendingLayer[] = []

    // Edges: `MEdge` is a struct array, not an int2 layer. `flag` packs seam/sharp/hide/select and the
    // crease/bevel-weight bytes are 0..255 scaled to 0..1 (`BKE_mesh_legacy_edge_crease_to_layers`).
    const edges: any = meshData.medge
    let edgeVerts: Int32Array | null = null
    const edgesNum = edges ? edges.length | 0 : 0
    if (edges && edgesNum > 0) {
        edgeVerts = new Int32Array(edgesNum * 2)
        const seam = new Uint8Array(edgesNum)
        const sharp = new Uint8Array(edgesNum)
        const hide = new Uint8Array(edgesNum)
        const select = new Uint8Array(edgesNum)
        const crease = new Float32Array(edgesNum)
        const bweight = new Float32Array(edgesNum)
        let anySeam = false, anySharp = false, anyHide = false, anySelect = false, anyCrease = false, anyBweight = false
        for (let e = 0; e < edgesNum; e++) {
            const me = edges[e]
            if (!me) return skip(`MEdge ${e} did not resolve`)
            edgeVerts[e * 2] = me.v1
            edgeVerts[e * 2 + 1] = me.v2
            const flag = me.flag | 0
            if (flag & ME_SEAM) { seam[e] = 1; anySeam = true }
            if (flag & ME_SHARP) { sharp[e] = 1; anySharp = true }
            if (flag & ME_HIDE) { hide[e] = 1; anyHide = true }
            if (flag & SELECT) { select[e] = 1; anySelect = true }
            const cr = me.crease | 0, bw = me.bweight | 0
            if (cr) { crease[e] = cr / 255 ; anyCrease = true }
            if (bw) { bweight[e] = bw / 255; anyBweight = true }
        }
        if (anySeam) layers.push({name: AttrName.uvSeam, domain: AttrDomain.Edge, type: 'bool', data: seam})
        if (anySharp) layers.push({name: AttrName.sharpEdge, domain: AttrDomain.Edge, type: 'bool', data: sharp})
        if (anyHide) layers.push({name: AttrName.hideEdge, domain: AttrDomain.Edge, type: 'bool', data: hide})
        if (anySelect) layers.push({name: AttrName.selectEdge, domain: AttrDomain.Edge, type: 'bool', data: select})
        if (anyCrease) layers.push({name: AttrName.creaseEdge, domain: AttrDomain.Edge, type: 'float', data: crease})
        if (anyBweight) layers.push({name: AttrName.bevelWeightEdge, domain: AttrDomain.Edge, type: 'float', data: bweight})
    }

    // Vertex flags. `MVert.bweight` is the legacy bevel weight, same 0..255 scaling.
    {
        const hide = new Uint8Array(vertsNum)
        const select = new Uint8Array(vertsNum)
        const bweight = new Float32Array(vertsNum)
        let anyHide = false, anySelect = false, anyBweight = false
        for (let v = 0; v < vertsNum; v++) {
            const flag = verts[v].flag | 0
            if (flag & ME_HIDE) { hide[v] = 1; anyHide = true }
            if (flag & SELECT) { select[v] = 1; anySelect = true }
            const bw = verts[v].bweight | 0
            if (bw) { bweight[v] = bw / 255; anyBweight = true }
        }
        if (anyHide) layers.push({name: AttrName.hideVert, domain: AttrDomain.Point, type: 'bool', data: hide})
        if (anySelect) layers.push({name: AttrName.selectVert, domain: AttrDomain.Point, type: 'bool', data: select})
        if (anyBweight) layers.push({name: AttrName.bevelWeightVert, domain: AttrDomain.Point, type: 'float', data: bweight})
    }

    // Face data: material slot, flat shading (the inverse of `ME_SMOOTH`, per
    // `mesh_legacy_convert.cc:1272`), hide and select.
    {
        const material = new Int32Array(facesNum)
        const sharpFace = new Uint8Array(facesNum)
        const hide = new Uint8Array(facesNum)
        const select = new Uint8Array(facesNum)
        let anyMaterial = false, anySharp = false, anyHide = false, anySelect = false
        for (let f = 0; f < facesNum; f++) {
            const p = polys[f]
            const mat = p.mat_nr | 0
            if (mat) { material[f] = mat; anyMaterial = true }
            const flag = p.flag | 0
            if (!(flag & ME_SMOOTH)) { sharpFace[f] = 1; anySharp = true }
            if (flag & ME_HIDE) { hide[f] = 1; anyHide = true }
            if (flag & (1 << 1)) { select[f] = 1; anySelect = true } // ME_FACE_SEL
        }
        if (anyMaterial) layers.push({name: AttrName.materialIndex, domain: AttrDomain.Face, type: 'int32', data: material})
        if (anySharp) layers.push({name: AttrName.sharpFace, domain: AttrDomain.Face, type: 'bool', data: sharpFace})
        if (anyHide) layers.push({name: AttrName.hideFace, domain: AttrDomain.Face, type: 'bool', data: hide})
        if (anySelect) layers.push({name: AttrName.selectFace, domain: AttrDomain.Face, type: 'bool', data: select})
    }

    // UV maps: `CD_MLOOPUV` is a struct (`MLoopUV { float uv[2]; int flag; }`), so it is read per
    // element rather than as a packed float2 block. Every UV map in the file is carried, under its own
    // Blender name, so the bake can pick one and an editor can see the rest.
    for (const layer of customDataLayers(meshData, 'ldata')) {
        if (layer.type !== CD_MLOOPUV) continue
        const data = layer.data
        if (!data || !data.length || data.length < cornersNum) continue
        const uv = new Float32Array(cornersNum * 2)
        for (let c = 0; c < cornersNum; c++) {
            const e = data[c] && data[c].uv
            if (!e) continue
            uv[c * 2] = e[0]
            uv[c * 2 + 1] = e[1]
        }
        layers.push({name: layer.name || 'UVMap', domain: AttrDomain.Corner, type: 'float2', data: uv})
    }

    collectCustomDataLayers(meshData, layers, vertsNum, edgesNum, facesNum, cornersNum)

    return {
        vertsNum, edgesNum, facesNum, cornersNum,
        positions, edgeVerts, cornerVerts, cornerEdges, faceOffsets,
        layers,
        materials: readMaterialSlots(meshData),
    }
}

// endregion

// region layout B: 3.6 - 4.x named CustomData layers

/**
 * The generic-attribute layout (Blender 3.6 - 4.x): topology lives in named `CustomData` layers
 * (`position`, `.edge_verts`, `.corner_vert`, `.corner_edge`) plus `Mesh.poly_offset_indices`.
 */
function rawFromCustomData(meshData: any, skip: Skip): RawMesh | null {
    const vertsNum = meshData.totvert | 0
    const edgesNum = meshData.totedge | 0
    const facesNum = meshData.totpoly | 0
    const cornersNum = meshData.totloop | 0
    if (vertsNum <= 0 || cornersNum <= 0 || facesNum <= 0) return skip(`empty mesh (v${vertsNum} f${facesNum} l${cornersNum})`)
    if (cornersNum > MAX_ELEMENTS || facesNum > MAX_ELEMENTS) return skip(`implausible element counts (f${facesNum} l${cornersNum})`)

    const positions = readLayerArray(findCdLayer(meshData, 'vdata', 'position', CD_PROP_FLOAT3), Float32Array, vertsNum * 3)
    const cornerVerts = readLayerArray(findCdLayer(meshData, 'ldata', '.corner_vert', CD_PROP_INT32), Int32Array, cornersNum)
    if (!positions) return skip("no readable 'position' layer")
    if (!cornerVerts) return skip("no readable '.corner_vert' layer")

    const poi = meshData.poly_offset_indices
    if (!poi || poi.__data_address__ === undefined || !poi.__blender_file__) return skip('no poly_offset_indices block')
    if ((poi.__byte_length__ | 0) < (facesNum + 1) * 4) {
        return skip(`poly_offset_indices is ${poi.__byte_length__} bytes, need ${(facesNum + 1) * 4} for ${facesNum} faces`)
    }
    const faceOffsets = poi.__blender_file__.readTypedArray(Int32Array, poi.__data_address__, facesNum + 1)

    const edgeVerts = edgesNum > 0
        ? readLayerArray(findCdLayer(meshData, 'edata', '.edge_verts', CD_PROP_INT32_2D), Int32Array, edgesNum * 2)
        : null
    const cornerEdges = readLayerArray(findCdLayer(meshData, 'ldata', '.corner_edge', CD_PROP_INT32), Int32Array, cornersNum)

    const layers: PendingLayer[] = []
    collectCustomDataLayers(meshData, layers, vertsNum, edgesNum, facesNum, cornersNum)

    return {
        vertsNum, edgesNum, facesNum, cornersNum,
        positions, edgeVerts, cornerVerts, cornerEdges, faceOffsets,
        layers,
        materials: readMaterialSlots(meshData),
    }
}

/**
 * Carry every named `CD_PROP_*` layer across, on all four domains: UV maps, colours, `material_index`,
 * `sharp_face`, `sharp_edge`, `uv_seam`, creases, bevel weights, selection and hide flags, and any
 * user attribute. Topology layers are skipped - they are read explicitly above.
 *
 * Unnamed legacy layers are handled by type: `CD_CREASE` and `CD_BWEIGHT` are the pre-4.0 storage for
 * the crease and bevel weight that 4.0 moved to named `CD_PROP_FLOAT` layers
 * (`BKE_mesh_legacy_crease_to_generic`), and they still appear in 3.x files.
 */
function collectCustomDataLayers(
    meshData: any, out: PendingLayer[],
    vertsNum: number, edgesNum: number, facesNum: number, cornersNum: number,
): void {
    const domains: [string, AttrDomain, number][] = [
        ['vdata', AttrDomain.Point, vertsNum],
        ['edata', AttrDomain.Edge, edgesNum],
        ['pdata', AttrDomain.Face, facesNum],
        ['ldata', AttrDomain.Corner, cornersNum],
    ]
    for (const [cdName, domain, count] of domains) {
        if (count <= 0) continue
        for (const layer of customDataLayers(meshData, cdName)) {
            const rawName: string = layer.name || ''
            // Legacy unnamed crease / bevel-weight layers, which 4.0 renamed rather than restructured.
            let name = rawName
            if (!name) {
                if (layer.type === CD_CREASE) name = domain === AttrDomain.Edge ? AttrName.creaseEdge : AttrName.creaseVert
                else if (layer.type === CD_BWEIGHT) name = domain === AttrDomain.Edge ? AttrName.bevelWeightEdge : AttrName.bevelWeightVert
                else continue
            }
            const type = cdPropType(layer.type === CD_CREASE || layer.type === CD_BWEIGHT ? CD_PROP_FLOAT : layer.type)
            if (!type) continue
            name = RENAMED_ATTRS[name] ?? name
            if (SKIPPED_ATTRS.has(name)) continue
            if (name === AttrName.position || name === AttrName.edgeVerts ||
                name === AttrName.cornerVert || name === AttrName.cornerEdge) continue
            if (out.some(l => l.name === name)) continue // first layer of a duplicated name wins
            const {ctor, components} = TYPE_READ[type]
            const data = readLayerArray(layer, ctor, count * components)
            if (!data) continue
            out.push({name, domain, type, data})
        }
    }
}

// endregion

// region layout C: 5.0 attribute_storage

/**
 * The 5.0 layout. The names are the same as 3.6-4.x; only the container changed. Element counts come
 * from the stored array sizes rather than `Mesh.tot*`, which became runtime values there.
 */
function rawFromAttributeStorage(meshData: any, skip: Skip): RawMesh | null {
    const attrs = attributeStorageRecords(meshData)
    if (!attrs.length) return skip('attribute_storage has no resolved attributes')

    const named = new Map<string, any>()
    for (const a of attrs) {
        const n = readCString(a.name)
        if (n && !named.has(n)) named.set(n, a)
    }

    const posAttr = named.get(AttrName.position)
    const cvAttr = named.get(AttrName.cornerVert)
    if (!posAttr || posAttr.data_type !== AT_FLOAT3) return skip("attribute_storage has no float3 'position'")
    if (!cvAttr || cvAttr.data_type !== AT_INT32) return skip("attribute_storage has no int32 '.corner_vert'")

    const vertsNum = attrSize(posAttr)
    const cornersNum = attrSize(cvAttr)
    if (vertsNum <= 0 || cornersNum <= 0 || cornersNum > MAX_ELEMENTS) return skip(`implausible stored sizes (v${vertsNum} l${cornersNum})`)

    const poi = meshData.poly_offset_indices
    if (!poi || poi.__data_address__ === undefined || !poi.__blender_file__) return skip('no poly_offset_indices block')
    const offsetsNum = (poi.__byte_length__ | 0) >> 2
    if (offsetsNum < 2 || offsetsNum - 1 > MAX_ELEMENTS) return skip(`poly_offset_indices holds ${offsetsNum} entries`)
    const facesNum = offsetsNum - 1
    const faceOffsets = poi.__blender_file__.readTypedArray(Int32Array, poi.__data_address__, offsetsNum)

    const positions = readAttrArray(posAttr, Float32Array, vertsNum * 3)
    const cornerVerts = readAttrArray(cvAttr, Int32Array, cornersNum)
    if (!positions || !cornerVerts) return skip('position/.corner_vert data blocks did not resolve')

    const evAttr = named.get(AttrName.edgeVerts)
    const edgesNum = evAttr && evAttr.data_type === AT_INT32_2D ? attrSize(evAttr) : 0
    const edgeVerts = edgesNum > 0 ? readAttrArray(evAttr, Int32Array, edgesNum * 2) : null

    const ceAttr = named.get(AttrName.cornerEdge)
    const cornerEdges = ceAttr && ceAttr.data_type === AT_INT32 && attrSize(ceAttr) >= cornersNum
        ? readAttrArray(ceAttr, Int32Array, cornersNum)
        : null

    const domainCount = [vertsNum, edgesNum, facesNum, cornersNum]
    const layers: PendingLayer[] = []
    for (const a of attrs) {
        const rawName = readCString(a.name)
        if (!rawName) continue
        const name = RENAMED_ATTRS[rawName] ?? rawName
        if (SKIPPED_ATTRS.has(name)) continue
        if (name === AttrName.position || name === AttrName.edgeVerts ||
            name === AttrName.cornerVert || name === AttrName.cornerEdge) continue
        const domain = a.domain | 0
        if (domain < DOMAIN_POINT || domain > DOMAIN_CORNER) continue
        const count = domainCount[domain]
        if (count <= 0) continue
        if (attrSize(a) < count) continue
        const type = attrPropType(a.data_type | 0)
        if (!type) continue
        if (layers.some(l => l.name === name)) continue
        const {ctor, components} = TYPE_READ[type]
        const data = readAttrArray(a, ctor, count * components)
        if (!data) continue
        layers.push({name, domain: domain as AttrDomain, type, data})
    }

    return {
        vertsNum, edgesNum, facesNum, cornersNum,
        positions, edgeVerts, cornerVerts, cornerEdges, faceOffsets,
        layers,
        materials: readMaterialSlots(meshData),
    }
}

// endregion

/**
 * Material slot names, in slot order. `material_index` refers into this, and the kernel's bake only
 * emits geometry groups when there is more than one slot - the same rule the old importer used.
 * An empty slot keeps its place so the indices stay right.
 */
function readMaterialSlots(meshData: any): string[] {
    const totcol = meshData.totcol | 0
    if (totcol <= 0) return []
    const mat = meshData.mat
    const slots: any[] = Array.isArray(mat) ? mat : (mat ? [mat] : [])
    const out: string[] = new Array(totcol)
    for (let i = 0; i < totcol; i++) {
        const m = slots[i]
        const name = m && m.id && typeof m.id.name === 'string' ? m.id.name.slice(2) : ''
        out[i] = name
    }
    return out
}

/**
 * Assemble a {@link MeshData} from a decoded {@link RawMesh}, converting Z-up to Y-up and filling
 * `.corner_edge` from whatever the file authored.
 *
 * Returns null - rather than throwing or repairing - when the result is not well formed. `.blend`
 * files in the wild do contain NaN positions, out-of-range corner indices and zero-corner faces (a
 * geometry-nodes evaluation left half-written, most often), and the caller falls back to the older,
 * more forgiving decoding path for those rather than losing the mesh entirely.
 */
function buildMeshData(raw: RawMesh, name: string, skip: Skip): MeshData | null {
    const {vertsNum, edgesNum, facesNum, cornersNum} = raw

    // Faces must all be real n-gons and the offsets contiguous; `MeshData.validate` would reject the
    // rest anyway, but checking first keeps the failure cheap on a large broken mesh.
    if (raw.faceOffsets[0] !== 0 || raw.faceOffsets[facesNum] !== cornersNum) {
        return skip(`face offsets run ${raw.faceOffsets[0]}..${raw.faceOffsets[facesNum]}, expected 0..${cornersNum}`)
    }
    for (let f = 0; f < facesNum; f++) {
        if (raw.faceOffsets[f + 1] - raw.faceOffsets[f] < 3) {
            return skip(`face ${f} has ${raw.faceOffsets[f + 1] - raw.faceOffsets[f]} corners`)
        }
    }
    if (!raw.edgeVerts || edgesNum <= 0) return skip('no edge domain')

    const mesh = new MeshData()
    mesh.resize({verts: vertsNum, edges: edgesNum, faces: facesNum, corners: cornersNum})

    // Blender Z-up (x, y, z) -> three Y-up (x, z, -y). Non-finite components are rejected rather than
    // sanitised to 0: a NaN vertex silently snapped to the origin produces a spike through the model,
    // and the legacy path's sanitising behaviour is still there as the fallback.
    const positions = mesh.positions
    for (let v = 0; v < vertsNum; v++) {
        const x = raw.positions[v * 3], y = raw.positions[v * 3 + 1], z = raw.positions[v * 3 + 2]
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return skip(`vertex ${v} is not finite`)
        positions[v * 3] = x
        positions[v * 3 + 1] = z
        positions[v * 3 + 2] = -y
    }

    const edgeVerts = mesh.edgeVerts
    for (let i = 0; i < edgesNum * 2; i++) edgeVerts[i] = raw.edgeVerts[i]
    const cornerVerts = mesh.cornerVerts
    for (let c = 0; c < cornersNum; c++) cornerVerts[c] = raw.cornerVerts[c]
    mesh.faceOffsets.set(raw.faceOffsets as never)

    for (const layer of raw.layers) {
        if (mesh.attributes.has(layer.name)) continue
        try {
            mesh.attributes.add({name: layer.name, domain: layer.domain, type: layer.type, data: layer.data})
        } catch (e) {
            // A built-in name carrying the wrong shape, or data of the wrong length. Neither is worth
            // failing the whole mesh for - the attribute is dropped and the topology survives.
            console.warn(`BlendLoader - "${name}": skipping attribute '${layer.name}':`, (e as Error).message)
        }
    }

    // `.corner_edge`: Blender authors it, so prefer what it wrote. `calculateCornerEdges` looks the
    // edges up in the authored edge domain and is used only when the layer is missing (never
    // `calculateEdges`, which replaces the edge domain and takes `sharp_edge`, `uv_seam` and the
    // creases down with it).
    const cornerEdges = mesh.cornerEdges
    let authored = false
    if (raw.cornerEdges) {
        authored = true
        for (let c = 0; c < cornersNum; c++) {
            const e = raw.cornerEdges[c]
            if (e < 0 || e >= edgesNum) { authored = false; break }
            cornerEdges[c] = e
        }
    }
    if (!authored) {
        try {
            mesh.calculateCornerEdges()
        } catch (e) {
            return skip(`could not map corners to the authored edges: ${(e as Error).message}`)
        }
    }

    mesh.materials = raw.materials

    if (mesh.validate().length) {
        // The authored `.corner_edge` can disagree with the authored edges in a file Blender itself
        // would repair on load. Re-derive once against the same edge domain before giving up, so a
        // stale corner-edge layer costs the mapping rather than the mesh.
        if (authored) {
            try {
                mesh.calculateCornerEdges()
            } catch (e) {
                return skip(`could not map corners to the authored edges: ${(e as Error).message}`)
            }
            if (!mesh.validate().length) return mesh
        }
        return skip(mesh.validate()[0])
    }
    return mesh
}

/**
 * Decode a Blender `Mesh` datablock into an editable {@link MeshData}, n-gons intact.
 *
 * Returns null when the datablock uses a layout this cannot read, or decodes to something malformed;
 * `loader/geometry.ts` then falls back to its older per-layout decoding, so a file that loaded before
 * still loads.
 */
export function createMeshData(meshData: any, onSkip?: MeshDataSkipReporter): MeshData | null {
    if (!meshData) return null
    const name = typeof meshData.aname === 'string' ? meshData.aname : ''
    // Every early return goes through this, so a mesh that falls back always says why. `null` is the
    // return value in each case; the cast keeps the call sites to one line.
    const skip: Skip = (reason: string) => {
        onSkip?.(reason)
        return null
    }
    let raw: RawMesh | null = null
    try {
        if (meshData.mpoly) raw = rawFromMPoly(meshData, skip)
        else if (meshData.attribute_storage) raw = rawFromAttributeStorage(meshData, skip)
        else raw = rawFromCustomData(meshData, skip)
    } catch (e) {
        return skip(`decode threw: ${(e as Error).message}`)
    }
    if (!raw) return null
    try {
        return buildMeshData(raw, name, skip)
    } catch (e) {
        return skip(`assembly threw: ${(e as Error).message}`)
    }
}
