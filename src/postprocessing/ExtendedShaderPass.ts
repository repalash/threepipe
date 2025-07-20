import {IPass} from './Pass'
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js'
import {ExtendedShaderMaterial, IWebGLRenderer, ShaderMaterial2} from '../core'
import {ShaderLibShader, ShaderMaterialParameters, Texture, WebGLRenderTarget} from 'three'
import {uiToggle} from 'uiconfig.js'
import {onChange2, serialize} from 'ts-browser-helpers'
import {IShaderPropertiesUpdater} from '../materials'

export class ExtendedShaderPass extends ShaderPass implements IPass {
    public static readonly DEFAULT_TEX_ID = 'tDiffuse'

    declare material: ShaderMaterial2
    overrideReadBuffer: {texture?: WebGLRenderTarget['texture']}|null = null

    readonly isExtendedShaderPass = true
    // private _textureIDs: string[]

    @uiToggle('Enabled') @serialize()
    @onChange2(ExtendedShaderPass.prototype.setDirty)
        enabled = true

    constructor(shader: ShaderMaterial2|ShaderMaterialParameters, ...textureID: string[]) {
        super(
            (<ShaderMaterial2>shader).isMaterial ? <ShaderMaterial2>shader : new ExtendedShaderMaterial(<ShaderMaterialParameters>shader, textureID),
            textureID.length < 1 ? ExtendedShaderPass.DEFAULT_TEX_ID : textureID[0])
        this.setDirty = this.setDirty.bind(this)
    }

    // writes to writeBuffer
    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget<Texture|Texture[]>|null, readBuffer?: WebGLRenderTarget<Texture|Texture[]>, deltaTime?: number, maskActive?: boolean) {
        if (!this.enabled) return
        renderer.renderWithModes({
            backgroundRender: false,
        }, ()=>{
            // @ts-expect-error todo fix render target ts?
            super.render(renderer, writeBuffer || null, (this.overrideReadBuffer as WebGLRenderTarget) || readBuffer, deltaTime, maskActive)
        })
    }

    /**
     * to be called from beforeRender or onObjectRender or similar.
     * @param updater
     */
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
        if (this.material) this.material.needsUpdate = true // do this when material defines etc are changed
        this.onDirty?.forEach(v=>v())
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
    constructor(shader: ShaderLibShader|ShaderMaterial2, ...textureID: string[]) {
        console.error('ShaderPass2 is renamed to ExtendedShaderPass')
        super(shader, ...textureID)
    }
}

