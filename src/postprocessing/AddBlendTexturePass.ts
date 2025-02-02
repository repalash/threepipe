import {Texture, Vector4} from 'three'
import {CopyShader} from 'three/examples/jsm/shaders/CopyShader.js'
import {ExtendedShaderPass} from './ExtendedShaderPass'
import {IPass} from './Pass'
import {glsl} from 'ts-browser-helpers'

export class AddBlendTexturePass extends ExtendedShaderPass implements IPass {
    constructor(texture?: Texture, maxIntensity = 120) {
        super({
            vertexShader: CopyShader.vertexShader,
            fragmentShader: glsl`
                uniform vec4 weight;
                uniform vec4 weight2;
                varying vec2 vUv;
                void main() {
                    vec4 texel = clamp(weight * tDiffuseTexelToLinear ( texture2D( tDiffuse, vUv ) ) + weight2 * tDiffuse2TexelToLinear ( texture2D( tDiffuse2, vUv ) ), vec4(0), vec4(MAX_INTENSITY));
                    gl_FragColor = texel;
                    #include <colorspace_fragment>
                }
            `,
            uniforms: {
                'tDiffuse': {value: null},
                'tDiffuse2': {value: texture},
                'weight': {value: new Vector4(1, 1, 1, 1)},
                'weight2': {value: new Vector4(1, 1, 1, 1)},
            },
            defines: {
                ['MAX_INTENSITY']: maxIntensity,
            },
        }, 'tDiffuse', 'tDiffuse2')
        this.clear = false
        this.needsSwap = true
    }

}
