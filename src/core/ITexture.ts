import {IMaterial} from './IMaterial'
import {Source, Texture, TextureEventMap} from 'three'
import {IRenderTarget} from '../rendering'

export interface ITextureUserData{
    mimeType?: string
    embedUrlImagePreviews?: boolean
    /**
     * Automatically dispose texture when not used by any material that's applied to some object in the scene.
     * Works only after it's applied to a material once.
     */
    disposeOnIdle?: boolean
}

// export type ITextureEventTypes = 'dispose' | 'update'
// export type ITextureEvent<T extends string = ITextureEventTypes> = Event & {
//     type: T
//     texture?: ITexture
//     uiChangeEvent?: ChangeEvent
// }

export type ITextureEventMap = TextureEventMap

export interface ITexture<TE extends ITextureEventMap = ITextureEventMap> extends Texture<TE> {
    assetType?: 'texture'
    userData: ITextureUserData
    readonly isTexture: true
    isDataTexture?: boolean
    isCubeTexture?: boolean
    isVideoTexture?: boolean
    isCanvasTexture?: boolean
    isCompressedTexture?: boolean
    is3DDataTexture?: boolean

    setDirty?(): void

    source: Source & {
        _sourceImgBuffer?: ArrayBuffer|Uint8Array // see KTX2LoadPlugin and serializeTextureInExtras
        _canSerialize?: boolean // see KTX2LoadPlugin and GLTFExporter.js. Disables auto decompress for glTF export
    }

    _appliedMaterials?: Set<IMaterial> // for internal use only. refers to the materials that this texture is applied to

    _target?: IRenderTarget // for internal use only. refers to the render target that this texture is attached to
}

export function upgradeTexture(this: ITexture) {
    this.assetType = 'texture'
    if (!this.userData) this.userData = {}
    if (!this._appliedMaterials) this._appliedMaterials = new Set()
    if (!this.setDirty) this.setDirty = ()=>this.needsUpdate = true
    // todo: uiconfig, dispose, etc
}
