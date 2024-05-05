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

@uiFolderContainer('Screen Pass')
export class ScreenPass extends ExtendedShaderPass implements IPipelinePass<'screen'> {
    uiConfig!: UiObjectConfig
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
    }

    reRender(renderer: IWebGLRenderer, writeBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget | null, deltaTime?: number, maskActive?: boolean) {
        if (this._lastReadBuffer) this.render(renderer, writeBuffer, this._lastReadBuffer, deltaTime, maskActive)
    }
    private _needsReRender = false
    onPostFrame(renderManager: IRenderManager) {
        if (!this._needsReRender) return
        this._needsReRender = false
        this.reRender(renderManager.renderer)
    }

    dispose() {
        this._lastReadBuffer = undefined
        super.dispose()
    }

    // todo test
    @matDefineBool('CLIP_BACKGROUND', undefined, undefined, ScreenPass.prototype.setDirty, true)
    @uiToggle() clipBackground = false // todo show warning that gbuffer is required

    beforeRender(_: IScene, _1: ICamera, renderManager: ViewerRenderManager) {
        this.material.uniforms.tTransparent.value = renderManager.renderPass.preserveTransparentTarget ? renderManager.renderPass.transparentTarget?.texture || null : null
        this.material.defines.HAS_TRANSPARENT_TARGET = this.material.uniforms.tTransparent.value ? 1 : undefined
        if (!this.material.defines.HAS_TRANSPARENT_TARGET) delete this.material.defines.HAS_TRANSPARENT_TARGET
    }

    setDirty() {
        super.setDirty()
        this._needsReRender = true
    }
}

function makeScreenShader(shader: string | [string, string] | {pars?: string; main: string} | ShaderMaterialParameters | ShaderMaterial2) {
    return {
        ...CopyShader,
        fragmentShader:
            shaderReplaceString(shaderReplaceString(ScreenPassShader,
                'void main()', (Array.isArray(shader) ? shader[0] : (<any>shader)?.pars || '') + '\n', {prepend: true}),
            '#glMarker', (Array.isArray(shader) ? shader[1] : typeof shader === 'string' ? shader : (shader as any)?.main || '') + '\n', {prepend: true}),
        uniforms: {
            tDiffuse: {value: null},
            tTransparent: {value: null},
        },
        transparent: true,
        blending: NoBlending,
        side: FrontSide,
    } as ShaderMaterialParameters
}
