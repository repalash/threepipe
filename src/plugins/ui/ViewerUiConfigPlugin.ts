import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {serialize} from 'ts-browser-helpers'

export class ViewerUiConfigPlugin extends AViewerPluginSync<''> {
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
