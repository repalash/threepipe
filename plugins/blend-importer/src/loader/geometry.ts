import {bakeGeometry, geometryDataToBufferGeometry, MeshData} from '@threepipe/mesh-kernel'
import {Ctx} from './ctx'
import {buildGeometry, MeshSource, withEmptyPosition} from './meshBuilder'
import {createMeshData, MESH_DATA_KEY} from './meshData'

// Every datablock the n-gon path (`meshData.ts`) can transcribe becomes a kernel `MeshData`, baked by
// the kernel with Blender's normal rules (see `bakeMeshData`). The rest - mis-resolved or half-written
// geometry - fall back to reading the datablock into a {@link MeshSource} and building it with
// `buildGeometry`, which does triangulation and normals the way Blender does. Blender has stored meshes in four layouts:
//   - MFace (< 2.63): one struct per tri/quad face.                          -> sourceFromMFace
//   - MVert/MEdge/MPoly/MLoop (2.63 - 3.6; 3.x still writes these for compat) -> sourceFromMPoly
//   - CustomData layers + poly_offset_indices (4.0 - 4.5)                    -> sourceFromLayers
//   - attribute_storage (5.0+, file format version 1)                        -> sourceFromAttributes
// https://projects.blender.org/blender/blender/pulls/108015/files
// https://developer.blender.org/docs/release_notes/4.0/python_api/#breaking-changes
// https://developer.blender.org/docs/release_notes/4.1/modeling/#auto-smooth

/** Options that come from the object rather than the mesh. */
export interface GeometryOptions {
    /**
     * Angle of a "Smooth by Angle" (Auto Smooth) modifier on the object, in radians. Blender 4.1+ only;
     * older files keep Auto Smooth on the mesh (`Mesh.flag`/`smoothresh`).
     */
    smoothByAngle?: number | null
    /** The modifier's "Ignore Sharpness" option: sharp edges and flat faces become smooth too. */
    ignoreSharpness?: boolean
}

// DNA_mesh_types.h / DNA_meshdata_types.h
const ME_AUTOSMOOTH = 1 << 5 // Mesh.flag, < 4.1
const ME_SMOOTH = 1 << 0 // MPoly.flag / MFace.flag
const ME_SHARP = 1 << 9 // MEdge.flag

const asArray = (v: any): any[] => v === undefined || v === null ? [] : Array.isArray(v) ? v : typeof v.length === 'number' && typeof v !== 'string' && !v.blender_name ? Array.from(v) : [v]
const finite = (x: any) => typeof x === 'number' && Number.isFinite(x) ? x : 0

/** Blender version of the file the struct was read from, e.g. 300 for 3.0, 405 for 4.5, 500 for 5.0. */
function fileVersion(block: any): number {
    const v = parseInt(block?.__blender_file__?.template?.version, 10)
    return Number.isFinite(v) ? v : 0
}

// Normal rules from the mesh's own Auto Smooth setting (files before 4.1).
function legacyNormalMode(meshData: any): Pick<MeshSource, 'normalMode' | 'autoSmoothAngle'> {
    if ((meshData.flag || 0) & ME_AUTOSMOOTH) {
        const a = typeof meshData.smoothresh === 'number' ? meshData.smoothresh : meshData.smoothresh_legacy
        return {normalMode: 'split', autoSmoothAngle: typeof a === 'number' && Number.isFinite(a) ? a : Math.PI / 6}
    }
    return {normalMode: 'vertex', autoSmoothAngle: null}
}
function normalModeFor(meshData: any, opts: GeometryOptions): Pick<MeshSource, 'normalMode' | 'autoSmoothAngle'> {
    if (fileVersion(meshData) < 401) return legacyNormalMode(meshData)
    return {normalMode: 'split', autoSmoothAngle: opts.smoothByAngle ?? null}
}

// Raw TypedArray over a pointed-to DATA block (whole block), alignment-safe.
function rawBlock(d: any, arrayType: any): any {
    const b = Array.isArray(d) ? d[0] : d
    if (!b || b.__data_address__ === undefined || !b.__blender_file__) return null
    // The parser gives an array block's first element the whole block's length (later elements get their
    // own); count x element size covers the block too, should that ever change.
    const bytes = Math.max(b.__byte_length__ || 0, Array.isArray(d) ? d.length * (b._length || 0) : 0)
    const n = Math.floor(bytes / arrayType.BYTES_PER_ELEMENT)
    if (!(n > 0)) return null
    return b.__blender_file__.readTypedArray(arrayType, b.__data_address__, n)
}

