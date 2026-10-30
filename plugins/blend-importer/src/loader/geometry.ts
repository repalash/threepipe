import {Ctx} from './ctx'

function getLayer(layers: any, i: number) {
    if (!Array.isArray(layers)) return layers
    return layers[i]
}
// https://projects.blender.org/blender/blender/pulls/108015/files
// https://projects.blender.org/blender/blender/commit/1b63a290c68636211b16c5e212a699e6b63031b9
// https://developer.blender.org/docs/release_notes/4.0/python_api/#breaking-changes
// https://developer.blender.org/docs/release_notes/4.0/#blend-files
// https://projects.blender.org/blender/blender/commit/7966cd16d6dc4e66d01f7bd68a090107c1a7978c
// https://projects.blender.org/blender/blender/issues/95967
// https://projects.blender.org/blender/blender/pulls/106638

// Read a NUL-terminated C string from a resolved pointer block (e.g. an Attribute.name char*).
function readCString(block: any): string | null {
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    const u8 = block.__blender_file__.byte
    let s = '', o = block.__data_address__
    while (o < u8.length && u8[o] !== 0 && s.length < 256) s += String.fromCharCode(u8[o++])
    return s
}

// Blender 5.0 (.blend file_format_version 1) stores mesh attributes in `attribute_storage`
// (struct AttributeStorage { Attribute *dna_attributes; int dna_attributes_num; ... }) instead of
// the CustomData vdata/ldata layers used by 2.8-4.x. See
// .repos/blender/source/blender/makesdna/DNA_attribute_types.h and BKE_attribute_enums.hh.
// Each Attribute { char *name; int16 data_type; int8 domain; int8 storage_type; void *data; } where
// data -> AttributeArray { void *data; ...; int64 size; } and the void* points to the packed values.
const ATTR_TYPE_INT32 = 3, ATTR_TYPE_FLOAT2 = 6, ATTR_TYPE_FLOAT3 = 7 // bke::AttrType
const ATTR_DOMAIN_CORNER = 3 // bke::AttrDomain (Point=0, Edge=1, Face=2, Corner=3)
function getAttributes(meshData: any): any[] {
    const as = meshData.attribute_storage
    if (!as) return []
    let attrs = as.dna_attributes
    if (!attrs) return []
    attrs = (Array.isArray(attrs) || attrs.length !== undefined) ? Array.from(attrs) : [attrs]
    return attrs as any[]
}
function findAttribute(attrs: any[], name: string, type?: number): any {
    for (const a of attrs) {
        if (readCString(a.name) === name && (type === undefined || a.data_type === type)) return a
    }
    return null
}
// Element count actually stored for an attribute (AttributeArray.size). In Blender 5.0 the Mesh
// tot* fields are runtime (post-geometry-nodes) counts and DON'T match the stored array sizes — a
// geometry-nodes "Circle" can report totvert=15 while only 4 base vertices are stored. So the
// attribute's own size is authoritative; reading tot* elements overruns into adjacent blocks (garbage).
function attrSize(attr: any): number {
    const arr = attr && attr.data
    const n = arr && arr.size !== undefined ? Number(arr.size) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
}
// Read the packed array for an Attribute as a TypedArray of `count` elements (alignment-safe).
function readAttrArray(attr: any, Ctor: any, count: number): any {
    const arr = attr && attr.data // AttributeArray
    const block = arr && arr.data // void* -> packed values block
    if (!block || block.__data_address__ === undefined || !block.__blender_file__) return null
    return block.__blender_file__.readTypedArray(Ctor, block.__data_address__, count)
}

