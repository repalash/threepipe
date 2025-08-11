import {Cache as threeCache, EventDispatcher, EventListener, FileLoader, LoaderUtils, LoadingManager} from 'three'
import {
    IAssetImporter,
    IImportResultUserData,
    ImportAssetOptions,
    ImportFilesOptions,
    ImportResult,
    LoadFileOptions,
    ProcessRawOptions,
    RootSceneImportResult,
} from './IAssetImporter'
import {IAsset, IFile} from './IAsset'
import {IImporter, ILoader} from './IImporter'
import {Importer} from './Importer'
import {SimpleJSONLoader} from './import'
import {escapeRegExp, parseFileExtension} from 'ts-browser-helpers'
import {AssetManagerOptions, ImportAddOptions} from './AssetManager'
import {overrideThreeCache} from '../three'

// export type IAssetImporterEvent = Event&{
//     type: IAssetImporterEventTypes,
//     data?: ImportResult, options?: ProcessRawOptions,
//     path?: string, progress?: number, state?: string, error?: any
//     files?: Map<string, IFile>
//     url?: string, loaded?: number, total?: number
//     loader?: ILoader,
// }

// export type IAssetImporterEventTypes = 'onLoad' | 'onProgress' | 'onStop' | 'onError' | 'onStart' | 'loaderCreate' | 'importFile' | 'importFiles' | 'processRaw' | 'processRawStart'
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

/**
 * Asset Importer
 *
 * Utility class to import assets from local files, blobs, urls, etc.
 * Used in {@link AssetManager} to import assets.
 * Acts as a wrapper over three.js LoadingManager and adds support for dynamically loading loaders, caching assets, better event dispatching and file tracking.
 * @category Asset Manager
 */
export class AssetImporter extends EventDispatcher<IAssetImporterEventMap> implements IAssetImporter {
    private _loadingManager: LoadingManager

    private _storage?: Cache | Storage
    get storage() {
        return this._storage
    }

    private _logger = console.log
    // Used when loading multiple files at once.
    protected _rootContext?: {path: string, rootUrl: string, /* baseUrl: string;*/}
    private _loaderCache: {loader: ILoader, ext: string[], mime: string[]}[] = []
    private _fileDatabase: Map<string, IFile> = new Map<string, IFile>()
    private _cachedAssets: IAsset[] = []

    /**
     * If true, imported assets are cached in memory(as js/three.js objects) and can be reused later. They will be cleared when dispose event is fired on the object or {@link clearCache} is called.
     */
    cacheImportedAssets = true

    // moved to constants whiteImageData and whiteTexture
    // static WHITE_IMAGE_DATA = new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1)
    // static WHITE_TEXTURE = new Texture(AssetImporter.WHITE_IMAGE_DATA)

    readonly importers: IImporter[] = [
        new Importer(SimpleJSONLoader, ['json', 'vjson'], ['application/json'], false),
        new Importer(FileLoader, ['txt'], ['text/plain'], false),
        // new Importer(RGBEPNGLoader, ['rgbe.png', 'hdr.png', 'hdrpng'], ['image/png+rgbe'], false), // todo: not working on windows?
        // new Importer(LUTCubeLoader2, ['cube'], false),
    ]

    constructor(logging = false, {simpleCache = false, storage}: AssetManagerOptions = {}) {
        super()
        if (!logging) this._logger = () => {return}
        // this._viewer = viewer
        this._onLoad = this._onLoad.bind(this)
        this._onProgress = this._onProgress.bind(this)
        this._onError = this._onError.bind(this)
        this._onStart = this._onStart.bind(this)
        this._urlModifier = this._urlModifier.bind(this)
        this._loadingManager = new LoadingManager(this._onLoad, this._onProgress, this._onError)
        this._loadingManager.onStart = this._onStart
        this._loadingManager.setURLModifier(this._urlModifier)
        this._initCacheStorage(simpleCache, storage ?? true)
    }

    get loadingManager(): LoadingManager {
        return this._loadingManager
    }
    get cachedAssets(): IAsset[] {
        return this._cachedAssets
    }

    addImporter(...importers: IImporter[]) {
        for (const importer of importers) {
            if (this.importers.includes(importer)) {
                console.warn('AssetImporter: Importer already added', importer)
                return
            }
            this.importers.push(importer)
        }
    }
    removeImporter(...importers: IImporter[]) {
        for (const importer of importers) {
            const index = this.importers.indexOf(importer)
            if (index >= 0) this.importers.splice(index, 1)
        }
    }

