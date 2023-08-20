import {IUniform, Texture, TextureDataType, UnsignedByteType, WebGLRenderTarget} from 'three'
import {IPassID, IPipelinePass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiFolderContainer, uiImage, uiInput} from 'uiconfig.js'
import {ICamera, IRenderManager, IScene, IWebGLRenderer} from '../../core'
import {AddBlendTexturePass} from '../../postprocessing/AddBlendTexturePass'
import {serialize, ValOrFunc} from 'ts-browser-helpers'

export type ProgressivePluginEventTypes = ''
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
    extends PipelinePassPlugin<ProgressiveBlendPass, 'progressive', ProgressivePluginEventTypes> {

    readonly passId = 'progressive'
    public static readonly PluginType = 'ProgressivePlugin'

    target?: ProgressivePluginTarget

    @serialize() @uiInput('Frame count') maxFrameCount: number
    // todo: deserialize jitter

    @uiImage('Last Texture' /* {readOnly: true}*/) texture?: Texture

    // @onChange2(ProgressivePlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    constructor(
        maxFrameCount = 32,
        bufferType: TextureDataType = UnsignedByteType,
        enabled = true,
    ) {
        super()
        this.maxFrameCount = maxFrameCount
        this.enabled = enabled
        this.bufferType = bufferType
    }

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()
        if (!this.target) this.target = this._viewer.renderManager.composerTarget.clone(true) as WebGLRenderTarget

        this.texture = this.target.texture
        this.texture.name = 'progressiveLastBuffer'

        if (this._pass) this._pass.target = this.target
    }

    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this.texture = undefined
    }

    protected _createPass() {
        this._createTarget(true)
        if (!this.target) throw new Error('ProgressivePlugin: target not created')
        const pass = new ProgressiveBlendPass(this.passId, this.target)
        pass.dirty = () => (this._viewer?.renderManager.frameCount || 0) < this.maxFrameCount // todo use isConverged function
        return pass
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
        return (this._viewer?.renderer.frameCount || 0) >= this.maxFrameCount - 1 + (postRender ? 1 : 0)
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

}

class ProgressiveBlendPass extends AddBlendTexturePass implements IPipelinePass {
    before = ['screen']
    after = ['render']
    required = ['render']
    dirty: ValOrFunc<boolean> = () => false
    constructor(public readonly passId: IPassID, public target: WebGLRenderTarget) {
        super()
    }
    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (renderer.renderManager.frameCount < 1) {
            this.needsSwap = false
            if (readBuffer?.texture)
                renderer.renderManager.blit(this.target, {
                    source: readBuffer.texture,
                    respectColorSpace: false,
                })
            return
        }
        this.needsSwap = true
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        renderer.renderManager.blit(this.target, {
            source: writeBuffer.texture,
            respectColorSpace: false,
        })
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
        this.uniforms.tDiffuse2.value = this.target.texture
        this.material.uniformsNeedUpdate = true
    }

}