function sanitize(a: Float32Array): Float32Array {
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) a[i] = 0
    return a
}

// ── Legacy MPoly/MLoop (2.63 - 3.x) ─────────────────────────────────
function sourceFromMPoly(meshData: any): MeshSource {
    const verts = asArray(meshData.mvert)
    const loops = asArray(meshData.mloop)
    const polys = asArray(meshData.mpoly)
    const edges = asArray(meshData.medge)
    const uvs = asArray(meshData.mloopuv)

    const vertCount = verts.length
    const positions = new Float32Array(vertCount * 3)
    for (let i = 0; i < vertCount; i++) {
        const co = verts[i]?.co
        if (co) { positions[i * 3] = finite(co[0]); positions[i * 3 + 1] = finite(co[1]); positions[i * 3 + 2] = finite(co[2]) }
    }

    const faceCount = polys.length
    const faceOffsets = new Int32Array(faceCount + 1)
    let loopCount = 0
    for (let f = 0; f < faceCount; f++) { faceOffsets[f] = loopCount; loopCount += Math.max(0, polys[f].totloop | 0) }
    faceOffsets[faceCount] = loopCount
    const cornerVerts = new Int32Array(loopCount).fill(-1)
    const cornerUVs = uvs.length ? new Float32Array(loopCount * 2) : null
    const faceMat = new Int32Array(faceCount)
    const faceFlat = new Uint8Array(faceCount)
    for (let f = 0; f < faceCount; f++) {
        const p = polys[f], ls = p.loopstart | 0, o = faceOffsets[f], n = faceOffsets[f + 1] - o
        faceMat[f] = p.mat_nr || 0
        faceFlat[f] = p.flag & ME_SMOOTH ? 0 : 1
        for (let k = 0; k < n; k++) {
            const l = loops[ls + k]
            cornerVerts[o + k] = l ? l.v : -1
            const uv = cornerUVs && uvs[ls + k]?.uv
            if (uv) { cornerUVs![(o + k) * 2] = finite(uv[0]); cornerUVs![(o + k) * 2 + 1] = finite(uv[1]) }
        }
    }

    const sharp: number[] = []
    for (const e of edges) if (e && e.flag & ME_SHARP) sharp.push(e.v1, e.v2)

    return {
        positions, vertCount, faceOffsets, faceCount, cornerVerts, cornerUVs, faceMat, faceFlat,
        materialSlots: meshData.totcol || 0, sharpEdges: sharp, ...legacyNormalMode(meshData),
    }
}

// ── Legacy MFace (< 2.63): tris and quads only, no loops ────────────
function sourceFromMFace(meshData: any): MeshSource {
    const verts = asArray(meshData.mvert)
    const faces = asArray(meshData.mface)
    const tfaces = asArray(meshData.mtface)
    const edges = asArray(meshData.medge)
    const vertCount = verts.length
    const positions = new Float32Array(vertCount * 3)
    for (let i = 0; i < vertCount; i++) {
        const co = verts[i]?.co
        if (co) { positions[i * 3] = finite(co[0]); positions[i * 3 + 1] = finite(co[1]); positions[i * 3 + 2] = finite(co[2]) }
    }
    const faceCount = faces.length
    const faceOffsets = new Int32Array(faceCount + 1)
    const cv: number[] = [], uv: number[] = []
    const faceMat = new Int32Array(faceCount), faceFlat = new Uint8Array(faceCount)
    const hasUv = tfaces.length >= faceCount && faceCount > 0
    for (let f = 0; f < faceCount; f++) {
        const fa = faces[f]
        faceOffsets[f] = cv.length
        // A quad is stored with v4 != 0 (Blender rotates the indices so that v4 is never 0 on a quad).
        const ids = fa.v4 ? [fa.v1, fa.v2, fa.v3, fa.v4] : [fa.v1, fa.v2, fa.v3]
        cv.push(...ids)
        if (hasUv) {
            const t = tfaces[f]?.uv
            for (let k = 0; k < ids.length; k++) {
                const c = Array.isArray(t?.[k]) ? t[k] : t ? [t[k * 2], t[k * 2 + 1]] : [0, 0]
                uv.push(finite(c?.[0]), finite(c?.[1]))
            }
        }
        faceMat[f] = fa.mat_nr || 0
        faceFlat[f] = fa.flag & ME_SMOOTH ? 0 : 1
    }
    faceOffsets[faceCount] = cv.length
    const sharp: number[] = []
    for (const e of edges) if (e && e.flag & ME_SHARP) sharp.push(e.v1, e.v2)
    return {
        positions, vertCount, faceOffsets, faceCount, cornerVerts: new Int32Array(cv), cornerUVs: hasUv ? new Float32Array(uv) : null,
        faceMat, faceFlat, materialSlots: meshData.totcol || 0, sharpEdges: sharp, ...legacyNormalMode(meshData),
    }
}

