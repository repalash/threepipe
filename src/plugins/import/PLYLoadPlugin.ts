import {IViewerPluginSync, ThreeViewer} from '../../viewer'
import {ILoader, Importer} from '../../assetmanager'
import {PLYLoader} from 'three/examples/jsm/loaders/PLYLoader.js'
import {AnyOptions} from 'ts-browser-helpers'
import {BufferGeometry, Color, Mesh} from 'three'
import {PhysicalMaterial} from '../../core'

/**
 * Adds support for loading `.ply`, `text/plain+ply` files and data uris
 * @category Plugins
 */
export class PLYLoadPlugin implements IViewerPluginSync {
    declare ['constructor']: typeof PLYLoadPlugin

    public static readonly PluginType = 'PLYLoadPlugin'
    private _importer = new Importer(class extends PLYLoader implements ILoader {
        transform(res: BufferGeometry, _: AnyOptions): Mesh|undefined {
            if (!res.attributes?.normal) res.computeVertexNormals()
            // todo set mesh name from options/path
            return res ? new Mesh(res, new PhysicalMaterial({color: new Color(1, 1, 1)})) : undefined
        }
    }, ['ply'], ['text/plain+ply'], false)

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
