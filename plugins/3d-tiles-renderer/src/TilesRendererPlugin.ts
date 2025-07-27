import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    Box3B,
    DropzonePlugin,
    EventListener2,
    generateUUID,
    IAssetImporter,
    ILoader,
    ImportAddOptions,
    Importer,
    IObject3D,
    iObjectCommons,
    IRenderManager,
    IRenderManagerEventMap,
    Loader,
    LoadingManager,
    Object3D,
    Sphere,
    ThreeViewer,
    uiButton,
    uiFolderContainer,
    IObjectExtension,
} from 'threepipe'
import {TilesGroup, TilesRenderer} from '3d-tiles-renderer'
import {gltfCesiumRTCExtension, gltfMeshFeaturesExtension, gltfStructuralMetadataExtension} from './gltf'
import {
    CesiumIonAuthPlugin,
    ImplicitTilingPlugin,
    TilesFadePlugin,
    UpdateOnChangePlugin,
// @ts-expect-error moduleResolution issue
} from '3d-tiles-renderer/plugins'

export type TilesRendererGroup = TilesGroup & IObject3D

export interface TilesRendererPluginEventMap extends AViewerPluginEventMap {
    addTile: {group: TilesRendererGroup}
    removeTile: {group: TilesRendererGroup}
}

/**
 * TilesRendererPlugin is a plugin for loading and rendering OGC 3D Tiles using [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) package.
 *
 * Specification - https://www.ogc.org/standards/3dtiles/
 */
@uiFolderContainer('3D Tiles')
export class TilesRendererPlugin extends AViewerPluginSync<TilesRendererPluginEventMap> {
    public static readonly PluginType: string = 'TilesRendererPlugin'
    enabled = true
    dependencies = []

    static readonly DUMMY_EXT = 'tileset'

    objects: TilesRendererGroup[] = []

    protected _importer = new Importer(TilesRendererLoader, [TilesRendererPlugin.DUMMY_EXT, TilesRendererPlugin.DUMMY_EXT + '.json'], [], false)

    constructor() {
        super()
    }

    async load(url: string, options?: ImportAddOptions) {
        if (!this._viewer) {
            console.warn('TilesRendererPlugin: viewer not set')
            return
        }
        const temp = generateUUID() + '.' + TilesRendererPlugin.DUMMY_EXT
        const importer = this._viewer.assetManager.importer.registerFile(temp) as TilesRendererLoader
        if (!importer.isTilesRendererLoader) {
            console.warn('TilesRendererPlugin: TilesRendererLoader not registered')
            return
        }
        return await this._viewer.load<TilesRendererGroup>(url, {
            ...options,
            fileExtension: TilesRendererPlugin.DUMMY_EXT,
            fileHandler: importer,
        }).finally(() => {
            this._viewer?.assetManager.importer.unregisterFile(temp)
        })
    }

    async loadCesiumIon(info: TilesImportOptions['CesiumIonAuthPlugin'], options?: ImportAddOptions) {
        const file = generateUUID() + '.' + TilesRendererPlugin.DUMMY_EXT
        return this.load(file, {
            ...options,
            tiles: {
                CesiumIonAuthPlugin: info,
                ...options?.tiles,
            },
        })
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._importer.onCtor = (l, ai) => {
            if (l) l.ai = ai
            return l
        }
        viewer.assetManager.registerGltfExtension(gltfCesiumRTCExtension)
        viewer.assetManager.registerGltfExtension(gltfStructuralMetadataExtension)
        viewer.assetManager.registerGltfExtension(gltfMeshFeaturesExtension)
        viewer.assetManager.importer.addImporter(this._importer)
        viewer.object3dManager.registerObjectExtension(this._objectExt)
        // viewer.scene.addEventListener('addSceneObject', this._addSceneObject)
        // viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)
        // viewer.scene.addEventListener('mainCameraUpdate', this._mainCameraUpdate)
        viewer.renderManager.addEventListener('preRender', this._preRender) // note - adding to renderManager preRender, not viewer. So its fired for each camera render
        viewer.renderManager.addEventListener('resize', this._resize)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.importer.removeImporter(this._importer)
        viewer.assetManager.unregisterGltfExtension(gltfCesiumRTCExtension.name)
        viewer.assetManager.unregisterGltfExtension(gltfStructuralMetadataExtension.name)
        viewer.assetManager.unregisterGltfExtension(gltfMeshFeaturesExtension.name)
        viewer.object3dManager.unregisterObjectExtension(this._objectExt)
        // viewer.scene.removeEventListener('addSceneObject', this._addSceneObject)
        // viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        // viewer.scene.removeEventListener('mainCameraUpdate', this._mainCameraUpdate)
        viewer.renderManager.removeEventListener('preRender', this._preRender)
        viewer.renderManager.removeEventListener('resize', this._resize)
        // todo dispose all tiles renderers?
        super.onRemove(viewer)
    }

