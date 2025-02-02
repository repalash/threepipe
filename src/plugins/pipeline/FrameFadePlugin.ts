import {LinearFilter, WebGLRenderTarget} from 'three'
import {IPassID, IPipelinePass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiFolderContainer, uiToggle} from 'uiconfig.js'
import {ITexture, IWebGLRenderer} from '../../core'
import {AddBlendTexturePass} from '../../postprocessing/AddBlendTexturePass'
import {now, serialize, timeout, ValOrFunc} from 'ts-browser-helpers'
import {ProgressivePlugin} from './ProgressivePlugin'
import {IRenderTarget} from '../../rendering'

/**
 * FrameFade Plugin
 *
 * Adds a post-render pass to smoothly fade to a new rendered frame over time.
 * This is useful for example when changing the camera position, material, object properties, etc to avoid a sudden jump.
 * @category Plugins
 */
@uiFolderContainer('FrameFade Plugin')
export class FrameFadePlugin
    extends PipelinePassPlugin<FrameFadeBlendPass, 'frameFade'> {

    readonly passId = 'frameFade'
    public static readonly PluginType = 'FrameFadePlugin'

    dependencies = [ProgressivePlugin]

    // disables fadeOn... options but not serialized
    isEditor = false

    @serialize() @uiToggle() fadeOnActiveCameraChange = true
    @serialize() @uiToggle() fadeOnMaterialUpdate = true
    @serialize() @uiToggle() fadeOnSceneUpdate = true

    protected _pointerEnabled = true
    protected _target?: IRenderTarget

    constructor(
        enabled = true,
    ) {
        super()
        this.enabled = enabled
        this.startTransition = this.startTransition.bind(this)
        this.stopTransition = this.stopTransition.bind(this)
        this._fadeCam = this._fadeCam.bind(this)
        this._fadeMat = this._fadeMat.bind(this)
        this.isDisabled = ((sup)=>()=>!this._pointerEnabled || sup())(this.isDisabled)
    }

    saveFrameTimeThreshold = 500 // ms

    /**
     * Start a frame fade transition.
     * Note that the current frame data will only be used if the last running transition is ended or near the end. To do it anyway, call {@link stopTransition} first
     * @param duration
     */
    public async startTransition(duration: number) { // duration in ms
        if (!this._viewer || !this._pass || this.isDisabled()) return
        if (!this._target)
            this._target = this._viewer.renderManager.getTempTarget({
                sizeMultiplier: 1.,
                minFilter: LinearFilter,
                magFilter: LinearFilter,
                colorSpace: (this._viewer.renderManager.composerTarget.texture as ITexture).colorSpace,
            })

        if (this._pass.fadeTimeState < this.saveFrameTimeThreshold) // only save if very near the end
            this._pass.toSaveFrame = true

        this._pass.fadeTimeState = Math.max(duration, this._pass.fadeTimeState)
        this._pass.fadeTime = this._pass.fadeTimeState
        // this._pass.enabled = true
        this.setDirty()
        await timeout(duration)
    }

    /**
     * Stop a frame fade transition if running. Note that it will be stopped next frame.
     */
    public stopTransition() {
        if (!this._pass) return
        this._pass.fadeTimeState = 0. // will be stopped in update on next frame
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('mainCameraUpdate', this.stopTransition)
        viewer.scene.addEventListener('mainCameraChange', this._fadeCam)
        viewer.scene.addEventListener('materialUpdate', this._fadeMat)
        viewer.scene.addEventListener('sceneUpdate', this._fadeScene)
        viewer.scene.addEventListener('objectUpdate', this._fadeObjectUpdate)
        window.addEventListener('pointermove', this._onPointerMove) // has to be on window
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('mainCameraUpdate', this.stopTransition)
        viewer.scene.removeEventListener('mainCameraChange', this._fadeCam)
        viewer.scene.removeEventListener('materialUpdate', this._fadeMat)
        viewer.scene.removeEventListener('sceneUpdate', this._fadeScene)
        viewer.scene.removeEventListener('objectUpdate', this._fadeObjectUpdate)
        window.removeEventListener('pointermove', this._onPointerMove)
        super.onRemove(viewer)
    }

    private _fadeCam = async(ev: any)=>
        ev.frameFade !== false && !this.isEditor && this.fadeOnActiveCameraChange && this.startTransition(ev.fadeDuration || 1000)
    private _fadeMat = async(ev: any)=>
        ev.frameFade !== false && !this.isEditor && this.fadeOnMaterialUpdate && this.startTransition(ev.fadeDuration || 200)
    private _fadeScene = async(ev: any)=>
        ev.frameFade !== false && !this.isEditor && this.fadeOnSceneUpdate && this.startTransition(ev.fadeDuration || 500)
    private _fadeObjectUpdate = async(ev: any)=>
        ev.frameFade && !this.isEditor && this.startTransition(ev.fadeDuration || 500)

    private _onPointerMove = (ev: PointerEvent)=> {
        const canvas = this._viewer?.canvas
        if (!canvas) {
            this._pointerEnabled = false
            return
        }

        // no button is pressed
        if (!ev.buttons || ev.target !== canvas) {
            this._pointerEnabled = true
            return
        }

        // check if pointer is over canvas
        const rect = canvas.getBoundingClientRect()
        const x = (ev.clientX - rect.left) / rect.width
        const y = (ev.clientY - rect.top) / rect.height
        this._pointerEnabled = x < 0 || x > 1 || y < 0 || y > 1
    }

    setDirty() {
        super.setDirty()
        if (this.isDisabled()) return
        this._viewer?.setDirty()
    }

    get dirty() {
        return !this.isDisabled() && !!this._pass && this._pass.fadeTimeState > 0
    }

    set dirty(_: boolean) {
        console.error('FrameFadePlugin.dirty is readonly')
    }

    protected _createPass() {
        return new FrameFadeBlendPass(this.passId, this, this._viewer?.renderManager.maxHDRIntensity)
    }

    get canFrameFade() {
        return this._target && this._pointerEnabled &&
            this.dirty && this._pass &&
            this._pass.fadeTimeState > 0.001 &&
            this._viewer && this._viewer.scene.renderCamera === this._viewer.scene.mainCamera
    }

    get lastFrame() {
        return this._viewer?.getPlugin(ProgressivePlugin)?.texture
    }

    get target() {
        return this._target
    }

    protected _beforeRender(): boolean {
        if (!super._beforeRender() || !this._pass) return false

        if (this.isDisabled()) this.stopTransition()

        if (this._pass.fadeTimeState < 0.001) {
            this._pass.toSaveFrame = false
            if (this._target && this._viewer) {
                this._viewer.renderManager.releaseTempTarget(this._target)
                this._target = undefined
            }
        }
        return true
    }

}

