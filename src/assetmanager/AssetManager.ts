import {ImportAssetOptions, ImportResult, ProcessRawOptions, RootSceneImportResult} from './IAssetImporter'
import {
    BaseEvent,
    Camera,
    EventDispatcher,
    Light,
    LinearFilter,
    LinearMipmapLinearFilter,
    LoadingManager,
    Object3D,
    TextureLoader,
} from 'three'
import {ISerializedConfig, IViewerPlugin, type ThreeViewer} from '../viewer'
import {AssetImporter} from './AssetImporter'
import {getTextureDataType} from '../three'
import {IAsset} from './IAsset'
import {
    AddObjectOptions,
    AmbientLight2,
    DirectionalLight2,
    HemisphereLight2,
    ICamera,
    iCameraCommons,
    ILight,
    iLightCommons,
    IMaterial,
    iMaterialCommons,
    IObject3D,
    iObjectCommons,
    ISceneEventMap,
    ITexture,
    OrthographicCamera2,
    PerspectiveCamera2,
    PointLight2,
    RectAreaLight2,
    SpotLight2,
    upgradeTexture,
} from '../core'
import {Importer} from './Importer'
import {MaterialManager} from './MaterialManager'
import {
    DRACOLoader2,
    FBXLoader2,
    GLTFLoader2,
    JSONMaterialLoader,
    MTLLoader2,
    OBJLoader2,
    SVGTextureLoader,
    VideoTextureLoader,
    ZipLoader,
} from './import'
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js'
import {EXRLoader} from 'three/examples/jsm/loaders/EXRLoader.js'
import {Class, ValOrArr} from 'ts-browser-helpers'
import {ILoader} from './IImporter'
import {AssetExporter} from './AssetExporter'
import {IExporter} from './IExporter'
import {GLTFExporter2, GLTFWriter2} from './export'
import {legacySeparateMapSamplerUVFix} from '../utils/legacy'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {GLTFExporterPlugin} from 'three/examples/jsm/exporters/GLTFExporter.js'

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
    loadAsset: {data: ImportResult}
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
    }: AddAssetOptions = {}): Promise<T | never[]> {
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

            const rootPath = obj.__rootPath || obj.userData?.rootPath

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
            this.dispatchEvent({type: 'loadAsset', data: obj})
            if (Array.isArray(ret)) ret.push(r)
            else ret = r as T
        }

        return ret || []
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
        } else if (ev.type === 'beforeDeserialize') {
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

        // todo fix - loading manager getHandler matches backwards?
        const importers: Importer[] = [
            new Importer(SVGTextureLoader, ['svg', 'data:image/svg'], ['image/svg+xml'], false), // todo: use ImageBitmapLoader if supported (better performance)

            new Importer(TextureLoader, ['webp', 'png', 'jpeg', 'jpg', 'ico', 'data:image', 'avif', 'bmp', 'gif', 'tiff'], [
                'image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/avif',
            ], false), // todo: use ImageBitmapLoader if supported (better performance)

            new Importer<JSONMaterialLoader>(JSONMaterialLoader,
                ['mat', ...this.materials.templates.map(t => t.typeSlug!).filter(v => v)], // todo add others
                [], false, (loader) => {
                    if (loader) loader.viewer = this.viewer
                    return loader
                }),

            new Importer(class extends RGBELoader {
                constructor(manager: LoadingManager) {
                    super(manager)
                    this.setDataType(getTextureDataType(viewer.renderManager.renderer))
                }
            }, ['hdr'], ['image/vnd.radiance'], false),

            new Importer(class extends EXRLoader {
                constructor(manager: LoadingManager) {
                    super(manager)
                    this.setDataType(getTextureDataType(viewer.renderManager.renderer))
                }
            }, ['exr'], ['image/x-exr'], false),

            new Importer(FBXLoader2, ['fbx'], ['model/fbx'], true),
            new Importer(ZipLoader, ['zip', 'glbz', 'gltfz'], ['application/zip', 'model/gltf+zip', 'model/zip'], true), // gltfz and glbz are invented zip files with gltf/glb inside along with resources

            new Importer(OBJLoader2 as any as Class<ILoader>, ['obj'], ['model/obj'], true),
            new Importer(MTLLoader2 as any as Class<ILoader>, ['mtl'], ['model/mtl'], false),

            new Importer<GLTFLoader2>(GLTFLoader2, ['gltf', 'glb', 'data:model/gltf', 'data:model/glb'], ['model/gltf', 'model/gltf+json', 'model/gltf-binary', 'model/glb'], true, (l, _, i) => l?.setup(this.viewer, i.extensions)),

            new Importer(DRACOLoader2, ['drc'], ['model/mesh+draco', 'model/drc'], true),

            new Importer(VideoTextureLoader, ['mp4', 'ogg', 'mov', 'webm', 'data:video'], ['video/mp4', 'video/ogg', 'video/quicktime', 'video/webm'], true),
        ]

        this.importer.addImporter(...importers)

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
            const obj = event.data as IObject3D
            if (obj && obj.isObject3D) {
                this._loadObjectDependencies(obj)
                return
            }
            // console.log('preprocess mat', mat)
            const mat = event.data as IMaterial
            if (!mat || !mat.isMaterial || !mat.uuid) return
            this.materials.registerMaterial(mat)
        })

        this.importer.addEventListener('processRawStart', (event) => {
            // console.log('preprocess mat', mat)
            const res = event.data!
            const options = event.options! as ProcessRawOptions
            // if (!res.assetType) {
            //     if (res.isBufferGeometry) { // for eg stl todo
            //         res = new Mesh(res, new MeshStandardMaterial())
            //     }
            //     if (res.isObject3D) {
            //     }
            // }
            if (res.isObject3D) {
                const cameras: Camera[] = []
                const lights: Light[] = []
                res.traverse((obj: any) => {
                    if (obj.material) {
                        const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
                        const newMaterials = []
                        for (const material of materials) {
                            const mat = this.materials.convertToIMaterial(material, {createFromTemplate: options.replaceMaterials !== false}) || material
                            mat.uuid = material.uuid
                            mat.userData.uuid = material.uuid
                            newMaterials.push(mat)
                        }
                        if (Array.isArray(obj.material)) obj.material = newMaterials
                        else obj.material = newMaterials[0]
                    }
                    if (obj.isCamera) cameras.push(obj)
                    if (obj.isLight) lights.push(obj)
                })
                for (const camera of cameras) {
                    if ((camera as Partial<ICamera>).assetType === 'camera') continue
                    // todo: OrthographicCamera
                    if (!camera.parent || options.replaceCameras === false) {
                        iCameraCommons.upgradeCamera.call(camera)
                    } else {
                        const newCamera: ICamera = (camera as any).iCamera ??
                            !(camera as Partial<ICamera>).isOrthographicCamera ?
                            new PerspectiveCamera2('', this.viewer.canvas) :
                            new OrthographicCamera2('', this.viewer.canvas)
                        if (camera === newCamera) continue
                        camera.parent.children.splice(camera.parent.children.indexOf(camera), 1, newCamera)
                        newCamera.parent = camera.parent as any
                        newCamera.copy(camera as any)
                        camera.parent = null
                        ;(newCamera as any).uuid = camera.uuid
                        newCamera.userData.uuid = camera.uuid
                        ;(camera as any).iCamera = newCamera
                        // console.log('replacing camera', camera, newCamera)
                    }
                }
                for (const light of lights) {
                    if ((light as ILight).assetType === 'light') continue
                    if (!light.parent || options.replaceLights === false) {
                        iLightCommons.upgradeLight.call(light)
                    } else {
                        const newLight: ILight | undefined = (light as any).iLight ??
                        (light as any).isDirectionalLight ? new DirectionalLight2() :
                            (light as any).isPointLight ? new PointLight2() :
                                (light as any).isSpotLight ? new SpotLight2() :
                                    (light as any).isAmbientLight ? new AmbientLight2() :
                                        (light as any).isHemisphereLight ? new HemisphereLight2() :
                                            (light as any).isRectAreaLight ? new RectAreaLight2() :
                                                undefined
                        if (light === newLight || !newLight) continue
                        light.parent.children.splice(light.parent.children.indexOf(light), 1, newLight)
                        newLight.parent = light.parent as any
                        newLight.copy(light as any)
                        light.parent = null
                        ;(newLight as any).uuid = light.uuid
                        newLight.userData.uuid = light.uuid
                        ;(light as any).iLight = newLight
                    }
                }

                iObjectCommons.upgradeObject3D.call(res)
            } else if (res.isMaterial) {
                if (!res.assetType) iMaterialCommons.upgradeMaterial.call(res)
                // todo update res by generating new material?
            } else if (res.isTexture) {
                upgradeTexture.call(res)

                if (event?.options?.generateMipmaps !== undefined)
                    res.generateMipmaps = event?.options.generateMipmaps
                if (!res.generateMipmaps && !res.isRenderTargetTexture) { // todo: do we need to check more?
                    res.minFilter = res.minFilter === LinearMipmapLinearFilter ? LinearFilter : res.minFilter
                    res.magFilter = res.magFilter === LinearMipmapLinearFilter ? LinearFilter : res.magFilter
                }

            }
            // todo other asset/object types?
        })
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
        this.importer.addEventListener('importFile', (data: any) => {
            this.setProcessState(data.path, data.state !== 'done' ? {
                state: data.state,
                progress: data.progress ? data.progress * 100 : undefined,
            } : undefined)
        })
        this.importer.addEventListener('processRawStart', (data: any) => {
            this.setProcessState(data.path, {
                state: 'processing',
                progress: undefined,
            })
        })
        this.importer.addEventListener('processRaw', (data: any) => {
            this.setProcessState(data.path, undefined)
        })
        this.exporter.addEventListener('exportFile', (data: any) => {
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

