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

// https://github.com/blender/blender/blob/55e2fd2929b7577e0785c128c8f8069efd990c07/source/blender/blenkernel/intern/mesh.cc#L413
export function createBufferGeometry(meshData: any, ctx: Ctx) {

    if (meshData.mpoly) return createBufferGeometryOld(meshData, ctx)
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
        faceIndices = [...new Int32Array(meshData.poly_offset_indices.__blender_file__.AB, meshData.poly_offset_indices.__data_address__, meshData.totpoly + 1)]
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