    // region import functions

    async import<T extends ImportResult|undefined = ImportResult>(assetOrPath?: string | IAsset | IAsset[] | File | File[], options?: ImportAssetOptions): Promise<(T|undefined)[]> {
        if (!assetOrPath) return []
        if (Array.isArray(assetOrPath)) return (await Promise.all(assetOrPath.map(async a => this.import<T>(a, options)))).flat(1)
        if (assetOrPath instanceof File) return await this.importFile<T>(assetOrPath, options)
        if (typeof assetOrPath === 'object') return await this.importAsset<T>(assetOrPath, options)
        if (typeof assetOrPath === 'string') return await this.importPath<T>(assetOrPath, options)
        console.error('AssetImporter: Invalid asset or path', assetOrPath)
        return []
    }
    async importSingle<T extends ImportResult|undefined = ImportResult>(asset?: string | IAsset | File, options?: ImportAssetOptions): Promise<T|undefined> {
        return (await this.import<T>(asset, options))?.[0]
    }

    async importPath<T extends ImportResult|undefined = ImportResult|undefined>(path: string, options: ImportAssetOptions = {}): Promise<T[]> {
        const opts = this._serializeOptions(options)
        const cached = this._cachedAssets.find(a => a.path === path && a._options === opts)
        let asset: IAsset
        if (cached) asset = cached
        else asset = {path}
        asset._options = opts
        if (options.importedFile) asset.file = options.importedFile
        return await this.importAsset(asset, options)
    }

    private _serializeOptions(options: ImportAddOptions) {
        const {
            pathOverride,
            forceImport,
            reimportDisposed,
            fileHandler,
            importedFile,
            ...op} = options
        return JSON.stringify(op)
    }

    // import and process an IAsset
    async importAsset<T extends ImportResult|undefined = ImportResult|undefined>(asset?: IAsset, options: ImportAssetOptions = {}, onDownloadProgress?: (e:ProgressEvent)=>void): Promise<T[]> {
        if (!asset) return []
        if (!asset.path && !asset.file && !options.pathOverride) {
            return [asset as any] // maybe already imported asset
        }

        // Cache the asset reference if it is not already cached
        if (!this._cachedAssets.includes(asset)) {
            if (Object.entries(asset).length === 1 && asset.path) {
                const ca = this._cachedAssets.find(value => value.path === asset.path)
                if (ca) Object.assign(asset, ca)
            }
            const ca = this._cachedAssets.findIndex(value => value.path === asset.path)
            if (ca >= 0) this._cachedAssets.splice(ca, 1)
            this._cachedAssets.push(asset)
        }

        let result: any = asset?.preImported
        if (!result && asset?.preImportedRaw) {
            result = await asset.preImportedRaw
        }

        const path = options.pathOverride || asset.path
        // console.log(result)
        if (!options.forceImport && result) {
            const results = await this.processRaw<T>(result, options, path) // just in case its not processed. Internal check is done to ensure it's not processed twice
            // let isDisposed = false // if any of the objects is disposed
            // for (const r of results) {
            //     // todo: check if this is still required.
            //     if ((r as RootSceneImportResult)?.userData?.rootSceneModelRoot) { // in case processImported is false we need a special case check here
            //         if (r?.children?.find((c: any) => c.__disposed)) {
            //             isDisposed = true
            //             break
            //         }
            //     }
            //     if (r && !r.__disposed) continue // todo add __disposed to object, material, texture, etc
            //     isDisposed = true
            //     break
            // }
            // todo: should we check if any of it's children is disposed ?
            // if (!isDisposed || options.reimportDisposed === false)
            return results
        }

        // todo: add support to get cloned asset? if we want to import multiple times and everytime return a cloned asset
        asset.preImportedRaw = this._loadFile(path, typeof asset.file?.arrayBuffer === 'function' ? asset.file : undefined, options, onDownloadProgress)
        result = await asset.preImportedRaw

        if (!this.cacheImportedAssets) asset.preImportedRaw = undefined

        if (result) result = await this.processRaw(result, options, path)
        if (result) {
            if (options.processRaw !== false && this.cacheImportedAssets) asset.preImported = result

            const arrs: any[] = []
            const push = (r: typeof result)=>{
                if (r.userData?.rootSceneModelRoot) arrs.push(...r.children)
                else arrs.push(r)
            }
            if (Array.isArray(result)) result.map(push)
            else push(result)

            // remove preImportedRaw when any one of the assets is disposed. todo maybe do when ALL are dispoed?
            arrs.forEach(r=>r?.addEventListener && r.addEventListener('dispose', () => { // todo: recheck after dispose logic change
                if (asset?.preImportedRaw) asset.preImportedRaw = undefined
                if (asset?.preImported) asset.preImported = undefined
            }))
        }

        return result
    }

