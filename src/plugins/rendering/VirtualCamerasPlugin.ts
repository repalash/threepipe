import {AViewerPluginEventMap, AViewerPluginSync} from '../../viewer'
import {IRenderTarget} from '../../rendering'
import {ICamera} from '../../core'
import {uiFolderContainer, uiToggle} from 'uiconfig.js'

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

    addCamera(camera: ICamera, target?: IRenderTarget): VirtualCamera {
        if (!this._viewer) throw 'Plugin not added to viewer'
        target = target ?? this._viewer.renderManager.composerTarget.clone(true)
        target.name = camera.name + '_virtualCamTarget'
        const vCam: VirtualCamera = {camera, target, enabled: true}
        this.cameras.push(vCam)
        // todo: track for jitter in progressive or something else for jittering
        return vCam
    }

}
