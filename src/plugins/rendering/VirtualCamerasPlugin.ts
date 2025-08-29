import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IRenderTarget} from '../../rendering'
import {ICamera, IObjectExtension} from '../../core'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import type {RenderTargetPreviewPlugin} from '../ui/RenderTargetPreviewPlugin'

export interface VirtualCamerasPluginEventMap extends AViewerPluginEventMap {
    preRenderCamera: {camera: VirtualCamera}
    preBlitCamera: {camera: VirtualCamera, readBuffer: WebGLTexture}
    postRenderCamera: {camera: VirtualCamera}
}

export interface VirtualCamera {
    camera: ICamera
    target: IRenderTarget
    enabled: boolean
}
@uiFolderContainer('Virtual Cameras')
export class VirtualCamerasPlugin extends AViewerPluginSync<VirtualCamerasPluginEventMap> {
    public static readonly PluginType = 'VirtualCamerasPlugin'

    @uiToggle()
        enabled = true

    toJSON: any = undefined // disable serialization

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    cameras: VirtualCamera[] = []

    protected _viewerListeners = {
        preRender: () => {
            if (this.isDisabled() || !this._viewer) return
            const viewer = this._viewer
            for (const v of this.cameras) {
                if (!v.enabled) continue
                const camera = v.camera
                try {
                    this.dispatchEvent({type: 'preRenderCamera', camera: v})
                    viewer.scene.renderCamera = camera
                    viewer.renderManager.render(viewer.scene, false)
                    const source = viewer.renderManager.composer.readBuffer.texture
                    this.dispatchEvent({type: 'preBlitCamera', camera: v, readBuffer: source})
                    viewer.renderManager.blit(v.target, {source})
                    this.dispatchEvent({type: 'postRenderCamera', camera: v})
                } catch (e: any) {
                    viewer.console.error(e)
                    v.enabled = false
                    if (viewer.debug) throw e
                }
            }
        },
    }

    private _objectExtension: IObjectExtension = {
        uuid: 'VirtualCameraPluginExt',
        isCompatible: object => object.isCamera,
        getUiConfig: (object): UiObjectConfig[]|undefined => {
            if (!object.isCamera) return undefined
            return [{
                type: 'button',
                label: 'Add Virtual Camera',
                hidden: ()=>!!this.cameras.find(f=>f.camera === object),
                onClick: () => {
                    if (!this._viewer) return
                    this.addCamera(object as ICamera, undefined, true)
                    object.setDirty()
                    return ()=>{
                        this.removeCamera(object as ICamera)
                        object.setDirty()
                    }
                },
            }, {
                type: 'button',
                label: 'Virtual Camera Enabled',
                hidden: ()=>!this.cameras.find(f=>f.camera === object),
                getValue: ()=>{
                    const vCam = this.cameras.find(f => f.camera === object)
                    return vCam ? vCam.enabled : false
                },
                setValue: ()=>{
                    const vCam = this.cameras.find(f => f.camera === object)
                    if (vCam) {
                        vCam.enabled = !vCam.enabled
                        return vCam.enabled
                    }
                    return false
                },
            }, {
                type: 'button',
                label: 'Remove Virtual Camera',
                hidden: ()=>!this.cameras.find(f=>f.camera === object),
                onClick: () => {
                    if (!this._viewer) return
                    this.removeCamera(object as ICamera)
                    object.setDirty()
                    return ()=>{
                        this.addCamera(object as ICamera, undefined, true)
                        object.setDirty()
                    }
                },
            }]
        },
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo save camera state in userData?
        viewer.object3dManager.registerObjectExtension(this._objectExtension)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.unregisterObjectExtension(this._objectExtension)
        super.onRemove(viewer)
    }

    addCamera(camera: ICamera, target?: IRenderTarget, addTargetPreview = false): VirtualCamera {
        if (!this._viewer) throw 'Plugin not added to viewer'
        target = target ?? this._viewer.renderManager.composerTarget.clone(true)
        target.name = camera.name + '_virtualCamTarget'
        const vCam: VirtualCamera = {camera, target, enabled: true}
        this.cameras.push(vCam)
        // todo: track for jitter in progressive or something else for jittering

        if (addTargetPreview) {
            const rt = this._viewer.getPlugin<RenderTargetPreviewPlugin>('RenderTargetPreviewPlugin')
            rt?.addTarget(target, camera.name, false, false, true)
        }
        return vCam
    }

    removeCamera(camera: ICamera): boolean {
        if (!this._viewer) throw 'Plugin not added to viewer'
        const index = this.cameras.findIndex(f => f.camera === camera)
        if (index >= 0) {
            const vCam = this.cameras[index]
            this.cameras.splice(index, 1)
            const rt = this._viewer.getPlugin<RenderTargetPreviewPlugin>('RenderTargetPreviewPlugin')
            rt?.removeTarget(vCam.target)
            vCam.target.dispose()
            return true
        }
        return false

    }

}