// ── CustomData layers (4.0 - 4.5) ───────────────────────────────────
// CustomDataLayer.type values (DNA_customdata_types.h)
const CD_PROP_INT32 = 11, CD_PROP_FLOAT3 = 48, CD_PROP_FLOAT2 = 49, CD_PROP_BOOL = 50, CD_PROP_INT32_2D = 52

function layersOf(cd: any): any[] {
    if (!cd || !cd.layers || !cd.totlayer) return []
    const ls = asArray(cd.layers)
    return ls.slice(0, cd.totlayer).filter(Boolean)
}
// A named (or, failing that, the first matching-type) layer's raw values, if it holds at least `need` numbers.
function layerArray(layers: any[], name: string | null, type: number, arrayType: any, need: number, fallback?: (l: any) => boolean): any {
    const pick = (pred: (l: any) => boolean) => {
        for (const l of layers) {
            if (!pred(l)) continue
            const a = rawBlock(l.data, arrayType)
            if (a && a.length >= need) return a.length === need ? a : a.subarray(0, need)
        }
        return null
    }
    return (name !== null ? pick(l => l.name === name && (l.type === type || l.type === undefined)) : null)
        ?? (fallback ? pick(fallback) : null)
}

function sourceFromLayers(meshData: any, opts: GeometryOptions): MeshSource | null {
    const vertCount = meshData.totvert | 0, loopCount = meshData.totloop | 0, faceCount = meshData.totpoly | 0
    const edgeCount = meshData.totedge | 0
    if (!(vertCount > 0 && loopCount > 0 && faceCount > 0)) return null
    const vl = layersOf(meshData.vdata), ll = layersOf(meshData.ldata), pl = layersOf(meshData.pdata), el = layersOf(meshData.edata)

    const pos = layerArray(vl, 'position', CD_PROP_FLOAT3, Float32Array, vertCount * 3, l => l.type === CD_PROP_FLOAT3)
    const cornerVerts = layerArray(ll, '.corner_vert', CD_PROP_INT32, Int32Array, loopCount)
    const poi = meshData.poly_offset_indices
    const faceOffsets = poi && poi.__blender_file__ ? poi.__blender_file__.readTypedArray(Int32Array, poi.__data_address__, faceCount + 1) : null
    if (!pos || !cornerVerts || !faceOffsets) return null

    // UV map: a Float2 corner layer, user-named (not dot-prefixed like `.corner_vert`/`.pn`/`.vs.*`).
    const cornerUVs = layerArray(ll, null, CD_PROP_FLOAT2, Float32Array, loopCount * 2,
        l => l.type === CD_PROP_FLOAT2 && typeof l.name === 'string' && l.name[0] !== '.')
    const faceMat = (meshData.totcol || 0) > 1 ? layerArray(pl, 'material_index', CD_PROP_INT32, Int32Array, faceCount) : null
    let faceFlat = layerArray(pl, 'sharp_face', CD_PROP_BOOL, Uint8Array, faceCount)

    let sharpEdges: Int32Array | null = null
    const sharp = layerArray(el, 'sharp_edge', CD_PROP_BOOL, Uint8Array, edgeCount)
    const edgeVerts = sharp ? layerArray(el, '.edge_verts', CD_PROP_INT32_2D, Int32Array, edgeCount * 2) : null
    if (sharp && edgeVerts && !opts.ignoreSharpness) {
        const out: number[] = []
        for (let e = 0; e < edgeCount; e++) if (sharp[e]) out.push(edgeVerts[e * 2], edgeVerts[e * 2 + 1])
        sharpEdges = new Int32Array(out)
    }
    if (opts.ignoreSharpness) faceFlat = null

    return {
        positions: sanitize(Float32Array.from(pos)), vertCount, faceOffsets, faceCount, cornerVerts, cornerUVs, faceMat, faceFlat,
        materialSlots: meshData.totcol || 0, sharpEdges, ...normalModeFor(meshData, opts),
    }
}

