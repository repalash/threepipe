import {IPassID, IPipelinePass} from '../../postprocessing'
import {AViewerPluginEventMap, AViewerPluginSync, ISerializedConfig, ThreeViewer} from '../../viewer'
import {onChange, serialize} from 'ts-browser-helpers'
import {SerializationMetaType, wrapThisFunction2} from '../../utils'
import {uiToggle} from 'uiconfig.js'
import {ICamera, IRenderManager, IScene} from '../../core'

/**
 * Pipeline Pass Plugin
 *
 * Base class for creating a plugin that registers a custom pass to the main render pipeline
 *
 * @category Plugins
 */
export abstract class PipelinePassPlugin<T extends IPipelinePass, TPassId extends IPassID, TEvent extends AViewerPluginEventMap = AViewerPluginEventMap, TViewer extends ThreeViewer=ThreeViewer> extends AViewerPluginSync<TEvent, TViewer> {
    abstract passId: TPassId

    @serialize()
    @uiToggle('Enabled')
    @onChange(PipelinePassPlugin.prototype.setDirty)
        enabled = true

    // @uiConfig()
    @serialize('pass')
    protected _pass?: T
    protected abstract _createPass():T

    /**
     * This function is called every frame before composer render, if this pass is being used in the pipeline
     * @param _
     * @param _1
     * @param _2
     */
    protected _beforeRender(_?: IScene, _1?: ICamera, _2?: IRenderManager): boolean {
        if (!this._pass) return false
        this._pass.enabled = !this.isDisabled()
        return this._pass.enabled
    }

    constructor() {
        super()
        this._beforeRender = this._beforeRender.bind(this)
    }
    onAdded(viewer: TViewer): void {
        super.onAdded(viewer)

        this._pass = this._createPass()
        this._pass.onDirty?.push(viewer.setDirty)
        this._pass.beforeRender = wrapThisFunction2(this._beforeRender, this._pass.beforeRender)
        viewer.renderManager.registerPass(this._pass)
    }

    onRemove(viewer: TViewer): void {
        if (this._pass) {
            viewer.renderManager.unregisterPass(this._pass)
            if (this._pass.dispose) this._pass.dispose()
        }
        this._pass = undefined
        super.onRemove(viewer)
    }

    get pass(): T | undefined {
        return this._pass
    }

    toJSON(meta?: SerializationMetaType): ISerializedConfig&{pass?: any} {
        return super.toJSON(meta)
    }

    fromJSON(data: ISerializedConfig&{pass?: any}, meta?: SerializationMetaType): this|null|Promise<this|null> {
        return super.fromJSON(data, meta)
    }

    setDirty() {
        if (this._pass) this._pass.enabled = !this.isDisabled()
        this._viewer?.setDirty()
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 100) // adding delay for a few frames, so render target(if any can update)
    }

}
