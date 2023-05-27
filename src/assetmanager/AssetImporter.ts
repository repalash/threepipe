import {Event, EventDispatcher, FileLoader, LoaderUtils, LoadingManager} from 'three'
import {
    IAssetImporter,
    IAssetImporterEventTypes,
    IImportResultUserData,
    ImportAssetOptions,
    ImportFilesOptions,
    ImportResult,
    LoadFileOptions,
    ProcessRawOptions,
} from './IAssetImporter'
import {IAsset, IFile} from './IAsset'
import {IImporter, ILoader} from './IImporter'
import {Importer} from './Importer'
import {SimpleJSONLoader} from './import'
import {parseFileExtension} from 'ts-browser-helpers'
import {IObject3D} from '../core'

export type IAssetImporterEvent = Event&{
    type: IAssetImporterEventTypes,
    data?: ImportResult, options?: ProcessRawOptions,
    path?: string, progress?: number, state?: string, error?: any
    files?: Map<string, IFile>
    url?: string, loaded?: number, total?: number
    loader?: ILoader,
}
export class AssetImporter extends EventDispatcher<IAssetImporterEvent, IAssetImporterEventTypes> implements IAssetImporter {
    private _loadingManager: LoadingManager

    private _logger = console.log
    // Used when loading multiple files at once.
    protected _rootContext?: {path: string, rootUrl: string, /* baseUrl: string;*/}
    private _loaderCache: {loader: ILoader, ext: string[], mime: string[]}[] = []
    private _fileDatabase: Map<string, IFile> = new Map<string, IFile>()
    private _cachedAssets: IAsset[] = []

    readonly importers: IImporter[] = [
        // new Importer(VideoTextureLoader, ['mp4', 'ogg', 'mov', 'data:video'], false),
        new Importer(SimpleJSONLoader, ['json', 'vjson'], ['application/json'], false),
        new Importer(FileLoader, ['txt'], ['text/plain'], false),
        // new Importer(RGBEPNGLoader, ['rgbe.png', 'hdr.png', 'hdrpng'], ['image/png+rgbe'], false), // todo: not working on windows?
        // new Importer(LUTCubeLoader2, ['cube'], false),
    ]