export class FrameFadeBlendPass extends AddBlendTexturePass implements IPipelinePass {
    before = ['progressive', 'taa']
    after = ['render']
    required = ['render', 'progressive']
    dirty: ValOrFunc<boolean> = () => false

    fadeTime = 0 // ms
    fadeTimeState = 0
    toSaveFrame = false

    private _lastTime = 0

    constructor(public readonly passId: IPassID, public plugin: FrameFadePlugin, maxIntensity = 120) {
        super(undefined, maxIntensity)
    }

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        this.needsSwap = false
        const target = this.plugin.target

        if (!this.plugin.canFrameFade || !target) return
        const lastFrame = this.plugin.lastFrame
        if (this.toSaveFrame && lastFrame) {
            renderer.renderManager.blit(target, {source: lastFrame, respectColorSpace: false})
            this._lastTime = 0
            this.toSaveFrame = false
        }

        this.uniforms.tDiffuse2.value = target.texture

        const weight = this.fadeTimeState / this.fadeTime
        this.uniforms.weight2.value.setScalar(weight)
        this.uniforms.weight2.value.w = 1
        this.uniforms.weight.value.setScalar(1. - weight)
        this.uniforms.weight.value.w = 1
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        this.needsSwap = true

        const time = now()
        if (this._lastTime < 10) this._lastTime = time - 10 // ms
        const dt = time - this._lastTime
        this._lastTime = time

        this.fadeTimeState -= dt
    }

}

declare module '../../core/IObject'{
    export interface IObjectSetDirtyOptions{
        frameFade?: boolean
    }
}