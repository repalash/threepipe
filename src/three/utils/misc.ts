import {BufferGeometry, MathUtils} from 'three'
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {IGeometry, IMaterial, IObject3D, IScene, ITexture} from '../../core'

/**
 * Convert geometry to BufferGeometry with indexed attributes.
 */
export function toIndexedGeometry(geometry: BufferGeometry<any, any, any>, tolerance = -1) {
    return mergeVertices(geometry, tolerance)
}

export function generateUUID() {
    return MathUtils.generateUUID()
}

/**
 * Check if a single or multiple object/geometry/material/texture is in the scene.
 * This is used internally to check if a material is used by any object in the scene, and if not, it can be disposed.
 * @param sceneObj
 */
export function isInScene(...sceneObj: (IGeometry|IMaterial|IObject3D|ITexture)[]): boolean {
    if (sceneObj.length > 1) return sceneObj.some((a)=>isInScene(a))
    const o = sceneObj[0]
    if ((<ITexture>o).isTexture) return Array.from((<ITexture>o).userData.__appliedMaterials || []).some((m) => isInScene(m)) ?? false

    const objects =
        (<IObject3D>o).isObject3D ? [<IObject3D>o] :
            (<IGeometry|IMaterial>o).appliedMeshes
    for (const obj of objects) {
        let inScene = false
        obj.traverseAncestors((ob: IObject3D) => (<IScene>ob).isScene && (inScene = true))
        if (inScene) return true
    }
    return false
}