    async importFile<T extends ImportResult|undefined = ImportResult|undefined>(file?: File, options: ImportAssetOptions = {}, onDownloadProgress?: (e:ProgressEvent)=>void): Promise<T[]> {
        if (!file) return []
        if (!(file instanceof File)) {
            console.error('AssetImporter: Invalid file', file)
            return []
        }
        return this.importAsset(this._cachedAssets.find(a=>a.file === file) ?? {
            path: file.name || file.webkitRelativePath, file,
        }, options, onDownloadProgress)
    }

    /**
     * Import multiple local files/blobs from a map of files, like when a local folder is loaded, or when multiple files are dropped.
     * @param files
     * @param options
     */
    async importFiles<T extends ImportResult|undefined=ImportResult|undefined>(files: Map<string, IFile>, options: ImportFilesOptions = {}): Promise<Map<string, T[]>> {
        const loaded = new Map<string, any>()

        let {allowedExtensions} = options
        if (allowedExtensions && allowedExtensions.length < 1) allowedExtensions = undefined
        if (files.size === 0) return loaded
        this.dispatchEvent({type: 'importFiles', files: files, state: 'start'})

        const baseFiles: string[] = []
        const altFiles: string[] = []

        // Note: mostly path === file.name
        files.forEach((file, path) => { // todo: handle only one file at the top

            this.registerFile(path, file)
            const ext = file.ext
            const mime = file.mime
            if ((ext || mime) && // todo: files with no extensions are not supported right now. This also includes __MacOSX
                (allowedExtensions?.includes((ext || mime || '').toLowerCase()) ?? true)) {
                if (this._isRootFile(ext)) baseFiles.push(path)
                else altFiles.push(path)
            }

        })
        if (baseFiles.length > 0) {
            for (const value of baseFiles) {
                let res = await this._loadFile(value, undefined, options)
                if (res) res = await this.processRaw(res, options, value)
                loaded.set(value, res)
            }
        } else {
            for (const value of altFiles) {
                let res = await this._loadFile(value, undefined, options)
                if (res) res = await this.processRaw(res, options, value)
                loaded.set(value, res)
            }

            // todo: handle no baseFiles
        }

        this.dispatchEvent({type: 'importFiles', files: files, state: 'end'})

        files.forEach((_, path) => this.unregisterFile(path))

        return loaded
    }

