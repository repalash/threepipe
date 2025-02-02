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
    rebuildUi() {
        if (!this._viewer) return
        GridItemList.RebuildUi(this._viewer.container) // todo throttle?
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        GridItemList.Dispose()
    }
}

