import {IMaterial} from './IMaterial'
import {Texture} from 'three'

export interface ITextureUserData{
    disposeOnIdle?: boolean // automatically dispose when added to a material and then not used in any material
    __appliedMaterials?: Set<IMaterial>
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

}

export function upgradeTexture(this: ITexture) {
    this.assetType = 'texture'
    if (!this.userData) this.userData = {}
    if (!this.userData.__appliedMaterials) this.userData.__appliedMaterials = new Set()
    // todo: uiconfig, dispose, etc

}
