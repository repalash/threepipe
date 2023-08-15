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
import {IWebGLRenderer, ShaderMaterial2} from '../core'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {IPassID, IPipelinePass} from './Pass'
import {uiFolderContainer} from 'uiconfig.js'

export type TViewerScreenShaderFrag = string | [string, string] | {pars?: string, main: string}
export type TViewerScreenShader = TViewerScreenShaderFrag | ShaderMaterialParameters | ShaderMaterial2

@uiFolderContainer('Screen Pass')
export class ScreenPass extends ExtendedShaderPass implements IPipelinePass<'screen'> {
    readonly passId = 'screen'
    after: IPassID[] = ['render']
    required: IPassID[] = ['render']

    constructor(shader: TViewerScreenShader, ...textureID: string[]) {
        super(
            (<any>shader)?.fragmentShader || (<ShaderMaterial2>shader)?.isShaderMaterial ? <ShaderMaterialParameters|ShaderMaterial2>shader :
                makeScreenShader(shader),
            ...textureID.length ? textureID : ['tDiffuse'])
    }

    outputColorSpace: ColorSpace = SRGBColorSpace

    private _lastReadBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget | null, readBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        const colorSpace = renderer.outputColorSpace
        if (!writeBuffer || this.renderToScreen) renderer.outputColorSpace = this.outputColorSpace
        else console.warn('ScreenPass: outputColorSpace is ignored when renderToScreen is false')
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
}

function makeScreenShader(shader: string | [string, string] | {pars?: string; main: string} | ShaderMaterialParameters | ShaderMaterial2) {
    return {
        ...CopyShader,
        fragmentShader: `
varying vec2 vUv;

#include <alphatest_pars_fragment>
${Array.isArray(shader) ? shader[0] : (<any>shader)?.pars || ''}

void main() {

    vec4 diffuseColor = tDiffuseTexelToLinear (texture2D(tDiffuse, vUv));
    
    #glMarker
    
    ${Array.isArray(shader) ? shader[1] : typeof shader === 'string' ? shader : (shader as any)?.main || ''}
        
    #include <alphatest_fragment>
    #ifdef OPAQUE
    diffuseColor.a = 1.0;
    #endif
    gl_FragColor = diffuseColor;
    #include <encodings_fragment>
}`,
        uniforms: {
            tDiffuse: {value: null},
        },
        transparent: true,
        blending: NoBlending,
        side: FrontSide,
    } as ShaderMaterialParameters
}
