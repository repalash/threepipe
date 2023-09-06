import {IViewerPluginSync, ThreeViewer} from '../../viewer'
import {Importer} from '../../assetmanager'
import {USDZLoader} from 'three/examples/jsm/loaders/USDZLoader.js'
import {Group, Mesh} from 'three'
import {Zippable, zipSync} from 'three/examples/jsm/libs/fflate.module.js'

/**
 * Adds support for loading `.usdz`, `model/vnd.usd+zip` and `.usda`, `model/vnd.usda` files and data uris
 * @category Plugins
 */
export class USDZLoadPlugin implements IViewerPluginSync {
    declare ['constructor']: typeof USDZLoadPlugin

    public static readonly PluginType = 'USDZLoadPlugin'
    private _importer = new Importer(class extends USDZLoader {
        private _currentUrl = ''
        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<Mesh> {
            this._currentUrl = url
            const res = await super.loadAsync(url, onProgress)
            this._currentUrl = ''
            return res
        }

        parse(buffer: ArrayBuffer): Group {
            // todo make changes in three.js to allow passing unzipped buffer directly for usda
            if (this._currentUrl.endsWith('.usda')) {
                const filename = this._currentUrl.split('/').pop()
                if (filename) {
                    const zip: Zippable = {}
                    zip[filename] = new Uint8Array(buffer)
                    buffer = zipSync(zip).buffer
                }
            }
            return super.parse(buffer)
        }
    }, ['usdz', 'usda'], ['model/vnd.usd+zip', 'model/vnd.usdz+zip', 'model/vnd.usda'], false)

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
