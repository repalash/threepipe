import {Mesh, Object3D, PhysicalMaterial} from 'threepipe'
import {createBufferGeometry} from './geometry'
import {createMaterial} from './material'

export function setCreateTransform(object: any, obj: Object3D) {
    // obj.rotateZ(object.rot[2])
    // obj.rotateY(object.rot[1])
    // obj.rotateX(object.rot[0])

    obj.name = object.aname
    obj.quaternion.set(object.quat[1], object.quat[3], -object.quat[2], object.quat[0]) // wxyz
    obj.scale.set(object.size[0], object.size[1], object.size[2])
    obj.position.set(object.loc[0], object.loc[2], -object.loc[1])
    obj.updateMatrix()
}

export function createMesh(object: any) {
    if (!object.data) {
        return
    }

    const geometry = createBufferGeometry(object.data)

    const mat = object.data.mat[0]

    // const material = mat ? createMaterial(mat) : undefined
    const material = mat ? createMaterial(mat) : new PhysicalMaterial()
    // console.log(material, mat)
    // material.side = DoubleSide
    const mesh = new Mesh(geometry, material)

    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
}
