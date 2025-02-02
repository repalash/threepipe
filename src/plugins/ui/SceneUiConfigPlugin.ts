import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {serialize} from 'ts-browser-helpers'
import {RootScene} from '../../core'

export class SceneUiConfigPlugin extends AViewerPluginSync {
    static readonly PluginType = 'SceneUiConfigPlugin'
    enabled = true
    serializeWithViewer = false
    constructor() {
        super()
        this.uiConfig = {}
    }
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.uiConfig = viewer.scene.uiConfig
        this._scene = viewer.scene
    }
    @serialize('scene')
    protected _scene: RootScene | undefined
}
