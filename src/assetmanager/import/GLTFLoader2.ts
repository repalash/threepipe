import type {GLTF, GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {LoadingManager, Object3D, OrthographicCamera} from 'three'
import {AnyOptions, safeSetProperty} from 'ts-browser-helpers'
import {ThreeViewer} from '../../viewer'
import {generateUUID} from '../../three'
import {
    glbEncryptionPreparser,
    GLTFLightExtrasExtension,
    GLTFMaterialExtrasExtension,
    GLTFMaterialsAlphaMapExtension,
    GLTFMaterialsBumpMapExtension,
    GLTFMaterialsDisplacementMapExtension,
    GLTFMaterialsLightMapExtension,
    GLTFObject3DExtrasExtension,
    GLTFViewerConfigExtension,
} from '../gltf'
import {RootSceneImportResult} from '../IAssetImporter'
import {ILoader} from '../IImporter'
import {ThreeSerialization} from '../../utils'
import {
    DirectionalLight2,
    PerspectiveCamera0,
    PhysicalMaterial,
    PointLight2,
    SpotLight2,
    UnlitLineMaterial,
    UnlitMaterial,
} from '../../core'

export class GLTFLoader2 extends GLTFLoader implements ILoader<GLTF, Object3D|undefined> {
    isGLTFLoader2 = true
    constructor(manager: LoadingManager) {
        super(manager)
        this.preparsers.push(glbEncryptionPreparser)

        GLTFLoader.ObjectConstructors.DirectionalLight = DirectionalLight2 as any
        GLTFLoader.ObjectConstructors.PointLight = PointLight2 as any
        GLTFLoader.ObjectConstructors.SpotLight = SpotLight2 as any
        GLTFLoader.ObjectConstructors.MeshStandardMaterial = PhysicalMaterial as any
        GLTFLoader.ObjectConstructors.MeshBasicMaterial = UnlitMaterial as any
        GLTFLoader.ObjectConstructors.MeshPhysicalMaterial = PhysicalMaterial as any
        GLTFLoader.ObjectConstructors.LineBasicMaterial = UnlitLineMaterial as any
        // GLTFLoader.ObjectConstructors.PointsMaterial = PointsMaterial2
        GLTFLoader.ObjectConstructors.PerspectiveCamera = PerspectiveCamera0 // todo set domElement in the AssetManager during process
        GLTFLoader.ObjectConstructors.OrthographicCamera = OrthographicCamera // todo
    }

    static ImportExtensions: ((parser: GLTFParser) => GLTFLoaderPlugin)[] = [
        GLTFObject3DExtrasExtension.Import,
        GLTFLightExtrasExtension.Import,
        GLTFMaterialsBumpMapExtension.Import,
        GLTFMaterialsDisplacementMapExtension.Import,
        GLTFMaterialsLightMapExtension.Import,
        GLTFMaterialsAlphaMapExtension.Import,
    ]

    /**
     * Preparsers are run on the arraybuffer/string before parsing to read the glb/gltf data
     */
    preparsers: GLTFPreparser[] = []

    async preparse(data: ArrayBuffer | string, path: string): Promise<ArrayBuffer | string> {
        for (const preparser of this.preparsers) {
            data = await preparser.process(data, path)
        }
        return data
    }

    parse(data: ArrayBuffer | string, path: string, onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void, url?: string) {
        this.preparse.call(this, data, url || path)
            .then((res: ArrayBuffer | string) => res ? super.parse(res, path, onLoad, onError) : onError && onError(new ErrorEvent('no data')))
            .catch((e: any) => {
                console.error(e)
                if (onError) onError(e ?? new ErrorEvent('unknown error'))
            })
    }

    /**
     * This is run post parse to extract the result scene from the GLTF object
     * @param res
     * @param _
     */
    transform(res: GLTF, _: AnyOptions): Object3D|undefined {
        // todo: support loading of multiple scenes?
        const scene: RootSceneImportResult|undefined = res ? res.scene || !!res.scenes && res.scenes.length > 0 && res.scenes[0] : undefined as any
        if (!scene) return undefined
        if (res.animations.length > 0) scene.animations = res.animations
        scene.traverse((node: Object3D) => {
            if (node.userData.gltfUUID) { // saved in GLTFExporter2
                safeSetProperty(node, 'uuid', node.userData.gltfUUID, true, true)
                delete node.userData.gltfUUID // have issue with cloning if we don't dispose.
            }
        })
        // todo: replacing lights and camera, todo: remove and change constructors in GLTFLoader.js
        if (!scene.userData) scene.userData = {}
        if (res.userData) scene.userData.gltfExtras = res.userData // todo: put back in gltf in GLTFExporter2
        if (res.cameras) res.cameras.forEach(c => !c.parent && scene.add(c))
        if (res.asset) scene.userData.gltfAsset = res.asset // todo: put back in gltf in GLTFExporter2
        return scene
    }

    register(callback: (parser: GLTFParser) => GLTFLoaderPlugin): this {
        return super.register(callback) as this
    }

    setup(viewer: ThreeViewer, extraExtensions: ((parser: GLTFParser) => GLTFLoaderPlugin)[]): this {
        this.register(GLTFMaterialExtrasExtension.Import(viewer.loadConfigResources))
        for (const ext of extraExtensions) this.register(ext)

        for (const ext of GLTFLoader2.ImportExtensions) this.register(ext)

        // Note: this should be last
        this.register(this.gltfViewerParser(viewer))

        return this
    }

    // loads the viewer config and handles loading the draco loader for extension
    gltfViewerParser = (viewer: ThreeViewer): (p: GLTFParser)=>GLTFLoaderPlugin => {
        return (parser: GLTFParser) => {
            const getDependency = parser.getDependency
            parser.getDependency = async(type: string, index: number) => {
                const res = await getDependency.call(parser, type, index)
                if (res && res.userData) {
                    const gltfExtensions = res.userData.gltfExtensions
                    delete res.userData.gltfExtensions
                    res.userData = ThreeSerialization.Deserialize(res.userData, {})
                    res.userData.gltfExtensions = gltfExtensions
                }
                return res
            }
            const tempPathDrc = generateUUID() + '.drc'
            const tempPathKtx2 = generateUUID() + '.ktx2'
            const needsDrc = parser.json?.extensionsRequired?.includes?.('KHR_draco_mesh_compression')
            if (needsDrc) {
                const drc = viewer.assetManager.importer.registerFile(tempPathDrc)
                drc && this.setDRACOLoader(drc as any) // todo: check class?
            }
            const needsMeshOpt = parser.json?.extensionsUsed?.includes?.('EXT_meshopt_compression')
            if (needsMeshOpt) {
                if ((window as any).MeshoptDecoder) { // added by the plugin or by the user
                    this.setMeshoptDecoder((window as any).MeshoptDecoder)
                    parser.options.meshoptDecoder = (window as any).MeshoptDecoder as any
                } else {
                    console.error('Add GLTFMeshOptPlugin to viewer to enable EXT_meshopt_compression decode')
                }
            }
            const needsBasisU = parser.json?.extensionsUsed?.includes?.('KHR_texture_basisu')
            if (needsBasisU) {
                const ktx2 = viewer.assetManager.importer.registerFile(tempPathKtx2)
                if (ktx2) {
                    this.setKTX2Loader(ktx2 as any) // todo: check class?
                    parser.options.ktx2Loader = ktx2 as any
                }
            }
            return {name: 'GLTF2_HELPER_PLUGIN', afterRoot: async(result: GLTF) => {
                if (needsDrc) viewer.assetManager.importer.unregisterFile(tempPathDrc)
                if (needsBasisU) viewer.assetManager.importer.unregisterFile(tempPathKtx2)
                await GLTFViewerConfigExtension.ImportViewerConfig(parser, viewer, result.scenes || [result.scene])
            }}
        }
    }


}

export interface GLTFPreparser{
    process(data: string | ArrayBuffer, path: string): Promise<string | ArrayBuffer>
    [key: string]: any
}
