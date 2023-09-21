import {Importer, Rhino3dmLoader2} from '../../assetmanager'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading Rhino `.3dm`, `model/vnd.3dm`, `model/3dm` files and data uris.
 * @category Plugins
 */
export class Rhino3dmLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'Rhino3dmLoadPlugin'
    protected _importer = new Importer(Rhino3dmLoader2, ['3dm'], ['model/vnd.3dm', 'model/3dm'], true)
}
