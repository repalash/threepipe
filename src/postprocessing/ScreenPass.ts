import {ExtendedShaderPass} from './ExtendedShaderPass'
import {ColorSpace, Shader, SRGBColorSpace, WebGLMultipleRenderTargets, WebGLRenderTarget} from 'three'
import {IWebGLRenderer, ShaderMaterial2} from '../core'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {IPassID, IPipelinePass} from './Pass'
import {uiFolderContainer} from 'uiconfig.js'

export type TViewerScreenShaderFrag = string | [string, string] | {pars?: string, main: string}
export type TViewerScreenShader = TViewerScreenShaderFrag | Shader | ShaderMaterial2

@uiFolderContainer('Screen Pass')
export class ScreenPass extends ExtendedShaderPass implements IPipelinePass<'screen'> {
    readonly passId = 'screen'
    after: IPassID[] = ['render']
    required: IPassID[] = ['render']

    constructor(shader: TViewerScreenShader, ...textureID: string[]) {
        super(
            (<any>shader)?.fragmentShader || (<ShaderMaterial2>shader)?.isShaderMaterial ? <Shader|ShaderMaterial2>shader :
                makeScreenShader(shader),
            ...textureID.length ? textureID : ['tDiffuse'])
    }

    outputColorSpace: ColorSpace = SRGBColorSpace

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget | null, readBuffer?: WebGLMultipleRenderTargets | WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        const colorSpace = renderer.outputColorSpace
        if (!writeBuffer || this.renderToScreen) renderer.outputColorSpace = this.outputColorSpace
        else console.warn('ScreenPass: outputColorSpace is ignored when renderToScreen is false')
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        renderer.outputColorSpace = colorSpace
    }
}

function makeScreenShader(shader: string | [string, string] | {pars?: string; main: string} | Shader | ShaderMaterial2) {
    return {
        ...CopyShader,
        fragmentShader: `
varying vec2 vUv;

${Array.isArray(shader) ? shader[0] : (<any>shader)?.pars || ''}

void main() {

    gl_FragColor = tDiffuseTexelToLinear (texture2D(tDiffuse, vUv));
    
    ${Array.isArray(shader) ? shader[1] : typeof shader === 'string' ? shader : (shader as any)?.main || ''}
    
    #include <encodings_fragment>
}`,
        uniforms: {
            tDiffuse: {value: null},
        },
    }
}