// ── Per-face material slots -> BufferGeometry groups ─────────────────
type GroupRun = {start: number, count: number, mat: number}
// Append a triangle run [start, start+count) (index-buffer offsets) tagged with material slot `mat`,
// merging into the previous run when contiguous and same-slot so the group count stays minimal.
function mergeGroupRun(runs: GroupRun[], start: number, count: number, mat: number) {
    if (count <= 0) return
    const last = runs[runs.length - 1]
    if (last && last.mat === mat && last.start + last.count === start) last.count += count
    else runs.push({start, count, mat})
}
// Mid path (corner_vert): per-face material slot is the `pdata` CustomData layer "material_index"
// (CD_PROP_INT32, type 11), one int per face. `pdata.layers` is a single object when totlayer===1.
function readFaceMaterialIndex(meshData: any, faceCount: number): number[] | null {
    const pd = meshData.pdata
    if (!pd || !pd.layers || !pd.totlayer) return null
    for (let i = 0; i < pd.totlayer; i++) {
        const l = getLayer(pd.layers, i)
        if (l && l.name === 'material_index' && l.data) {
            const data = Array.isArray(l.data) ? l.data : (l.data.length !== undefined ? Array.from(l.data) : null)
            if (!data) return null
            const out: number[] = new Array(faceCount)
            for (let f = 0; f < faceCount; f++) {
                const e: any = data[f]
                out[f] = (e && typeof e === 'object') ? (e.i ?? e.value ?? 0) : (e || 0)
            }
            return out
        }
    }
    return null
}
// Per-face flat-shading flag — Blender's `sharp_face` bool attribute (Face domain; default false = smooth;
// the inverted legacy `ME_SMOOTH`). A face with sharp_face=true is flat-shaded (all its corners take the
// face normal). Stored exactly like `material_index`: a `pdata` CD_PROP_BOOL layer in 4.x, or an
// `attribute_storage` Bool attribute in 5.0. Returns null when absent → caller keeps the smooth path.
const ATTR_TYPE_BOOL = 50 // CD_PROP_BOOL
function readFaceSharp(meshData: any, faceCount: number): boolean[] | null {
    const toBool = (e: any) => !!((e && typeof e === 'object') ? (e.i ?? e.value ?? e.b ?? 0) : e)
    // 4.x / legacy: named pdata layer.
    const pd = meshData.pdata
    if (pd && pd.layers && pd.totlayer) {
        for (let i = 0; i < pd.totlayer; i++) {
            const l = getLayer(pd.layers, i)
            if (l && l.name === 'sharp_face' && l.data) {
                const data = Array.isArray(l.data) ? l.data : (l.data.length !== undefined ? Array.from(l.data) : null)
                if (!data) break
                const out = new Array(faceCount)
                for (let f = 0; f < faceCount; f++) out[f] = toBool(data[f])
                return out
            }
        }
    }
    // 5.0: attribute_storage Bool attribute on the Face domain.
    const attr = findAttribute(getAttributes(meshData), 'sharp_face', ATTR_TYPE_BOOL)
    if (attr && attrSize(attr) >= faceCount) {
        const raw = readAttrArray(attr, Uint8Array, faceCount)
        if (raw) { const out = new Array(faceCount); for (let f = 0; f < faceCount; f++) out[f] = !!raw[f]; return out }
    }
    return null
}
// Split a triangulated indexed geometry's normals per Blender's sharp_face: each flat face's corners take
// its (area-weighted) face normal, smooth corners take the vertex normal averaged over SMOOTH faces only.
// Vertices are welded by (original vertex, quantized normal) so smooth regions stay shared and seams split
// at flat/smooth boundaries (the same weld pattern used for UV seams). Triangle order/count is preserved,
// so existing material groups (index-offset ranges) stay valid. Mutates `geometry` in place.
export function applySharpFaceNormals(geometry: any, ctx: Ctx, triFace: number[], sharpFace: boolean[]) {
    const pos = geometry.attributes.position.array as Float32Array
    const uv = geometry.attributes.uv ? geometry.attributes.uv.array as Float32Array : null
    const index = geometry.index.array as Uint32Array | Uint16Array
    const triCount = index.length / 3
    const vCount = pos.length / 3
    const faceN = new Map<number, number[]>()       // face -> accumulated (area-weighted) normal
    const smoothVN = new Float32Array(vCount * 3)    // smooth-only per-vertex accumulation
    for (let ti = 0; ti < triCount; ti++) {
        const a = index[ti * 3], b = index[ti * 3 + 1], c = index[ti * 3 + 2]
        const e1x = pos[b * 3] - pos[a * 3], e1y = pos[b * 3 + 1] - pos[a * 3 + 1], e1z = pos[b * 3 + 2] - pos[a * 3 + 2]
        const e2x = pos[c * 3] - pos[a * 3], e2y = pos[c * 3 + 1] - pos[a * 3 + 1], e2z = pos[c * 3 + 2] - pos[a * 3 + 2]
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x // area-weighted cross
        const f = triFace[ti]
        let fn = faceN.get(f); if (!fn) { fn = [0, 0, 0]; faceN.set(f, fn) }
        fn[0] += nx; fn[1] += ny; fn[2] += nz
        if (!sharpFace[f]) for (const v of [a, b, c]) { smoothVN[v * 3] += nx; smoothVN[v * 3 + 1] += ny; smoothVN[v * 3 + 2] += nz }
    }
    const norm = (x: number, y: number, z: number): [number, number, number] => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
    for (const [f, fn] of faceN) faceN.set(f, norm(fn[0], fn[1], fn[2]))
    const newPos: number[] = [], newUv: number[] = [], newNrm: number[] = [], newIdx: number[] = []
    const remap = new Map<string, number>()
    for (let ti = 0; ti < triCount; ti++) {
        const f = triFace[ti], flat = sharpFace[f], fn = faceN.get(f)!
        for (let k = 0; k < 3; k++) {
            const vi = index[ti * 3 + k]
            const n = flat ? fn : norm(smoothVN[vi * 3], smoothVN[vi * 3 + 1], smoothVN[vi * 3 + 2])
            const key = vi + '|' + Math.round(n[0] * 1e4) + ',' + Math.round(n[1] * 1e4) + ',' + Math.round(n[2] * 1e4)
            let ni = remap.get(key)
            if (ni === undefined) {
                ni = newPos.length / 3
                newPos.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2])
                if (uv) newUv.push(uv[vi * 2], uv[vi * 2 + 1])
                newNrm.push(n[0], n[1], n[2])
                remap.set(key, ni)
            }
            newIdx.push(ni)
        }
    }
    geometry.setAttribute('position', new ctx.BufferAttribute(new Float32Array(newPos), 3))
    if (uv) geometry.setAttribute('uv', new ctx.BufferAttribute(new Float32Array(newUv), 2))
    geometry.setAttribute('normal', new ctx.BufferAttribute(new Float32Array(newNrm), 3))
    geometry.setIndex(new ctx.BufferAttribute(newPos.length / 3 > 65535 ? new Uint32Array(newIdx) : new Uint16Array(newIdx), 1))
}

