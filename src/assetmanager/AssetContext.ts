import type {Object3D, WebGLRenderer} from 'three'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {GLTFExporterPlugin} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {AssetImporter} from './AssetImporter'
import {AssetExporter} from './AssetExporter'
import {MaterialManager} from './MaterialManager'
import type {AssetManagerOptions} from './AssetManager'
import type {IAssetHost} from './IAssetHost'
import type {IAsset} from './IAsset'
import type {ImportAssetOptions, ImportResult} from './IAssetImporter'
import type {BlobExt, ExportFileOptions, IExporter} from './IExporter'
import {Importer} from './Importer'
import {GLTFExporter2, GLTFWriter2} from './export'
import type {GLTFLoader2} from './import'
import {AssetFormat, defaultAssetFormats} from './formats'
import {upgradeImportedAsset} from './upgradeImportedAsset'
import {MetaImporter, metaFromResources, SerializationMetaType, SerializationResourcesType} from '../utils/serialization'
import {IMaterial, iMaterialCommons, IObject3D, iObjectCommons, ITexture} from '../core'

/**
 * Options for {@link createAssetContext}
 * @category Asset Manager
 */
export interface AssetContextOptions extends AssetManagerOptions {
    /**
     * File formats to load: functions from {@link assetFormats}, or {@link Importer} objects (like the ones of the
     * importer plugins). Formats can be added later with {@link AssetContext.addFormat}.
     * @default {@link defaultAssetFormats} (everything {@link AssetManager} loads)
     */
    formats?: (AssetFormat | Importer)[]
    /**
     * Convert the materials of loaded models to threepipe materials, replace their cameras and lights with
     * threepipe's, and upgrade loaded objects, materials and textures, like {@link AssetManager} does.
     * With `false`, loaders that create plain three.js materials (like OBJ and FBX) keep them, and the root object
     * of a model does not get threepipe's object API. The glTF loader creates threepipe materials, cameras and lights
     * either way.
     * @default true
     */
    upgrade?: boolean
    /**
     * Picks the data type of loaded HDR and EXR textures for this renderer (half float when supported). Without it,
     * the loaders keep their default (half float).
     */
    renderer?: WebGLRenderer
    /**
     * Canvas for the cameras created when importing a model.
     */
    canvas?: HTMLCanvasElement
    /**
     * Log the imports to the console
     * @default false
     */
    logging?: boolean
}

/**
 * Loads and exports files without a viewer: models, textures, materials and serialized data, in the formats of
 * {@link assetFormats} or added ones. Use {@link createAssetContext} to create one, or the one-shot functions
 * {@link loadAsset}, {@link loadModel}, {@link loadTexture} and {@link exportAsset}.
 *
 * A {@link ThreeViewer} uses an {@link AssetManager} instead, which also adds what it loads to the scene.
 *
 * @example
 * ```ts
 * const assets = createAssetContext({formats: [assetFormats.gltf, assetFormats.images]})
 * const model = await assets.loadModel('model.glb')
 * scene.add(model) // a three.js Object3D
 * ```
 * @category Asset Manager
 */
export class AssetContext implements IAssetHost {
    readonly importer: AssetImporter
    readonly exporter: AssetExporter
    readonly materials: MaterialManager
    readonly renderManager?: {readonly renderer: WebGLRenderer}
    readonly canvas?: HTMLCanvasElement

    /**
     * For the loaders that look for `assetManager.importer` and `assetManager.materials` on their host.
     */
    get assetManager() {
        return this
    }

    constructor({formats = defaultAssetFormats, upgrade = true, renderer, canvas, logging = false, ...cacheOptions}: AssetContextOptions = {}) {
        this.importer = new AssetImporter(logging, cacheOptions)
        this.exporter = new AssetExporter()
        this.materials = new MaterialManager()
        if (renderer) this.renderManager = {renderer}
        this.canvas = canvas

        this._loaderCreate = this._loaderCreate.bind(this)
        this.importer.addEventListener('loaderCreate', this._loaderCreate as any)
        if (upgrade) {
            this.importer.addEventListener('processRawStart', (e) => upgradeImportedAsset(e, this))
            this.importer.addEventListener('processRaw', (e) => {
                const mat = e.data as IMaterial
                if (mat && mat.isMaterial && mat.uuid) this.materials.registerMaterial(mat)
            })
        }

        this.addFormat(...formats)
        this.exporter.addExporter(this._gltfExporter)
    }

    /**
     * Add file formats: functions from {@link assetFormats}, or {@link Importer} objects.
     */
    addFormat(...formats: (AssetFormat | Importer)[]) {
        this.importer.addImporter(...formats.map(f => typeof f === 'function' ? f(this) : f))
    }

    /**
     * Load files: urls, `File` objects, or `{path, file}` assets, one or several.
     * @returns everything they contain: objects, textures, materials and configs
     */
    async load<T extends ImportResult = ImportResult>(assets: string | IAsset | File | (string | IAsset | File)[], options?: ImportAssetOptions): Promise<T[]> {
        const list = Array.isArray(assets) ? assets : [assets]
        const results = await Promise.all(list.map(async a => this.importer.import<T>(a as string | IAsset | File, options)))
        return results.flat().filter((r): r is T => !!r)
    }

    /**
     * Load a model file
     * @returns the root object of the first model in the file, with the file's viewer config in
     * `importedViewerConfig` when it has one
     */
    async loadModel<T extends IObject3D = IObject3D>(asset: string | IAsset | File, options?: ImportAssetOptions): Promise<T | undefined> {
        return (await this.load(asset, options)).find(r => r.isObject3D) as T | undefined
    }

