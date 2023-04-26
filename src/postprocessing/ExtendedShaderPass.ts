import {IPass} from './Pass'
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js'
import {ExtendedShaderMaterial, IWebGLRenderer, ShaderMaterial2} from '../core'
import {Shader, WebGLMultipleRenderTargets, WebGLRenderTarget} from 'three'
import {uiToggle} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {IShaderPropertiesUpdater} from '../materials'

export class ExtendedShaderPass extends ShaderPass implements IPass {
    public static readonly DEFAULT_TEX_ID = 'tDiffuse'

    material!: ShaderMaterial2
    overrideReadBuffer: WebGLRenderTarget|null = null

    readonly isExtendedShaderPass = true
    // private _textureIDs: string[]

    @uiToggle('Enabled') @serialize() enabled = true

    constructor(shader: Shader|ShaderMaterial2, ...textureID: string[]) {
        super(
            (<ShaderMaterial2>shader).isMaterial ? <ShaderMaterial2>shader : new ExtendedShaderMaterial(<Shader>shader, textureID),
            textureID.length < 1 ? ExtendedShaderPass.DEFAULT_TEX_ID : textureID[0])
    }

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLMultipleRenderTargets|WebGLRenderTarget|null, readBuffer?: WebGLMultipleRenderTargets|WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        if (!this.enabled) return
        super.render(renderer, writeBuffer || null, this.overrideReadBuffer || readBuffer, deltaTime, maskActive)
    }

    updateShaderProperties(updater?: (IShaderPropertiesUpdater|undefined) | (IShaderPropertiesUpdater|undefined)[]) {
        if (!updater) return
        if (!Array.isArray(updater)) updater = [updater]
        updater.forEach(value => value?.updateShaderProperties(this.material))
    }

    public onDirty: (()=>void)[] = []
    dispose() {
        this.material?.dispose?.()
        this.fsQuad?.dispose?.()
        this.onDirty = []
    }

    setDirty() {
        this.onDirty.forEach(v=>v())
    }


    // legacy

    /**
     * @deprecated renamed to {@link isExtendedShaderPass}
     */
    get isShaderPass2() {
        console.error('isShaderPass2 is deprecated, use isExtendedShaderPass instead')
        return true
    }

}

/**
 * @deprecated renamed to {@link ExtendedShaderPass}
 */
export class ShaderPass2 extends ExtendedShaderPass {
    constructor(shader: Shader|ShaderMaterial2, ...textureID: string[]) {
        console.error('ShaderPass2 is renamed to ExtendedShaderPass')
        super(shader, ...textureID)
    }
}