    // load a single file
    private async _loadFile(path: string, file?: IFile, options: LoadFileOptions = {}, onDownloadProgress?: (e: ProgressEvent)=>void): Promise<ImportResult | ImportResult[] | undefined> {
        // if (file?.__loadedAsset) return file.__loadedAsset
        if (this._cacheStoreInitPromise) await this._cacheStoreInitPromise

        this.dispatchEvent({type: 'importFile', path, state:'downloading', progress: 0})
        let res: ImportResult | ImportResult[] | undefined
        try {
            const loader = this.registerFile(path, file, options.fileExtension, options.fileHandler)

            // const url = this.resolveURL(path) // todo: why is this required? maybe for query string?
            // const path2 = path.replace(/\?.*$/, '') // remove query string to find the handler properly
            // const loader = (options.fileHandler as ILoader) ?? this._getLoader(path2) ??
            //     (file ? this._getLoader(file.name, file.ext, file.mime) : undefined)

            if (!loader) {
                throw new Error('AssetImporter: Unable to find loader for ' + path) // caught below
            }
            this._rootContext = {
                path,
                rootUrl: LoaderUtils.extractUrlBase(path),
                // baseUrl: LoaderUtils.extractUrlBase(url),
            }

            loader.importOptions = options
            res = await loader.loadAsync(path + (options.queryString ? (path.includes('?') ? '&' : '?') + options.queryString : ''), (e)=>{
                if (onDownloadProgress) onDownloadProgress(e)
                const total = e.lengthComputable ? e.total : undefined
                this.dispatchEvent({
                    type: 'importFile', path,
                    state:'downloading',
                    loadedBytes: e.loaded || undefined,
                    totalBytes: total && total < e.loaded ? e.loaded : e.total || undefined, // sometimes total is more than e.loaded
                    progress: total && total > 0 && total > e.loaded ? e.loaded / total : 1,
                })
            })
            if (loader.transform) res = await loader.transform(res, options)
            delete loader.importOptions

            this._rootContext = undefined

            this.dispatchEvent({type: 'importFile', path, state:'downloading', progress: 1})
            this.dispatchEvent({type: 'importFile', path, state: 'adding'})

            if (file)
                this._logger('AssetImporter: loaded', path)
            else
                this._logger('AssetImporter: downloaded', path)

            if (file)
                this.unregisterFile(path)

        } catch (e: any) {
            console.error('AssetImporter: Unable to import file', path, file)
            console.error(e)
            console.error(e?.stack)
            // throw e
            this.dispatchEvent({type: 'importFile', path, state: 'error', error: e})
            if (file)
                this.unregisterFile(path)
            return []
        }
        this.dispatchEvent({type: 'importFile', path, state: 'done'}) // todo: do this after processing?
        // if (file) {
        //     file.__loadedAsset = res
        //
        //
        //     // todo: recheck below code after dispose logic change
        //
        //     // Clear the reference __loadedAsset when any one asset is disposed.
        //     // it's a bit hacky to do this here, but it works for now. todo: move to a better place
        //     let ress: any[] = []
        //     if (Array.isArray(res)) ress = res.flat(2)
        //     else if ((<RootSceneImportResult>res)?.userData?.rootSceneModelRoot) ress.push(...(<IObject3D>res).children)
        //     else ress.push(res)
        //     for (const r of ress) r?.addEventListener?.('dispose', () => file.__loadedAsset = undefined)
        //
        // }
        if (res && typeof res === 'object' && !Array.isArray(res)) {
            if (options.fileHandler && !options.fileExtension) {
                console.warn('AssetImporter - Pass fileExtension to options when using fileHandler to be able to use `rootPath`', options.fileHandler, path)
            }
            res.__rootPath = path
            if (options) {
                const ser = this._serializeOptions(options)
                if (ser) res.__rootPathOptions = JSON.parse(ser)
            }
            const f = file || this._fileDatabase.get(path)
            if (f) res.__rootBlob = f
        }
        return res
    }

    // endregion

    // region file database

    /**
     * Register a file in the database and return a loader for it. If the loader does not exist, it will be created.
     * @param path
     * @param file
     * @param extension
     * @param loader
     */
    registerFile(path: string, file?: IFile, extension?: string, loader?: ILoader): ILoader | undefined {
        const isData = path.startsWith('data:') || false
        if (!isData) path = path.replace(/\?.*$/, '') // remove query string

        const ext = extension || (isData ? undefined : file?.ext ?? parseFileExtension(file?.name ?? path.trim())?.toLowerCase())
        const mime = file?.mime ?? isData ? path.slice(0, path.indexOf(';')).split(':')[1] || undefined : undefined

        if (file) {
            if (file.name === undefined) (file as any).name = path
            if (!file.ext) file.ext = ext
            if (!file.mime) file.mime = mime
            if (this._fileDatabase.has(path)) {
                console.warn('AssetImporter: File already registered, replacing', path)
                this.unregisterFile(path)
            }
            this._fileDatabase.set(path, file)
        }

        return loader || this._getLoader(path, ext, mime) || this._createLoader(path, ext, mime)
    }

    /**
     * Remove a file from the database and revoke the object url if it exists.
     * @param path
     */
    unregisterFile(path: string) {
        path = path.replace(/\?.*$/, '') // remove query string
        const file = this._fileDatabase.get(path)
        if (file?.objectUrl) {
            URL.revokeObjectURL(file.objectUrl)
            file.objectUrl = undefined
        }
        if (file) this._fileDatabase.delete(path)
    }

    // endregion

    // region processRaw

