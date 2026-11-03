import {ImportAssetOptions, ImportResult, ProcessRawOptions, RootSceneImportResult} from './IAssetImporter'
import {BaseEvent, EventDispatcher, Object3D} from 'three'
import {ISerializedConfig, IViewerPlugin, type ThreeViewer} from '../viewer'
import {AssetImporter} from './AssetImporter'
import {IAsset} from './IAsset'
import {AddObjectOptions, IMaterial, IObject3D, ISceneEventMap, ITexture} from '../core'
import {MaterialManager} from './MaterialManager'
import {GLTFLoader2, JSONMaterialLoader} from './import'
import {ValOrArr} from 'ts-browser-helpers'
import {AssetExporter} from './AssetExporter'
import {IExporter} from './IExporter'
import {GLTFExporter2, GLTFWriter2} from './export'
import {legacySeparateMapSamplerUVFix} from '../utils/legacy'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {GLTFExporterPlugin} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {defaultAssetFormats} from './formats'
import {upgradeImportedAsset} from './upgradeImportedAsset'

// todo rename to AssetImporterCacheOptions
export interface AssetManagerOptions{
    /**
     * simple memory based cache for downloaded files, default = false
     */
    simpleCache?: boolean
    /**
     * Cache Storage for downloaded files, can use with `caches.open`
     * When true and by default uses `caches.open('threepipe-assetmanager')`, set to false to disable
     * @default true
     */
    storage?: Cache | Storage | boolean
}

export interface AddAssetOptions extends AddObjectOptions{
    /**
     * Automatically set any loaded HDR, EXR file as the scene environment map
     * @default true
     */
    autoSetEnvironment?: boolean
    /**
     * Automatically set any loaded image(ITexture) file as the scene background
     */
    autoSetBackground?: boolean
}
export interface ImportAddOptions extends ImportAssetOptions, AddAssetOptions{}
export interface AddRawOptions extends ProcessRawOptions, AddAssetOptions{}

export interface AssetManagerEventMap{
    /**
     * An asset was loaded and added. `options` are the add options given to {@link AssetManager.loadImported}, without
     * `autoSetEnvironment` and `autoSetBackground`. A listener can read `importConfig: false` there: a viewer config in
     * the asset was not imported.
     */
    loadAsset: {data: ImportResult, options?: AddAssetOptions}
    processStateUpdate: object
}

/**
 * Asset Manager
 *
 * Utility class to manage import, export, and material management.
 * @category Asset Manager
 */
export class AssetManager extends EventDispatcher<AssetManagerEventMap> {
    readonly viewer: ThreeViewer
    readonly importer: AssetImporter
    readonly exporter: AssetExporter
    readonly materials: MaterialManager
    get storage() {
        return this.importer.storage
    }

    constructor(viewer: ThreeViewer, cacheOptions?: AssetManagerOptions) {
        super()
        this._sceneUpdated = this._sceneUpdated.bind(this)
        this.addAsset = this.addAsset.bind(this)
        this.addRaw = this.addRaw.bind(this)
        this._loaderCreate = this._loaderCreate.bind(this)
        this.addImported = this.addImported.bind(this)

        this.importer = new AssetImporter(!!viewer.getPlugin('debug'), cacheOptions)
        this.exporter = new AssetExporter()
        this.materials = new MaterialManager()
        this.viewer = viewer
        this.viewer.scene.addEventListener('addSceneObject', this._sceneUpdated)
        this.viewer.scene.addEventListener('materialChanged', this._sceneUpdated)
        this.viewer.scene.addEventListener('beforeDeserialize', this._sceneUpdated)

        this._setupGltfExtensions()
        this._setupObjectProcess()
        this._setupObjectExport()
        this._setupProcessState()
        this._addImporters()
        this._addExporters()

    }

    async addAsset<T extends ImportResult = ImportResult>(assetOrPath?: string | IAsset | IAsset[] | File | File[], options?: ImportAddOptions): Promise<(T | undefined)[]> {
        if (!this.importer || !this.viewer) return []
        const imported = await this.importer.import<T>(assetOrPath, options)
        if (!imported) {
            const path = typeof assetOrPath === 'string' ? assetOrPath : (assetOrPath as IAsset)?.path
            if (path && !path.split('?')[0].endsWith('.vjson'))
                console.warn('Threepipe AssetManager - Unable to import', assetOrPath, imported)
            return []
        }
        return this.loadImported<(T | undefined)[]>(imported, options)
    }

