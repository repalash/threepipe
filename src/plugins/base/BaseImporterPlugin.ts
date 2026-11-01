import {IViewerPluginSync, ThreeViewer} from '../../viewer'
import {Importer} from '../../assetmanager'

export abstract class BaseImporterPlugin implements IViewerPluginSync {
    declare ['constructor']: typeof BaseImporterPlugin
    public static readonly PluginType: string

    protected abstract _importer: Importer

    /**
     * The file format this plugin adds. It works without a viewer too, as a format of an {@link AssetContext}:
     * `createAssetContext().addFormat(new STLLoadPlugin().importer)`
     */
    get importer(): Importer {
        return this._importer
    }

    toJSON: any = null // disable serialization

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
