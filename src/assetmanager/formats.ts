import {LoadingManager, TextureLoader} from 'three'
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js'
import {EXRLoader} from 'three/examples/jsm/loaders/EXRLoader.js'
import {Class, getOrCall} from 'ts-browser-helpers'
import {Importer} from './Importer'
import {ILoader} from './IImporter'
import type {IAssetHost} from './IAssetHost'
import {
    DRACOLoader2,
    FBXLoader2,
    GLTFLoader2,
    JSONMaterialLoader,
    MTLLoader2,
    OBJLoader2,
    SimpleJSONLoader,
    SVGTextureLoader,
    VideoTextureLoader,
    ZipLoader,
} from './import'
import {PolyhavenMaterialGLTFLoader} from './import/PolyhavenMaterialGLTFLoader'
import {getTextureDataType} from '../three'
import {ThreeSerialization} from '../utils'

/**
 * A file format for an {@link AssetImporter}: a function that creates its {@link Importer} for a host (a viewer or an
 * {@link AssetContext}). An {@link Importer} that does not need a host (like the ones in the importer plugins) can be
 * used directly instead.
 * @category Asset Manager
 */
export type AssetFormat = (host: IAssetHost) => Importer

/**
 * The file formats that {@link AssetManager} and {@link AssetContext} load by default. Pick some of them to load only
 * those, see {@link createAssetContext}.
 * @category Asset Manager
 */
