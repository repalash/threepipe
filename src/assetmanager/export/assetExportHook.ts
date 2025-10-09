import {AssetExporterEventMap} from '../AssetExporter.ts'
import {
    IGeometry,
    IMaterial,
    iMaterialCommons,
    IObject3D,
    iObjectCommons,
    ITexture,
    MeshLine,
    MeshLineSegments,
} from '../../core'
import {BufferAttribute, BufferGeometry} from 'three'
import {AssetImporter} from '../AssetImporter.ts'
import {GLTFExporter2Options} from './GLTFExporter2.ts'
import {getPartialProps, setPartialProps} from '../../utils'
import {ValOrArr} from 'ts-browser-helpers'

export const assetExportHook = (e: AssetExporterEventMap['exportFile'], trackRootPath = false) => {
    const options = e.exportOptions || {}
    const mat = (e.obj as IMaterial).isMaterial ? e.obj as IMaterial : null
    const obj = (e.obj as IObject3D).isObject3D ? e.obj as IObject3D : null

    if (e.state === 'processing') {
        if (mat) {
            const rootPath = trackRootPath ? mat.userData?.rootPath || null : null
            const maps: Map<string, ITexture> = rootPath ? iMaterialCommons.getMapsForMaterial.call(mat) : null
            const savedMaps = maps && rootPath ? replaceExternalTextures(maps, rootPath, mat) : null
            mat.__exportState = {savedMaps}
        }
        if (obj) {
            const {
                objectList,
                meshLines,
                fomMap,
                geomMap,
                matCloneMap,
                savedTextures,
            } = obj.__exportState = {
                objectList: new Set<IObject3D>(),
                meshLines: new Map(),
                fomMap: new Map(),
                geomMap: new Map(),
                matCloneMap: new Map(),
                savedTextures: new Map(),
            }
            // todo we should only use rootPath check if specified in options
            const rootPath = trackRootPath ? obj.userData?.rootPath || null : null

            obj.traverse((obj1: IObject3D) => {
                if (!obj1?.isObject3D) return
                objectList.add(obj1)
                if (obj1.children && obj1._sChildren) {
                    // @ts-expect-error temp
                    obj1._tChildren = obj1.children
                    obj1.children = obj1._sChildren as IObject3D[]
                }
            })

            const textures: Map<IObject3D|IMaterial, Map<string, ITexture>> = new Map()

            objectList.forEach(obj1=>{
                if (options.preserveUUIDs !== false && obj1.uuid) obj1.userData.gltfUUID = obj1.uuid

                if (rootPath && obj1._tpRootPath && obj1._tpRootPath !== rootPath) {
                    // todo object belongs to a diff asset. we shouldn't save it
                    console.error('Object belongs to a different asset, it should not be present in children/sChildren.', obj1, obj, rootPath)
                }

                // todo handle sProperties for objects as well
                // if (obj1.userData.sProperties !== undefined) {
                //     const props = getSProps(obj1, obj1.userData.sProperties)
                //
                // }

                processGLTFAnimations(obj1, options)

                const geomOverride = replaceExternalGeometry(obj1, rootPath)
                if (geomOverride) {
                    geomMap.set(obj1, obj1.forcedOverrideGeometry)
                    obj1.forcedOverrideGeometry = geomOverride
                }

                const current = !meshLines.has(obj1) ? processMeshLines(obj1) : null
                if (current) meshLines.set(obj1, current)

                const mats = processObjectMaterials(obj1, matCloneMap, rootPath, textures)
                if (mats !== undefined) {
                    fomMap.set(obj1, obj1.forcedOverrideMaterial)
                    obj1.forcedOverrideMaterial = mats
                }

                const textures1: Map<string, ITexture> = iObjectCommons.getMapsForObject3D.call(obj1)
                textures.set(obj1, textures1)
            })

            if (rootPath)
                textures.forEach((textures1, obj1)=>{
                    const savedMaps = replaceExternalTextures(textures1, rootPath, obj1)
                    savedTextures.set(obj1, savedMaps)
                })
            textures.clear()

        }
    }
    if (e.state === 'done' || e.state === 'error') {
        if (mat && mat.__exportState) {
            revertExternalTextures(mat.__exportState.savedMaps, mat)
            delete mat.__exportState
        }
        if (obj && obj.__exportState) {
            const {
                objectList,
                meshLines,
                fomMap,
                geomMap,
                matCloneMap,
                savedTextures,
            } = obj.__exportState
            delete obj.__exportState
            const rootPath = trackRootPath ? obj.userData?.rootPath || null : null

            objectList.forEach(obj1=>{
                if (options.preserveUUIDs !== false && obj1.userData.gltfUUID) delete obj1.userData.gltfUUID

                revertMeshLines(obj1, meshLines.get(obj1))

                if (obj1.userData.tpAssetRefIds) {
                    delete obj1.userData.tpAssetRefIds
                }
                // @ts-expect-error temp
                if (obj1._tChildren) {
                    // @ts-expect-error temp
                    obj1.children = obj1._tChildren
                    // @ts-expect-error temp
                    delete obj1._tChildren
                }
            })
            meshLines.clear()
            objectList.clear()
            new Set([...matCloneMap.values()]).forEach(m=>{
                m.dispose && m.dispose()
            })
            matCloneMap.clear()
            fomMap.forEach((fom, obj1)=>{
                if (fom !== undefined) obj1.forcedOverrideMaterial = fom
                else delete obj1.forcedOverrideMaterial
            })
            fomMap.clear()
            geomMap.forEach((fom, obj1)=>{
                if (fom !== undefined) obj1.forcedOverrideGeometry = fom
                else delete obj1.forcedOverrideGeometry
            })
            geomMap.clear()

            // revert external map references
            if (rootPath)
                savedTextures.forEach((savedMaps, obj1)=>{
                    revertExternalTextures(savedMaps, obj1)
                })
            savedTextures.clear()

        }
    }
}

