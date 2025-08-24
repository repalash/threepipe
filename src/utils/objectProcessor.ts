import {ThreeViewer} from '../viewer'
import {getOrCall, ValOrFunc} from 'ts-browser-helpers'
import {IObject3D, IObjectProcessor} from '../core'

export function defaultObjectProcessor(viewerF: ValOrFunc<ThreeViewer|undefined>): IObjectProcessor {
    return {
        processObject: (object: IObject3D)=>{
            const viewer = getOrCall(viewerF)
            if (!viewer || object.userData.autoRegisterInManager === false) return
            viewer.object3dManager.registerObject(object)
            if (object.material) {
                if (!viewer.assetManager) {
                    console.error('AssetManager is not initialized yet, cannot register material', object.material)
                    return
                }
                const mats = Array.isArray(object.material) ? object.material : [object.material]
                for (const mat of mats) {
                    if (mat.userData.autoRegisterInManager === false) continue
                    viewer.assetManager.materials.registerMaterial(mat)
                }
            }
        },
    }
}
