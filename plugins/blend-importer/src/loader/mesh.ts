import {Object3D} from 'threepipe'
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

export function createMesh(object: any, loaded: WeakMap<any, any>, ctx: any) {
    if (!object.data) {
        return undefined
    }

    const geometry = loaded.get(object.data) ?? createBufferGeometry(object.data, ctx)
    loaded.set(object.data, geometry)

    const mat = object.data.mat[0]

    // const material = mat ? createMaterial(mat) : undefined
    const material = mat ? loaded.get(mat) ?? createMaterial(mat, ctx) : new ctx.MeshPhysicalMaterial()
    if (mat) loaded.set(mat, material)

    // console.log(material, mat)
    // material.side = DoubleSide
    const mesh = new ctx.Mesh(geometry, material)

    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
}
