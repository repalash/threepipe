import type {AssetManager, GLTFWriter2, IObject3D} from 'threepipe'
import type {GLTF, GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {VolumeObject} from './VolumeObject'

/**
 * Name of the glTF node extension that saves a volume.
 *
 * No volume extension exists in the Khronos registry yet, so this is a vendor extension, optional
 * (`extensionsUsed`, never `extensionsRequired`). The node keeps its box mesh as the fallback for other viewers.
 * Like USD (`UsdVolVolume` with `VolumeFieldAsset` fields), the voxels are not stored in the scene file: each field is
 * a link to its data file.
 *
 * ```json
 * "extensions": {"WEBGI_volume": {
 *     "fields": {"density": {"filePath": "https://.../scan.nrrd", "fieldName": "", "fieldIndex": 0, "fieldDataType": "short"}},
 *     "activeField": "density",
 *     "unitScale": 0.001,
 *     "material": {"type": "VolumeMaterial", "mode": "composite", "range": [...], "transferFunction": {...}, ...}
 * }}
 * ```
 */
export const VOLUME_GLTF_EXTENSION = 'WEBGI_volume'

export interface VolumeGltfExtensionData {
    fields: Record<string, {filePath: string, fieldName?: string, fieldIndex?: number, fieldDataType?: string}>
    activeField: string
    unitScale?: number
    material?: any
}

const importPlugin = (_: GLTFParser): GLTFLoaderPlugin => ({
    // the `__` prefix keeps the extension data in userData.gltfExtensions, read in afterRoot
    name: '__' + VOLUME_GLTF_EXTENSION,
    afterRoot: async(result: GLTF) => {
        const scenes = result.scenes || (result.scene ? [result.scene] : [])
        for (const s of scenes) {
            s.traverse((o: any) => {
                const ext = o?.userData?.gltfExtensions?.[VOLUME_GLTF_EXTENSION] as VolumeGltfExtensionData | undefined
                if (!ext) return
                delete o.userData.gltfExtensions[VOLUME_GLTF_EXTENSION]
                const field = ext.fields?.[ext.activeField] ?? Object.values(ext.fields ?? {})[0]
                if (!field?.filePath) {
                    console.warn('VolumePlugin: a saved volume has no data file, showing its box', o.name)
                    return
                }
                // the asset manager loads the file again and calls VolumeObject._copyFromEmbedded with this node
                o.userData.rootPath = field.filePath
                o.userData.rootPathRefresh = true
                o.userData.__volumeSettings = ext
            })
        }
    },
})

const exportPlugin = (w: GLTFWriter2) => ({
    writeNode: (object: IObject3D, nodeDef: any) => {
        const vol = object as unknown as VolumeObject
        if (!vol?.isVolumeObject) return
        const fields: VolumeGltfExtensionData['fields'] = {}
        for (const [name, d] of Object.entries(vol.fields)) {
            if (!d.filePath) continue
            fields[name] = {filePath: d.filePath, fieldName: d.fieldName || undefined, fieldIndex: d.fieldIndex || undefined, fieldDataType: d.fieldDataType}
        }
        if (!Object.keys(fields).length) {
            console.warn('VolumePlugin: a volume made in code has no data file to link to; only its box is saved', vol.name)
            return
        }
        const data: VolumeGltfExtensionData = {
            fields,
            activeField: vol.activeField,
            unitScale: vol.unitScale || undefined,
            material: vol.material.toJSON(undefined, true),
        }
        nodeDef.extensions = nodeDef.extensions || {}
        nodeDef.extensions[VOLUME_GLTF_EXTENSION] = JSON.parse(JSON.stringify(data))
        w.extensionsUsed[VOLUME_GLTF_EXTENSION] = true
    },
})

export const volumeGLTFExtension = {
    name: VOLUME_GLTF_EXTENSION,
    import: importPlugin,
    export: exportPlugin as any,
    textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]
