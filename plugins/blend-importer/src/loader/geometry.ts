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
        let totalTriangles = 0
        for (let i = 0; i < faceIndices.length - 1; i++) totalTriangles += Math.max(0, (faceIndices[i + 1] - faceIndices[i]) - 2)
        const indexes = new Uint32Array(totalTriangles * 3)
        const inRange = (v: number) => v >= 0 && v < vertCount
        let t = 0
        for (let i = 0; i < faceIndices.length - 1; i++) {
            const faceStart = faceIndices[i], faceVertCount = faceIndices[i + 1] - faceStart
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
        }
        geometry.setIndex(new ctx.BufferAttribute(t === indexes.length ? indexes : indexes.slice(0, t), 1))

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
    let indicesData

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
                if (indices && (layer.name !== '.corner_vert' || indices.name === '.corner_vert')) {
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

    if (verticesData && verticesData.length > 0) {
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

    if (indicesData && indicesData.length > 0 && verticesData?.length) {
        const faceSize = meshData.totloop / meshData.totpoly
        if (faceIndices.length > 0) {
            // Use face offset indices for variable-sized faces
            let totalTriangles = 0
            for (let i = 0; i < faceIndices.length - 1; i++) {
                const faceVertCount = faceIndices[i + 1] - faceIndices[i]
                totalTriangles += Math.max(0, faceVertCount - 2)
            }

            const indexes = new Uint32Array(totalTriangles * 3)
            let t = 0

            for (let i = 0; i < faceIndices.length - 1; i++) {
                const faceStart = faceIndices[i]
                const faceEnd = faceIndices[i + 1]
                const faceVertCount = faceEnd - faceStart

                if (faceVertCount >= 3) {
                    // todo better Triangulate the face using fan triangulation
                    const firstVert = indicesData[faceStart].i
                    for (let k = 1; k < faceVertCount - 1; k++) {
                        indexes[t++] = firstVert
                        indexes[t++] = indicesData[faceStart + k].i
                        indexes[t++] = indicesData[faceStart + k + 1].i
                    }
                } else {
                    // debugger
                }
            }

            // console.log(indexes)
            geometry.setIndex(new ctx.BufferAttribute(indexes, 1))
        } else if (faceSize === 3 || faceSize === 4) {
            // Fall back to uniform face size approach
            const isQuad = faceSize === 4
            const faceCount = indices.length / faceSize
            const indexes = new Uint32Array(faceCount * 3 * (isQuad ? 2 : 1))

            if (faceSize !== 3 && faceSize !== 4) return geometry
            for (let j = 0, t = 0; j < indices.length; j += faceSize) {
                const a = indices[j].i
                const b = indices[j + 1].i
                const c = indices[j + 2].i
                indexes[t++] = a
                indexes[t++] = b
                indexes[t++] = c

                if (isQuad) {
                    const d = indices[j + 3].i
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

    // compute stuff not present
    if (geometry.attributes.position && !geometry.attributes.normal)
        geometry.computeVertexNormals()

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

    for (const face of faces) {
        const len = face.totloop
        const start = face.loopstart
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
    }

    geometry.setAttribute('position', new ctx.BufferAttribute(positions, 3))
    geometry.setIndex(new ctx.BufferAttribute(indices, 1))
    geometry.setAttribute('normal', new ctx.BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new ctx.BufferAttribute(uvs, 2))

    if (computeNormals) {
        geometry.computeVertexNormals()
    }

    return geometry
}
