import {ExtendedShaderPass} from './ExtendedShaderPass'
import {
    ColorSpace,
    FrontSide,
    NoBlending,
    ShaderMaterialParameters,
    SRGBColorSpace,
    WebGLMultipleRenderTargets,
    WebGLRenderTarget,
} from 'three'
import {ICamera, IRenderManager, IScene, IWebGLRenderer, ShaderMaterial2} from '../core'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {IPassID, IPipelinePass} from './Pass'
import {uiDropdown, uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {ViewerRenderManager} from '../viewer'
import {matDefineBool, threeConstMappings} from '../three'
import ScreenPassShader from './ScreenPass.glsl'
import {shaderReplaceString} from '../utils'

export type TViewerScreenShaderFrag = string | [string, string] | {pars?: string, main: string}
export type TViewerScreenShader = TViewerScreenShaderFrag | ShaderMaterialParameters | ShaderMaterial2

/**
 * Screen Pass
 *
 * This pass renders the final scene to the screen.
 * It can be extended by Screen Pass Extensions to apply post-processing effects, such as tonemapping, color grading, etc.
 *
 * It is used by default in {@link ViewerRenderManager} to render the final scene.
 * A custom material/shader can be passed to the constructor to use a custom base fragment shader.
 */
@uiFolderContainer('Screen Pass')
export class ScreenPass extends ExtendedShaderPass implements IPipelinePass<'screen'> {
    declare uiConfig: UiObjectConfig
    readonly passId = 'screen'
    after: IPassID[] = ['render']
    required: IPassID[] = ['render']

    constructor(shader: TViewerScreenShader = '', ...textureID: string[]) {
        super(
            (<any>shader)?.fragmentShader || (<ShaderMaterial2>shader)?.isShaderMaterial ? <ShaderMaterialParameters|ShaderMaterial2>shader :
                makeScreenShader(shader),
            ...textureID.length ? textureID : ['tDiffuse', 'tTransparent'])
        this.material.addEventListener('materialUpdate', this.setDirty)
    }

    /**
     * Output Color Space
     * Note: this is ignored when renderToScreen is false (it will take the color space of the render target)
     */
    @uiDropdown('Output Color Space', threeConstMappings.ColorSpace.uiConfig, (t: ScreenPass)=>({onChange: t.setDirty}))
        outputColorSpace: ColorSpace = SRGBColorSpace

    private _lastReadBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget | null, readBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        const colorSpace = renderer.outputColorSpace
        if (!writeBuffer || this.renderToScreen) renderer.outputColorSpace = this.outputColorSpace
        // else console.warn('ScreenPass: outputColorSpace is ignored when renderToScreen is false')
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        this._lastReadBuffer = readBuffer
        renderer.outputColorSpace = colorSpace
        this._needsReRender = false
    }

    reRender(renderer: IWebGLRenderer, writeBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget | null, deltaTime?: number, maskActive?: boolean) {
        if (this._lastReadBuffer) this.render(renderer, writeBuffer, this._lastReadBuffer, deltaTime, maskActive)
    }
    private _needsReRender = false
    onPostFrame(renderManager: IRenderManager) {
        if (!this._needsReRender) return
        this._needsReRender = false
        this.reRender(renderManager.renderer)
        if (this.clipBackground && !(renderManager as ViewerRenderManager).gbufferTarget) {
            // todo warn only when rgbm
            console.warn('ScreenPass: clipBackground set to true but no gbufferTarget set. Try adding GBufferPlugin.')
        }
    }

    dispose() {
        this._lastReadBuffer = undefined
        super.dispose()
    }

    /**
     * Force clip background. If this is `true` {@link clipBackground} is overridden.
     * This happens when scene.background and scene.backgroundColor are both null.
     * This is set in {@link ViewerRenderManager.render}.
     */
    @matDefineBool('CLIP_BACKGROUND_FORCE', undefined, undefined, ScreenPass.prototype.setDirty, true)
        clipBackgroundForce = false

    // todo: this is not serialized anymore? we should serialize this in some plugin...
    @matDefineBool('CLIP_BACKGROUND', undefined, undefined, ScreenPass.prototype.setDirty)
    @uiToggle() clipBackground = false

    beforeRender(_: IScene, _1: ICamera, renderManager: ViewerRenderManager) {
        if (this.material.uniforms.tTransparent) {
            this.material.uniforms.tTransparent.value = renderManager.renderPass.preserveTransparentTarget ? renderManager.renderPass.transparentTarget?.texture || null : null
            this.material.defines.HAS_TRANSPARENT_TARGET = this.material.uniforms.tTransparent.value ? 1 : undefined
            if (!this.material.defines.HAS_TRANSPARENT_TARGET) delete this.material.defines.HAS_TRANSPARENT_TARGET
        }
    }

    setDirty() {
        super.setDirty()
        this._needsReRender = true
    }
}

function makeScreenShader(shader: string | [string, string] | {pars?: string; main: string} | ShaderMaterialParameters | ShaderMaterial2) {
    const baseShader = shaderReplaceString(
        ScreenPassShader,
        'void main()',
        (Array.isArray(shader) ? shader[0] : (<any>shader)?.pars || '') + '\n',
        {prepend: true}
    )
    const finalShader = baseShader.includes('#glMarker') ? shaderReplaceString(
        baseShader,
        '#glMarker',
        (Array.isArray(shader) ? shader[1] : typeof shader === 'string' ? shader : (shader as any)?.main || '') + '\n',
        {prepend: true}
    ) : baseShader
    return {
        ...CopyShader,
        fragmentShader: finalShader,
        uniforms: {
            tDiffuse: {value: null},
            tTransparent: {value: null},
        },
        transparent: true,
        blending: NoBlending,
        side: FrontSide,
    } as ShaderMaterialParameters
}
