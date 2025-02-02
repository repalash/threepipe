import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {getUrlQueryParam, JSUndoManager, onChange} from 'ts-browser-helpers'

// @uiPanelContainer('Undo Manager')
export class UndoManagerPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'UndoManagerPlugin'

    // @uiToggle()
    @onChange(UndoManagerPlugin.prototype._refresh)
        enabled = true

    undoManager?: JSUndoManager

    @onChange(UndoManagerPlugin.prototype._refresh)
        limit = 1000

    constructor(enabled = true, limit = 1000) {
        super()
        this.enabled = enabled
        this.limit = limit
    }

    protected _refresh() {
        if (!this.undoManager) return
        this.undoManager.enabled = this.enabled
        this.undoManager.limit = this.limit
        this.undoManager.options.debug = this._viewer?.debug || this.undoManager.options.debug
    }

    toJSON: any = undefined

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.undoManager = new JSUndoManager({bindHotKeys: true, limit: this.limit, debug: viewer.debug || getUrlQueryParam('debugUndo') !== null, hotKeyRoot: document as any})
    }

    onRemove(viewer: ThreeViewer) {
        this.undoManager?.dispose()
        this.undoManager = undefined
        super.onRemove(viewer)
    }

}
