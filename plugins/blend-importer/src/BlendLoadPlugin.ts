import {AnyOptions, BaseImporterPlugin, FileLoader, ILoader, Importer, Object3D, Scene} from 'threepipe'
import {parseBlend} from './js-blend/main.js'
import {createObjects} from './loader'

/**
 * Adds support for loading Blend `.blend`, `application/x-blender` files and data uris
 */
export class BlendLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'BlendLoadPlugin'
    constructor() {
        super()
    }
    protected _importer = new Importer(class extends FileLoader implements ILoader {
        async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<any> {
            this.setResponseType('arraybuffer')
            const res = (await super.loadAsync(url, onProgress)) as ArrayBuffer
            const blend = await parseBlend(res)
            const objects = await createObjects(blend)
            const root = new Object3D()
            root.add(...objects)
            // console.log(res, blend, root)
            blend.scene = root
            return blend
        }

        transform(res: any, _: AnyOptions): Scene {
            // console.log(res)
            // res.scene.userData.kinematics = res.kinematics
            // res.scene.userData.library = res.library
            return res.scene
        }
    }, ['blend'], ['application/x-blender'], true)
}
