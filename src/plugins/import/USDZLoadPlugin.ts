import {Importer} from '../../assetmanager'
import {USDZLoader} from 'three/examples/jsm/loaders/USDZLoader.js'
import {Group, Mesh} from 'three'
import {Zippable, zipSync} from 'three/examples/jsm/libs/fflate.module.js'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading `.usdz`, `model/vnd.usd+zip` and `.usda`, `model/vnd.usda` files and data uris
 * @category Plugins
 */
export class USDZLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'USDZLoadPlugin'
    protected _importer = new Importer(class extends USDZLoader {

        currentUrl = ''

        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<Mesh> {
            this.currentUrl = url
            const res = await super.loadAsync(url, onProgress)
            // console.log(res)
            this.currentUrl = ''
            if (!res.children.length) throw new Error('No mesh found in USDZ file, note that usdc files are not supported.')
            // todo see three-usdz-loader
            return res
        }

        parse(buffer: ArrayBuffer|string): Group {
            // todo make changes in three.js to allow passing unzipped buffer directly for usda
            if (this.currentUrl.endsWith('.usda') && typeof buffer !== 'string') {
                const filename = this.currentUrl.split('/').pop()
                if (filename) {
                    const zip: Zippable = {}
                    zip[filename] = new Uint8Array(buffer)
                    buffer = zipSync(zip).buffer as ArrayBuffer
                }
            }
            return super.parse(buffer)
        }
    }, ['usdz', 'usda'], ['model/vnd.usd+zip', 'model/vnd.usdz+zip', 'model/vnd.usda'], false)

}
