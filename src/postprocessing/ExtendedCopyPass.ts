import {UniformsUtils} from 'three'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {getOrCall, glsl, ValOrFunc} from 'ts-browser-helpers'
import {ExtendedShaderPass} from './ExtendedShaderPass'

export class ExtendedCopyPass extends ExtendedShaderPass {
    constructor(snippet?: ValOrFunc<string, [string]>, respectColorSpace = true) {
        super({
            uniforms: UniformsUtils.clone(CopyShader.uniforms),
            vertexShader: CopyShader.vertexShader,
            fragmentShader: glsl`
                uniform float opacity;
                #include <alphatest_pars_fragment>
                varying vec2 vUv;
                void main() {
                    ${respectColorSpace ?
        'vec4 diffuseColor = tDiffuseTexelToLinear(texture2D(tDiffuse, vUv)) * opacity;' :
        'vec4 diffuseColor = texture2D(tDiffuse, vUv) * opacity;'}
                    #include <alphatest_fragment>
                    ${snippet ? getOrCall(snippet, 'diffuseColor') : ''}
                    #ifdef OPAQUE
                    diffuseColor.a = 1.0;
                    #endif
                    gl_FragColor = diffuseColor;
                    ${respectColorSpace ? '#include <colorspace_fragment>' : ''}
                }
            `,
        }, 'tDiffuse')
    }
}
