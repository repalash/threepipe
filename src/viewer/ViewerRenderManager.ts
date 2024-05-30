import {IRenderTarget, RenderManager} from '../rendering'
import {HalfFloatType, LinearMipMapLinearFilter, NoColorSpace, RGBM16ColorSpace, UnsignedByteType} from 'three'
import {IRenderManagerEvent, IRenderManagerOptions, IScene} from '../core'
import {ExtendedRenderPass, ScreenPass, TViewerScreenShader} from '../postprocessing'
import {uiFolderContainer, UiObjectConfig} from 'uiconfig.js'
import {MaterialExtension} from '../materials'
import {onChange3} from 'ts-browser-helpers'

export interface ViewerRenderManagerOptions extends IRenderManagerOptions {
    rgbm?: boolean,
    msaa?: boolean | number,
    depthBuffer?: boolean,
    zPrepass?: boolean,
    screenShader?: TViewerScreenShader
}

@uiFolderContainer('Render Manager')
export class ViewerRenderManager extends RenderManager<IRenderManagerEvent, 'gbufferUnpackExtensionChanged'> {
    readonly rgbm: boolean
    readonly msaa: boolean | number
    readonly depthBuffer: boolean
    readonly zPrepass: boolean
    readonly renderPass: ExtendedRenderPass
    readonly screenPass: ScreenPass
    declare uiConfig: UiObjectConfig

    constructor({rgbm = true, msaa = false, depthBuffer = false, ...options}: ViewerRenderManagerOptions) {
        super({
            ...options,
            targetOptions: {
                samples: msaa ? typeof msaa !== 'number' ? 4 : msaa : 0,
                colorSpace: rgbm ? RGBM16ColorSpace : NoColorSpace,
                type: rgbm ? UnsignedByteType : HalfFloatType,
                depthBuffer: depthBuffer,
                generateMipmaps: msaa ? true : undefined, // todo: hack for now, fix blurTransmissionTarget in ExtendedRenderPass
                minFilter: msaa ? LinearMipMapLinearFilter : undefined, // todo: hack for now, fix blurTransmissionTarget in ExtendedRenderPass
            },
        })
        this.rgbm = rgbm
        this.msaa = msaa && this.isWebGL2
        this.depthBuffer = depthBuffer
        this.zPrepass = options.zPrepass || false

        let doTransmissionFix = true // const for debugging, todo could be made into a static prop maybe?
        if (!this._renderer.userData) {
            doTransmissionFix = false
            this._renderer.userData = {__isIWebGLRenderer: true}
        }
        this._renderer.userData.renderTransmissionPass = !doTransmissionFix // hack. used in WebGLRenderer.js

        this.renderPass = new ExtendedRenderPass(this)
        this.screenPass = new ScreenPass(options.screenShader || '')
        this.registerPass(this.renderPass)
        this.registerPass(this.screenPass)
    }

    /**
     * Reference to the gbuffer target, if it exists. This can be set by plugins like {@link DepthBufferPlugin}, {@link GBufferPlugin}
     */
    gbufferTarget: IRenderTarget | undefined
    /**
     * The extension that can be used to upload and unpack the values in gbuffer target(s), if it exists. This can be set by plugins like {@link DepthBufferPlugin}, {@link GBufferPlugin}
     * Note: this should not be changed after set by some plugin.
     */
    @onChange3(ViewerRenderManager.prototype._gbufferUnpackExtensionChanged)
        gbufferUnpackExtension: MaterialExtension | undefined

    private _gbufferUnpackExtensionChanged(params: any) {
        this.dispatchEvent({type: 'gbufferUnpackExtensionChanged', ...params})
    }

    render(scene: IScene, renderToScreen?: boolean): void {
        const cbf = this.screenPass.clipBackgroundForce
        if (this.rgbm) {
            const val = !scene.background && !scene.backgroundColor
            if (val !== cbf) this.screenPass.clipBackgroundForce = val
        }
        super.render(scene, renderToScreen)
    }
}
