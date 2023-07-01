import {IViewerPluginSync, ThreeViewer} from '../../viewer'
import {Importer, Rhino3dmLoader2} from '../../assetmanager'

export class Rhino3dmLoadPlugin implements IViewerPluginSync {
    declare ['constructor']: typeof Rhino3dmLoadPlugin

    public static readonly PluginType = 'Rhino3dmLoadPlugin'
    private _importer = new Importer(Rhino3dmLoader2, ['3dm'], ['model/vnd.3dm', 'model/3dm'], true)

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
