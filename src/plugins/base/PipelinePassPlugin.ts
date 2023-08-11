import {IPassID, IPipelinePass} from '../../postprocessing'
import {AViewerPluginSync, ISerializedConfig, ThreeViewer} from '../../viewer'
import {AnyFunction, serialize} from 'ts-browser-helpers'
import {SerializationMetaType} from '../../utils'
import {uiConfig, uiToggle} from 'uiconfig.js'

export abstract class PipelinePassPlugin<T extends IPipelinePass, TPassId extends IPassID, TEvent extends string, TViewer extends ThreeViewer=ThreeViewer> extends AViewerPluginSync<TEvent, TViewer> {
    abstract passId: TPassId

    @serialize()
    @uiToggle('Enabled')
    get enabled(): boolean {
        return this._pass?.enabled || this._enabledTemp
    }

    set enabled(value: boolean) {
        if (this._pass) this._pass.enabled = value
        this._enabledTemp = value
    }


    @uiConfig()
    @serialize('pass')
    protected _pass?: T
    abstract createPass(v:TViewer):T

    /**
     * This function is called every frame before composer render, if this pass is being used in the pipeline
     * @param _
     * @protected
     */
    protected _beforeRender(): boolean {return this._pass?.enabled && this.enabled || false}
    private _enabledTemp = true // to save enabled state when pass is not yet created


    constructor() {
        super()
        this._beforeRender = this._beforeRender.bind(this)
    }
    onAdded(viewer: TViewer): void {
        super.onAdded(viewer)

        this._pass = this.createPass(viewer)
        this._pass.onDirty?.push(viewer.setDirty)
        this._pass.beforeRender = wrapThisFunction(this._beforeRender, this._pass.beforeRender)
        viewer.renderManager.registerPass(this._pass)
        this.enabled = this._enabledTemp
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

}

function wrapThisFunction<T extends AnyFunction, T2>(f1: ()=>void, f2?: T): T {
    return function(this: T2, ...args: Parameters<T>) {
        f1()
        return f2 && f2.call(this, ...args)
    } as T
}
