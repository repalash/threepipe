import {IMaterial} from './IMaterial'
import {Event, Texture} from 'three'
import {ChangeEvent} from 'uiconfig.js'

export interface ITextureUserData{
    mimeType?: string
    disposeOnIdle?: boolean // automatically dispose when added to a material and then not used in any material
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

}

export function upgradeTexture(this: ITexture) {
    this.assetType = 'texture'
    if (!this.userData) this.userData = {}
    if (!this.userData.__appliedMaterials) this.userData.__appliedMaterials = new Set()
    if (!this.setDirty) this.setDirty = ()=>this.needsUpdate = true
    // todo: uiconfig, dispose, etc
}