// ── attribute_storage (5.0+) ────────────────────────────────────────
// struct AttributeStorage { Attribute *dna_attributes; int dna_attributes_num; ... }
// struct Attribute { char *name; int16 data_type; int8 domain; int8 storage_type; void *data; }
// storage_type Array (0): data -> AttributeArray { void *data; ...; int64 size; }
// storage_type Single (1): data -> AttributeSingle { void *data; } holding one value for every element.
// See DNA_attribute_types.h and BKE_attribute_enums.hh.
const ATTR_BOOL = 0, ATTR_INT32 = 3, ATTR_INT32_2D = 4, ATTR_FLOAT2 = 6, ATTR_FLOAT3 = 7 // bke::AttrType
const DOMAIN_EDGE = 1, DOMAIN_FACE = 2, DOMAIN_CORNER = 3 // bke::AttrDomain (Point = 0)
const STORAGE_SINGLE = 1

// Read a NUL-terminated C string from a resolved pointer block (e.g. an Attribute.name char*).
function readCString(block: any): string | null {
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    const u8 = block.__blender_file__.byte
    let s = '', o = block.__data_address__
    while (o < u8.length && u8[o] !== 0 && s.length < 256) s += String.fromCharCode(u8[o++])
    return s
}
function getAttributes(meshData: any): {name: string, attr: any}[] {
    const attrs = asArray(meshData.attribute_storage?.dna_attributes)
    return attrs.map(a => ({name: readCString(a.name) || '', attr: a}))
}
// Number of stored elements (AttributeArray.size). In 5.0 the Mesh tot* fields are runtime
// (post-geometry-nodes) counts and don't match the stored arrays, so this is authoritative.
function attrSize(attr: any): number {
    const n = attr?.data?.size !== undefined ? Number(attr.data.size) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
}
// An attribute's values for `count` elements of `comps` numbers each, or null.
function readAttr(attrs: {name: string, attr: any}[], pred: (name: string, a: any) => boolean, arrayType: any, comps: number, count: number): any {
    const e = attrs.find(x => pred(x.name, x.attr))
    if (!e) return null
    const a = e.attr, block = a.data?.data
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    const bf = block.__blender_file__
    if (a.storage_type === STORAGE_SINGLE) {
        const one = bf.readTypedArray(arrayType, block.__data_address__, comps)
        const out = new arrayType(count * comps)
        for (let i = 0; i < count; i++) out.set(one, i * comps)
        return out
    }
    if (attrSize(a) < count) return null
    return bf.readTypedArray(arrayType, block.__data_address__, count * comps)
}

