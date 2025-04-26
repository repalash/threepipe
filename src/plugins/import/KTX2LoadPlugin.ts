import {ThreeViewer} from '../../viewer'
import {GLTFWriter2, ILoader, Importer, ImportResultExtras} from '../../assetmanager'
import {KTX2Loader} from 'three/examples/jsm/loaders/KTX2Loader.js'
import {CompressedTexture} from 'three'
import {serializeTextureInExtras} from '../../utils'
import {ITexture, upgradeTexture} from '../../core'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading Compressed Textures of format `.ktx2`, `image/ktx2` files and data uris.
 * @category Plugins
 */
export class KTX2LoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'KTX2LoadPlugin'
    protected _importer = new Importer(KTX2Loader2, ['ktx2'], ['image/ktx2'], false)

    public static TRANSCODER_LIBRARY_PATH = 'https://cdn.jsdelivr.net/gh/BinomialLLC/basis_universal@1.16.4/webgl/transcoder/build/'

    /**
     * Flag to save the source buffer data in the texture object, it can be used later when downloading/serializing
     * the texture like when downloading glb with embedded textures.
     */
    public static SAVE_SOURCE_BLOBS = false

    onAdded(viewer: ThreeViewer) {
        this._importer.onCtor = (l: KTX2Loader2) => l
            .setTranscoderPath(KTX2LoadPlugin.TRANSCODER_LIBRARY_PATH)
            .detectSupport(viewer.renderManager.renderer)
        super.onAdded(viewer)
        viewer.assetManager.exporter.getExporter('gltf', 'glb')?.extensions?.push(glTFTextureBasisUExtensionExport)
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        const exporter = viewer.assetManager.exporter.getExporter('gltf', 'glb')
        const index = exporter?.extensions?.indexOf(glTFTextureBasisUExtensionExport)
        if (index !== undefined && index !== -1) exporter?.extensions?.splice(index, 1)
    }


}

export class KTX2Loader2 extends KTX2Loader implements ILoader {

    private _initTexture(t: CompressedTexture & ITexture) {
        upgradeTexture.call(t)
        t.userData.mimeType = 'image/ktx2'
        t.toJSON = (meta?: any)=>{
            return serializeTextureInExtras(t, meta, t.name, 'image/ktx2')
        }
        const cloneFn = t.clone
        t.clone = ()=>{
            const res = cloneFn.call(t)
            if (res.source !== t.source) // in case something changes
                res.source._sourceImgBuffer = t.source._sourceImgBuffer
            return this._initTexture(res)
        }
        return t
    }
    async createTexture(buffer: ArrayBuffer, config: any): Promise<CompressedTexture> {
        const buffer2 = KTX2LoadPlugin.SAVE_SOURCE_BLOBS ? new Uint8Array(buffer.slice(0)) : undefined // clones the buffer
        const texture = (await super.createTexture(buffer, config)) as CompressedTexture & ITexture
        // todo check if rootPath is set?
        if (KTX2LoadPlugin.SAVE_SOURCE_BLOBS && buffer2) {
            texture.source._sourceImgBuffer = buffer2 // keep the same buffer when cloned and all, used in serializeTextureInExtras
            texture.source._canSerialize = true
        }
        this._initTexture(texture)
        return texture
    }

}


export const KHR_TEXTURE_BASISU = 'KHR_texture_basisu'

const glTFTextureBasisUExtensionExport = (w: GLTFWriter2)=> ({
    writeTexture: (texture: ITexture&ImportResultExtras, textureDef: any) => {
        // if (!w.options.embedImages) return // option is removed.
        if (texture.userData.mimeType !== 'image/ktx2') return
        if (textureDef.source !== undefined && textureDef.source !== null) {
            console.warn('ktx2 export: source already set')
            return
        }
        const sourceBuffer = texture.source._sourceImgBuffer || texture.__sourceBuffer // todo do this for all images that have a __sourceBuffer (in GLTFExporter.processImage or GLTFWriter2.processTexture)
        if (!sourceBuffer) {
            console.warn('ktx2 export: no source buffer for ktx2')
            return
        }

        textureDef.extensions = textureDef.extensions || {}

        const extensionDef: any = {}

        const blob = new Blob([sourceBuffer], {type: 'image/ktx2'})
        extensionDef.source = w.processImageBlob(blob, texture)

        textureDef.extensions[ KHR_TEXTURE_BASISU ] = extensionDef
        w.extensionsUsed[ KHR_TEXTURE_BASISU ] = true
    },
})