    // materials: IMaterial[] = []
    // textures: ITexture[] = []

    // todo move this function to viewer
    async loadImported<T extends ValOrArr<ImportResult | undefined> = ImportResult>(imported: T, {
        autoSetEnvironment = true,
        autoSetBackground = false,
        ...options
    }: AddAssetOptions = {}): Promise<T> {
        const arr: (ImportResult | undefined)[] = Array.isArray(imported) ? imported : [imported]
        let ret: T = Array.isArray(imported) ? [] : undefined as any

        if (options?.importConfig !== false) {
            const config = arr.find(v => v?.assetType === 'config') || arr.find(v=>v && !!v.importedViewerConfig)?.importedViewerConfig
            if (config) legacySeparateMapSamplerUVFix(config, arr.filter(a=>a?.isObject3D) as Object3D[])
        }

        for (const obj of arr) {
            if (!obj) {
                if (Array.isArray(ret)) ret.push(undefined)
                continue
            }

            let r = obj

            const rootPath = obj?.__rootBlob ? obj.__rootBlob.filePath || obj.__rootBlob.name : obj.__rootPath || obj.userData?.rootPath || obj.name || ''

            switch (obj.assetType) {
            case 'material':
                this.materials.registerMaterial(<IMaterial>obj)
                break
            case 'texture':
                if (autoSetEnvironment && (rootPath?.endsWith('.hdr') || rootPath?.endsWith('.exr')))
                    this.viewer.scene.environment = <ITexture>obj
                if (autoSetBackground) this.viewer.scene.background = <ITexture>obj
                break
            case 'model':
            case 'light':
            case 'camera':
                r = await this.viewer.addSceneObject(<IObject3D | RootSceneImportResult>obj, options) // todo update references in scene update event
                break
            case 'config':
                if (options?.importConfig !== false) await this.viewer.importConfig(<ISerializedConfig>obj)
                break
            default:

                // legacy
                if (obj.type && typeof obj.type === 'string' && (Array.isArray((obj as any).plugins) ||
                        (obj as any).type === 'ThreeViewer' || this.viewer.getPlugin((obj as any).type))) {
                    await this.viewer.importConfig(<ISerializedConfig>obj)
                }
                break
            }
            this.dispatchEvent({type: 'loadAsset', data: obj, options})
            if (Array.isArray(ret)) ret.push(r)
            else ret = r as T
        }

        return ret
    }

    /**
     * same as {@link loadImported}
     * @param imported
     * @param options
     */
    async addProcessedAssets<T extends ImportResult | undefined = ImportResult>(imported: (T | undefined)[], options?: AddAssetOptions): Promise<(T | undefined)[]> {
        return this.loadImported(imported, options)
    }

    async addAssetSingle<T extends ImportResult = ImportResult>(asset?: string | IAsset | File, options?: ImportAssetOptions): Promise<T | undefined> {
        return !asset ? undefined : (await this.addAsset<T>(asset, options))?.[0]
    }

    // processAndAddObjects
    async addRaw<T extends (ImportResult | undefined) = ImportResult>(res: T | T[], options: AddRawOptions = {}): Promise<(T | undefined)[]> {
        const r = await this.importer.processRaw<T>(res, options)
        return this.loadImported<T[]>(r, options)
    }

    async addRawSingle<T extends ImportResult | undefined = ImportResult | undefined>(res: T, options: AddRawOptions = {}): Promise<T | undefined> {
        return (await this.addRaw<T>(res, options))?.[0]
    }

    private _sceneUpdated<T extends keyof ISceneEventMap>(ev: BaseEvent<T> & ISceneEventMap[T]) { // todo: check if objects are added some other way.
        if (ev.type === 'addSceneObject') {
            const event = ev as ISceneEventMap['addSceneObject']
            const target = event.object as ImportResult
            switch (target.assetType) {
            case 'material':
                this.materials.registerMaterial(<IMaterial>target)
                break
            case 'texture':
                break
            case 'model':
            case 'light':
            case 'camera':
                break
            default:
                break
            }
        } else if (ev.type === 'materialChanged') {
            const event = ev as ISceneEventMap['materialChanged']
            const target = event.material as IMaterial | IMaterial[] | undefined
            const targets = Array.isArray(target) ? target : target ? [target] : []
            for (const t of targets) {
                this.materials.registerMaterial(t)
            }
        } else if (ev.type === 'beforeDeserialize') {// todo where is this used? is it needed?
            const event = ev as ISceneEventMap['beforeDeserialize']
            // object/material/texture to be deserialized
            const data = event.data as any
            const meta = event.meta
            if (!data.metadata) {
                console.warn('Invalid data(no metadata)', data)
            }
            if (event.material) {
                if (data.metadata?.type !== 'Material') {
                    console.warn('Invalid material data', data)
                }
                JSONMaterialLoader.DeserializeMaterialJSON(data, this.viewer, meta, event.material).then(() => {
                    //
                })
            }

        } else {
            console.error('Unexpected')
        }
    }