function sourceFromAttributes(meshData: any, opts: GeometryOptions): MeshSource | null {
    const attrs = getAttributes(meshData)
    if (!attrs.length) return null
    const posE = attrs.find(x => x.name === 'position' && x.attr.data_type === ATTR_FLOAT3)
    const vertCount = posE ? attrSize(posE.attr) : 0
    const pos = vertCount > 0 && readAttr(attrs, (n, a) => n === 'position' && a.data_type === ATTR_FLOAT3, Float32Array, 3, vertCount)
    if (!pos) return null

    // Faces: .corner_vert + poly_offset_indices. Counts come from the stored arrays (corner_vert size and
    // the poly_offset_indices block length), not Mesh.totloop/totpoly, which are runtime counts.
    const cvE = attrs.find(x => x.name === '.corner_vert' && x.attr.data_type === ATTR_INT32)
    const loopCount = cvE ? attrSize(cvE.attr) : 0
    const cornerVerts = loopCount > 0 && readAttr(attrs, n => n === '.corner_vert', Int32Array, 1, loopCount)
    const poi = meshData.poly_offset_indices
    const offsetsCount = poi && poi.__byte_length__ ? poi.__byte_length__ >> 2 : 0
    if (!cornerVerts || offsetsCount < 2) {
        return {positions: sanitize(Float32Array.from(pos)), vertCount, faceOffsets: [0], faceCount: 0, cornerVerts: [], materialSlots: 0, normalMode: 'split'}
    }
    const faceOffsets = poi.__blender_file__.readTypedArray(Int32Array, poi.__data_address__, offsetsCount)
    const faceCount = offsetsCount - 1

    const edgeE = attrs.find(x => x.name === '.edge_verts' && x.attr.data_type === ATTR_INT32_2D)
    const edgeCount = edgeE ? attrSize(edgeE.attr) : 0

    // The first user UV map: a Float2 corner attribute that isn't dot-prefixed (`.uv_select_*` etc).
    const cornerUVs = readAttr(attrs, (n, a) => a.data_type === ATTR_FLOAT2 && a.domain === DOMAIN_CORNER && !!n && !n.startsWith('.'), Float32Array, 2, loopCount)
    const faceMat = (meshData.totcol || 0) > 1 ? readAttr(attrs, (n, a) => n === 'material_index' && a.data_type === ATTR_INT32 && a.domain === DOMAIN_FACE, Int32Array, 1, faceCount) : null
    const faceFlat = opts.ignoreSharpness ? null : readAttr(attrs, (n, a) => n === 'sharp_face' && a.data_type === ATTR_BOOL && a.domain === DOMAIN_FACE, Uint8Array, 1, faceCount)
    let sharpEdges: Int32Array | null = null
    if (edgeCount > 0 && !opts.ignoreSharpness) {
        const sharp = readAttr(attrs, (n, a) => n === 'sharp_edge' && a.data_type === ATTR_BOOL && a.domain === DOMAIN_EDGE, Uint8Array, 1, edgeCount)
        const ev = sharp && readAttr(attrs, n => n === '.edge_verts', Int32Array, 2, edgeCount)
        if (sharp && ev) {
            const out: number[] = []
            for (let e = 0; e < edgeCount; e++) if (sharp[e]) out.push(ev[e * 2], ev[e * 2 + 1])
            sharpEdges = new Int32Array(out)
        }
    }
    return {
        positions: sanitize(Float32Array.from(pos)), vertCount, faceOffsets, faceCount, cornerVerts, cornerUVs, faceMat, faceFlat,
        materialSlots: meshData.totcol || 0, sharpEdges, normalMode: 'split', autoSmoothAngle: opts.smoothByAngle ?? null,
    }
}

/**
 * The polygon cage the Subsurf modifier subdivides (`catmull.ts`) when there is no `MeshData`, i.e. on
 * the fallback path: shared positions in three.js space,
 * the faces as vertex lists, per-corner UVs and per-face material slots. Same faces as the triangulated
 * geometry, so Catmull-Clark smooths across them instead of across disconnected triangles.
 */
function attachCage(geometry: any, src: MeshSource) {
    const {positions: p, cornerVerts: cv, faceOffsets: fo, faceCount, vertCount} = src
    const positions: number[][] = new Array(vertCount)
    for (let i = 0; i < vertCount; i++) positions[i] = [p[i * 3], p[i * 3 + 2], -p[i * 3 + 1]] // Z-up -> Y-up
    const uv = src.cornerUVs && src.cornerUVs.length >= cv.length * 2 ? src.cornerUVs : null
    const useMats = src.materialSlots > 1 && !!src.faceMat
    const faces: number[][] = [], uvs: number[][][] | null = uv ? [] : null, mats: number[] | null = useMats ? [] : null
    for (let f = 0; f < faceCount; f++) {
        const face: number[] = [], fuv: number[][] = []
        for (let c = fo[f]; c < fo[f + 1]; c++) {
            const v = cv[c]
            if (!(v >= 0 && v < vertCount)) continue
            face.push(v)
            if (uv) fuv.push([uv[c * 2], uv[c * 2 + 1]])
        }
        if (face.length < 3) continue
        faces.push(face)
        if (uvs) uvs.push(fuv)
        if (mats) mats.push(src.faceMat![f] || 0)
    }
    if (!faces.length) return
    geometry.userData = geometry.userData || {}
    geometry.userData.__cage = {positions, faces, uvs, materialIndices: mats}
}