    /**
     * Load an image, HDR or EXR file (or another format that loads a texture)
     */
    async loadTexture<T extends ITexture = ITexture>(asset: string | IAsset | File, options?: ImportAssetOptions): Promise<T | undefined> {
        return (await this.load(asset, options)).find(r => (r as ITexture).isTexture) as T | undefined
    }

    /**
     * Export an object, material or texture to a file.
     * Plain three.js objects and materials are upgraded in place first (threepipe adds its API to them).
     * @returns the file as a Blob, `glb` for objects by default (see {@link ExportFileOptions.exportExt})
     */
    async export(obj: Object3D | IObject3D | IMaterial | ITexture, options?: ExportFileOptions): Promise<BlobExt | undefined> {
        if ((obj as IObject3D).isObject3D && !(obj as IObject3D).assetType) iObjectCommons.upgradeObject3D.call(obj as IObject3D)
        else if ((obj as IMaterial).isMaterial && !(obj as IMaterial).assetType) iMaterialCommons.upgradeMaterial.call(obj as IMaterial)
        return this.exporter.exportObject(obj as IObject3D, options)
    }

    /**
     * Loads the resources referenced by serialized data, using this context's importer.
     * See {@link ThreeViewer.loadConfigResources}
     */
    loadConfigResources = async(json: Partial<SerializationMetaType>, extraResources?: Partial<SerializationResourcesType>) => {
        if (json.__isLoadedResources) return json as SerializationMetaType
        const meta = metaFromResources(json)
        meta._context.assetImporter = this.importer
        return await MetaImporter.ImportMeta(meta, extraResources)
    }

    addURLModifier(modifier: (url: string) => string) {
        this.importer.addURLModifier(modifier)
    }

    removeURLModifier(modifier: (url: string) => string) {
        this.importer.removeURLModifier(modifier)
    }

    // region glTF extensions

    /**
     * glTF extensions to import and export, see {@link AssetManager.registerGltfExtension}
     */
    readonly gltfExtensions: {
        name: string
        import: (parser: GLTFParser, viewer?: any) => GLTFLoaderPlugin,
        export: (parser: GLTFWriter2) => GLTFExporterPlugin,
        textures?: Record<string, string|number>
    }[] = []

    registerGltfExtension(ext: AssetContext['gltfExtensions'][number]) {
        this.unregisterGltfExtension(ext.name)
        this.gltfExtensions.push(ext)
        this._gltfExporter.extensions.push(ext.export)
    }

    unregisterGltfExtension(name: string) {
        const ind = this.gltfExtensions.findIndex(e => e.name === name)
        if (ind < 0) return
        const [ext] = this.gltfExtensions.splice(ind, 1)
        const ind1 = this._gltfExporter.extensions.indexOf(ext.export)
        if (ind1 >= 0) this._gltfExporter.extensions.splice(ind1, 1)
    }

    private _loaderCreate({loader}: {loader: GLTFLoader2}) {
        if (!loader.isGLTFLoader2) return
        for (const gltfExtension of this.gltfExtensions) {
            loader.register(gltfExtension.import)
        }
    }

    private _gltfExporter = {
        ext: ['gltf', 'glb'],
        extensions: [] as (typeof GLTFExporter2.ExportExtensions)[number][],
        ctor: (_, exporter) => new GLTFExporter2().setup(this, exporter.extensions),
    } satisfies IExporter

    // endregion

    dispose() {
        this.importer.dispose()
        this.materials.dispose()
        this.exporter.dispose()
    }
}

/**
 * Create an {@link AssetContext}: loads and exports files without a viewer.
 *
 * @example
 * ```ts
 * // only the formats you list are registered
 * const assets = createAssetContext({formats: [assetFormats.gltf, assetFormats.hdr]})
 * const model = await assets.loadModel('helmet.glb')
 * const env = await assets.loadTexture('studio.hdr')
 * ```
 * @category Asset Manager
 */
export function createAssetContext(options?: AssetContextOptions) {
    return new AssetContext(options)
}

let defaultContext: AssetContext | undefined

/**
 * The context used by {@link loadAsset}, {@link loadModel}, {@link loadTexture} and {@link exportAsset}: every
 * format of {@link defaultAssetFormats}, created on first use.
 * @category Asset Manager
 */
export function getDefaultAssetContext() {
    if (!defaultContext) defaultContext = new AssetContext()
    return defaultContext
}

/**
 * Load files without a viewer, see {@link AssetContext.load}
 * @category Asset Manager
 */
export async function loadAsset<T extends ImportResult = ImportResult>(assets: string | IAsset | File | (string | IAsset | File)[], options?: ImportAssetOptions) {
    return getDefaultAssetContext().load<T>(assets, options)
}

/**
 * Load a model file without a viewer, see {@link AssetContext.loadModel}
 * @example
 * ```ts
 * const model = await loadModel('helmet.glb')
 * scene.add(model)
 * ```
 * @category Asset Manager
 */
export async function loadModel<T extends IObject3D = IObject3D>(asset: string | IAsset | File, options?: ImportAssetOptions) {
    return getDefaultAssetContext().loadModel<T>(asset, options)
}

/**
 * Load an image, HDR or EXR file without a viewer, see {@link AssetContext.loadTexture}
 * @category Asset Manager
 */
export async function loadTexture<T extends ITexture = ITexture>(asset: string | IAsset | File, options?: ImportAssetOptions) {
    return getDefaultAssetContext().loadTexture<T>(asset, options)
}

/**
 * Export an object, material or texture to a file without a viewer, see {@link AssetContext.export}
 * @example
 * ```ts
 * const glb = await exportAsset(model) // Blob
 * ```
 * @category Asset Manager
 */
export async function exportAsset(obj: Object3D | IObject3D | IMaterial | ITexture, options?: ExportFileOptions) {
    return getDefaultAssetContext().export(obj, options)
}