    public async processRaw<T extends (ImportResult|undefined) = ImportResult>(res: T|T[], options: ProcessRawOptions, path?: string): Promise<T[]> {
        if (!res) return []

        // legacy
        if (options.processImported !== undefined) {
            console.error('AssetImporter: processImported is deprecated, use processRaw instead')
            options.processRaw = options.processImported
        }

        if (Array.isArray(res)) {
            const r: any[] = []
            for (const re of res) { // todo: should we parallelize?
                r.push(...await this.processRaw(re, options, path))
            }
            return r
        }

        if (options.processRaw === false) return [res]

        if (res.assetImporterProcessed && !options.forceImporterReprocess) return [res]

        this.dispatchEvent({type: 'processRawStart', data: res, options, path})

        // for testing only
        if (res.isTexture && options._testDataTextureComplete) {
            // if some data textures are not loading correctly, should not ideally be required
            if (res.isDataTexture && res.image?.data) res.image.complete = true
            if (res.image?.complete) res.needsUpdate = true
        }
        const rootPath = res.__rootPath
        const rootPathOptions = res.__rootPathOptions
        const rootBlob = res.__rootBlob

        if (res.userData) {
            const userData: IImportResultUserData = res.userData
            if (!userData.rootPath && rootPath && !rootPath.startsWith('blob:') && !rootPath.startsWith('/')) {
                userData.rootPath = rootPath
                if (rootPathOptions) userData.rootPathOptions = rootPathOptions
            }
            if (rootBlob) {
                userData.__sourceBlob = rootBlob
                if (userData.__needsSourceBuffer) { // set __sourceBuffer here if required during serialize later on, __needsSourceBuffer can be set in asset loaders
                    userData.__sourceBuffer = await rootBlob.arrayBuffer()
                    delete userData.__needsSourceBuffer
                }
            }
        }
        if ((res as RootSceneImportResult)?.userData && (res as RootSceneImportResult).userData.rootSceneModelRoot) {
            res._childrenCopy = [...res.children]
        }

        if (res.name === '') res.name = (rootPath || rootBlob?.filePath || rootBlob?.name || '').replace(/^\//, '')

        // if (res.assetType) // todo: why if?
        res.assetImporterProcessed = true // this should not be put in userData

        this.dispatchEvent({type: 'processRaw', data: res, options, path})

        // special for zip files. ZipLoader gives this
        if ((<any>res) instanceof Map && options.autoImportZipContents !== false) {
            // todo: should we pass in onProgress from outside?
            return [...(await this.importFiles<T>(<any>res, options)).values()].flat()
        }

        return [res]

    }

    public async processRawSingle<T extends (ImportResult|undefined) = ImportResult>(res: T, options: ProcessRawOptions, path?: string): Promise<T> {
        return (await this.processRaw(res, options, path))[0]
    }

    // endregion

    // region disposal

    dispose(): void {
        this.clearCache()
        // this._processors?.dispose()
        // this._loadingManager.dispose // todo
    }

    /**
     * Clear memory asset and loader cache. Browser cache and custom cache storage is not cleared with this.
     */
    clearCache(): void {
        this._cachedAssets = []
        this.unregisterAllFiles() // todo should this be done here?
        this.clearLoaderCache()
    }

    unregisterAllFiles(): void {
        const keys = [...this._fileDatabase.keys()]
        for (const key of keys) {
            this.unregisterFile(key)
        }
    }

    clearLoaderCache(): void {
        for (const lc of this._loaderCache) {
            lc.loader?.dispose && lc.loader?.dispose()
        }
        this._loaderCache = []
    }

    // endregion

    // region utils

    resolveURL(url: string): string {
        return this._loadingManager.resolveURL(url)
    }

    protected _urlModifiers: ((url: string) => string)[] = []
    addURLModifier(modifier: (url: string) => string) {
        this._urlModifiers.push(modifier)
    }
    removeURLModifier(modifier: (url: string) => string) {
        const index = this._urlModifiers.indexOf(modifier)
        if (index >= 0) this._urlModifiers.splice(index, 1)
    }

    protected _urlModifier(url: string) {
        url = this._urlModifiers.reduce((acc, modifier) => modifier(acc), url)
        let normalizedURL = decodeURI(url)
        const rootUrl = this._rootContext?.rootUrl
        if (!normalizedURL.includes('://') && rootUrl && !normalizedURL.startsWith(rootUrl))
            normalizedURL = rootUrl + normalizedURL
        normalizedURL = normalizedURL.replace('./', '') // remove ./
        normalizedURL = normalizedURL.replace(/^(\/\/)/, '/') // fix for start with //
        // remove query string
        normalizedURL = normalizedURL.replace(/\?.*$/, '')

        const file = this._fileDatabase.get(normalizedURL)
        if (!file) return url
        const ext = file.ext
        if (!ext) {
            console.error('Unable to determine file extension', file)
            return url
        }
        if (!file.objectUrl) file.objectUrl = URL.createObjectURL(file) + '#' + normalizedURL
        return file.objectUrl
    }

    private _isRootFile(ext?: string, mime?: string) {
        mime = mime?.toLowerCase()
        ext = ext?.toLowerCase()
        return this.importers.find(value => value.root && (
            ext && value.ext.includes(ext.toLowerCase()) ||
            mime && value.mime.includes(mime.toLowerCase())
        )) != null
    }

    // get an importer that can create a loader
    private _getImporter(name:string, ext?:string, mime?: string, isRoot = false): IImporter | undefined {
        mime = mime?.toLowerCase()
        ext = ext?.toLowerCase()
        return this.importers.find(importer => {
            if (isRoot && !importer.root) return false
            if (mime && importer.mime?.find(m => mime === m)) return true
            if (importer.ext.find(iext =>
                ext ? iext === ext : name?.toLowerCase()?.endsWith('.' + iext)
                || iext?.startsWith('data:') && name?.startsWith(iext))) return true
            return false
        })
    }

    // get a loader that can load a file.
    private _getLoader(name?:string, ext?:string, mime?: string): ILoader | undefined {
        if (!ext && !mime && name) ext = parseFileExtension(name).toLowerCase()
        mime = mime?.toLowerCase().trim()
        ext = ext?.toLowerCase().trim()
        return (name ? this._loadingManager.getHandler(name.trim()) as ILoader : undefined)
            || this._loaderCache.find((lc)=> ext && lc.ext.includes(ext) || mime && lc.mime.includes(mime))?.loader
    }

    private _createLoader(name:string, ext?:string, mime?: string): ILoader | undefined { // todo: remove/destroy loader.
        const importer = this._getImporter(name, ext, mime)
        if (!importer) return undefined
        const loader = importer.ctor(this)
        if (!loader) return undefined
        importer.ext.forEach(iext => {
            const regex = new RegExp(iext.startsWith('data:') ? '^' + escapeRegExp(iext) + '[\\/\\+\\:\\,\\;]' : '\\.' + iext + '$', 'i')
            this._loadingManager.addHandler(regex, loader)
        })
        importer.mime?.forEach(imime => {
            const regex = new RegExp('^data:' + escapeRegExp(imime) + '[\\/\\+\\:\\,\\;]', 'i')
            this._loadingManager.addHandler(regex, loader)
        })
        this._loaderCache.push({loader, ext: importer.ext, mime: importer.mime})
        this.dispatchEvent({type: 'loaderCreate', loader})
        return loader
    }

    private _cacheStoreInitPromise?: Promise<void>
    private _initCacheStorage(simpleCache?: boolean, storage?: Cache | Storage | boolean) {
        if (storage === true && window?.caches) {
            this._cacheStoreInitPromise = window.caches.open?.('threepipe-assetmanager').then(c => {
                this._initCacheStorage(simpleCache, c)
                this._storage = c
                this._cacheStoreInitPromise = undefined
            })
            return
        }
        if (simpleCache || storage) {
            // three.js built-in simple memory cache. used in FileLoader.js todo: use local storage somehow
            if (simpleCache) threeCache.enabled = true

            if (storage && window.Cache && typeof window.Cache === 'function' && storage instanceof window.Cache) {
                overrideThreeCache(storage)
                // todo: clear cache
            }
        }
        this._storage = typeof storage === 'boolean' ? undefined : storage
    }

    addEventListener<T extends keyof IAssetImporterEventMap>(type: T, listener: EventListener<IAssetImporterEventMap[T], T, this>): void {
        super.addEventListener(type, listener)
        if (type === 'loaderCreate') {
            for (const loaderCacheElement of this._loaderCache) {
                this.dispatchEvent({type: 'loaderCreate', loader: loaderCacheElement.loader})
            }
        }
    }

    // endregion

    // region Loader Event Dispatchers
    protected _onLoad() {
        this.dispatchEvent({type: 'onLoad'})
    }

    protected _onProgress(url: string, loaded: number, total: number) {
        this.dispatchEvent({type: 'onProgress', url, loaded, total})
    }

    protected _onError(url: string) {
        this.dispatchEvent({type: 'onError', url})
    }

    protected _onStart(url: string, loaded: number, total: number) {
        this.dispatchEvent({type: 'onStart', url, loaded, total})
    }
    // endregion

    // region deprecated

    /**
     * @deprecated use {@link processRaw} instead
     * @param res
     * @param options
     */
    public async processImported(res: any, options: ProcessRawOptions, path?: string): Promise<any[]> {
        console.error('processImported is deprecated. Use processRaw instead.')
        return await this.processRaw(res, options, path)
    }

    // endregion


}

// function escapeReplacement(str: string) {
//     return str.replace(/\$/g, '$$$$')
// }
