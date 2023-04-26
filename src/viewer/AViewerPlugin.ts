import {ISerializedConfig, ThreeViewer} from './ThreeViewer'
import {BaseEvent, EventDispatcher} from 'three'
import {SerializationMetaType, ThreeSerialization} from '../utils'
import {IViewerPlugin, IViewerPluginAsync} from './IViewerPlugin'

/**
 * Base Class for Viewer Plugins
 * @category Viewer
 */
export abstract class AViewerPlugin<T extends string, TViewer extends ThreeViewer = ThreeViewer, IsSync extends boolean = boolean> extends EventDispatcher<BaseEvent, T|'serialize'|'deserialize'> implements IViewerPlugin<TViewer, IsSync> {
    declare ['constructor']: typeof AViewerPlugin
    public static readonly PluginType: string = 'AViewerPlugin'
    protected _dirty = false

    // uiConfig?: UiObjectConfig = undefined // todo: this should work when uncommented, remove all get uiConfig and do it properly

    protected _viewer?: TViewer

    // this is just a property, not an indicator that a plugin is used, to disable a plugin, just remove it from the viewer
    abstract enabled: boolean

    abstract onAdded(viewer: TViewer): IsSync extends false ? Promise<void> : void

    abstract onRemove(viewer: TViewer): IsSync extends false ? Promise<void> : void

    dispose(): void {
        return
    }

    toJSON(meta?: SerializationMetaType): ISerializedConfig {
        const data: any = ThreeSerialization.Serialize(this, meta, true)
        data.type = (this as any).constructor.PluginType
        data.assetType = 'config'
        this.dispatchEvent({type: 'serialize', data})
        return data
    }

    fromJSON(data: ISerializedConfig, meta?: SerializationMetaType): this|null|Promise<this|null> {
        if (data.type !== this.constructor.PluginType)
            return null
        ThreeSerialization.Deserialize(data, this, meta, true)
        this.dispatchEvent({type: 'deserialize', data})
        return this
    }

    protected _storeKey(prefix?: string) {
        return (prefix ?? 'webgi') + '_' + (this.constructor.PluginType || this.constructor.name)
    }


    exportState() {
        return this._viewer?.exportPluginConfig(this) ?? this.toJSON?.()
    }
    async importState(state: any) {
        if (this._viewer) await this._viewer.importPluginConfig(state, this)
        else this.fromJSON?.(state)
    }

    // todo: move to ThreeViewer
    // storeState(prefix?: string, storage?: Storage, data?: any): void {
    //     storage = storage || (window ? window.localStorage : undefined)
    //     if (!storage) {
    //         console.warn('Unable to store state')
    //         return
    //     }
    //     if (data === undefined) data = this.exportState()
    //     if (data) storage.setItem(this._storeKey(prefix), JSON.stringify(data))
    // }
    //
    // async loadState(prefix?: string, storage?: Storage): Promise<void> {
    //     storage = storage || (window ? window.localStorage : undefined)
    //     if (!storage) {
    //         console.warn('Unable to load state')
    //         return
    //     }
    //     const data = storage.getItem(this._storeKey(prefix))
    //     if (data) await this.importState(JSON.parse(data))
    // }

    get dirty(): boolean {
        return this._dirty
    }

    set dirty(value: boolean) {
        this._dirty = value
    }

    /**
     * Template

     toJSON(meta?: any): any {
        const data = super.toJSON(meta)
        if (!data.type) return data
        // add here
        return data
    }

     fromJSON(data: any, meta?: any): this | null {
        if (!super.fromJSON(data, meta)) return null
        // add here
        return this
    }
     */

}

/**
 * Base Class for Sync Viewer Plugins
 * @category Viewer
 */
export abstract class AViewerPluginSync<T extends string, TViewer extends ThreeViewer = ThreeViewer> extends AViewerPlugin<T, TViewer, true> {
    declare ['constructor']: (typeof AViewerPluginSync) & (typeof AViewerPlugin)

    onAdded(viewer: TViewer): void {
        this._viewer = viewer
    }
    onRemove(viewer: TViewer): void {
        if (this._viewer !== viewer) viewer.console.error('Wrong viewer')
        this._viewer = undefined
    }

}

/**
 * Base Class for Async Viewer Plugins
 * @category Viewer
 */
export abstract class AViewerPluginAsync<T extends string, TViewer extends ThreeViewer = ThreeViewer> extends AViewerPlugin<T, TViewer, false> implements IViewerPluginAsync<TViewer> {
    declare ['constructor']: (typeof AViewerPluginAsync) & (typeof AViewerPlugin)

    async onAdded(viewer: TViewer): Promise<void> {
        this._viewer = viewer
    }
    async onRemove(viewer: TViewer): Promise<void> {
        if (this._viewer !== viewer) viewer.console.error('Wrong viewer')
        this._viewer = undefined
    }
}
