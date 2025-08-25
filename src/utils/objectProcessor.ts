import {ThreeViewer} from '../viewer'
import {getOrCall, ValOrFunc} from 'ts-browser-helpers'
import {AddModelOptions, IGeometry, IObject3D, IObjectProcessor} from '../core'

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

export function addModelProcess(obj: IObject3D, {
    autoCenter = false, centerGeometries = false, centerGeometriesKeepPosition = true, autoScale = false, autoScaleRadius = 2., license,
}: AddModelOptions) {
    if (license) obj.userData.license = [obj.userData.license, license].filter(v=>v).join(', ')
    const process = ()=>{
        if (autoCenter && !obj.userData.isCentered && !obj.userData.pseudoCentered && !obj.isLight) { // pseudoCentered is legacy
            obj.autoCenter && obj.autoCenter()
        } else {
            obj.userData.isCentered = true // mark as centered, so that autoCenter is not called again when file is reloaded.
        }
        if (autoScale && !obj.userData.autoScaled && !obj.isLight) {
            obj.autoScale && obj.autoScale(obj.userData.autoScaleRadius || autoScaleRadius)
        } else {
            obj.userData.autoScaled = true // mark as auto-scaled, so that autoScale is not called again when file is reloaded.
        }
        if (centerGeometries && !obj.userData.geometriesCentered) {
            centerAllGeometries(obj, centerGeometriesKeepPosition)
            obj.userData.geometriesCentered = true
        } else {
            obj.userData.geometriesCentered = true // mark as centered, so that geometry center is not called again when file is reloaded.
        }
    }
    if (obj._loadingPromise) obj._loadingPromise.finally(process)
    else process()
}

export function centerAllGeometries(obj: IObject3D, keepPosition: boolean) {
    const geoms = new Set<IGeometry>()
    obj.traverseModels && obj.traverseModels((o) => {
        o.geometry && geoms.add(o.geometry)
    }, {visible: false, widgets: false})
    const undos: (() => void)[] = []
    geoms.forEach(g => undos.push(g.center2(undefined, keepPosition)))
    return () => undos.forEach(u => u())
}

