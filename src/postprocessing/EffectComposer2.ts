import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js'
import {WebGLRenderer, WebGLRenderTarget} from 'three'
import {ExtendedCopyPass} from './ExtendedCopyPass'

export class EffectComposer2 extends EffectComposer {

    copyPass2 = new ExtendedCopyPass()
    constructor(renderer: WebGLRenderer, renderTarget: WebGLRenderTarget) {
        super(renderer, renderTarget)
    }

    setPixelRatio(pixelRatio: number, updateSize = true): void {
        const t = this.setSize
        if (!updateSize) this.setSize = ()=>{return}
        super.setPixelRatio(pixelRatio)
        if (!updateSize) this.setSize = t
    }

}