    constructor(logging = false) {
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

        // addDracoLoader()
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

    async import<T extends ImportResult|undefined = ImportResult>(assetOrPath?: string | IAsset | IAsset[], options?: ImportAssetOptions): Promise<(T|undefined)[]> {
        if (!assetOrPath) return []
        if (Array.isArray(assetOrPath)) return (await Promise.all(assetOrPath.map(async a => this.import<T>(a, options)))).flat(1)
        if (typeof assetOrPath === 'object') return await this.importAsset<T>(assetOrPath, options)
        if (typeof assetOrPath === 'string') return await this.importPath<T>(assetOrPath, options)
        console.error('AssetImporter: Invalid asset or path', assetOrPath)
        return []
    }
    async importSingle<T extends ImportResult|undefined = ImportResult>(asset?: IAsset | string, options?: ImportAssetOptions): Promise<T|undefined> {
        return (await this.import<T>(asset, options))?.[0]
    }

    async importPath<T extends ImportResult|undefined = ImportResult|undefined>(path: string, options: ImportAssetOptions = {}): Promise<T[]> {
        const op = {...options}
        delete op.pathOverride
        delete op.forceImport
        delete op.reimportDisposed
        delete op.fileHandler
        delete op.importedFile
        const opts = JSON.stringify(op)
        const cached = this._cachedAssets.find(a => a.path === path && a._options === opts)
        let asset: IAsset
        if (cached) asset = cached
        else asset = {path}
        asset._options = opts
        if (options.importedFile) asset.file = options.importedFile
        return await this.importAsset(asset, options)
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
        // console.log(result)
        if (!options.forceImport && result) {
            const results = await this.processRaw<T>(result, options) // just in case its not processed. Internal check is done to ensure it's not processed twice
            let isDisposed = false // if any of the objects is disposed
            for (const r of results) {
                if (r && !r.__disposed) continue // todo add __disposed to object, material, texture, etc
                isDisposed = true
                break
            }
            // todo: should we check if any of it's children is disposed ?
            if (!isDisposed || options.reimportDisposed === false) return results
        }

        // todo: add support to get cloned asset? if we want to import multiple times and everytime return a cloned asset
        asset.preImportedRaw = this._loadFile(options.pathOverride || asset.path, typeof asset.file?.arrayBuffer === 'function' ? asset.file : undefined, options, onDownloadProgress)
        result = await asset.preImportedRaw

        if (result) result = await this.processRaw(result, options)
        if (result) {
            if (options.processRaw !== false) asset.preImported = result

            const arrs: any[] = []
            if (Array.isArray(result)) arrs.push(...result)
            else {
                if (result.userData?.rootSceneModelRoot) arrs.push(...result.children)
                else arrs.push(result)
            }
            // remove preImportedRaw when any of the assets is disposed. This is to prevent memory leaks
            arrs.forEach(r=>r.addEventListener?.('dispose', () => {
                if (asset?.preImportedRaw) asset.preImportedRaw = undefined
                if (asset?.preImported) asset.preImported = undefined
            }))
        }

        return result
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
                if (res) res = await this.processRaw(res, options)
                loaded.set(value, res)
            }
        } else {
            for (const value of altFiles) {
                let res = await this._loadFile(value, undefined, options)
                if (res) res = await this.processRaw(res, options)
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
        if (file?.__loadedAsset) return file.__loadedAsset

        this.dispatchEvent({type: 'importFile', path, state:'downloading', progress: 0})
        let res: ImportResult | ImportResult[] | undefined
        try {
            const loader = this.registerFile(path, file)

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

            res = await loader.loadAsync(path + (options.queryString ? (path.includes('?') ? '&' : '?') + options.queryString : ''), (e)=>{
                if (onDownloadProgress) onDownloadProgress(e)
                this.dispatchEvent({type: 'importFile', path, state:'downloading', progress: e.loaded / e.total})
            })
            if (loader.transform) res = await loader.transform(res, options)

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
        if (file) {
            file.__loadedAsset = res

            // Clear the reference __loadedAsset when any one asset is disposed.
            // it's a bit hacky to do this here, but it works for now. todo: move to a better place
            let ress: any[] = []
            if (Array.isArray(res)) ress = res.flat(2)
            else if ((<IObject3D>res)?.userData?.rootSceneModelRoot) ress.push(...(<IObject3D>res).children)
            else ress.push(res)
            for (const r of ress) r?.addEventListener?.('dispose', () => file.__loadedAsset = undefined)

        }
        if (res && typeof res === 'object' && !Array.isArray(res)) {
            res.__rootPath = path
            if (file) res.__rootBlob = file
        }
        return res
    }

    // endregion

    // region file database

    /**
     * Register a file in the database and return a loader for it. If the loader does not exist, it will be created.
     * @param path
     * @param file
     */
    registerFile(path: string, file?: IFile): ILoader | undefined {
        const isData = path.startsWith('data:') || false
        if (!isData) path = path.replace(/\?.*$/, '') // remove query string

        const ext = isData ? undefined : file?.ext ?? parseFileExtension(file?.name ?? path)?.toLowerCase()
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

        return this._getLoader(path) || this._createLoader(path, ext, mime)
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

    public async processRaw<T extends (ImportResult|undefined) = ImportResult>(res: T|T[], options: ProcessRawOptions): Promise<T[]> {
        if (!res) return []

        // legacy
        if (options.processImported !== undefined) {
            console.error('AssetImporter: processImported is deprecated, use processRaw instead')
            options.processRaw = options.processImported
        }

        if (Array.isArray(res)) {
            const r: any[] = []
            for (const re of res) { // todo: can we parallelize?
                r.push(...await this.processRaw(re, options))
            }
            return r
        }

        if (options.processRaw === false) return [res]

        if (res.assetImporterProcessed && !options.forceImporterReprocess) return [res]

        this.dispatchEvent({type: 'processRawStart', data: res, options})

        // for testing only
        if (res.isTexture && options._testDataTextureComplete) {
            // if some data textures are not loading correctly, should not ideally be required
            if (res.isDataTexture && res.image?.data) res.image.complete = true
            if (res.image?.complete) res.needsUpdate = true
        }

        if (res.userData) {
            const userData: IImportResultUserData = res.userData
            const rootPath = res.__rootPath
            if (!userData.rootPath && rootPath && !rootPath.startsWith('blob:') && !rootPath.startsWith('/'))
                userData.rootPath = rootPath
            if (res.__rootBlob) {
                userData.__sourceBlob = res.__rootBlob
                if (userData.__needsSourceBuffer) { // set __sourceBuffer here if required during serialize later on, __needsSourceBuffer can be set in asset loaders
                    userData.__sourceBuffer = await res.__rootBlob.arrayBuffer()
                    delete userData.__needsSourceBuffer
                }
            }
        }

        // if (res.assetType) // todo: why if?
        res.assetImporterProcessed = true // this should not be put in userData

        this.dispatchEvent({type: 'processRaw', data: res, options})

        // special for zip files. ZipLoader gives this
        if ((<any>res) instanceof Map && options.autoImportZipContents !== false) {
            // todo: should we pass in onProgress from outside?
            return [...(await this.importFiles<T>(<any>res, options)).values()].flat()
        }

        return [res]

    }

    public async processRawSingle<T extends (ImportResult|undefined) = ImportResult>(res: T, options: ProcessRawOptions): Promise<T> {
        return (await this.processRaw(res, options))[0]
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
        this.unregisterAllFiles()
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
            lc.loader?.dispose?.()
        }
        this._loaderCache = []
    }

    // endregion

    // region utils

    resolveURL(url: string): string {
        return this._loadingManager.resolveURL(url)
    }

    protected _urlModifier(url: string) {
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
                ext && iext === ext
                || name?.toLowerCase()?.endsWith('.' + iext)
                || iext?.startsWith('data:') && name?.startsWith(iext))) return true
            return false
        })
    }

    // get a loader that can load a file.
    private _getLoader(name?:string, ext?:string, mime?: string): ILoader | undefined {
        if (!ext && !mime && name) ext = parseFileExtension(name).toLowerCase()
        mime = mime?.toLowerCase()
        ext = ext?.toLowerCase()
        return (name ? this._loadingManager.getHandler(name) as ILoader : undefined)
            || this._loaderCache.find((lc)=> ext && lc.ext.includes(ext) || mime && lc.mime.includes(mime))?.loader
    }

    private _createLoader(name:string, ext?:string, mime?: string): ILoader | undefined { // todo: remove/destroy loader.
        const importer = this._getImporter(name, ext, mime)
        if (!importer) return undefined
        const loader = importer.ctor(this)
        if (!loader) return undefined
        importer.ext.forEach(iext => {
            const regex = new RegExp(iext.startsWith('data:') ? '^' + iext + '\\/' : '\\.' + iext + '$', 'i')
            this._loadingManager.addHandler(regex, loader)
        })
        importer.mime?.forEach(imime => {
            const regex = new RegExp('^data:' + imime + '$', 'i')
            this._loadingManager.addHandler(regex, loader)
        })
        this._loaderCache.push({loader, ext: importer.ext, mime: importer.mime})
        this.dispatchEvent({type: 'loaderCreate', loader})
        return loader
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
    public async processImported(res: any, options: ProcessRawOptions): Promise<any[]> {
        console.error('processImported is deprecated. Use processRaw instead.')
        return await this.processRaw(res, options)
    }

    // endregion


}
