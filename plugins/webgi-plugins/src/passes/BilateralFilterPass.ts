import ssaoBilateral from './shaders/ssaoBilateral.glsl'
import {
    CopyShader,
    ExtendedShaderPass, getOrCall,
    IPass,
    IWebGLRenderer,
    serialize,
    uniform, ValOrFunc,
    Vector2,
    WebGLRenderTarget
} from "threepipe";

export class BilateralFilterPass extends ExtendedShaderPass implements IPass {
    @serialize() @uniform() smoothEnabled = true
    @serialize() @uniform() edgeSharpness = 0.1
    // @serialize() @uniform() smoothSigma = new Vector4(1, 0.2, 4., 1)
    // @serialize() @uniform() smoothScale = new Vector4(0, 10, 1, 0)

    constructor(public target?: ValOrFunc<WebGLRenderTarget|undefined>, sourceAccessor = 'rgba') {
        super({
            vertexShader: CopyShader.vertexShader,
            fragmentShader: `
// for gbuffer
#include <packing>
#define THREE_PACKING_INCLUDED
` + ssaoBilateral,
            uniforms: {
                bilDirection: {value: new Vector2(1, 0)},
                // tNormalDepth: {value: null},
                tDiffuse: {value: null},
                tDiffuseSize: {value: new Vector2()},
            },
            defines: {
                ['B_SRC_ACCESSOR']: sourceAccessor,
            },
        }, 'tDiffuse')
        this.clear = false
        this.needsSwap = false
    }

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, _readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (!this.enabled) return
        const target = getOrCall(this.target)
        if(!target) return

        this.uniforms.bilDirection.value.set(1, 0)

        this.uniforms.tDiffuse.value = target.texture
        this.uniforms.tDiffuseSize.value.set(this.uniforms.tDiffuse.value?.image.width || 0, this.uniforms.tDiffuse.value?.image.height || 0)
        super.render(renderer, writeBuffer, target, deltaTime, maskActive)

        this.uniforms.bilDirection.value.set(0, 1)
        this.uniforms.tDiffuse.value = writeBuffer.texture
        this.uniforms.tDiffuseSize.value.set(this.uniforms.tDiffuse.value?.image.width || 0, this.uniforms.tDiffuse.value?.image.height || 0)
        super.render(renderer, target, writeBuffer, deltaTime, maskActive)

        // this.uniforms.bilDirection.value.set(-1, -1)
        // this.uniforms.tDiffuse2.value = target.texture
        // super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)

    }
}
