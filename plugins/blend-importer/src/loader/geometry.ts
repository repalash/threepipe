import {BufferAttribute, BufferGeometry, Vector3Tuple} from 'threepipe'

export function createBufferGeometry(mesh: any, origin: Vector3Tuple) {
    const
        faces = Array.isArray(mesh.mpoly) ? mesh.mpoly as any[] : [mesh.mpoly],
        loops = mesh.mloop,
        uv = mesh.mloopuv,
        vertices = mesh.mvert

    const geometry = new BufferGeometry()

    if (!faces) return geometry

    const size = faces.reduce((acc, face) => acc + Math.floor(face.totloop * 3.0 / 2), 0)
    const indices = new Uint32Array(size)
    const uvs = new Float32Array(size * 2)
    const normals = new Float32Array(size * 3)
    const positions = new Float32Array(size * 3)

    let currentIndex = 0

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
                const vert = vertices[loop.v]
                indices[currentIndex] = currentIndex

                positions[currentIndex * 3 + 0] = vert.co[0] + origin[0]
                positions[currentIndex * 3 + 1] = vert.co[2] + origin[2]
                positions[currentIndex * 3 + 2] = -vert.co[1] + -origin[1]

                normals[currentIndex * 3 + 0] = vert.no[0]
                normals[currentIndex * 3 + 1] = vert.no[2]
                normals[currentIndex * 3 + 2] = -vert.no[1]

                if (uv) {
                    uvs[currentIndex * 2 + 0] = uv[index].uv[0]
                    uvs[currentIndex * 2 + 1] = uv[index].uv[1]
                }

                currentIndex++
            }

            indexi += 2
        }
    }

    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setIndex(new BufferAttribute(indices, 1))
    geometry.setAttribute('normal', new BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2))

    return geometry
}