function build(src: MeshSource | null, name: string, ctx: Ctx) {
    if (!src) return withEmptyPosition(new ctx.BufferGeometry(), ctx)
    const geometry = buildGeometry(src, name, ctx)
    attachCage(geometry, src)
    return geometry
}

/**
 * Bake an n-gon {@link MeshData} into a renderable `BufferGeometry`, and leave the mesh itself on the
 * geometry's `userData` so it stays editable.
 *
 * The bake is corner-indexed (one output vertex per face corner) and ear-clips concave n-gons, which
 * is what Blender's own draw path does. Normals follow the file's rules: before 4.1 the mesh's own
 * Auto Smooth setting (off: smooth vertex normals, sharp edges ignored; on: split at sharp edges and
 * above `smoothresh`), from 4.1 sharp edges always split and the angle comes from the object's Smooth
 * by Angle modifier.
 */
function bakeMeshData(mesh: MeshData, meshData: any, name: string, ctx: Ctx, opts: GeometryOptions): any {
    const rules = normalModeFor(meshData, opts)
    const baked = bakeGeometry(mesh, {
        includeNormals: true,
        vertexNormals: rules.normalMode === 'vertex',
        autoSmoothAngle: rules.autoSmoothAngle ?? null,
        ignoreSharp: !!opts.ignoreSharpness,
    })
    const geometry = geometryDataToBufferGeometry<any>(baked.data, ctx)
    geometry.name = name
    geometry.userData = geometry.userData || {}
    // Double-underscored so threepipe's serialiser leaves it alone: `MeshData` is a class, and a
    // half-JSONified copy in glTF `primitive.extras` would be worse than none. Binary persistence is
    // a glTF extension of its own (see issues/open/modelling-tools/00-synthesis.md 3.3).
    geometry.userData[MESH_DATA_KEY] = mesh
    return geometry
}

/**
 * How many times one parsed file may complain about a datablock it could not decode as n-gons, before
 * it stops. A geometry-nodes scene can hold hundreds of affected meshes and the console is not the
 * place to list them all; the count is reported at the cut-off so nothing is hidden.
 */
const MAX_FALLBACK_WARNINGS = 8
const fallbackWarnings = new WeakMap<object, number>()

function warnFallback(meshData: any, name: string, reason: string) {
    const file = meshData.__blender_file__
    if (!file) return
    const seen = (fallbackWarnings.get(file) ?? 0) + 1
    fallbackWarnings.set(file, seen)
    if (seen > MAX_FALLBACK_WARNINGS) return
    console.warn(`BlendLoader - "${name}": not importable as n-gons (${reason}), falling back to the triangulating path.` +
        (seen === MAX_FALLBACK_WARNINGS ? ' Further meshes in this file will not be reported.' : ''))
}

export function createBufferGeometry(meshData: any, ctx: Ctx, opts: GeometryOptions = {}) {
    const name = meshData.aname || ''

    // N-gon path: transcribe the datablock into a `MeshData` and bake that. It reads all three DNA
    // layouts, so this is the path for every file the parser resolves cleanly.
    let reason = ''
    const mesh = createMeshData(meshData, r => { reason ||= r })
    if (mesh) return bakeMeshData(mesh, meshData, name, ctx, opts)
    if (reason) warnFallback(meshData, name, reason)

    let src: MeshSource | null = null
    if (meshData.attribute_storage) src = sourceFromAttributes(meshData, opts)
    if (!src && meshData.mpoly && meshData.totpoly > 0) src = sourceFromMPoly(meshData)
    if (!src && meshData.poly_offset_indices) src = sourceFromLayers(meshData, opts)
    if (!src && meshData.mface && meshData.totface > 0) src = sourceFromMFace(meshData)
    return build(src, name, ctx)
}

/** A pre-4.0 (`MPoly`/`MLoop`) mesh datablock through the fallback builder. Kept for tests of that layout. */
export function createBufferGeometryOld(meshData: any, ctx: Ctx) {
    return build(sourceFromMPoly(meshData), meshData.aname || '', ctx)
}
