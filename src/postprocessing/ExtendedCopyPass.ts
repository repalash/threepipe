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
                uniform float alphaTest;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = tDiffuseTexelToLinear(texture2D(tDiffuse, vUv)) * opacity;
                    #ifdef USE_ALPHATEST
                    if ( gl_FragColor.a < alphaTest ) discard;
                    #endif
                    #ifdef OPAQUE
                    gl_FragColor.a = 1.0;
                    #endif
                    #include <encodings_fragment>
                }
            `,
        }, 'tDiffuse')
    }
}
