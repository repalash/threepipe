import {EventDispatcher, LoadingManager, Object3D} from 'three'
import {IDisposable} from 'ts-browser-helpers'
import {IAsset, IFile} from './IAsset'
import {ILoader} from './IImporter'
import {ICamera, IMaterial, IObject3D, ITexture} from '../core'
import {ISerializedConfig, ISerializedViewerConfig} from '../viewer'
import {GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface RootSceneImportResult extends Object3D {
    readonly visible: true
    importedViewerConfig?: ISerializedViewerConfig
    userData: {
        rootSceneModelRoot?: true
        __importData?: any
        gltfExtras?: GLTF['userData']
        gltfAsset?: GLTF['asset']
        [key: string]: any
    }

    /**
     * copy of children to use after import, set in processRaw
     * @internal
     */
    _childrenCopy?: Object3D[]
}

export type ImportResultObject = IObject3D | ITexture | ICamera | ISerializedConfig | ISerializedViewerConfig | RootSceneImportResult | IMaterial
export interface ImportResultExtras {
    constructor: any
    assetImporterProcessed?: boolean

    isObject3D?: boolean
    isCamera?: boolean
    isMaterial?: boolean
    isTexture?: boolean

    userData?: IImportResultUserData

    __rootPath?: string
    __rootPathOptions?: Record<string, any>
    __rootBlob?: IFile
    // __disposed?: boolean

    [key: string]: any
}
export type ImportResult = ImportResultObject & ImportResultExtras

export interface IImportResultUserData{
    /**
     * The path from which the asset was downloaded/imported.
     */
    rootPath?: string
    /**
     * Incase files are loaded as different extensions(like for json), this will be set.
     */
    rootPathOptions?: Record<string, any>
    /**
     * Whether to refresh this object from the asset manager when its loaded as an embedded object
     */
    rootPathRefresh?: boolean

    /**
     * extra arbitrary data saved by the importer that can be used by the plugins (like gltf material variants)
     */
    __importData?: any
    /**
     * This can be set to true in the importer to indicate that the source buffer should be loaded and cached in the userdata during processRaw
     */
    __needsSourceBuffer?: boolean
    /**
     * Cached source buffer for the asset (only cached when __needsSourceBuffer is set)
     */
    __sourceBuffer?: ArrayBuffer
    /**
     * Cached source blob for the asset
     */
    __sourceBlob?: IFile
}

export interface ProcessRawOptions {
    /**
     * default = true, toggle to control the processing of the raw objects in the proecssRaw method
     */
    processRaw?: boolean,
    /**
     * default = false. If true, the importer will reprocess the imported objects, even if they are already processed.
     */
    forceImporterReprocess?: boolean,

    /**
     * internal use
     */
    rootPath?: string,

    /**
     * default = undefined, only used for textures
     */
    generateMipmaps?: boolean|undefined,

    /**
     * If true, the importer will replace any three.js light instances with upgraded lights
     * default = true
     */
    replaceLights?: boolean, // default = true
    /**
     * If true, the importer will replace any three.js camera instances with upgraded cameras
     * default = true
     */
    replaceCameras?: boolean, // default = true
    /**
     * If true, the importer will replace any three.js material instances with upgraded materials
     * default = true
     */
    replaceMaterials?: boolean, // default = true


    /**
     * default = true, if true, the importer will automatically import the contents of zip files, if zip importer is registered.
     */
    autoImportZipContents?: boolean,

    /**
     * @internal
     * default = false, if set to true, it will test if the data textures are complete. [internal use]
     */
    _testDataTextureComplete?: boolean,

    /**
     * @deprecated use processRaw instead
     */
    processImported?: boolean, // same  as processRaw

    [key: string]: any
}

export interface LoadFileOptions {
    /**
     * The file extension to use for the file. If not specified, the importer will try to determine the file extension from the file name/url.
     */
    fileExtension?: string,
    /**
     * The custom {@link ILoader} to use for the file. If not specified, the importer will try to determine the loader from the file extension.
     */
    fileHandler?: ILoader,
    /**
     * Query string to add to the url. Default = undefined
     */
    queryString?: string,
    /**
     * Use {@link MeshLine}(an extension of three.js `Line2`) instead of default `Line` for lines. This allows changing line width(fat lines) and other properties.
     *
     * Note - Only for gltf, glb files or files loaded with {@link GLTFLoader2}. If this flag is not passed, the default value is the value of the static property `GLTFLoader2.UseMeshLines`.
     */
    useMeshLines?: boolean,

    /**
     * If true, the loader will create unique names for objects in the gltf file when multiple objects with the same name are found.
     *
     * Note - Only for gltf, glb files or files loaded with {@link GLTFLoader2}. If this flag is not passed, the default value is the value of the static property `GLTFLoader2.CreateUniqueNames`.
     */
    createUniqueNames?: boolean,

    /**
     * for internal use
     */
    rootPath?: string,
}

export interface ImportFilesOptions extends ProcessRawOptions, LoadFileOptions {
    /**
     * Allowed file extensions. If undefined, all files are allowed.
     */
    allowedExtensions?: string[]
}

export interface ImportAssetOptions extends ProcessRawOptions, LoadFileOptions {
    /**
     * Default = false. If true, the asset will be imported again on subsequent calls, even if it is already imported.
     */
    forceImport?: boolean,
    /**
     * If true or not specified, and any of the assets is disposed(only root objects are checked, not children), all assets will be imported in this call. If false, old assets will be returned.
     * Default = true.
     */
    reimportDisposed?: boolean,
    /**
     * Path override to use for the asset. This will be used in the importer as override to path inside the asset/cached asset.
     */
    pathOverride?: string,
    /**
     * Mime type to use when importing the file, if not specified, it will be determined from the file extension.
     */
    mimeType?: string,
    /**
     * Pass a custom file to use for the import. This will be used in the importer, and nothing will be fetched from the path
     */
    importedFile?: IFile,
}

// exp ort type IAssetImporterEventTypes = 'onLoad' | 'onProgress' | 'onStop' | 'onError' | 'onStart' | 'loaderCreate' | 'importFile' | 'importFiles' | 'processRaw' | 'processRawStart'

export interface IAssetImporterEventMap {
    loaderCreate: {type: 'loaderCreate', loader: ILoader}
    importFile: {type: 'importFile', path: string, state: 'downloading'|'done'|'error'|'adding', progress?: number, loadedBytes?: number, totalBytes?: number, error?: any}
    importFiles: {type: 'importFiles', files: Map<string, IFile>, state: 'start'|'end'}
    processRaw: {type: 'processRaw', data: any, options: ProcessRawOptions, path?: string}
    processRawStart: {type: 'processRawStart', data: any, options: ProcessRawOptions, path?: string}

    /**
     * @deprecated use the {@link importFile} event instead
     */
    onLoad: {type: 'onLoad'}
    /**
     * @deprecated use the {@link importFile} event instead
     */
    onProgress: {type: 'onProgress', url: string, loaded: number, total: number}
    /**
     * @deprecated use the {@link importFile} event instead
     */
    onError: {type: 'onError', url: string}
    /**
     * @deprecated use the {@link importFile} event instead
     */
    onStart: {type: 'onStart', url: string, loaded: number, total: number}
}

export interface IAssetImporter<TE extends IAssetImporterEventMap = IAssetImporterEventMap> extends EventDispatcher<TE>, IDisposable {
    readonly loadingManager: LoadingManager
    readonly cachedAssets: IAsset[]

    /**
     * Import single or multiple assets(like in case of zip files) from a path(url) or an {@link IAsset}.
     * @param assetOrPath - The path or asset to import
     * @param options - Options for the import
     */
    import<T extends ImportResult = ImportResult>(assetOrPath?: IAsset | string, options?: ImportAssetOptions): Promise<(T|undefined)[]>;

    /**
     * Import a single asset from a path(url) or an {@link IAsset}.
     * @param asset
     * @param options
     */
    importSingle<T extends ImportResult = ImportResult>(asset?: IAsset | string, options?: ImportAssetOptions): Promise<T|undefined>;

    /**
     * Import multiple local files/blobs from a map of files.
     * @param files
     * @param options
     */
    importFiles(files: Map<string, IFile>, options?: ImportFilesOptions): Promise<Map<string, any[]> | undefined>;


    /**
     * Register a file to a specific path, so this file will be used when importing the path.
     * @param path
     * @param file
     */
    registerFile(path: string, file?: IFile): ILoader | undefined;

    /**
     * Unregister a file from a specific path.
     * @param path
     */
    unregisterFile(path: string): void;

    /**
     * Process the raw output from the loaders and return the updated/patched-objects.
     * @param res
     * @param options
     */
    processRaw(res: any, options: ProcessRawOptions): Promise<any[]>

    addURLModifier(modifier: (url: string) => string): void
    removeURLModifier(modifier: (url: string) => string): void

}

