import {Importer} from '../../assetmanager'
import {KTXLoader} from 'three/examples/jsm/loaders/KTXLoader.js'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading `.ktx`, `image/ktx` files and data uris.
 * @category Plugins
 */
export class KTXLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'KTXLoadPlugin'
    protected _importer = new Importer(KTXLoader, ['ktx'], ['image/ktx'], false)

}
