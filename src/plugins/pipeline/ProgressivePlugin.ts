import {IUniform, Texture, TextureDataType, UnsignedByteType, WebGLRenderTarget} from 'three'
import {IPassID, IPipelinePass} from '../../postprocessing'
import {ISerializedConfig, ThreeViewer} from '../../viewer'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiFolderContainer, uiImage, uiInput} from 'uiconfig.js'
import {ICamera, IRenderManager, IScene, IWebGLRenderer} from '../../core'
import {AddBlendTexturePass} from '../../postprocessing/AddBlendTexturePass'
import {getOrCall, serialize, ValOrFunc} from 'ts-browser-helpers'
import {IShaderPropertiesUpdater} from '../../materials'
import {SerializationMetaType} from '../../utils'
import {SSAAPlugin} from './SSAAPlugin'

export type ProgressivePluginTarget = WebGLRenderTarget

/**
 * Progressive Plugin
 *
 * Adds a post-render pass to blend the last frame with the current frame.
 * This can be used to create a progressive rendering effect which is useful for progressive shadows, gi, denoising, baking, anti-aliasing, and many other effects.
 * @category Plugins
 */
@uiFolderContainer('Progressive Plugin')
export class ProgressivePlugin
    extends PipelinePassPlugin<ProgressiveBlendPass, 'progressive'> implements IShaderPropertiesUpdater {

    readonly passId = 'progressive'
    public static readonly PluginType = 'ProgressivePlugin'
    public static readonly OldPluginType = 'Progressive'

    /**
     * Different targets for different render cameras.
     * Need to save them all here since we need them in the next frame.
     * @protected
     */
    protected _targets = new Map<string, ProgressivePluginTarget>()

    @serialize() @uiInput('Frame count') maxFrameCount: number

    // @uiImage('Last Texture', {readOnly: true}) texture?: Texture

    get texture(): Texture | undefined {
        return this.target?.texture
    }

    get target(): ProgressivePluginTarget | undefined {
        return this._viewer ? this._targets.get(this._viewer.scene.renderCamera.uuid) : undefined
    }

    getTarget(camera?: ICamera) {
        return this._viewer ? this._targets.get((camera ? camera : this._viewer.scene.renderCamera).uuid) : undefined
    }

    get textures() {
        return this._viewer ? Array.from(this._targets.values()).map(t => t.texture) : []
    }

    @uiImage('Last Texture', {readOnly: true})
    get mainTexture() {
        return this._viewer ? this.getTarget(this._viewer.scene.mainCamera)?.texture : undefined
    }

    /**
     * Note - this is not used right now
     */
    // @onChange2(ProgressivePlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    constructor(
        maxFrameCount = 32,
        bufferType: TextureDataType = UnsignedByteType, // this is not used. todo use halffloat when rgbm = false
        enabled = true,
    ) {
        super()
        this.maxFrameCount = maxFrameCount
        this.enabled = enabled
        this.bufferType = bufferType
    }

    protected _createTarget(camera?: ICamera, recreate = false) {
        if (!this._viewer) return
        camera = camera ?? this._viewer.scene.renderCamera
        if (recreate) this._disposeTarget(camera)
        if (this._targets.has(camera.uuid)) return this._targets.get(camera.uuid)
        const target = this._viewer.renderManager.composerTarget.clone(true) as WebGLRenderTarget
        target.texture.name = 'progressiveLastBuffer_' + camera.uuid
        // target.texture.type = this.bufferType
        this._targets.set(camera.uuid, target)
        // if (this._pass) this._pass.target = this.target
        return target
    }

    protected _disposeTarget(camera?: ICamera) {
        if (!this._viewer) return
        if (!camera) {
            this._targets.forEach((t) => this._viewer!.renderManager.disposeTarget(t))
            this._targets.clear()
        } else {
            const t = this._targets.get(camera.uuid)
            if (t) {
                this._viewer!.renderManager.disposeTarget(t)
                this._targets.delete(camera.uuid)
            }
        }
    }

    protected _createPass() {
        // this._createTarget(true)
        const pass = new ProgressiveBlendPass(this.passId, ()=>this.target ?? this._createTarget(), this._viewer?.renderManager.maxHDRIntensity) // todo: disposeTarget somewhere
        pass.dirty = () => (this._viewer?.renderManager.frameCount || 0) < this.maxFrameCount // todo use isConverged function
        return pass
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        return super.onRemove(viewer)
    }
    /**
     *
     * @param postRender - if called after rendering frame.
     */
    public isConverged(postRender = false): boolean {
        return (this._viewer?.renderManager.frameCount || 0) >= this.maxFrameCount - 1 + (postRender ? 1 : 0)
    }

    updateShaderProperties(material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}}): this {
        if (material.uniforms.tLastFrame) material.uniforms.tLastFrame.value = this.target?.texture ?? undefined
        return this
    }

    /**
     * Get recording delta post render, For use with animations to sync with converge mode in canvas recorder. See PopmotionPlugin for usage.
     * @returns {number} - delta time in milliseconds, or 0 when converging, or -1 in case of not recording in converge mode
     */
    postFrameConvergedRecordingDelta(_ = 'CanvasRecorder'): number {
        // const recorder = this._viewer!.getPluginByType<IConvergedCanvasRecorder&IViewerPlugin>(recorderPlugin)
        // if (recorder && recorder.isRecording() && recorder.convergeMode)
        //     return this.isConverged(true) ? 1. / recorder.videoFrameRate : 0
        return -1
    }

    get convergedPromise() {
        return new Promise<void>(resolve=>{
            if (this.isConverged()) {
                this._viewer?.doOnce('postFrame', ()=>resolve())
            } else {
                const l = ()=>{
                    if (!this.isConverged(true)) return
                    this._viewer?.removeEventListener('postRender', l)
                    this._viewer?.doOnce('postFrame', ()=>resolve())
                }
                this._viewer?.addEventListener('postRender', l)
            }
        })
    }

    fromJSON(data: ISerializedConfig&{pass?: any}, meta?: SerializationMetaType): this|null|Promise<this|null> {
        if (data.jitter !== undefined) {
            const ssaa = this._viewer?.getPlugin(SSAAPlugin)
            if (!ssaa) {
                console.warn('Loading old webgi v0 file, add SSAAPlugin to get anti-aliasing')
            } else {
                data = {...data}
                ssaa.enabled = data.jitter
                delete data.jitter
            }
        }
        return super.fromJSON(data, meta)
    }

}

