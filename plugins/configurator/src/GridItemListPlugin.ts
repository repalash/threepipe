import {AViewerPluginSync, ThreeViewer} from 'threepipe'
import {GridItemList} from './GridItemList'

/**
 * A helper plugin to create a a simple list of small grids like for material or object configurator
 */
export class GridItemListPlugin extends AViewerPluginSync {
    enabled = true
    toJSON: any = undefined
    create = GridItemList.Create
    removeAll = GridItemList.RemoveAll
    private _container?: HTMLElement

    /**
     * An element of the page to put the grids in, in its layout (a panel, the card of an example). Default: a column over
     * the top left of the viewer's canvas.
     */
    get container(): HTMLElement | undefined {
        return this._container
    }
    set container(container: HTMLElement | undefined) {
        this._container = container
        this.rebuildUi()
    }

    rebuildUi() {
        if (!this._viewer) return
        GridItemList.RebuildUi(this._container ?? this._viewer.container, !!this._container) // todo throttle?
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        GridItemList.Dispose()
    }
}

