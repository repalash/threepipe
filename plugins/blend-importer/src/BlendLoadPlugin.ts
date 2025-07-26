import {
    AmbientLight2,
    AnyOptions,
    BaseImporterPlugin,
    BufferAttribute,
    BufferGeometry2,
    DirectionalLight2,
    FileLoader,
    ILoader,
    Importer, Mesh,
    Mesh2,
    Object3D,
    Object3D2,
    OrthographicCamera0,
    PerspectiveCamera0,
    PhysicalMaterial,
    PointLight2,
    Scene, SpotLight2,
    UnlitMaterial,
} from 'threepipe'
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
            // console.log(bakeGetters(blend))
            const ctx = {
                Object3D: Object3D2,
                Mesh: Mesh2 as typeof Mesh,
                MeshPhysicalMaterial: PhysicalMaterial,
                MeshBasicMaterial: UnlitMaterial,
                PerspectiveCamera: PerspectiveCamera0,
                OrthographicCamera: OrthographicCamera0,
                PointLight: PointLight2,
                DirectionalLight: DirectionalLight2,
                SpotLight: SpotLight2,
                AmbientLight: AmbientLight2,
                BufferGeometry: BufferGeometry2,
                BufferAttribute: BufferAttribute,
            }
            const objects = await createObjects(blend, ctx)
            const root = new Object3D()
            root.add(...objects)
            // root.userData.autoScaled = true
            // root.userData.autoCentered = true
            // console.log(res, blend, root)
            blend.scene = root
            return blend
        }

        transform(res: any, options: AnyOptions): Scene {
            // console.log(res)
            // res.scene.userData.kinematics = res.kinematics
            // res.scene.userData.library = res.library
            if (typeof options.onBlendLoad === 'function') {
                options.onBlendLoad(res)
            }
            return res.scene
        }
    }, ['blend'], ['application/x-blender'], true)
}
