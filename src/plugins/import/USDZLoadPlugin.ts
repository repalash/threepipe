import {Importer} from '../../assetmanager'
import {USDLoader} from 'three/examples/jsm/loaders/USDLoader.js'
import {Group} from 'three'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading USD files: `.usdz` (`model/vnd.usdz+zip`), `.usda` (`model/vnd.usda`), `.usdc` and `.usd`,
 * and data uris, with three.js `USDLoader`.
 * @category Plugins
 */
export class USDZLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'USDZLoadPlugin'
    protected _importer = new Importer(class extends USDLoader {
        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<Group> {
            const res = await super.loadAsync(url, onProgress)
            if (!res.children.length) throw new Error('No mesh found in the USD file')
            return res
        }
    }, ['usdz', 'usda', 'usdc', 'usd'], ['model/vnd.usd+zip', 'model/vnd.usdz+zip', 'model/vnd.usda'], false)

}