export class ProgressiveBlendPass extends AddBlendTexturePass implements IPipelinePass {
    before = ['screen']
    after = ['render']
    required = ['render']
    dirty: ValOrFunc<boolean> = () => false
    constructor(public readonly passId: IPassID, public target?: ValOrFunc<WebGLRenderTarget|undefined>, maxIntensity = 120) {
        super(undefined, maxIntensity)
    }

    copyToWriteBuffer = true

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (!this.enabled) return
        const target = getOrCall(this.target)
        if (!target) {
            console.warn('ProgressiveBlendPass: target not defined')
            return
        }
        this.needsSwap = false
        if (renderer.renderManager.frameCount < 1) {
            if (readBuffer?.texture)
                renderer.renderManager.blit(target, {
                    source: readBuffer.texture,
                    respectColorSpace: false,
                })
            return
        }
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)

        if (this.copyToWriteBuffer) {
            renderer.renderManager.blit(target, {
                source: writeBuffer.texture,
                respectColorSpace: false,
            })
            this.needsSwap = true
        }
    }

    beforeRender(_: IScene, _1: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        if (!this.target) {
            console.error('ProgressiveBlendPass: render target undefined')
            return
        }
        let f = 1. / (Math.max(renderManager.frameCount, 0) + 1)
        this.uniforms.weight.value.set(f, f, f, f)
        f = 1. - f
        this.uniforms.weight2.value.set(f, f, f, f)
        this.uniforms.tDiffuse2.value = getOrCall(this.target)?.texture
        this.material.uniformsNeedUpdate = true
    }

}