export const assetFormats = {
    /**
     * `.json` and `.vjson`: viewer configs, and serialized objects and materials (forwarded to the format that
     * supports their type, like {@link assetFormats.material})
     */
    json: ((host) => new Importer(class extends SimpleJSONLoader {
        async parseAsync(json: Record<string, any>): Promise<any> {
            if (json.assetType === 'config') return json // process later
            // When a file with .json extension and a .type is imported, we can forward it to other loaders inheriting SimpleJSONLoader that support that type like JSONMaterialLoader
            // getOrCall ensures we get all materials registered at runtime
            const type = json.type || json.metadata?.type
            const importer = host.assetManager.importer
            const imps = importer.importers.filter(i=>{
                const t = ((i as Importer).cls as typeof SimpleJSONLoader)?.SupportedJSONTypes
                if (t) return getOrCall(t)?.includes(type)
            })
            for (const imp of imps) {
                if (!imp) continue
                const loader = imp.ctor(importer) as SimpleJSONLoader
                const res = await loader.parseAsync(json)
                ;(loader as ILoader).dispose && (loader as ILoader).dispose!()
                if (res) return res // loader can return undefined if they don't want to support this file
            }
            if (json.serializableClassId) { // todo check json.type also as its supported in Serialization? or just do it anyway for any object because it could have nested serialized objects?
                const resources = json.resources
                if (json.resources) delete json.resources
                const meta = resources ? await host.loadConfigResources(resources) : undefined
                const res = ThreeSerialization.Deserialize(json, undefined, meta)
                if (meta) json.resources = meta
                if (res) return res
            }
            return super.parseAsync(json)
        }
    }, ['json', 'vjson'], ['application/json'], false)) satisfies AssetFormat,

    /**
     * `.svg` images as textures
     */
    svg: (() => new Importer(SVGTextureLoader, ['svg', 'data:image/svg'], ['image/svg+xml'], false)) satisfies AssetFormat, // todo: use ImageBitmapLoader if supported (better performance)

    /**
     * Images as textures: webp, png, jpeg, avif, bmp, gif, tiff, ico
     */
    images: (() => new Importer(TextureLoader, ['webp', 'png', 'jpeg', 'jpg', 'ico', 'data:image', 'avif', 'bmp', 'gif', 'tiff'], [
        'image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/avif',
    ], false)) satisfies AssetFormat, // todo: use ImageBitmapLoader if supported (better performance)

    /**
     * Serialized threepipe materials: `.mat` and the material type extensions (`.pmat`, `.bmat`…)
     */
    material: ((host) => new Importer<JSONMaterialLoader>(JSONMaterialLoader,
        JSONMaterialLoader.SupportedJSONExtensions,
        [], false, (loader) => {
            if (loader) loader.viewer = host
            return loader
        })) satisfies AssetFormat,

    /**
     * `.hdr` (RGBE) environment maps and textures
     */
    hdr: ((host) => new Importer(class extends RGBELoader {
        constructor(manager: LoadingManager) {
            super(manager)
            if (host.renderManager) this.setDataType(getTextureDataType(host.renderManager.renderer))
        }
    }, ['hdr'], ['image/vnd.radiance'], false)) satisfies AssetFormat,

    /**
     * `.exr` (OpenEXR) environment maps and textures
     */
    exr: ((host) => new Importer(class extends EXRLoader {
        constructor(manager: LoadingManager) {
            super(manager)
            if (host.renderManager) this.setDataType(getTextureDataType(host.renderManager.renderer))
        }
    }, ['exr'], ['image/x-exr'], false)) satisfies AssetFormat,

    /**
     * `.fbx` models
     */
    fbx: (() => new Importer(FBXLoader2, ['fbx'], ['model/fbx'], true)) satisfies AssetFormat,

    /**
     * `.zip` archives, and `.glbz` / `.gltfz` (a glTF file with its resources in a zip)
     */
    zip: (() => new Importer(ZipLoader, ['zip', 'glbz', 'gltfz'], ['application/zip', 'model/gltf+zip', 'model/zip'], true)) satisfies AssetFormat,

    /**
     * `.obj` models
     */
    obj: (() => new Importer(OBJLoader2 as any as Class<ILoader>, ['obj'], ['model/obj'], true)) satisfies AssetFormat,

    /**
     * `.mtl` materials for `.obj` models
     */
    mtl: (() => new Importer(MTLLoader2 as any as Class<ILoader>, ['mtl'], ['model/mtl'], false)) satisfies AssetFormat,

    /**
     * `.gltf` and `.glb` models, with the threepipe glTF extensions and the viewer config embedded by threepipe
     */
    gltf: ((host) => new Importer<GLTFLoader2>(GLTFLoader2, ['gltf', 'glb', 'data:model/gltf', 'data:model/glb'], ['model/gltf', 'model/gltf+json', 'model/gltf-binary', 'model/glb'], true, (l, _, i) => l?.setup(host, i.extensions))) satisfies AssetFormat,

    /**
     * `.drc` Draco compressed meshes (Draco compressed glTF files need only {@link assetFormats.gltf})
     */
    draco: (() => new Importer(DRACOLoader2, ['drc'], ['model/mesh+draco', 'model/drc'], true)) satisfies AssetFormat,

    /**
     * Videos as textures: mp4, ogg, mov, webm
     */
    video: (() => new Importer(VideoTextureLoader, ['mp4', 'ogg', 'mov', 'webm', 'data:video'], ['video/mp4', 'video/ogg', 'video/quicktime', 'video/webm'], true)) satisfies AssetFormat,

    /**
     * Materials from Poly Haven (`.phmatgltf`)
     */
    polyhavenMaterial: (() => new Importer(PolyhavenMaterialGLTFLoader, ['phmatgltf'], [], true)) satisfies AssetFormat,
}

/**
 * Every format in {@link assetFormats}, in the order {@link AssetManager} registers them.
 * @category Asset Manager
 */
export const defaultAssetFormats: AssetFormat[] = [ // todo fix - loading manager getHandler matches backwards?
    assetFormats.json,
    assetFormats.svg,
    assetFormats.images,
    assetFormats.material,
    assetFormats.hdr,
    assetFormats.exr,
    assetFormats.fbx,
    assetFormats.zip,
    assetFormats.obj,
    assetFormats.mtl,
    assetFormats.gltf,
    assetFormats.draco,
    assetFormats.video,
    assetFormats.polyhavenMaterial,
]