// Build geometry from Blender 5.0 attribute_storage. Returns null if positions aren't available
// (so the caller can fall back to the vdata/ldata path).
function createBufferGeometryFromAttributes(meshData: any, ctx: Ctx): any {
    const attrs = getAttributes(meshData)
    if (!attrs.length) return null

    const posAttr = findAttribute(attrs, 'position', ATTR_TYPE_FLOAT3)
    const vertCount = attrSize(posAttr)
    const posRaw = vertCount > 0 && readAttrArray(posAttr, Float32Array, vertCount * 3)
    if (!posRaw) return null

    const geometry = new ctx.BufferGeometry()
    geometry.name = meshData.aname || ''

    // Blender Z-up (x,y,z) -> three.js Y-up (x, z, -y). Sanitize non-finite components to 0 —
    // real .blend files can contain NaN/Inf verts (e.g. from degenerate geometry-nodes ops), which
    // Blender tolerates but three.js does not (computeBoundingBox/Sphere return NaN and break culling).
    const positions = new Float32Array(vertCount * 3)
    for (let j = 0; j < vertCount; j++) {
        const x = posRaw[j * 3], y = posRaw[j * 3 + 1], z = posRaw[j * 3 + 2]
        positions[j * 3] = Number.isFinite(x) ? x : 0
        positions[j * 3 + 1] = Number.isFinite(z) ? z : 0
        positions[j * 3 + 2] = Number.isFinite(y) ? -y : 0
    }
    geometry.setAttribute('position', new ctx.BufferAttribute(positions, 3))

    // Faces: .corner_vert (vertex index per loop) + poly_offset_indices (loop range per face).
    // Use the corner_vert array size for the loop count, and the poly_offset_indices DATA block's
    // byte length for the face count (both are stored counts; Mesh.totloop/totpoly are runtime).
    const cvAttr = findAttribute(attrs, '.corner_vert', ATTR_TYPE_INT32)
    const loopCount = attrSize(cvAttr)
    const cornerVerts = loopCount > 0 && readAttrArray(cvAttr, Int32Array, loopCount)
    const poi = meshData.poly_offset_indices
    const faceOffsetCount = poi && poi.__byte_length__ ? (poi.__byte_length__ >> 2) : 0
    if (cornerVerts && faceOffsetCount > 1 && poi) {
        const faceIndices = poi.__blender_file__.readTypedArray(Int32Array, poi.__data_address__, faceOffsetCount)
        const faceCount = faceIndices.length - 1
        let totalTriangles = 0
        for (let i = 0; i < faceCount; i++) totalTriangles += Math.max(0, (faceIndices[i + 1] - faceIndices[i]) - 2)
        const indexes = new Uint32Array(totalTriangles * 3)
        const inRange = (v: number) => v >= 0 && v < vertCount
        // Per-face material slot -> groups (only when >1 slot). material_index is a Face-domain Int32 attribute.
        const matAttr = (meshData.totcol || 0) > 1 ? findAttribute(attrs, 'material_index', ATTR_TYPE_INT32) : null
        const faceMat = matAttr && attrSize(matAttr) >= faceCount ? readAttrArray(matAttr, Int32Array, faceCount) : null
        const groupRuns: GroupRun[] = []
        let t = 0
        for (let i = 0; i < faceCount; i++) {
            const faceStart = faceIndices[i], faceVertCount = faceIndices[i + 1] - faceStart
            const triStart = t
            if (faceVertCount >= 3 && faceStart >= 0 && faceStart + faceVertCount <= loopCount) {
                const firstVert = cornerVerts[faceStart] // todo: proper (ear-clip) triangulation for concave n-gons
                for (let k = 1; k < faceVertCount - 1; k++) {
                    const b = cornerVerts[faceStart + k], c = cornerVerts[faceStart + k + 1]
                    // Skip triangles referencing out-of-range vertices (corrupt/partial geometry-nodes data).
                    if (inRange(firstVert) && inRange(b) && inRange(c)) {
                        indexes[t++] = firstVert
                        indexes[t++] = b
                        indexes[t++] = c
                    }
                }
            }
            if (faceMat) mergeGroupRun(groupRuns, triStart, t - triStart, faceMat[i] || 0)
        }
        geometry.setIndex(new ctx.BufferAttribute(t === indexes.length ? indexes : indexes.slice(0, t), 1))
        if (faceMat) for (const g of groupRuns) geometry.addGroup(g.start, g.count, g.mat)

        // UVs: the first user UV map is a Float2 attribute on the Corner domain (named, not dot-prefixed;
        // `.uv_select_*` are bools). UVs are per-corner but our geometry is per-vertex indexed, so we
        // assign each vertex the UV of a corner referencing it (last write wins). This is exact away
        // from UV seams; seam-correct UVs would need per-corner vertex expansion (todo).
        // Blender and three.js share the same UV origin (bottom-left), so no V flip.
        const uvAttr = attrs.find((a: any) => a.data_type === ATTR_TYPE_FLOAT2 && a.domain === ATTR_DOMAIN_CORNER && !(readCString(a.name) || '.').startsWith('.'))
        const uvRaw = uvAttr && attrSize(uvAttr) >= loopCount && readAttrArray(uvAttr, Float32Array, loopCount * 2)
        if (uvRaw) {
            const uvs = new Float32Array(vertCount * 2)
            for (let i = 0; i < loopCount; i++) {
                const v = cornerVerts[i]
                if (v >= 0 && v < vertCount) {
                    const u = uvRaw[i * 2], vv = uvRaw[i * 2 + 1]
                    uvs[v * 2] = Number.isFinite(u) ? u : 0
                    uvs[v * 2 + 1] = Number.isFinite(vv) ? vv : 0
                }
            }
            geometry.setAttribute('uv', new ctx.BufferAttribute(uvs, 2))
        }
    }

    if (geometry.attributes.position && !geometry.attributes.normal)
        geometry.computeVertexNormals()
    return geometry
}

