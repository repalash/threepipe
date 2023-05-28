import {IRenderTarget, RenderManager} from '../rendering'
import {HalfFloatType, NoColorSpace, RGBM16ColorSpace, UnsignedByteType} from 'three'
import {IRenderManagerOptions} from '../core'
import {ExtendedRenderPass, ScreenPass, TViewerScreenShader} from '../postprocessing'
import {uiFolderContainer} from 'uiconfig.js'

export interface ViewerRenderManagerOptions extends IRenderManagerOptions {
    rgbm?: boolean,
    msaa?: boolean,
    depthBuffer?: boolean,
    zPrepass?: boolean,
    screenShader?: TViewerScreenShader
}

@uiFolderContainer('Render Manager')
export class ViewerRenderManager extends RenderManager {
    readonly rgbm: boolean
    readonly msaa: boolean
    readonly depthBuffer: boolean
    readonly zPrepass: boolean
    readonly renderPass: ExtendedRenderPass
    readonly screenPass: ScreenPass

    constructor({rgbm = true, msaa = false, depthBuffer = false, ...options}: ViewerRenderManagerOptions) {
        super({
            ...options,
            targetOptions: {
                samples: msaa ? 4 : 0,
                colorSpace: rgbm ? RGBM16ColorSpace : NoColorSpace,
                type: rgbm ? UnsignedByteType : HalfFloatType,
                depthBuffer: depthBuffer,
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
        this.screenPass = new ScreenPass(options.screenShader || '') // todo gamma correction by default?
        this.registerPass(this.renderPass)
        this.registerPass(this.screenPass)
    }

    /**
     * Reference to the gbuffer target, if it exists. This can be set by plugins like {@link DepthBufferPlugin}
     */
    gbufferTarget: IRenderTarget | undefined

}