    dispose() {
        this.importer.dispose()
        this.materials.dispose()
        this.processState.clear()
        this.viewer.scene.removeEventListener('addSceneObject', this._sceneUpdated)
        this.viewer.scene.removeEventListener('materialChanged', this._sceneUpdated)
        this.exporter.dispose()
    }

    protected _addImporters() {
        const viewer = this.viewer
        if (!viewer) return
        this.importer.addImporter(...defaultAssetFormats.map(f => f(viewer)))
    }

    private _gltfExporter = {
        ext: ['gltf', 'glb'],
        extensions: [] as (typeof GLTFExporter2.ExportExtensions)[number][],
        ctor: (_, exporter) => {
            const ex = new GLTFExporter2()
            // This should be added at the end.
            ex.setup(this.viewer, exporter.extensions)
            return ex
        },
    } satisfies IExporter

    protected _addExporters() {
        const exporters: IExporter[] = [this._gltfExporter]

        this.exporter.addExporter(...exporters)
    }

    protected _setupObjectProcess() {
        this.importer.addEventListener('processRaw', (event) => {
            if (event.data && event.data.isObject3D) {
                const node = event.data as IObject3D
                this._loadObjectDependencies(node)
                return
            }
            const mat = event.data as IMaterial
            if (mat && mat.isMaterial && mat.uuid) {
                this.materials.registerMaterial(mat)
            }
        })

        this.importer.addEventListener('processRawStart', (e)=>upgradeImportedAsset(e, {materials: this.materials, importer: this.importer, canvas: this.viewer.canvas}))
    }

    protected _setupObjectExport() {
        // this.exporter.addEventListener('exportFile', ()=>{
        // })
    }

    /**
     * Load the embedded `rootPath` dependencies within this object
     * @param object
     * @private
     */
    private async _loadObjectDependencies(object: IObject3D) {
        const deps = [] as IObject3D[]
        if (!object.traverseModels) {
            this.viewer.console.error('AssetManager - Object not upgraded, cannot load dependencies', object)
            return
        }
        object.traverseModels && object.traverseModels(m => {
            if (m.userData.rootPathRefresh && !m._rootPathRefreshed && !m._rootPathRefreshing && m.userData.rootPath) {
                deps.push(m)
                return false // to not traverse children
            }
            return true
        }, {visible: false, widgets: true})
        const pms = deps.map(async m => {
            m._rootPathRefreshing = true
            const rootPath = m.userData.rootPath
            if (!rootPath) return null
            const rootPathOptions = m.userData.rootPathOptions
            const res = await this.importer.import(rootPath, {
                ...rootPathOptions,
            })
            if (!res) {
                throw new Error(`Unable to load asset from url - ${rootPath}`)
            }
            return res
        })
        const r = await Promise.allSettled(pms)
        // console.log(r)
        for (let i = 0; i < r.length; i++) {
            const res = r[i]
            const obj = deps[i]
            delete obj._rootPathRefreshing
            obj._rootPathRefreshed = true
            if (res.status === 'rejected') {
                this.viewer.console.error(`ThreeViewer - Failed to load root path for object ${obj.name}`, res.reason)
                continue
            }
            if (res.status !== 'fulfilled') continue
            const models = res.value
            if (!models || !models.length) continue
            const model = models.find(m => m?.isObject3D)
            if (!model) {
                this.viewer.console.warn('AssetManager - No valid model found in root path', res.value)
                continue
            }
            const others = models.filter(m => m && m !== model)
            const parent = obj.parent
            const newIndex = parent ? parent.children.indexOf(obj) : -1
            if (parent) obj.removeFromParent()
            this.viewer.object3dManager.unregisterObject(obj)
            if (!model.isObject3D) {
                this.viewer.console.warn('Non model dependency loaded. Not fully supported yet.')
                // todo?
                continue
            }
            if (!parent) {
                this.viewer.console.error('AssetManager - Unexpected error, no parent found for object when loading dependency', obj)
                // parent = this.viewer.scene.modelRoot
                continue
            }
            if (model._copyFromEmbedded) model._copyFromEmbedded(obj) // todo better name, document this in IObject3D or ImportResult?
            else {
                obj.matrix.decompose(model.position, model.quaternion, model.scale)
                model.name = obj.name // copy name
                model.userData = {...obj.userData, ...model.userData} // merge userData
                model._rootPathRefreshed = true // mark as refreshed
                // @ts-expect-error force update
                model.uuid = obj.uuid
            }
            parent.add(model as IObject3D)
            const newIndex2 = parent.children.indexOf(model as IObject3D)
            if (newIndex >= 0 && newIndex2 >= 0 && newIndex !== newIndex2) {
                parent.children.splice(newIndex2, 1)
                parent.children.splice(newIndex, 0, model as IObject3D) // add at new index
            }
            if (others.length) {
                for (const other of others) {
                    if (other?.isObject3D) {
                        parent.add(other as Object3D)
                    } else {
                        this.viewer.console.warn('Non model dependency loaded. Not fully supported yet.', other)
                    }
                }
            }
        }
    }

