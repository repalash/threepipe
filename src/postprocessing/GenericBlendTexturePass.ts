import {IUniform} from 'three/src/renderers/shaders/UniformsLib'
import {Texture} from 'three'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {ExtendedShaderPass} from './ExtendedShaderPass'
import {IPass} from './Pass'
import {glsl} from 'ts-browser-helpers'

export class GenericBlendTexturePass extends ExtendedShaderPass implements IPass {
    constructor(uniforms: {[uniform: string]: IUniform}, blendFunc = 'c = a + b;', extraFrag = '', texture?: Texture) {
        super({
            vertexShader: CopyShader.vertexShader,
            fragmentShader: glsl`
                varying vec2 vUv;
                ${extraFrag}
                void blend(in vec4 a, in vec4 b, inout vec4 c){
                ${blendFunc}
                }
                void main() {
                    vec4 texel = vec4(0);
                    blend(tDiffuseTexelToLinear ( texture2D( tDiffuse, vUv ) ), tDiffuse2TexelToLinear ( texture2D( tDiffuse2, vUv ) ), texel);
                    texel = clamp(texel, vec4(0), vec4(8));
                    gl_FragColor = texel;
                    #include <encodings_fragment>
                }
            `,
            uniforms: {
                'tDiffuse': {value: null},
                'tDiffuse2': {value: texture},
                ...uniforms,
            },
        }, 'tDiffuse', 'tDiffuse2')
        this.clear = false
        this.needsSwap = true
    }

}