/**
 * Find all the textures that do not belong to that rootPath (asset) and replace them with null in the material,
 * and save their ids in userData.tpAssetRefIds
 * @param maps
 * @param rootPath
 * @param obj
 */
function replaceExternalTextures(maps: Map<string, ITexture>, rootPath: string|null, obj: IMaterial|IObject3D) {
    const extMaps: Record<string, null> = {}
    const savedMaps: Record<string, ITexture> = {}
    maps.forEach((texture, k) => {
        // textures which are themselves loaded from a rootpath will not have _tpRootPath set. this is only for textures that "belong" to another asset
        if (rootPath && texture._tpRootPath && texture._tpRootPath !== rootPath) {
            // texture belongs to a diff asset. we shouldn't save it
            //  replace with dummy texture or null and save id (in material.userData.tpAssetRefIds), and replace back later on

            if (!obj.userData.tpAssetRefIds) obj.userData.tpAssetRefIds = {}
            if (obj.userData.tpAssetRefIds[k]) {
                // todo warn
            }
            obj.userData.tpAssetRefIds[k] = texture._tpRootPath + ':' + texture.uuid

            extMaps[k] = null
            savedMaps[k] = texture
            return
        }
    })
    setPartialProps(extMaps, obj)
    return savedMaps
}

function revertExternalTextures(savedMaps: Record<string, ITexture>|null, obj: IObject3D|IMaterial) {
    if (obj.userData.tpAssetRefIds) {
        delete obj.userData.tpAssetRefIds
    }
    savedMaps && setPartialProps(savedMaps, obj)
}

