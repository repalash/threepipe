import {IPipelinePass} from './Pass'
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js'
import {
    Color,
    HalfFloatType,
    LinearFilter,
    Material,
    NoColorSpace,
    RGBAFormat,
    Texture,
    UnsignedByteType,
    WebGLRenderTarget,
} from 'three'
import {generateUiConfig, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {GenericBlendTexturePass} from './GenericBlendTexturePass'
import {IRenderTarget} from '../rendering'
import {ICamera, IRenderManager, IScene, IWebGLRenderer} from '../core'
import {ViewerRenderManager} from '../viewer'

export class ExtendedRenderPass extends RenderPass implements IPipelinePass<'render'> {
    readonly isExtendedRenderPass = true

    @uiToggle('Enabled') @serialize() enabled = true
    readonly passId = 'render'

    private _blendPass: GenericBlendTexturePass
    readonly renderManager: ViewerRenderManager
    private _doTransmissionFix = true
    blurTransmissionTarget = true
    preserveTransparentTarget = false
    private _transparentTarget?: IRenderTarget

    get transparentTarget(): IRenderTarget {
        if (!this._transparentTarget) {
            const msaa = this.renderManager.msaa
            this._transparentTarget = this.renderManager.getTempTarget({
                sizeMultiplier: 1,
                samples: msaa ? typeof msaa !== 'number' ? ViewerRenderManager.DEFAULT_MSAA_SAMPLES : msaa : 0,
                colorSpace: NoColorSpace,
                type: this.renderManager.renderer.extensions.has('EXT_color_buffer_half_float') ? HalfFloatType : UnsignedByteType,
                format: RGBAFormat,
                minFilter: LinearFilter,
                magFilter: LinearFilter,
                depthBuffer: false,
            })
        }
        return this._transparentTarget
    }

    private _releaseTransparentTarget() {
        if (this._transparentTarget)
            this.renderManager.releaseTempTarget(this._transparentTarget)
        this._transparentTarget = undefined
    }

    readonly preserveOpaqueTarget = false
    private _opaqueTarget?: WebGLRenderTarget

    get opaqueTarget(): WebGLRenderTarget {
        if (!this._opaqueTarget) {
            const composerTarget = this.renderManager.composerTarget as WebGLRenderTarget
            const msaa = this.renderManager.msaa
            this._opaqueTarget = this.renderManager.getTempTarget({
                sizeMultiplier: 1,
                samples: msaa ? typeof msaa !== 'number' ? ViewerRenderManager.DEFAULT_MSAA_SAMPLES : msaa : 0,
                colorSpace: composerTarget.texture.colorSpace,
                type: this.renderManager.rgbm ? UnsignedByteType : HalfFloatType,
                format: composerTarget.texture.format,
                minFilter: composerTarget.texture.minFilter,
                magFilter: composerTarget.texture.magFilter,
                depthBuffer: composerTarget.depthBuffer,
                generateMipmaps: composerTarget.texture.generateMipmaps,
            })
            // console.log(this._opaqueTarget.samples)
        }
        return this._opaqueTarget
    }
    private _releaseOpaqueTarget() {
        if (this._opaqueTarget)
            this.renderManager.releaseTempTarget(this._opaqueTarget)
        this._opaqueTarget = undefined
    }

    constructor(renderManager: ViewerRenderManager, overrideMaterial?: Material, clearColor = new Color(0, 0, 0), clearAlpha = 0) {
        super(undefined, undefined, overrideMaterial, clearColor, clearAlpha)
        this.renderManager = renderManager
        this._blendPass = new GenericBlendTexturePass({}, 'c = vec4(a.rgb * (1. - b.a) + b.rgb * b.a, 1.);', '', undefined, renderManager.maxHDRIntensity)
        this.setDirty = this.setDirty.bind(this)
    }

    // names are incorrect. We read from `writeBuffer` and write to `readBuffer`. same in super class
    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget<Texture|Texture[]>|null, readBuffer?: WebGLRenderTarget<Texture|Texture[]>, deltaTime?: number, maskActive?: boolean) {
        if (!this.enabled) return
        let needsSwap = false

        renderer.userData.mainRenderPass = true
        if (!this._doTransmissionFix && !this.renderManager.rgbm) {
            super.render(renderer, writeBuffer || null, readBuffer, deltaTime, maskActive)
            this.needsSwap = needsSwap
            renderer.userData.mainRenderPass = undefined
            return
        }

        const ud = renderer.userData
        if (!ud) console.error('threejs is not patched. Use the @repalash/three.js-modded to this functionality.')

        const useGBufferDepth = (this.renderManager.zPrepass || !this.renderManager.depthBuffer) && this.renderManager.gbufferTarget
        let depthRenderBuffer: WebGLRenderbuffer | undefined = undefined

        if (useGBufferDepth) {

            const gbuffer = this.renderManager.gbufferTarget
            if (gbuffer) {
                const renderBufferProps = renderer.properties.get(gbuffer)
                depthRenderBuffer = renderBufferProps.__webglDepthRenderbuffer || renderBufferProps.__webglDepthbuffer
            }
            if (!depthRenderBuffer) {
                console.warn('No depth/gbuffer present for zPrepass.')
            }

        }

        const lastReadBuffer = readBuffer

        // if msaa we need to create a new multi sampled target to render to

        // todo
        readBuffer = this.renderManager.msaa ? this.opaqueTarget : readBuffer
        // readBuffer = this.opaqueTarget
        // if(readBuffer?.samples !== gbuffer?.samples)
        //     console.error('ExtendedRenderPass - readBuffer and gbuffer samples are not same', readBuffer?.samples, gbuffer?.samples)

        let renderFn = ()=> {
            super.render(renderer, null, readBuffer, deltaTime, maskActive, depthRenderBuffer) // read is write in super.render (RenderPass)
        }

        if (!this.renderManager.rgbm) {

            // Opaque + Transparent
            {

                const curClear = this.clear
                const curClearDepth = renderer.autoClearDepth
                renderer.autoClearDepth = !useGBufferDepth
                this.clear = true

                renderer.renderWithModes({
                    shadowMapRender: true,
                    backgroundRender: true,
                    opaqueRender: true,
                    transparentRender: true,
                    transmissionRender: false,
                }, renderFn)

                this.clear = curClear
                renderer.autoClearDepth = curClearDepth

            }

            // Transmissive
            {
                const source = !readBuffer ? undefined : Array.isArray(readBuffer.texture) ? readBuffer.texture[0] : readBuffer.texture
                // todo: first check if any transmissive object is there to use this buffer
                this.renderManager.blit(writeBuffer, {clear: true, source})
                // viewer.renderer.blit(writeBuffer.texture as any, readBuffer as any, {})
                // super.render(renderer, undefined as any, writeBuffer, deltaTime, maskActive); // copy read to write buffer

                const curClear = this.clear
                this.clear = false

                // don't need this clear is already false
                // const curClearDepth = renderer.autoClearDepth
                // renderer.autoClearDepth = false

                ud.transmissionRenderTarget = writeBuffer
                ud.blurTransmissionTarget = this.blurTransmissionTarget && ud.transmissionRenderTarget.samples === 0 // todo: not working with msaa target. its fine now because writeBuffer is never multi sampled

                renderer.renderWithModes({
                    shadowMapRender: false,
                    backgroundRender: false,
                    opaqueRender: false,
                    transparentRender: false,
                    transmissionRender: true,
                }, renderFn)

                ud.blurTransmissionTarget = undefined
                ud.transmissionRenderTarget = undefined

                // renderer.autoClearDepth = curClearDepth

                this.clear = curClear
            }

            needsSwap = false

        } else if (this.renderManager.rgbm) {

            needsSwap = false

            const renderToScreen = this.renderToScreen
            if (renderToScreen && !writeBuffer) {
                console.error('ExtendedRenderPass: renderToScreen is true but writeBuffer is not set, which is required for rgbm')
            }
            this.renderToScreen = false // for super RenderPass.render

            if (renderer.info && !renderer.info.autoReset)
                throw 'renderer.info.autoReset must be true' // it is required to check if any object is rendered in the scene, also frame count is maintained separately in the render manager, use that.


            // Opaque
            {
                const curClearDepth = renderer.autoClearDepth
                renderer.autoClearDepth = !useGBufferDepth

                renderer.renderWithModes({
                    shadowMapRender: true,
                    backgroundRender: true,
                    opaqueRender: true,
                    transparentRender: false,
                    transmissionRender: false,
                }, renderFn) // render to readBuffer

                renderer.autoClearDepth = curClearDepth

            }

            if (!useGBufferDepth && readBuffer) {
                const renderBufferProps2 = renderer.properties.get(readBuffer)
                depthRenderBuffer = renderBufferProps2.__webglDepthRenderbuffer || renderBufferProps2.__webglDepthbuffer
            }

            // readBuffer has data

            renderFn = ()=> {
                super.render(renderer, null, this.transparentTarget as any, deltaTime, maskActive, depthRenderBuffer)
            }

            // Transparent
            {
                const curClear = this.clear
                const curClearDepth = renderer.autoClearDepth
                renderer.autoClearDepth = false
                this.clear = true

                renderer.renderWithModes({
                    shadowMapRender: false,
                    backgroundRender: false,
                    opaqueRender: false,
                    transparentRender: true,
                    transmissionRender: false,
                }, renderFn) // render to transparentTarget

                this.clear = curClear
                renderer.autoClearDepth = curClearDepth
            }

            if (!renderer.info || renderer.info.render.calls > 0) {

                // writeBuffer = transparentTarget + readBuffer
                this._blendPass.uniforms.tDiffuse2.value = this.transparentTarget.texture
                this._blendPass.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
                needsSwap = true // writeBuffer has the data now.

            }

            // if needsSwap, writeBuffer has data, else readBuffer

            // Transmission
            {
                const curClear = this.clear
                this.clear = false // it is cleared in transparent pass above even if no object is rendered

                // const curClearDepth = renderer.autoClearDepth
                // renderer.autoClearDepth = false

                // if needsSwap, writeBuffer has current data, else readBuffer
                ud.transmissionRenderTarget = needsSwap ? writeBuffer : readBuffer
                ud.blurTransmissionTarget = this.blurTransmissionTarget && ud.transmissionRenderTarget.samples === 0 // todo: not working with msaa

                renderer.renderWithModes({
                    shadowMapRender: false,
                    backgroundRender: false,
                    opaqueRender: false,
                    transparentRender: false,
                    transmissionRender: true,
                }, renderFn) // render to transparentTarget

                ud.blurTransmissionTarget = undefined
                ud.transmissionRenderTarget = undefined

                // renderer.autoClearDepth = curClearDepth

                this.clear = curClear
            }

            // console.log(renderer.info.render.calls)
            if (!renderer.info || renderer.info.render.calls > 0) {

                // console.log('missive blit', renderer.info.render.frame)

                // writeBuffer = transparentTarget + readBuffer. opaque will overwrite opaque pixels again
                this._blendPass.uniforms.tDiffuse2.value = this.transparentTarget.texture
                this._blendPass.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
                needsSwap = true // writeBuffer has the data now.

            }

            // if needsSwap, writeBuffer has data, else readBuffer

            if (renderToScreen) {
                this.renderToScreen = true
                const tex = needsSwap ? writeBuffer?.texture : readBuffer?.texture
                const source = Array.isArray(tex) ? tex[0] : tex
                source && this.renderManager.blit(undefined, {
                    source, respectColorSpace: true,
                })
                // needsSwap = false
            }

        }

        // todo no need to do this if renderToScreen is true
        // resolve msaa
        if (!needsSwap && lastReadBuffer !== readBuffer && readBuffer) {
            // copy from readBuffer to lastReadBuffer
            const source = Array.isArray(readBuffer.texture) ? readBuffer.texture[0] : readBuffer.texture
            source && this.renderManager.blit(lastReadBuffer, {
                source: source, clear: true,
            })
            readBuffer = lastReadBuffer
        }

        if (!this.preserveTransparentTarget)
            this._releaseTransparentTarget()
        if (!this.preserveOpaqueTarget)
            this._releaseOpaqueTarget()

        this.needsSwap = needsSwap
        renderer.userData.mainRenderPass = undefined
    }


    public onDirty: (()=>void)[] = []
    dispose() {
        this._releaseTransparentTarget()
        this.onDirty = []
        this.scene = undefined
        this.camera = undefined
        super.dispose?.()
    }

    setDirty() {
        this.onDirty.forEach(v=>v())
    }

    beforeRender(scene: IScene, camera: ICamera, _: IRenderManager): void {
        this.scene = scene
        this.camera = camera
    }

    uiConfig: UiObjectConfig = {
        label: 'Render Pass',
        type: 'folder',
        children: generateUiConfig(this),
    }


    // legacy

    /**
     * @deprecated renamed to {@link isExtendedRenderPass}
     */
    get isRenderPass2() {
        console.error('isRenderPass2 is deprecated, use isExtendedRenderPass instead')
        return true
    }

}

/**
 * @deprecated renamed to {@link ExtendedRenderPass}
 */
export class RenderPass2 extends ExtendedRenderPass {
    constructor(...args: ConstructorParameters<typeof ExtendedRenderPass>) {
        console.error('RenderPass2 is deprecated, use ExtendedRenderPass instead')
        super(...args)
    }
}

