import {IViewerPluginSync, ThreeViewer} from '../../viewer'
import {ILoader, Importer} from '../../assetmanager'
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js'
import {BufferGeometry, Color, Mesh} from 'three'
import {AnyOptions} from 'ts-browser-helpers'
import {PhysicalMaterial} from '../../core'

/**
 * Adds support for loading `.stl`, `model/stl` files and data uris.
 * @category Plugins
 */
export class STLLoadPlugin implements IViewerPluginSync {
    declare ['constructor']: typeof STLLoadPlugin

    public static readonly PluginType = 'STLLoadPlugin'
    private _importer = new Importer(class extends STLLoader implements ILoader {
        transform(res: BufferGeometry, _: AnyOptions): Mesh|undefined {
            if (!res.attributes?.normal) res.computeVertexNormals()
            // todo set mesh name from options/path
            return res ? new Mesh(res, new PhysicalMaterial({color: new Color(1, 1, 1)})) : undefined
        }
    }, ['stl'], ['model/stl', 'model/x.stl-binary', 'model/x.stl-ascii'], false)

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