    private _preRender/* : EventListener2<'preRender', ThreeViewerEventMap, ThreeViewer>*/ = () => {
        const camera = this._viewer?.scene.renderCamera
        if (!this._viewer || !camera) return
        if (this._viewer.renderManager.frameCount > 0) return // from ProgressivePlugin
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
        for (const group of this.objects) {
            // todo do we need to do this every frame for every camera?
            group.tilesRenderer.setCamera(camera)
            group.tilesRenderer.setResolutionFromRenderer(camera, this._viewer.renderManager.webglRenderer)
            // group.tilesRenderer.frameCount = 0
            // console.log('update tiles renderer')
            group.tilesRenderer.update()
        }
    }

    // private _mainCameraUpdate: EventListener2<'mainCameraUpdate', ISceneEventMap, IScene> = (e) => {
    //     const camera = e.camera ?? this._viewer?.scene.mainCamera
    //     if (!this._viewer || !camera) return
    //     camera.updateProjectionMatrix()
    //     camera.updateMatrixWorld()
    //     for (const group of this.objects) {
    //         group.tilesRenderer.update()
    //     }
    // }
    //
    // private _mainCameraChange: EventListener2<'mainCameraChange', ISceneEventMap, IScene> = (e) => {
    //     const camera = e.camera
    //     if (!this._viewer) return
    //     for (const group of this.objects) {
    //         // todo deleteCamera?
    //         group.tilesRenderer.setCamera(camera)
    //         group.tilesRenderer.setResolutionFromRenderer(camera, this._viewer.renderManager.webglRenderer)
    //     }
    // }

    private _resize: EventListener2<'resize', IRenderManagerEventMap, IRenderManager> = () => {
        if (!this._viewer) return
        for (const group of this.objects) {
            group.tilesRenderer.setResolutionFromRenderer(this._viewer.scene.mainCamera, this._viewer.renderManager.webglRenderer)
        }
    }

    private _cachedRefs?: Pick<TilesRenderer, 'lruCache' | 'downloadQueue' | 'parseQueue'/* | 'processNodeQueue'*/>

    private _objectExt: IObjectExtension = {
        uuid: 'TilesRendererPluginObjectExt',
        isCompatible: (o)=>!!(o as TilesRendererGroup).tilesRenderer,
        onRegister: (group: TilesRendererGroup)=>{
            if (!group || !group.tilesRenderer || !this._viewer) return

            // set the second renderer to share the cache and queues from the first
            if (!this._cachedRefs) {
                this._cachedRefs = {
                    lruCache: group.tilesRenderer.lruCache,
                    downloadQueue: group.tilesRenderer.downloadQueue,
                    parseQueue: group.tilesRenderer.parseQueue,
                    // @ts-expect-error not in ts
                    processNodeQueue: group.tilesRenderer.processNodeQueue,
                }
            } else {
                group.tilesRenderer.lruCache = this._cachedRefs.lruCache
                group.tilesRenderer.downloadQueue = this._cachedRefs.downloadQueue
                group.tilesRenderer.parseQueue = this._cachedRefs.parseQueue
                // @ts-expect-error not in ts
                group.tilesRenderer.processNodeQueue = this._cachedRefs.processNodeQueue
            }

            this.objects.push(group)

            group.tilesRenderer.registerPlugin({
                dispose: () => {
                    const index = this.objects.indexOf(group)
                    if (index !== -1) this.objects.splice(index, 1)
                    this.dispatchEvent({type: 'removeTile', group})
                },
            })
            group.tilesRenderer.setCamera(this._viewer.scene.mainCamera)
            group.tilesRenderer.setResolutionFromRenderer(this._viewer.scene.mainCamera, this._viewer.renderManager.webglRenderer)
            group.tilesRenderer.update()
            group.addEventListener('dispose', ()=>{
                group.tilesRenderer.dispose()
            })

            this.dispatchEvent({type: 'addTile', group})
        },
    }

    @uiButton()
    async promptForURL() {
        const url = await this._viewer?.dialog.prompt('TilesRendererPlugin: Enter URL for the root tileset', '', true)
        if (!url) return
        const loader = this._viewer?.getPlugin(DropzonePlugin) ?? this._viewer ?? this
        return await loader.load(url, {fileExtension: TilesRendererPlugin.DUMMY_EXT})
    }
}

export class TilesRendererLoader extends Loader implements ILoader<TilesRendererGroup> {
    isTilesRendererLoader = true
    ai?: IAssetImporter
    importOptions?: ImportAddOptions

    plugins: ((o: TilesImportOptions, group: TilesRendererGroup)=>object|undefined)[] = [
        ()=>new UpdateOnChangePlugin(),
        (opts)=>opts?.ImplicitTilingPlugin !== false ? new ImplicitTilingPlugin() : undefined,
        (opts)=>opts?.TilesFadePlugin !== false ? new TilesFadePlugin(typeof opts?.TilesFadePlugin === 'object' ? opts.TilesFadePlugin : undefined) : undefined,
        (opts)=>opts?.CesiumIonAuthPlugin ? new CesiumIonAuthPlugin(typeof opts?.CesiumIonAuthPlugin === 'object' ? opts.CesiumIonAuthPlugin : undefined) : undefined,
    ]

