import {IPassID, IPipelinePass} from '../../postprocessing'
import {AViewerPluginSync, ISerializedConfig, ThreeViewer} from '../../viewer'
import {onChange, serialize, wrapThisFunction} from 'ts-browser-helpers'
import {SerializationMetaType} from '../../utils'
import {uiConfig, uiToggle} from 'uiconfig.js'

export abstract class PipelinePassPlugin<T extends IPipelinePass, TPassId extends IPassID, TEvent extends string, TViewer extends ThreeViewer=ThreeViewer> extends AViewerPluginSync<TEvent, TViewer> {
    abstract passId: TPassId

    @serialize()
    @uiToggle('Enabled')
    @onChange(PipelinePassPlugin.prototype.setDirty)
        enabled = true

    @uiConfig()
    @serialize('pass')
    protected _pass?: T
    protected abstract _createPass():T

    /**
     * This function is called every frame before composer render, if this pass is being used in the pipeline
     * @param _
     */
    protected _beforeRender(): boolean {
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
        this._pass.beforeRender = wrapThisFunction(this._beforeRender, this._pass.beforeRender)
        viewer.renderManager.registerPass(this._pass)
    }

    onRemove(viewer: TViewer): void {
        if (this._pass) viewer.renderManager.unregisterPass(this._pass)
        this._pass?.dispose?.()
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