// https://github.com/blender/blender/blob/55e2fd2929b7577e0785c128c8f8069efd990c07/source/blender/blenkernel/intern/mesh.cc#L413
export function createBufferGeometry(meshData: any, ctx: Ctx) {

    if (meshData.mpoly) return createBufferGeometryOld(meshData, ctx)

    // Blender 5.0+ mesh attribute storage (file_format_version 1). Falls through to the
    // vdata/ldata path below if positions aren't found there.
    if (meshData.attribute_storage) {
        const g = createBufferGeometryFromAttributes(meshData, ctx)
        if (g) return g
    }
    const geometry = new ctx.BufferGeometry()
    geometry.name = meshData.aname || ''

    // console.log(bakeGetters(meshData))

    // https://github.com/blender/blender/blob/05dcc0377b62d8e026e1901dfbecbd4b06fda0b5/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py#L19

    let vertices
    let verticesData
    let indices
    let indicesData: any
    let uvLayerData: any = null

    // Extract vertex positions from vdata layers
    if (meshData.vdata && meshData.vdata.layers && meshData.vdata.totlayer > 0) {
        for (let i = 0; i < meshData.vdata.totlayer; i++) {
            const layer = getLayer(meshData.vdata.layers, i)
            // if (layer.type === 0) {
            // https://github.com/blender/blender/blob/05dcc0377b62d8e026e1901dfbecbd4b06fda0b5/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py#L1575
            const data = layer.data || []
            // if (layer.name === 'position') { // type = 48 (custom vec3)
            if (data.length === meshData.totvert) {
                if (vertices && (layer.name !== 'position' || vertices.name === 'position')) {
                    // console.warn('BlendLoader - multiple vertices, ignoring', layer)
                    continue
                }
                vertices = layer
                verticesData = data
            } else {
                // console.log('unknown vdata', layer)
            }
        }
    }

    // Blender loops are indexes in three.js/blender. Called dots in gltf exporter

    // // Extract indexes from loop data layers
    if (meshData.ldata && meshData.ldata.layers) {
        for (let i = 0; i < meshData.ldata.totlayer; i++) {
            const layer = getLayer(meshData.ldata.layers, i)
            // if (layer.type === 0) {
            const data = layer.data || []
            // if (layer.name === '.corner_vert') { // type = 11
            if (data.length === meshData.totloop) { // type = 11
                const lname = layer.name || ''
                // UV map: a Float2 corner layer (CD_PROP_FLOAT2, type 49), user-named (not dot-prefixed
                // like `.corner_vert`/`.corner_edge`). Without this, textured meshes on the mid (3.6-4.x
                // corner_vert) path render with no UVs and the base-colour texture cannot map.
                if (!uvLayerData && (layer.type === 49 || (lname[0] !== '.' && /uv/i.test(lname)))) {
                    uvLayerData = data
                    continue
                }
                if (indices && (lname !== '.corner_vert' || indices.name === '.corner_vert')) {
                    // console.warn('BlendLoader - multiple indices, ignoring', layer)
                    continue
                }
                indices = layer
                indicesData = data
            } else {
                // console.log('unknown ldata', layer)
            }
        }
    }
    // if (meshData.pdata && meshData.pdata.layers) {
    //     for (let i = 0; i < meshData.pdata.totlayer; i++) {
    //         const layer = getLayer(meshData.pdata.layers, i)
    //         // if (layer.type === 0) {
    //         // if (layer.name === '.corner_vert') { // type = 11
    //         // } else {
    //         console.log('unknown pdata', layer)
    //         // }
    //     }
    // }
    // if (meshData.fdata && meshData.fdata.layers) {
    //     for (let i = 0; i < meshData.fdata.totlayer; i++) {
    //         const layer = getLayer(meshData.fdata.layers, i)
    //         // if (layer.type === 0) {
    //         // if (layer.name === '.corner_vert') { // type = 11
    //         // } else {
    //         console.log('unknown fdata', layer)
    //         // }
    //     }
    // }
    // if (meshData.edata && meshData.edata.layers) {
    //     for (let i = 0; i < meshData.edata.totlayer; i++) {
    //         const layer = getLayer(meshData.edata.layers, i)
    //         // if (layer.type === 0) {
    //         // if (layer.name === '.corner_vert') { // type = 11
    //         // } else {
    //         console.log('unknown edata', layer)
    //         // }
    //     }
    // }

    let faceIndices: number[] = []
    if (meshData.poly_offset_indices && meshData.totpoly > 0) {
        // Use the parser's alignment-safe reader — Blender packs blocks unpadded, so on v1
        // (Blender 5.0) and some v0 files this offset isn't 4-aligned and a raw Int32Array view throws.
        faceIndices = [...meshData.poly_offset_indices.__blender_file__.readTypedArray(Int32Array, meshData.poly_offset_indices.__data_address__, meshData.totpoly + 1)]
    }
    // if (faceSize !== 3 && faceSize !== 4 && !faceIndices.length) {
    //     console.error('not supported polygons with ', faceSize, 'vertices')
    //     return geometry
    // }

    // Per-corner vertex expansion for SEAM-CORRECT UVs (mid path). Blender stores UVs per corner (loop);
    // three.js needs one UV per vertex. A Blender vertex shared by corners with DIFFERENT UVs is a UV seam —
    // assigning it a single UV (last-write-wins) makes the faces across the seam interpolate the texture over
    // the whole UV range, smearing/stretching it (classic symptom: the back of a UV-mapped sphere). Expand to
    // one vertex per unique (blenderVert, uv) so seams split. Coincident split verts stay welded under the
    // subsurf subdivision (same positions → same repositioning), so no crack. No UV layer ⇒ no expansion.
    const vco = (vd: any): [number, number, number] => vd?.x !== undefined ? [vd.x, vd.y, vd.z] : (vd?.co ? [vd.co[0], vd.co[1], vd.co[2]] : [0, 0, 0])
    let cornerToVert: Int32Array | null = null
    let expandedPos: Float32Array | null = null
    let expandedUv: Float32Array | null = null
    if (uvLayerData && indicesData && verticesData && verticesData.length) {
        cornerToVert = new Int32Array(indicesData.length)
        const seen = new Map<string, number>()
        const ps: number[] = [], us: number[] = []
        const uvN = uvLayerData.length
        for (let i = 0; i < indicesData.length; i++) {
            const bv = indicesData[i]?.i
            if (!(bv >= 0 && bv < verticesData.length)) { cornerToVert[i] = 0; continue }
            const e = i < uvN ? uvLayerData[i] : null
            const u = e && Number.isFinite(e.x) ? e.x : 0
            const w = e && Number.isFinite(e.y) ? e.y : 0
            const key = bv + '|' + Math.round(u * 4096) + '|' + Math.round(w * 4096)
            let ev = seen.get(key)
            if (ev === undefined) {
                ev = us.length / 2
                seen.set(key, ev)
                const [x, y, z] = vco(verticesData[bv])
                ps.push(x, z, -y) // Blender Z-up → three Y-up (same mapping as the non-expanded path)
                us.push(u, w)
            }
            cornerToVert[i] = ev
        }
        expandedPos = new Float32Array(ps)
        expandedUv = new Float32Array(us)
    }
    // Expanded-vertex index for a corner (loop) index; falls back to the raw Blender vertex when not expanding.
    const vAt = (corner: number) => cornerToVert ? cornerToVert[corner] : indicesData[corner].i

    if (expandedPos) {
        geometry.setAttribute('position', new ctx.BufferAttribute(expandedPos, 3))
    } else if (verticesData && verticesData.length > 0) {
        const positions = new Float32Array(verticesData.length * 3)
        for (let j = 0; j < verticesData.length; j++) {
            const {x, y, z, co} = verticesData[j] || {}
            if (x !== undefined) {
                positions[j * 3] = x
                positions[j * 3 + 1] = z
                positions[j * 3 + 2] = -y
            } else if (co !== undefined) {
                positions[j * 3] = co[0]
                positions[j * 3 + 1] = co[2]
                positions[j * 3 + 2] = -co[1]
            } else {
                // console.log(bakeGetters(meshData))
                // const t = [...new Int32Array(vertex.__blender_file__.AB, vertex.__data_address__, 8)]
                // debugger
                console.error('BlendLoader - unknown vertex', verticesData[j])
                break
            }
        }
        geometry.setAttribute('position', new ctx.BufferAttribute(positions, 3))
    }

    // Per-face flat-shading (sharp_face). `triFace` records which original face each output triangle came
    // from; built ONLY when the mesh actually has flat faces, so smooth meshes (all current fixtures) take
    // the unchanged path with zero overhead. Applied after UVs are set (below).
    let triFace: number[] | null = null
    let sharpFace: boolean[] | null = null
    if (indicesData && indicesData.length > 0 && verticesData?.length) {
        const faceSize = meshData.totloop / meshData.totpoly
        if (faceIndices.length > 0) {
            // Use face offset indices for variable-sized faces
            const faceCount = faceIndices.length - 1
            let totalTriangles = 0
            for (let i = 0; i < faceCount; i++) {
                const faceVertCount = faceIndices[i + 1] - faceIndices[i]
                totalTriangles += Math.max(0, faceVertCount - 2)
            }

            const indexes = new Uint32Array(totalTriangles * 3)
            let t = 0

            // Per-face material slot -> groups (only when >1 slot). material_index lives in the `pdata` layer.
            const faceMat = (meshData.totcol || 0) > 1 ? readFaceMaterialIndex(meshData, faceCount) : null
            const groupRuns: GroupRun[] = []
            const fs = readFaceSharp(meshData, faceCount)
            if (fs && fs.some(s => s)) { sharpFace = fs; triFace = [] }

            for (let i = 0; i < faceCount; i++) {
                const faceStart = faceIndices[i]
                const faceEnd = faceIndices[i + 1]
                const faceVertCount = faceEnd - faceStart
                const triStart = t

                if (faceVertCount >= 3) {
                    // todo better Triangulate the face using fan triangulation
                    const firstVert = vAt(faceStart)
                    for (let k = 1; k < faceVertCount - 1; k++) {
                        indexes[t++] = firstVert
                        indexes[t++] = vAt(faceStart + k)
                        indexes[t++] = vAt(faceStart + k + 1)
                        if (triFace) triFace.push(i)
                    }
                } else {
                    // debugger
                }
                if (faceMat) mergeGroupRun(groupRuns, triStart, t - triStart, faceMat[i] || 0)
            }

            // console.log(indexes)
            geometry.setIndex(new ctx.BufferAttribute(indexes, 1))
            if (faceMat) for (const g of groupRuns) geometry.addGroup(g.start, g.count, g.mat)
        } else if (faceSize === 3 || faceSize === 4) {
            // Fall back to uniform face size approach
            const isQuad = faceSize === 4
            const faceCount = indices.length / faceSize
            const indexes = new Uint32Array(faceCount * 3 * (isQuad ? 2 : 1))

            if (faceSize !== 3 && faceSize !== 4) return geometry
            for (let j = 0, t = 0; j < indices.length; j += faceSize) {
                const a = vAt(j)
                const b = vAt(j + 1)
                const c = vAt(j + 2)
                indexes[t++] = a
                indexes[t++] = b
                indexes[t++] = c

                if (isQuad) {
                    const d = vAt(j + 3)
                    indexes[t++] = a
                    indexes[t++] = c
                    indexes[t++] = d
                }
            }
            geometry.setIndex(new ctx.BufferAttribute(indexes, 1))
        }
    } else if (faceIndices) {
        console.error('BlendLoader - no indices data found, but face indices are present', faceIndices)
    }

    // console.log(geometry.attributes.position)
    // console.log(geometry.index)

    // UVs (mid corner_vert path): seam-correct, from the per-corner expansion above (one UV per split vertex).
    // Blender and three.js share the same UV origin (bottom-left), so no V flip.
    if (expandedUv && !geometry.attributes.uv) {
        geometry.setAttribute('uv', new ctx.BufferAttribute(expandedUv, 2))
    }

    // Flat shading (sharp_face): split + assign face normals where Blender marks faces flat. Sets the normal
    // attribute itself, so the computeVertexNormals fallback below is skipped. Only runs when flat faces exist.
    if (sharpFace && triFace && geometry.index && geometry.attributes.position)
        applySharpFaceNormals(geometry, ctx, triFace, sharpFace)

    // compute stuff not present
    if (geometry.attributes.position && !geometry.attributes.normal)
        geometry.computeVertexNormals()

    // Catmull-Clark cage: the un-triangulated n-gon faces + per-corner UVs, kept on userData so a Subsurf
    // (subdivType==0) can be done as faithful Catmull-Clark (which needs the quad topology this triangulated
    // geometry has thrown away). mesh.ts subdivides this cage and re-triangulates. Mid path only.
    if (faceIndices.length > 1 && indicesData && verticesData && verticesData.length) {
        const cagePositions: number[][] = []
        for (const vd of verticesData) { const c = vco(vd); cagePositions.push([c[0], c[2], -c[1]]) } // Z-up→Y-up
        const cageFaces: number[][] = []
        const cageUVs: number[][][] | null = uvLayerData ? [] : null
        // Per-face material slot (only when >1 slot) — carried alongside the faces so the CC subdivider can
        // re-emit geometry groups (each cage face → a contiguous run of output quads of the same slot).
        const faceMat = (meshData.totcol || 0) > 1 ? readFaceMaterialIndex(meshData, faceIndices.length - 1) : null
        const cageMats: number[] | null = faceMat ? [] : null
        for (let i = 0; i < faceIndices.length - 1; i++) {
            const face: number[] = [], fuv: number[][] = []
            for (let l = faceIndices[i]; l < faceIndices[i + 1]; l++) {
                const v = indicesData[l]?.i
                if (v >= 0 && v < cagePositions.length) {
                    face.push(v)
                    if (cageUVs && uvLayerData) { const e = uvLayerData[l]; fuv.push([e?.x || 0, e?.y || 0]) }
                }
            }
            if (face.length >= 3) { cageFaces.push(face); if (cageUVs) cageUVs.push(fuv); if (cageMats && faceMat) cageMats.push(faceMat[i] || 0) }
        }
        if (cageFaces.length) { geometry.userData = geometry.userData || {}; geometry.userData.__cage = {positions: cagePositions, faces: cageFaces, uvs: cageUVs, materialIndices: cageMats} }
    }

    // if (meshData.loc) { // maybe this is the bbox center?
    //     geometry.translate(meshData.loc[0], meshData.loc[2], -meshData.loc[1])
    // }
    // if (meshData.size) { // maybe this is the bbox size?
    //     geometry.scale(meshData.size[0], meshData.size[2], -meshData.size[1])
    // }

    return geometry
}
//     // https://github.com/blender/blender/blob/05dcc0377b62d8e026e1901dfbecbd4b06fda0b5/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py#L19
//             // https://github.com/blender/blender/blob/05dcc0377b62d8e026e1901dfbecbd4b06fda0b5/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py#L1575
//             // todo __set_morph_locs_attribute
//             // todo __set_morph_tangent_attribute
//     // todo pdata(points), edata(edge), fdata(face? legacy?)
//     // meshData.eData = domain edge - https://github.com/blender/blender/blob/05dcc0377b62d8e026e1901dfbecbd4b06fda0b5/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py#L189
//     // todo normals, tangents

