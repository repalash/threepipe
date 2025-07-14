import {IRenderTarget, RenderManager} from '../rendering'
import {HalfFloatType, LinearFilter, NoColorSpace, RGBM16ColorSpace, UnsignedByteType} from 'three'
import {IRenderManagerOptions, IScene} from '../core'
import {ExtendedRenderPass, ScreenPass, TViewerScreenShader} from '../postprocessing'
import {uiFolderContainer, UiObjectConfig} from 'uiconfig.js'
import {MaterialExtension} from '../materials'
import {onChange3} from 'ts-browser-helpers'
import {IRenderManagerEventMap} from '../core/IRenderer'

export interface ViewerRenderManagerOptions extends IRenderManagerOptions {
    rgbm?: boolean,
    msaa?: boolean | number,
    depthBuffer?: boolean,
    stencilBuffer?: boolean,
    zPrepass?: boolean,
    screenShader?: TViewerScreenShader
    maxHDRIntensity?: number
}

export interface ViewerRenderManagerEventMap extends IRenderManagerEventMap{
    gbufferUnpackExtensionChanged: {
        key: string;
        value: any;
        oldValue: any;
        // target: TTarget;
    }
}

@uiFolderContainer('Render Manager')
export class ViewerRenderManager extends RenderManager<ViewerRenderManagerEventMap> {
    readonly rgbm: boolean
    readonly msaa: boolean | number
    readonly depthBuffer: boolean
    readonly zPrepass: boolean
    readonly maxHDRIntensity: number
    readonly renderPass: ExtendedRenderPass
    readonly screenPass: ScreenPass
    declare uiConfig: UiObjectConfig

    static DEFAULT_MSAA_SAMPLES = 4

    constructor({rgbm = true, msaa = false, depthBuffer = true, stencilBuffer = false, ...options}: ViewerRenderManagerOptions) {
        super({
            ...options,
            targetOptions: {
                samples: 0,
                // samples: msaa ? typeof msaa !== 'number' ? ViewerRenderManager.DEFAULT_MSAA_SAMPLES : msaa : 0,
                colorSpace: rgbm ? RGBM16ColorSpace : NoColorSpace,
                type: rgbm ? UnsignedByteType : HalfFloatType,
                depthBuffer: depthBuffer,
                stencilBuffer: stencilBuffer,
                generateMipmaps: /* msaa ? true : */false, // todo: hack for now, fix blurTransmissionTarget in ExtendedRenderPass
                minFilter: /* msaa ? LinearMipMapLinearFilter : */LinearFilter, // todo: hack for now, fix blurTransmissionTarget in ExtendedRenderPass
            },
        })
        this.rgbm = rgbm
        this.msaa = msaa && this.isWebGL2
        this.depthBuffer = depthBuffer
        this.zPrepass = options.zPrepass || false
        this.maxHDRIntensity = options.maxHDRIntensity ?? (rgbm ? 16 : 72)

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
