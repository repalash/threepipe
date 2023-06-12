import {UniformsUtils} from 'three'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {glsl} from 'ts-browser-helpers'
import {ExtendedShaderPass} from './ExtendedShaderPass'

export class ExtendedCopyPass extends ExtendedShaderPass {
    constructor() {
        super({
            uniforms: UniformsUtils.clone(CopyShader.uniforms),
            vertexShader: CopyShader.vertexShader,
            fragmentShader: glsl`
                uniform float opacity;
                #include <alphatest_pars_fragment>
                varying vec2 vUv;
                void main() {
                    vec4 diffuseColor = tDiffuseTexelToLinear(texture2D(tDiffuse, vUv)) * opacity;
                    #include <alphatest_fragment>
                    #ifdef OPAQUE
                    diffuseColor.a = 1.0;
                    #endif
                    gl_FragColor = diffuseColor;
                    #include <encodings_fragment>
                }
            `,
        }, 'tDiffuse')
    }
}