export function createBufferGeometryOld(mesh: any, ctx: Ctx) {
    const
        faces = Array.isArray(mesh.mpoly) ? mesh.mpoly as any[] : [mesh.mpoly],
        loops = mesh.mloop,
        uv = mesh.mloopuv,
        vertices = mesh.mvert

    const geometry = new ctx.BufferGeometry()

    if (!faces) return geometry

    const size = faces.reduce((acc, face) => acc + Math.floor(face.totloop * 3.0 / 2), 0)
    const indices = new Uint32Array(size)
    const uvs = new Float32Array(size * 2)
    const normals = new Float32Array(size * 3)
    const positions = new Float32Array(size * 3)

    let currentIndex = 0
    let computeNormals = false

    // Per-face material slot (mat_nr) -> geometry groups, but only when the mesh has >1 slot. Faces are
    // emitted in order, so each face's triangles form a contiguous index range; we merge consecutive
    // same-slot faces into one group. mesh.ts then assigns one material per slot.
    const useGroups = (mesh.totcol || 0) > 1
    const groupRuns: GroupRun[] = []

    for (const face of faces) {
        const len = face.totloop
        const start = face.loopstart
        const faceStartIndex = currentIndex
        let indexi = 1

        while (indexi < len) {

            let index = 0

            for (let l = 0; l < 3; l++) {
                // Per Vertex

                index = start
                if (indexi - 1 + l < len)
                    index += indexi - 1 + l

                const loop = loops[index]
                const {co, no} = vertices[loop.v] || {}
                indices[currentIndex] = currentIndex

                if (co) {
                    positions[currentIndex * 3 + 0] = co[0]
                    positions[currentIndex * 3 + 1] = co[2]
                    positions[currentIndex * 3 + 2] = -co[1]
                }

                if (no) {
                    normals[currentIndex * 3 + 0] = no[0]
                    normals[currentIndex * 3 + 1] = no[2]
                    normals[currentIndex * 3 + 2] = -no[1]
                } else {
                    computeNormals = true
                }

                if (uv) {
                    const uv1 = uv[index].uv
                    uvs[currentIndex * 2 + 0] = uv1[0]
                    uvs[currentIndex * 2 + 1] = uv1[1]
                }

                currentIndex++
            }

            indexi += 2
        }

        if (useGroups) mergeGroupRun(groupRuns, faceStartIndex, currentIndex - faceStartIndex, face.mat_nr || 0)
    }

    geometry.setAttribute('position', new ctx.BufferAttribute(positions, 3))
    geometry.setIndex(new ctx.BufferAttribute(indices, 1))
    geometry.setAttribute('normal', new ctx.BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new ctx.BufferAttribute(uvs, 2))

    // Emit groups for any multi-slot mesh: even a single run carries the correct slot index, so a mesh
    // whose faces all use e.g. slot 2 renders with material[2] (not material[0]).
    if (useGroups && groupRuns.length)
        for (const g of groupRuns) geometry.addGroup(g.start, g.count, g.mat)

    if (computeNormals) {
        geometry.computeVertexNormals()
    }

    return geometry
}