function replaceExternalGeometry(obj1: IObject3D, rootPath: string|null) {
    const geometry = obj1.geometry
    if (!geometry) return undefined
    let geomExtRef: string | null = null
    let g: IGeometry|null = null
    if (geometry.userData.isPlaceholder) {

        g = AssetImporter.DummyGeometry

    } else if (rootPath && geometry._tpRootPath && geometry._tpRootPath !== rootPath && !geometry.userData.rootPath) {
        // geometry belongs to a diff asset. we should only save the asset id and the geometry uuid
        if (!geometry.userData.uuid || geometry.userData.uuid !== geometry.uuid) {
            console.error('Geometry from different asset must have uuid in userData', geometry, obj1)
        }
        g = AssetImporter.DummyGeometry
        geomExtRef = geometry._tpRootPath + ':' + geometry.uuid
    }
    if (g && g !== geometry) {
        if (geomExtRef !== null) {
            if (!obj1.userData.tpAssetRefIds) obj1.userData.tpAssetRefIds = {}

            if (obj1.userData.tpAssetRefIds.geometry) { // it is supposed to be deleted after export
                console.warn('Overwriting existing userData.tpAssetRefIds.geometry', obj1.userData.tpAssetRefIds.geometry, geomExtRef, obj1)
            }
            obj1.userData.tpAssetRefIds.geometry = geomExtRef
        }

        return g
    }
}

/**
 * save the root where gltf animations are set, this is required since objects can have the same name in diff hierarchies
 * @param obj1
 * @param options
 */
function processGLTFAnimations(obj1: IObject3D, options: GLTFExporter2Options) {
    if (obj1.animations) {
        if (!options.animations) options.animations = []
        for (const animation of obj1.animations) {
            if (animation.__gltfExport === false) continue
            const rootRefs: string[] = animation.userData.rootRefs || []
            if (options.preserveUUIDs !== false && obj1.uuid) {
                if (!rootRefs.includes(obj1.uuid)) {
                    rootRefs.push(obj1.uuid)
                }
            } else if (obj1.name) {
                if (!rootRefs.includes(obj1.name)) {
                    rootRefs.push(obj1.name)
                }
            }
            animation.userData.rootRefs = rootRefs
            if (!options.animations.includes(animation))
                options.animations.push(animation)
        }
    }
}

function processMeshLines(obj1: IObject3D) {
    const line1 = (obj1 as any as MeshLine | MeshLineSegments)
    const geometry = line1.geometry

    // for mesh lines, create a temp line (BufferGeometry) so GLTFExporter correctly saves it as mode = line.
    if (typeof geometry?.getPositions === 'function'
        // && !obj1.geometry?.attributes.position
        && obj1.isLine === undefined && obj1.isLineSegments === undefined
        && (obj1.isLine2 || obj1.isLineSegments2)
    ) {
        const positions = geometry.getPositions()
        if (positions) {
            const colors = geometry.getColors && line1.geometry.getColors()
            const g1 = new BufferGeometry()
            g1.attributes.position = new BufferAttribute(positions, 3)
            if (colors) g1.attributes.color = new BufferAttribute(colors, 3)
            g1.name = geometry.name
            g1.userData = geometry.userData
            g1.uuid = geometry.uuid
            // todo groups? anything else
            const current = obj1.geometry
            if (obj1.assetType)
                obj1._currentGeometry = g1 as any
            else
                obj1.geometry = g1 as any

            if ((line1 as MeshLine).isLine2) obj1.isLine = true
            else if ((line1 as MeshLine).isLineSegments2) {
                obj1.isLine = true
                obj1.isLineSegments = true
            }
            return current
        }
    }
}

