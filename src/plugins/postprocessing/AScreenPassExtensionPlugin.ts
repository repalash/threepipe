import {AViewerPlugin, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {MaterialExtension} from '../../materials'
import {Shader, Vector4, WebGLRenderer} from 'three'
import {IMaterial} from '../../core'
import {shaderReplaceString} from '../../utils'

// todo move
export interface GBufferUpdater {
    updateGBufferFlags: (material: IMaterial, data: Vector4) => void
}

/**
 * Base Screen Pass Extension Plugin
 *
 * Extend the class to add an extension to {@link ScreenPass} material.
 * See {@link TonemapPlugin} and {@link VignettePlugin} for examples.
 *
 *
 * @category Plugins
 */
export abstract class AScreenPassExtensionPlugin<T extends string> extends AViewerPluginSync<T> implements MaterialExtension, GBufferUpdater {
    declare ['constructor']: (typeof AScreenPassExtensionPlugin) & (typeof AViewerPluginSync) & (typeof AViewerPlugin)

    abstract enabled: boolean

    set uniformsNeedUpdate(v: boolean) { // for @uniform decorator
        if (v) this.setDirty()
    }

    constructor() {
        super()
        this.setDirty = this.setDirty.bind(this)
    }

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -100

    protected _shaderPatch = ''

    shaderExtender(shader: Shader, _: IMaterial, _1: WebGLRenderer): void {
        if (!this.enabled) return

        shader.fragmentShader = shaderReplaceString(
            shader.fragmentShader,
            '#glMarker', '\n' + this._shaderPatch + '\n',
            {prepend: true}
        )
    }

    getUiConfig(): any {
        return this.uiConfig
    }

    computeCacheKey = (_: IMaterial) => this.enabled ? '1' : '0'

    isCompatible(_: IMaterial): boolean {
        return true // (material as MeshStandardMaterial2).isMeshStandardMaterial2
    }

    setDirty() {
        this.__setDirty?.() // this will update version which will set needsUpdate on material
        this._viewer?.renderManager.screenPass.setDirty()
    }

    fromJSON(data: any, meta?: any): this | null | Promise<this | null> {
        // really old legacy
        if (data.pass) {
            data = {...data}
            data.extension = {...data.pass}
            delete data.extension.enabled
            delete data.pass
        }
        // legacy
        if (data.extension) {
            data = {...data, ...data.extension}
            delete data.extension
        }
        return super.fromJSON(data, meta)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // viewer.getPlugin(GBufferPlugin)?.registerGBufferUpdater(this.updateGBufferFlags) // todo
        viewer.renderManager.screenPass.material.registerMaterialExtensions([this])
    }

    onRemove(viewer: ThreeViewer) {
        // viewer.getPlugin(GBufferPlugin)?.unregisterGBufferUpdater(this.updateGBufferFlags)
        viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this])
        super.onRemove(viewer)
    }

    // updateGBufferFlags(material: IMaterial, data: Vector4): void {
    //     const x = material?.userData.postTonemap === false ? 0 : 1
    //     data.w = updateBit(data.w, 1, x) // 2nd Bit
    // }

    // for typescript
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __setDirty?: () => void

    updateGBufferFlags(_: IMaterial, _1: Vector4): void {
        return
    }

}
