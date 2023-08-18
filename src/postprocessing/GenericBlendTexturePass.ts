import {IUniform} from 'three/src/renderers/shaders/UniformsLib'
import {Texture} from 'three'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {ExtendedShaderPass} from './ExtendedShaderPass'
import {IPass} from './Pass'

export class GenericBlendTexturePass extends ExtendedShaderPass implements IPass {
    constructor(uniforms: {[uniform: string]: IUniform}, blendFunc = 'c = a + b;', extraFrag = '', texture?: Texture) {
        super({
            vertexShader: CopyShader.vertexShader,
            fragmentShader: `
                varying vec2 vUv;
                ${extraFrag}
                void main() {
                    vec4 a = tDiffuseTexelToLinear ( texture2D( tDiffuse, vUv ) )
                    vec4 b = tDiffuse2TexelToLinear ( texture2D( tDiffuse2, vUv ) )
                    vec4 c = vec4(0);
                    ${blendFunc}
                    c = clamp(c, vec4(0), vec4(8));
                    gl_FragColor = c;
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
