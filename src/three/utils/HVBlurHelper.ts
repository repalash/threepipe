import {ShaderMaterial, Texture, WebGLRenderTarget} from 'three'
import {HorizontalBlurShader} from 'three/examples/jsm/shaders/HorizontalBlurShader.js'
import {VerticalBlurShader} from 'three/examples/jsm/shaders/VerticalBlurShader.js'
import {ThreeViewer} from '../../viewer'
import {IRenderTarget} from '../../rendering'

export class HVBlurHelper {
    horizontalBlurMaterial = new ShaderMaterial(HorizontalBlurShader)

    verticalBlurMaterial = new ShaderMaterial(VerticalBlurShader)

    constructor(private _viewer: ThreeViewer) {
        this.horizontalBlurMaterial.depthTest = false
        this.verticalBlurMaterial.depthTest = false
    }

    blur(source: Texture, dest: IRenderTarget & WebGLRenderTarget, tempTarget: IRenderTarget & WebGLRenderTarget, amountMultiplier = 1) {
        this.horizontalBlurMaterial.uniforms.h.value = amountMultiplier
        this.verticalBlurMaterial.uniforms.v.value = amountMultiplier
        this._viewer.renderManager.blit(tempTarget, {
            material: this.horizontalBlurMaterial,
            clear: true,
            source: source, // this._depthPass.target.texture,
        })
        // this._viewer.renderManager.blit(this._depthPass.target, {
        this._viewer.renderManager.blit(dest, {
            material: this.verticalBlurMaterial,
            clear: true,
            source: tempTarget.texture,
        })
    }

    dispose() {
        this.horizontalBlurMaterial.dispose()
        this.verticalBlurMaterial.dispose()
    }

}
