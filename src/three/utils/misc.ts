import {BufferGeometry, MathUtils, Object3D, Quaternion} from 'three'
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {IGeometry, IMaterial, IObject3D, IScene, ITexture} from '../../core'

/**
 * Convert geometry to BufferGeometry with indexed attributes.
 */
export function toIndexedGeometry<T extends BufferGeometry<any, any> = BufferGeometry<any, any>>(geometry: T, tolerance = -1): T {
    return mergeVertices(geometry, tolerance) as T
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
    if ((<ITexture>o).isTexture) return Array.from((<ITexture>o)._appliedMaterials || []).some((m) => isInScene(m)) ?? false

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

/**
 * Convert a world-space quaternion to local-space quaternion.
 * https://github.com/mrdoob/three.js/pull/20243
 * @param object
 * @param quaternion
 * @param _q
 */
export function worldToLocalQuaternion(object: Object3D, quaternion: Quaternion, _q = new Quaternion()) {
    return quaternion.premultiply(object.getWorldQuaternion(_q).invert())
}

/**
 * Convert a local-space quaternion to world-space quaternion.
 * https://github.com/mrdoob/three.js/pull/20243
 * @param object
 * @param quaternion
 * @param _q
 */
export function localToWorldQuaternion(object: Object3D, quaternion: Quaternion, _q = new Quaternion()) {
    return quaternion.premultiply(object.getWorldQuaternion(_q))
}
