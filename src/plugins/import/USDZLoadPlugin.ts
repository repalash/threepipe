import {Importer} from '../../assetmanager'
import {USDLoader} from 'three/examples/jsm/loaders/USDLoader.js'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading USD files: `.usdz` (`model/vnd.usdz+zip`), `.usda` (`model/vnd.usda`), `.usdc` and `.usd` (text or binary crate), and data uris
 * @category Plugins
 */
export class USDZLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'USDZLoadPlugin'
    protected _importer = new Importer(USDLoader, ['usdz', 'usda', 'usdc', 'usd'], ['model/vnd.usd+zip', 'model/vnd.usdz+zip', 'model/vnd.usda'], false)
}
