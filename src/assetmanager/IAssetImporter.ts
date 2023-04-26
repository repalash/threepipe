import {BaseEvent, EventDispatcher, LoadingManager, Object3D} from 'three'
import {AnyOptions, IDisposable} from 'ts-browser-helpers'
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

    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __rootPath?: string
    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __rootBlob?: IFile
    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __disposed?: boolean

    [key: string]: any
}
export type ImportResult = ImportResultObject & ImportResultExtras

export interface IImportResultUserData{
    rootPath?: string

    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __importData?: any // extra arbitrary data saved by the importer that can be used by the plugins (like gltf material variants)
    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __needsSourceBuffer?: boolean // This  can be set to true in the importer to indicate that the source buffer should be loaded and cached in the userdata during processRaw
    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __sourceBuffer?: ArrayBuffer // Cache d source buffer for the asset (only cached when __needsSourceBuffer is set)
    // eslin t-disable-next-line @typescript-eslint/naming-convention
    __sourceBlob?: IFile // Cache d source blob for the asset
}

export type ProcessRawOptions = {
    processRaw?: boolean, // defau lt = true, toggle to control the processing of the raw objects in the proecssRaw method
    forceImporterReprocess?: boolean, // defau lt = false. If true, the importer will reprocess the imported objects, even if they are already processed.

    rootPath?: string, // internal use

    generateMipmaps?: boolean|undefined, // defau lt = undefined, only used for textures

    autoImportZipContents?: boolean, // defau lt = true, if true, the importer will automatically import the contents of zip files, if zip importer is registered.

    // inter nal
    _testDataTextureComplete?: boolean, // defau lt = false, if set to true, it will test if the data textures are complete. [internal use]

    /**
     * @deprecated use processRaw instead
     */
    processImported?: boolean, // same  as processRaw
} & AnyOptions

export interface LoadFileOptions {
    fileHandler?: any, // custom {@link ILoader} for the file
    /**
     * Query string to add to the url. Default = undefined
     */
    queryString?: string,
    rootPath?: string, // internal use
}

export type ImportFilesOptions = ProcessRawOptions & LoadFileOptions & {allowedExtensions?: string[]}

export type ImportAssetOptions = {
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
} & ProcessRawOptions & LoadFileOptions & AnyOptions

export type IAssetImporterEventTypes = 'onLoad' | 'onProgress' | 'onStop' | 'onError' | 'onStart' | 'loaderCreate' | 'importFile' | 'importFiles' | 'processRaw' | 'processRawStart'
export interface IAssetImporter extends EventDispatcher<BaseEvent, IAssetImporterEventTypes>, IDisposable {
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

}

