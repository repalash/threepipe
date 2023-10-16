import {Mesh} from 'threepipe'
import {createBufferGeometry} from './geometry'
import {createMaterial} from './material'

export function createMesh(object: any) {
    if (!object.data) return null

    const geometry = createBufferGeometry(object.data, [0, 0, 0])

    const mat = object.data.mat[0]

    const material = mat ? createMaterial(mat) : undefined
    const mesh = new Mesh(geometry, material)

    mesh.castShadow = true
    mesh.receiveShadow = true

    mesh.rotateZ(object.rot[2])
    mesh.rotateY(object.rot[1])
    mesh.rotateX(object.rot[0])

    mesh.scale.fromArray(object.size, 0)
    mesh.position.fromArray([object.loc[0], object.loc[2], -object.loc[1]], 0)

    return mesh
}
