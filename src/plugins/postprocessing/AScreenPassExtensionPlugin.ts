import {type AViewerPlugin, AViewerPluginEventMap, AViewerPluginSync} from '../../viewer/AViewerPlugin'
import type {ThreeViewer} from '../../viewer'
import {MaterialExtension, MaterialExtensionShader} from '../../materials'
import {Vector4, WebGLRenderer} from 'three'
import {IMaterial} from '../../core'
import {shaderReplaceString} from '../../utils'
import {GBufferPlugin} from '../pipeline/GBufferPlugin'
import {GBufferUpdater, GBufferUpdaterContext} from '../pipeline/GBufferMaterial'

/**
 * Base Screen Pass Extension Plugin
 *
 * Extend the class to add an extension to {@link ScreenPass} material.
 * See {@link TonemapPlugin} and {@link VignettePlugin} for examples.
 *
 *
 * @category Plugins
 */
export abstract class AScreenPassExtensionPlugin<TE extends AViewerPluginEventMap = AViewerPluginEventMap> extends AViewerPluginSync<TE> implements MaterialExtension, GBufferUpdater {
    declare ['constructor']: (typeof AScreenPassExtensionPlugin) & (typeof AViewerPluginSync) & (typeof AViewerPlugin)

    abstract enabled: boolean

    set uniformsNeedUpdate(v: boolean) { // for @uniform decorator
        if (v) this.setDirty()
    }

    constructor(shaderPatch = '') {
        super()
        this._shaderPatch = shaderPatch
        this.setDirty = this.setDirty.bind(this)
    }

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -100

    protected _shaderPatch = ''

    shaderExtender(shader: MaterialExtensionShader, _: IMaterial, _1: WebGLRenderer): void {
        if (this.isDisabled()) return

        shader.fragmentShader = shaderReplaceString(
            shader.fragmentShader,
            '#glMarker', '\n' + this._shaderPatch + '\n',
            {prepend: true}
        )
    }

    getUiConfig(): any {
        return this.uiConfig
    }

    computeCacheKey = (_: IMaterial) => this.isDisabled() ? '0' : '1'

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
        viewer.forPlugin(GBufferPlugin, (gbuffer) => {
            gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
        }, (gbuffer)=>{
            gbuffer.unregisterGBufferUpdater(this.constructor.PluginType)
        }, this)
        viewer.renderManager.screenPass.material.registerMaterialExtensions([this])
    }

    onRemove(viewer: ThreeViewer) {
        viewer.getPlugin(GBufferPlugin)?.unregisterGBufferUpdater(this.constructor.PluginType)
        viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this])
        super.onRemove(viewer)
    }

    // for typescript
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __setDirty?: () => void

    updateGBufferFlags(_: Vector4, _1: GBufferUpdaterContext): void {
        return
    }

}
