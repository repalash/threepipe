import {Camera, Light, LinearFilter, LinearMipmapLinearFilter} from 'three'
import {ImportResult, ProcessRawOptions} from './IAssetImporter'
import type {AssetImporter, IAssetImporterEventMap} from './AssetImporter'
import type {MaterialManager} from './MaterialManager'
import {
    AmbientLight2,
    DirectionalLight2,
    HemisphereLight2,
    ICamera,
    iCameraCommons,
    ILight,
    iLightCommons,
    iMaterialCommons,
    iObjectCommons,
    ITexture,
    OrthographicCamera2,
    PerspectiveCamera2,
    PointLight2,
    RectAreaLight2,
    SpotLight2,
    upgradeTexture,
} from '../core'

/**
 * Upgrades an imported asset before it is processed: converts the materials of a model to threepipe materials
 * (registered in `materials`), replaces its cameras and lights with threepipe's, and upgrades textures and materials.
 * Listener for the `processRawStart` event of an {@link AssetImporter}, used by {@link AssetManager} and {@link AssetContext}.
 * @param event
 * @param materials - converts and registers the materials
 * @param importer - processes the textures embedded in other files
 * @param canvas - for the cameras that replace the imported ones
 */
export function upgradeImportedAsset(event: IAssetImporterEventMap['processRawStart'], {materials: materialManager, importer, canvas}: {materials: MaterialManager, importer: AssetImporter, canvas?: HTMLCanvasElement}) {
    // console.log('preprocess mat', mat)
    const res = event.data!
    const options = event.options! as ProcessRawOptions
    // if (!res.assetType) {
    //     if (res.isBufferGeometry) { // for eg stl todo
    //         res = new Mesh(res, new MeshStandardMaterial())
    //     }
    //     if (res.isObject3D) {
    //     }
    // }
    if (res.isObject3D) {
        const cameras: Camera[] = []
        const lights: Light[] = []
        res.traverse((obj: any) => {
            if (obj.material) {
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
                const newMaterials = []
                const textures = []
                for (const material of materials) {
                    const mat = materialManager.convertToIMaterial(material, {createFromTemplate: options.replaceMaterials !== false}) || material
                    mat.uuid = material.uuid
                    mat.userData.uuid = material.uuid
                    newMaterials.push(mat)
                    const maps: Map<string, ITexture> = iMaterialCommons.getMapsForMaterial.call(mat)
                    textures.push(...Array.from(maps.values()))
                }
                if (Array.isArray(obj.material)) obj.material = newMaterials
                else obj.material = newMaterials[0]
                new Set(textures).forEach(t => {
                    if (typeof t.userData.rootPath === 'string' && t.userData.rootPath.startsWith('blob:')) { // because we are not checking when setting inside three.js fork
                        delete t.userData.rootPath
                    }
                    // embedded texture loaded inside some other loader.
                    if (t.userData.rootPath && !(t as ImportResult).__rootPath) {
                        (t as ImportResult).__rootPath = t.userData.rootPath
                        // todo we are ignoring the promise from process raw
                        importer.processRawSingle(t, {})
                    } else {
                        upgradeTexture.call(t)
                    }
                })
            }
            if (obj.isCamera) cameras.push(obj)
            if (obj.isLight) lights.push(obj)
        })
        for (const camera of cameras) {
            if ((camera as Partial<ICamera>).assetType === 'camera') continue
            // todo: OrthographicCamera
            if (!camera.parent || options.replaceCameras === false) {
                iCameraCommons.upgradeCamera.call(camera)
            } else {
                const newCamera: ICamera = (camera as any).iCamera ??
                !(camera as Partial<ICamera>).isOrthographicCamera ?
                    new PerspectiveCamera2('', canvas) :
                    new OrthographicCamera2('', canvas)
                if (camera === newCamera) continue
                camera.parent.children.splice(camera.parent.children.indexOf(camera), 1, newCamera)
                newCamera.parent = camera.parent as any
                newCamera.copy(camera as any)
                camera.parent = null
                ;(newCamera as any).uuid = camera.uuid
                newCamera.userData.uuid = camera.uuid
                ;(camera as any).iCamera = newCamera
                // console.log('replacing camera', camera, newCamera)
            }
        }
        for (const light of lights) {
            if ((light as ILight).assetType === 'light') continue
            if (!light.parent || options.replaceLights === false) {
                iLightCommons.upgradeLight.call(light)
            } else {
                const newLight: ILight | undefined = (light as any).iLight ??
                (light as any).isDirectionalLight ? new DirectionalLight2() :
                    (light as any).isPointLight ? new PointLight2() :
                        (light as any).isSpotLight ? new SpotLight2() :
                            (light as any).isAmbientLight ? new AmbientLight2() :
                                (light as any).isHemisphereLight ? new HemisphereLight2() :
                                    (light as any).isRectAreaLight ? new RectAreaLight2() :
                                        undefined
                if (light === newLight || !newLight) continue
                light.parent.children.splice(light.parent.children.indexOf(light), 1, newLight)
                newLight.parent = light.parent as any
                newLight.copy(light as any)
                light.parent = null
                ;(newLight as any).uuid = light.uuid
                newLight.userData.uuid = light.uuid
                ;(light as any).iLight = newLight
            }
        }

        iObjectCommons.upgradeObject3D.call(res)
    } else if (res.isMaterial) {
        if (!res.assetType) iMaterialCommons.upgradeMaterial.call(res)
        // todo update res by generating new material?
    } else if (res.isTexture) {
        upgradeTexture.call(res)

        if (event?.options?.generateMipmaps !== undefined)
            res.generateMipmaps = event?.options.generateMipmaps
        if (!res.generateMipmaps && !res.isRenderTargetTexture) { // todo: do we need to check more?
            res.minFilter = res.minFilter === LinearMipmapLinearFilter ? LinearFilter : res.minFilter
            res.magFilter = res.magFilter === LinearMipmapLinearFilter ? LinearFilter : res.magFilter
        }

    }
    // todo other asset/object types?
}
