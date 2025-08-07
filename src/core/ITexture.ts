import {IMaterial} from './IMaterial'
import {Source, Texture, TextureEventMap} from 'three'
import {IRenderTarget} from '../rendering'
import type {ChangeEvent, UiObjectConfig} from 'uiconfig.js'
import {IObject3D} from './IObject'

export interface ITextureUserData{
    mimeType?: string
    embedUrlImagePreviews?: boolean
    /**
     * Automatically dispose texture when not used by any material that's applied to some object in the scene.
     * Works only after it's applied to a material once.
     */
    disposeOnIdle?: boolean


    // for videos etc
    timeline?: {
        enabled: boolean
        delay?: number // in ms
        scale?: number // scale the timeline to this value
        start?: number // in ms
        end?: number // in ms
    }
}

// export type ITextureEventTypes = 'dispose' | 'update'
// export type ITextureEvent<T extends string = ITextureEventTypes> = Event & {
//     type: T
//     texture?: ITexture
//     uiChangeEvent?: ChangeEvent
// }

export type ITextureEventMap = TextureEventMap

declare module 'three'{
    export interface TextureEventMap{
        textureUpdate: {
            // These are handled in dispatchEvent override in iMaterialCommons
            bubbleToObject?: boolean
            bubbleToParent?: boolean
            uiChangeEvent?: ChangeEvent
        } /* & ITextureSetDirtyOptions*/
        // select: { // todo remove?
        //     ui?: boolean
        //     // focusCamera?: boolean // todo ?
        //     bubbleToObject?: boolean
        //     bubbleToParent?: boolean
        //     material: IMaterial
        //     value?: /* IObject3D | */ ITexture | null // todo is this required?
        //
        //     source?: string // who is triggering the event. so that recursive events can be prevented
        // } /* & IObjectSetDirtyOptions*/
    }
}

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

    // _appliedMaterials?: Set<IMaterial> // for internal use only. refers to the materials that this texture is applied to
    /**
     * Objects/Materials in the scene that are using this texture.
     * This is set in the {@link Object3DManager} when the objects are added/removed from the scene. Do not modify this set directly.
     */
    appliedObjects?: Set<IObject3D|IMaterial>

    _target?: IRenderTarget // for internal use only. refers to the render target that this texture is attached to

    uiConfig?: UiObjectConfig
}

export function upgradeTexture(this: ITexture) {
    this.assetType = 'texture'
    if (!this.userData) this.userData = {}
    if (!this.appliedObjects) this.appliedObjects = new Set()
    if (!this.setDirty) this.setDirty = ()=>this.needsUpdate = true
    // todo: uiconfig, dispose, etc

    // if (!this.uiConfig) {
    //
    //     if (this.isVideoTexture) {
    //         this.uiConfig = {
    //             type: 'folder',
    //             label: 'Video Texture',
    //             children: [
    //                 {
    //
    //                 },
    //             ],
    //         }
    //     }
    //
    // }
}
