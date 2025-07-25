import {createBufferGeometry} from './geometry'
import {createMaterial} from './material'
import {Ctx} from './ctx'

export function createMesh(object: any, loaded: WeakMap<any, any>, ctx: Ctx) {
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
