import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {serialize} from 'ts-browser-helpers'

/**
 * Viewer UI Config Plugin
 *
 * Just a plugin wrapper over the `viewer.uiConfig
 *
 * @category Plugins
 */
export class ViewerUiConfigPlugin extends AViewerPluginSync {
    static readonly PluginType = 'ViewerUiConfigPlugin'
    enabled = true
    serializeWithViewer = false
    constructor() {
        super()
        this.uiConfig = {}
    }
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.uiConfig = viewer.uiConfig
        this.uiConfig.expanded = true
    }

    @serialize('viewer')
    declare protected _viewer: ThreeViewer | undefined // todo: fix deserialization throwing error

    // toJSON(): any {
    //     return this._viewer?.toJSON() ?? {}
    // }
    // fromJSON(data: ISerializedViewerConfig, meta?: SerializationMetaType): this | null {
    //     this._viewer?.fromJSON(data, meta)
    //     return this
    // }
}
