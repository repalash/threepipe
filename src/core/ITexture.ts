import {IMaterial} from './IMaterial'
import {Event, Texture} from 'three'
import {ChangeEvent} from 'uiconfig.js'
import {IRenderTarget} from '../rendering'

export interface ITextureUserData{
    mimeType?: string
    embedUrlImagePreviews?: boolean
    /**
     * Automatically dispose texture when not used by any material that's applied to some object in the scene.
     * Works only after it's applied to a material once.
     */
    disposeOnIdle?: boolean
    __appliedMaterials?: Set<IMaterial>
}
export type ITextureEventTypes = 'dispose' | 'update'
export type ITextureEvent<T extends string = ITextureEventTypes> = Event & {
    type: T
    texture?: ITexture
    uiChangeEvent?: ChangeEvent
}

export interface ITexture extends Texture {
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

    _target?: IRenderTarget // for internal use only. refers to the render target that this texture is attached to
}

export function upgradeTexture(this: ITexture) {
    this.assetType = 'texture'
    if (!this.userData) this.userData = {}
    if (!this.userData.__appliedMaterials) this.userData.__appliedMaterials = new Set()
    if (!this.setDirty) this.setDirty = ()=>this.needsUpdate = true
    // todo: uiconfig, dispose, etc
}
