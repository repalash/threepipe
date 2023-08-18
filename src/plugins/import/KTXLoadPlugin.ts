import {IViewerPluginSync, ThreeViewer} from '../../viewer'
import {Importer} from '../../assetmanager'
import {KTXLoader} from 'three/examples/jsm/loaders/KTXLoader.js'

/**
 * Adds support for loading `.ktx`, `image/ktx` files and data uris.
 * @category Plugins
 */
export class KTXLoadPlugin implements IViewerPluginSync {
    declare ['constructor']: typeof KTXLoadPlugin

    public static readonly PluginType = 'KTXLoadPlugin'
    private _importer = new Importer(KTXLoader, ['ktx'], ['image/ktx'], false)

    onAdded(viewer: ThreeViewer) {
        viewer.assetManager.importer.addImporter(this._importer)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.importer.removeImporter(this._importer)
    }

    dispose() {
        return
    }

}
