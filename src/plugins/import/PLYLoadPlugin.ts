import {ILoader, Importer} from '../../assetmanager'
import {PLYLoader} from 'three/examples/jsm/loaders/PLYLoader.js'
import {AnyOptions} from 'ts-browser-helpers'
import {BufferGeometry, Color, Mesh} from 'three'
import {PhysicalMaterial} from '../../core'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'

/**
 * Adds support for loading `.ply`, `text/plain+ply` files and data uris
 * @category Plugins
 */
export class PLYLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'PLYLoadPlugin'
    protected _importer = new Importer(class extends PLYLoader implements ILoader {
        transform(res: BufferGeometry, _: AnyOptions): Mesh|undefined {
            if (!res.attributes?.normal) res.computeVertexNormals()
            // todo set mesh name from options/path
            return res ? new Mesh(res, new PhysicalMaterial({
                color: new Color(1, 1, 1),
                vertexColors: res.hasAttribute('color'),
            })) : undefined
        }
    }, ['ply'], ['text/plain+ply'], false)
}
