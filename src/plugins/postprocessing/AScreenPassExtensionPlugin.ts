import {type AViewerPlugin, AViewerPluginSync} from '../../viewer/AViewerPlugin'
import type {IViewerEvent, ThreeViewer} from '../../viewer'
import {MaterialExtension} from '../../materials'
import {Shader, Vector4, WebGLRenderer} from 'three'
import {IMaterial} from '../../core'
import {shaderReplaceString} from '../../utils'
import {GBufferPlugin, GBufferUpdater, GBufferUpdaterContext} from '../pipeline/GBufferPlugin'

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
        const gbuffer = viewer.getPlugin(GBufferPlugin)
        if (gbuffer) gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
        else viewer.addEventListener('addPlugin', this._onPluginAdd)
        viewer.renderManager.screenPass.material.registerMaterialExtensions([this])
    }

    private _onPluginAdd = (e: IViewerEvent)=>{
        if (e.plugin?.constructor?.PluginType !== 'GBuffer') return
        const gbuffer = e.plugin as GBufferPlugin
        gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
        this._viewer?.removeEventListener('addPlugin', this._onPluginAdd)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('addPlugin', this._onPluginAdd)
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
