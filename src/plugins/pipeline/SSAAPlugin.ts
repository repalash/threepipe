import {OrthographicCamera, PerspectiveCamera} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {onChange, serialize} from 'ts-browser-helpers'
import {ICamera, ILight, IObject3D} from '../../core'
import {ProgressivePlugin} from './ProgressivePlugin'

export type TCamera = ICamera & (PerspectiveCamera|OrthographicCamera)

/**
 * SSAA Plugin
 *
 * Jitters the render camera and optionally other cameras in the scene
 * to create a super-sampled anti-aliasing effect.
 * This is done across multiple frames by integrating with the ProgressivePlugin
 * @category Plugins
 */
@uiFolderContainer('SSAA Plugin')
export class SSAAPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'SSAAPlugin'

    @serialize() @uiToggle('Enabled')
    @onChange(SSAAPlugin.prototype.setDirty)
        enabled = true

    @serialize() @uiSlider('Renders/Frame', [1, 32], 1)
    @onChange(SSAAPlugin.prototype.setDirty)
        rendersPerFrame = 1

    @serialize() @uiToggle('Render Camera')
    @onChange(SSAAPlugin.prototype.setDirty)
        jitterRenderCamera = true

    @serialize() @uiToggle('Light Cameras')
    @onChange(SSAAPlugin.prototype.setDirty)
        jitterLightCameras = true

    private _hasSetOffsetRC = false
    private _hasSetOffsetLC = false

    public trackedJitterCameras = new Map<TCamera, {width: number, height: number}>() // todo register other cameras and light shadows cameras when added to the scene and changed.

    dependencies = [ProgressivePlugin]

    constructor(rendersPerFrame = 1) {
        super()
        this.rendersPerFrame = rendersPerFrame
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))
        return super.onRemove(viewer)
    }

    setDirty() {
        if (!this._viewer) return
        this._viewer.rendersPerFrame = this.rendersPerFrame
        this._viewer.setDirty()
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const obj = e.object as ILight
        if (obj && obj.shadow && obj.shadow.camera && obj.shadow.mapSize) {
            this.trackedJitterCameras.set(obj.shadow.camera as TCamera, obj.shadow.mapSize)
        }
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const obj = e.object as ILight
        if (obj && obj.shadow && obj.shadow.camera) {
            const camera = obj.shadow.camera as TCamera
            this._clearJitter(camera)
            this.trackedJitterCameras.delete(camera)
        }
    }

    private _jitter(camera: TCamera, size: {
        width: number,
        height: number
    }, frameCount: number) {
        if (camera.userData.disableJitter) return
        if (camera.userData.__jittered) {
            this._viewer?.console.warn('SSAAPlugin: Camera already jittered')
            return
        }
        const sample = {...this.jitterOffsets[frameCount % this.jitterOffsets.length]}
        // const sample = {...offsets[Math.floor(Math.random() * (offsets.length - 0.001))]}
        // {
        //     sample.x += 1 * (Math.random() - 0.5)
        //     sample.y += 1 * (Math.random() - 0.5)
        // }
        camera.setViewOffset(size.width, size.height, sample.x, sample.y, size.width, size.height)
        camera.userData.__jittered = true
    }
    private _clearJitter(camera: TCamera) {
        if (!camera.userData.__jittered) return
        camera.clearViewOffset()
        delete camera.userData.__jittered
    }

    private _preRender = ()=> {
        const v = this._viewer
        if (!v || !this.enabled || v.renderManager.frameCount <= 1) return
        this.rendersPerFrame = v.rendersPerFrame // just to sync. todo: should this be here?. ideally there should be a event fired from the viewer when the prop changes

        const cam = v.scene.renderCamera as TCamera

        if (this.jitterRenderCamera) this._jitter(cam, {
            width: v.renderManager.renderSize.x * v.renderManager.renderScale,
            height: v.renderManager.renderSize.y * v.renderManager.renderScale,
        }, v.renderManager.frameCount)
        if (this.jitterLightCameras)
            this.trackedJitterCameras.entries().forEach((a) => this._jitter(...a, v.renderManager.frameCount))

        this._hasSetOffsetRC = this.jitterRenderCamera
        this._hasSetOffsetLC = this.jitterLightCameras

        v.renderManager.resetShadows()
    }
    private _postRender = ()=> {
        const v = this._viewer
        if (!v) return
        if (this._hasSetOffsetRC) {
            this._clearJitter(v.scene.renderCamera as TCamera)
            this._hasSetOffsetRC = false
        }
        if (this._hasSetOffsetLC) {
            this.trackedJitterCameras.keys().forEach((camera) => this._clearJitter(camera))
            this._hasSetOffsetLC = false
        }
    }

    jitterOffsets = [
        {x: 0, y: 0},
        {x: -0.5, y: 0},
        {x: -0.375, y: -0.25},
        {x: -0.1875, y: -0.125},
        {x: -0.125, y: -0.375},
        {x: 0.0625, y: -0.0625},
        {x: 0.125, y: -0.3125},
        {x: 0.375, y: -0.4375},
        {x: 0.3125, y: -0.1875},
        {x: 0.25, y: 0.0625},
        {x: 0.4375, y: 0.25},
        {x: 0.1875, y: 0.3125},
        {x: 0, y: 0.4375},
        {x: -0.0625, y: 0.1875},
        {x: -0.25, y: 0.375},
        {x: -0.4375, y: 0.5},
        {x: -0.3125, y: 0.125},
    ]
}