function processObjectMaterials(obj1: IObject3D, matCloneMap: Map<IMaterial, IMaterial>, rootPath: string|null, textures: Map<IObject3D | IMaterial, Map<string, ITexture>>) {
    if (!obj1.material) return
    const materials = obj1.material
    const isArr = Array.isArray(materials)
    const materialsArr = isArr ? materials : [materials]
    let mats = isArr ? [...materials] : materials
    let materialsExtRef: ValOrArr<string | null> = isArr ? (mats as any[]).map(() => null) : null

    const setMaterialRef = (i: number, material: IMaterial, ctor: ()=>IMaterial, extRef?: string) => {
        let mat2 = matCloneMap.get(material)
        if (!mat2) {
            mat2 = ctor()
            matCloneMap.set(material, mat2)
        }
        if (isArr) {
            // @ts-expect-error ts.
            mats[i] = mat2
            if (extRef && materialsExtRef) (materialsExtRef as any[])[i] = extRef
        } else {
            mats = mat2
            if (extRef) materialsExtRef = extRef
        }
    }

    materialsArr.forEach((material, i) => {
        if (material.userData.isPlaceholder) {
            // material is a dummy placeholder
            setMaterialRef(i, material, ()=>AssetImporter.DummyMaterial)
        } else if (rootPath && material._tpRootPath && material._tpRootPath !== rootPath && !material.userData.rootPath) {
            // material belongs to a diff asset. we should only save the asset id and the material uuid
            if (!material.userData.uuid || material.userData.uuid !== material.uuid) {
                console.error('Material from different asset must have uuid in userData', material, obj1)
            }
            setMaterialRef(i, material, ()=>AssetImporter.DummyMaterial, material._tpRootPath + ':' + material.uuid)
        } else {
            const textures1: Map<string, ITexture> = iMaterialCommons.getMapsForMaterial.call(material)
            textures.set(material, textures1)

            // todo do the same sProperties thing for objects as well.
            if (material.userData.sProperties !== undefined) { // clone the material and save only the specified properties
                setMaterialRef(i, material, ()=>{
                    // @ts-expect-error ts.
                    const mat3: IMaterial = new material.constructor()
                    mat3.name = material.name
                    // mat3.userData.tpAssetId = material.userData.tpAssetId
                    const props = getPartialProps(material, material.userData.sProperties)
                    setPartialProps(props, mat3)
                    mat3.userData.uuid = material.uuid
                    mat3.userData.sProperties = material.userData.sProperties
                    mat3.userData.rootPath = material.userData.rootPath
                    mat3.userData.rootPathOptions = material.userData.rootPathOptions
                    return mat3
                })
            }
        }
    })

    if (!isArr ? mats !== materials : (mats as IMaterial[]).some((m, i) => m !== (materials as IMaterial[])[i])) {
        if (!isArr ? materialsExtRef !== null : (materialsExtRef as any[])?.some(m => m !== null)) {
            if (!obj1.userData.tpAssetRefIds) obj1.userData.tpAssetRefIds = {}

            if (obj1.userData.tpAssetRefIds.material) { // it is supposed to be deleted after export
                console.warn('Overwriting existing userData.tpAssetRefIds.material', obj1.userData.tpAssetRefIds.material, materialsExtRef, obj1)
            }
            obj1.userData.tpAssetRefIds.material = materialsExtRef
        }

        return mats
    }
    return
}

function revertMeshLines(obj1: IObject3D, g1?: IGeometry) {
    if (g1 && obj1.geometry) {
        const g = obj1.geometry
        if (obj1.assetType)
            obj1._currentGeometry = g1
        else
            obj1.geometry = g1
        g.dispose(true)
        if (obj1.isLine) delete obj1.isLine
        if (obj1.isLineSegments) delete obj1.isLineSegments
    }
}


declare module '../../core/IObject.ts' {
    interface IObject3D{
        __exportState?: {
            objectList: Set<IObject3D>,
            meshLines: Map<IObject3D, IGeometry>,
            fomMap: Map<IObject3D, IObject3D['forcedOverrideMaterial']>,
            geomMap: Map<IObject3D, IObject3D['forcedOverrideGeometry']>,
            matCloneMap: Map<IMaterial, IMaterial>,
            savedTextures: Map<IObject3D|IMaterial, Record<string, ITexture>>,
        }
    }
}
declare module '../../core/IMaterial.ts' {
    interface IMaterial{
        __exportState?: {
            savedMaps: Record<string, ITexture>|null
        }
    }
}