    // region process state

    /**
     * State of download/upload/process/other processes in the viewer.
     * Subscribes to importer and exporter by default, more can be added by plugins like {@link FileTransferPlugin}
     */
    processState: Map<string, {state: string, progress?: number | undefined}> = new Map()

    /**
     * Set process state for a path
     * Progress should be a number between 0 and 100
     * Pass undefined in value to remove the state
     * @param path
     * @param value
     */
    setProcessState(path: string, value: {state: string, progress?: number | undefined} | undefined) {
        if (value === undefined) this.processState.delete(path)
        else this.processState.set(path, value)
        this.dispatchEvent({type: 'processStateUpdate'})
    }

    protected _setupProcessState() {
        this.importer.addEventListener('importFile', (data) => {
            if (!data.path || data.path.startsWith('blob:') || data.path.startsWith('data:')) return
            this.setProcessState(data.path, data.state !== 'done' ? {
                state: data.state,
                progress: data.progress ? data.progress * 100 : undefined,
            } : undefined)
        })
        this.importer.addEventListener('processRawStart', (data) => {
            if (!data.path || data.path.startsWith('blob:') || data.path.startsWith('data:')) return
            this.setProcessState(data.path, {
                state: 'processing',
                progress: undefined,
            })
        })
        this.importer.addEventListener('processRaw', (data) => {
            if (!data.path || data.path.startsWith('blob:') || data.path.startsWith('data:')) return
            this.setProcessState(data.path, undefined)
        })
        this.exporter.addEventListener('exportFile', (data) => {
            if (!data.obj.name) return
            this.setProcessState(data.obj.name, data.state !== 'done' ? {
                state: data.state,
                progress: data.progress ? data.progress * 100 : undefined,
            } : undefined)
        })
    }

    // endregion

    // region glTF extensions registration helpers

    gltfExtensions: {
        name: string
        import: (parser: GLTFParser, viewer?: ThreeViewer) => GLTFLoaderPlugin,
        export: (parser: GLTFWriter2) => GLTFExporterPlugin,
        textures?: Record<string, string|number> // see GLTFDracoExportPlugin
    }[] = []

    protected _setupGltfExtensions() {
        this.importer.addEventListener('loaderCreate', this._loaderCreate as any)
        this.viewer.forPlugin('GLTFDracoExportPlugin', (p)=> {
            if (!p.addExtension) return
            for (const gltfExtension of this.gltfExtensions) {
                p.addExtension(gltfExtension.name, gltfExtension.textures)
            }
        })
    }

    protected _loaderCreate({loader}: {loader: GLTFLoader2}) {
        if (!loader.isGLTFLoader2) return
        for (const gltfExtension of this.gltfExtensions) {
            loader.register(gltfExtension.import)
        }
    }