    constructor(manager: LoadingManager) {
        super(manager)
    }

    protected _createTilesRenderer(url: string) {

        const tiles = new TilesRenderer(url)
        tiles.manager = this.manager
        tiles.fetchOptions.headers = new Headers(this.requestHeader)
        tiles.fetchOptions.credentials = this.withCredentials ? 'include' : 'same-origin'
        tiles.fetchOptions.mode = 'cors'

        return tiles
    }

    load(url: string, onLoad: (data: unknown) => void, _onProgress?: (event: ProgressEvent) => void, _onError?: (err: unknown) => void) {
        // todo
        // let resourcePath = this.resourcePath || this.path || LoaderUtils.extractUrlBase(url)

        const tiles = this._createTilesRenderer(url)
        const group = iObjectCommons.upgradeObject3D.call(tiles.group) as TilesRendererGroup
        group.autoUpgradeChildren = false

        const opts = this.importOptions?.tiles ?? {}
        tiles.errorTarget = opts.errorTarget ?? 1
        const plugins = [...this.plugins, ...opts.plugins ?? []]
        for (const plugin of plugins) {
            const p = plugin(opts, group)
            if (p) tiles.registerPlugin(p)
        }

        // bounds, similar to InstancedMesh
        group.boundingBox = null
        group.boundingSphere = null
        group.computeBoundingBox = ()=>{
            if (!group.boundingBox) group.boundingBox = new Box3B()
            tiles.getBoundingBox(group.boundingBox)
        }
        group.computeBoundingSphere = ()=>{
            if (!group.boundingSphere) group.boundingSphere = new Sphere()
            tiles.getBoundingSphere(group.boundingSphere)
        }
        tiles.addEventListener('load-tile-set', (_e) => {
            group.computeBoundingBox!()
            group.computeBoundingSphere!()
        })

        // const sup = group.updateWorldMatrix
        // todo remove in next version
        group.updateWorldMatrix = (updateParents) => {
            if (group.parent && updateParents) {
                group.parent.updateWorldMatrix(updateParents, false)
            }
            // run the normal update function to ensure children and inverse matrices are in sync
            group.updateMatrixWorld(true)
        }

        // Save promise to tell the viewer/scene when the load is finished, it can then autoScale, autoCenter etc
        let resolve: any
        // let reject: any
        group._loadingPromise = new Promise<void>((res, _rej) => {
            resolve = res
            // reject = _rej
        })
        tiles.addEventListener('load-tile-set', (e) => {
            const isRoot = e.tileSet === tiles.rootTileSet
            if (isRoot && resolve) {
                resolve()
            }
        })

        group.userData.rootPathRefresh = true // when next loaded from gltf, the object will be refreshed based on rootPath
        group._rootPathRefreshed = true // so that it doesn't do it this time
        group._sChildren = [] // so that it's children are not saved in the gltf exporter.
        tiles.registerPlugin({
            processTileModel: (model: Object3D, tile: any) => {
                if (tile === (tiles.rootTileSet as any)?.root) {
                    group._sChildren = [model] // the root tileset will be saved inside the gltf on export
                }
            },
        })

        const ai = this.ai
        if (ai) {
            const tmpFile = generateUUID()
            ai.registerFile(tmpFile + '.gltf') // to set the gltf loader in manager
            ai.registerFile(tmpFile + '.drc') // to set the draco loader in manager

            const preprocessUrl = (url1: string) => {
                if (tiles.preprocessURL) return tiles.preprocessURL(url1)
                return url1
            }
            ai.addURLModifier(preprocessUrl)
            tiles.registerPlugin({
                dispose: () => {
                    if (ai) {
                        ai.unregisterFile(tmpFile + '.gltf')
                        ai.unregisterFile(tmpFile + '.drc')
                        ai.removeURLModifier(preprocessUrl)
                    }
                },
            })

        }

        tiles.addEventListener('tile-visibility-change', (_e) => {
            // console.log(e)
        })

        const setDirty = (_e: any)=>{
            // console.log(e)
            group.setDirty({frameFade: false})
        }
        tiles.addEventListener('load-content', setDirty)
        tiles.addEventListener('load-tile-set', setDirty)
        tiles.addEventListener('needs-update', setDirty)

        tiles.update()
        onLoad(group)

    }

}

export interface TilesImportOptions{
    /**
     * @default 1
     */
    errorTarget?: number
    ImplicitTilingPlugin?: boolean
    TilesFadePlugin?: boolean | {
        maximumFadeOutTiles?: number,
        fadeRootTiles?: boolean,
        fadeDuration?: number,
    }
    CesiumIonAuthPlugin?: boolean | {
        apiToken: string,
        assetId?: string | null,
        autoRefreshToken?: boolean
    }
    plugins?: ((opts: TilesImportOptions, group: TilesRendererGroup)=>object|undefined)[]
}

declare module 'threepipe'{
    interface ImportAddOptions {
        tiles?: TilesImportOptions
    }
}