    registerGltfExtension(ext: AssetManager['gltfExtensions'][number]) {
        const ext1 = this.gltfExtensions.findIndex(e => e.name === ext.name)
        if (ext1 >= 0) this.gltfExtensions.splice(ext1, 1)
        this.gltfExtensions.push(ext)
        this._gltfExporter.extensions.push(ext.export)
        const exporter2 = this.exporter.getExporter('gltf', 'glb')
        if (exporter2 && exporter2 !== this._gltfExporter)
            exporter2.extensions?.push(ext.export)
    }

    unregisterGltfExtension(name: string) {
        const ind = this.gltfExtensions.findIndex(e => e.name === name)
        if (ind < 0) return
        this.gltfExtensions.splice(ind, 1)
        const ind1 = this._gltfExporter.extensions.findIndex(e => e.name === name)
        if (ind1 >= 0) this._gltfExporter.extensions.splice(ind1, 1)
        const exporter2 = this.exporter.getExporter('gltf', 'glb')
        if (exporter2?.extensions && exporter2 !== this._gltfExporter) {
            const ind2 = exporter2.extensions.findIndex(e => e.name === name)
            if (ind2 >= 0) exporter2.extensions?.splice(ind2, 1)
        }
    }

    // endregion

    // region deprecated

    /**
     * @deprecated use addRaw instead
     * @param res
     * @param options
     */
    async addImported<T extends (ImportResult | undefined) = ImportResult>(res: T | T[], options: AddRawOptions = {}): Promise<(T | undefined)[]> {
        console.error('addImported is deprecated, use addRaw instead')
        return this.addRaw(res, options)
    }

    /**
     * @deprecated use addAsset instead
     * @param path
     * @param options
     */
    public async addFromPath(path: string, options: ImportAddOptions = {}): Promise<any[]> {
        console.error('addFromPath is deprecated, use addAsset instead')
        return this.addAsset(path, options)
    }

    /**
     * @deprecated use {@link ThreeViewer.exportConfig} instead
     * @param binary - if set to false, encodes all the array buffers to base64
     */
    exportViewerConfig(binary = true): Record<string, any> {
        if (!this.viewer) return {}
        console.error('exportViewerConfig is deprecated, use viewer.toJSON instead')
        return this.viewer.toJSON(binary, undefined)
    }

    /**
     * @deprecated use {@link ThreeViewer.exportPluginsConfig} instead
     * @param filter
     */
    exportPluginPresets(filter?: string[]) {
        console.error('exportPluginPresets is deprecated, use viewer.exportPluginsConfig instead')
        return this.viewer?.exportPluginsConfig(filter)
    }

    /**
     * @deprecated use {@link ThreeViewer.exportPluginConfig} instead
     * @param plugin
     */
    exportPluginPreset(plugin: IViewerPlugin) {
        console.error('exportPluginPreset is deprecated, use viewer.exportPluginConfig instead')
        return this.viewer?.exportPluginConfig(plugin)
    }

    /**
     * @deprecated use {@link ThreeViewer.importPluginConfig} instead
     * @param json
     * @param plugin
     */
    async importPluginPreset(json: any, plugin?: IViewerPlugin) {
        console.error('importPluginPreset is deprecated, use viewer.importPluginConfig instead')
        return this.viewer?.importPluginConfig(json, plugin)
    }

    // todo continue from here by moving functions to the viewer.
    /**
     * @deprecated use {@link ThreeViewer.importConfig} instead
     * @param viewerConfig
     */
    async importViewerConfig(viewerConfig: any) {
        return this.viewer?.importConfig(viewerConfig)
    }

    /**
     * @deprecated use {@link ThreeViewer.fromJSON} instead
     * @param viewerConfig
     */
    applyViewerConfig(viewerConfig: any, resources?: any) {
        console.error('applyViewerConfig is deprecated, use viewer.fromJSON instead')
        return this.viewer?.fromJSON(viewerConfig, resources)
    }

    /**
     * @deprecated moved to {@link ThreeViewer.loadConfigResources}
     * @param json
     * @param extraResources - preloaded resources in the format of viewer config resources.
     */
    async importConfigResources(json: any, extraResources?: any) {
        if (!this.importer) throw 'Importer not initialized yet.'

        if (json.__isLoadedResources) return json

        return this.viewer?.loadConfigResources(json, extraResources)
    }

    /**
     * @deprecated not a plugin anymore
     */
    static readonly PluginType = 'AssetManager'
    // endregion

}
