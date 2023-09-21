import {
    BaseEvent,
    Color,
    Event,
    EventDispatcher,
    LinearSRGBColorSpace,
    Object3D,
    Quaternion,
    Vector2,
    Vector3,
} from 'three'
import {Class, createCanvasElement, onChange, serialize} from 'ts-browser-helpers'
import {TViewerScreenShader} from '../postprocessing'
import {
    AddObjectOptions,
    IAnimationLoopEvent,
    IMaterial,
    IObject3D,
    IObjectProcessor,
    ITexture,
    PerspectiveCamera2,
    RootScene, TCameraControlsMode,
} from '../core'
import {ViewerRenderManager} from './ViewerRenderManager'
import {
    convertArrayBufferToStringsInMeta,
    getEmptyMeta,
    GLStatsJS,
    IDialogWrapper,
    jsonToBlob,
    metaFromResources,
    MetaImporter,
    metaToResources,
    SerializationMetaType,
    SerializationResourcesType,
    ThreeSerialization,
    windowDialogWrapper,
} from '../utils'
import {
    AssetManager,
    AssetManagerOptions,
    BlobExt,
    ExportFileOptions,
    IAsset,
    ImportAddOptions,
    ImportAssetOptions,
    ImportResult,
    RootSceneImportResult,
} from '../assetmanager'
import {IViewerPlugin, IViewerPluginSync} from './IViewerPlugin'
// noinspection ES6PreferShortImport
import {DropzonePlugin, DropzonePluginOptions} from '../plugins/interaction/DropzonePlugin'
import {uiConfig, uiFolderContainer, UiObjectConfig} from 'uiconfig.js'
import {IRenderTarget} from '../rendering'
import type {ProgressivePlugin} from '../plugins'
import {TonemapPlugin} from '../plugins'
import {VERSION} from './version'

export type IViewerEvent = BaseEvent & {
    type: 'update'|'preRender'|'postRender'|'preFrame'|'postFrame'|'dispose'|'addPlugin'|'renderEnabled'|'renderDisabled'
}
export type IViewerEventTypes = IViewerEvent['type']
export interface ISerializedConfig {
    assetType: 'config',
    type: string,
    metadata?: {
        generator: string,
        version: number,
        [key: string]: any
    },
    [key: string]: any
}
export interface ISerializedViewerConfig extends ISerializedConfig{
    type: 'ThreeViewer'|'ViewerApp',
    version: string,
    plugins: ISerializedConfig[],
    resources?: Partial<SerializationResourcesType> | SerializationMetaType
    renderManager?: any // todo
    scene?: any

    [key: string]: any
}

export type IConsoleWrapper = Partial<Console> & Pick<Console, 'log'|'warn'|'error'>

/**
 * Options for the ThreeViewer creation.
 * @category Viewer
 */
export interface ThreeViewerOptions {
    /**
     * The canvas element to use for rendering. Only one of container and canvas must be specified.
     */
    canvas?: HTMLCanvasElement,
    /**
     * The container for the canvas. A new canvas will be created in this container. Only one of container and canvas must be specified.
     */
    container?: HTMLElement,
    /**
     * The fragment shader snippet to render on screen.
     */
    screenShader?: TViewerScreenShader,
    /**
     * Use MSAA.
     */
    msaa?: boolean,
    /**
     * Use Uint8 RGBM HDR Render Pipeline.
     * Provides better performance with post-processing.
     * RenderManager Uses Half-float if set to false.
     */
    rgbm?: boolean
    /**
     * Use rendered gbuffer as depth-prepass / z-prepass.
     */
    zPrepass?: boolean

    /*
     * Render scale, 1 = full resolution, 0.5 = half resolution, 2 = double resolution.
     * Same as pixelRatio in three.js
     * Can be set to `window.devicePixelRatio` to render at device resolution in browsers.
     * An optimal value is `Math.min(2, window.devicePixelRatio)` to prevent issues on mobile.
     */
    renderScale?: number

    debug?: boolean

    /**
     * TonemapPlugin is added to the viewer if this is true.
     * @default true
     */
    tonemap?: boolean

    camera?: {
        controlsMode?: TCameraControlsMode,
        position?: Vector3,
        target?: Vector3,

    }

    /**
     * Options for the asset manager.
     */
    assetManager?: AssetManagerOptions

    /**
     * Add the dropzone plugin to the viewer, allowing to drag and drop files into the viewer over the canvas/container.
     * Set to true/false to enable/disable the plugin, or pass options to configure the plugin. Assuming true if options are passed.
     * @default - false
     */
    dropzone?: boolean|DropzonePluginOptions

    /**
     * @deprecated use {@link msaa} instead
     */
    isAntialiased?: boolean,
    /**
     * @deprecated use {@link rgbm} instead
     */
    useRgbm?: boolean
    /**
     * @deprecated use {@link zPrepass} instead
     */
    useGBufferDepth?: boolean
}

/**
 * Three Viewer
 *
 * The ThreeViewer is the main class in the framework to manage a scene, render and add plugins to it.
 * @category Viewer
 */
@uiFolderContainer('Viewer')
export class ThreeViewer extends EventDispatcher<IViewerEvent, IViewerEventTypes> {
    public static readonly VERSION = VERSION
    public static readonly ConfigTypeSlug = 'vjson'
    uiConfig!: UiObjectConfig

    static Console: IConsoleWrapper = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    }
    static Dialog: IDialogWrapper = windowDialogWrapper

    /**
     * If the viewer is enabled. Set this `false` to disable RAF loop.
     * @type {boolean}
     */
    enabled = true
    /**
     * Enable or disable all rendering, Animation loop including any frame/render events won't be fired when this is false.
     */
    @onChange(ThreeViewer.prototype._renderEnabledChanged)
        renderEnabled = true
    renderStats: GLStatsJS
    readonly assetManager: AssetManager
    @uiConfig() @serialize('renderManager')
    readonly renderManager: ViewerRenderManager
    public readonly plugins: Record<string, IViewerPlugin> = {}
    /**
     * Scene with object hierarchy used for rendering
     */
    get scene(): RootScene {
        return this._scene
    }
    /**
     * Specifies how many frames to render in a single request animation frame. Keep to 1 for realtime rendering.
     * Note: should be max (screen refresh rate / animation frame rate) like 60Hz / 30fps
     * @type {number}
     */
    public maxFramePerLoop = 1
    readonly debug: boolean

    /**
     * Get the HTML Element containing the canvas
     * @returns {HTMLElement}
     */
    get container(): HTMLElement {
        return this._container
    }

    /**
     * Get the HTML Canvas Element where the viewer is rendering
     * @returns {HTMLCanvasElement}
     */
    get canvas(): HTMLCanvasElement {
        return this._canvas
    }

    get console(): IConsoleWrapper {
        return ThreeViewer.Console
    }
    get dialog(): IDialogWrapper {
        return ThreeViewer.Dialog
    }
    @serialize() readonly type = 'ThreeViewer'

    /**
     * The ResizeObserver observing the canvas element. Add more elements to this observer to resize viewer on their size change.
     * @type {ResizeObserver | undefined}
     */
    readonly resizeObserver = window?.ResizeObserver ? new window.ResizeObserver(_ => this.resize()) : undefined

    private readonly _canvas: HTMLCanvasElement
    // this can be used by other plugins to add ui elements alongside the canvas
    private readonly _container: HTMLElement // todo: add a way to move the canvas to a new container... and dispatch event...
    /**
     * The Scene attached to the viewer, this cannot be changed.
     * @type {RootScene}
     */
    @uiConfig() @serialize('scene')
    private readonly _scene: RootScene
    private _needsResize = false
    private _isRenderingFrame = false
    private _objectProcessor: IObjectProcessor = {
        processObject: (object: IObject3D)=>{
            if (object.material) {
                if (Array.isArray(object.material)) this.assetManager.materials.registerMaterials(object.material)
                else this.assetManager.materials.registerMaterial(object.material)
            }
        },
    }
    private _needsReset = true // renderer needs reset

    // Helpers for tracking main camera change and setting dirty automatically
    private _lastCameraPosition: Vector3 = new Vector3()
    private _lastCameraQuat: Quaternion = new Quaternion()
    private _lastCameraTarget: Vector3 = new Vector3()
    private _tempVec: Vector3 = new Vector3()
    private _tempQuat: Quaternion = new Quaternion()

    /**
     * Create a viewer instance for using the webgi viewer SDK.
     * @param options - {@link ThreeViewerOptions}
     */
    constructor({debug = true, ...options}: ThreeViewerOptions) {
        super()
        this.debug = debug
        this._canvas = options.canvas || createCanvasElement()
        let container = options.container
        if (container && !options.canvas) container.appendChild(this._canvas)
        if (!container) container = this._canvas.parentElement ?? undefined
        if (!container) throw new Error('No container.')
        this._container = container
        this.setDirty = this.setDirty.bind(this)
        this._animationLoop = this._animationLoop.bind(this)
        this._setActiveCameraView = this._setActiveCameraView.bind(this)

        this.renderStats = new GLStatsJS(this._container)
        if (debug) this.renderStats.show()

        if (!(window as any).threeViewers) (window as any).threeViewers = [];
        (window as any).threeViewers.push(this)

        // camera

        const camera = new PerspectiveCamera2(options.camera?.controlsMode ?? 'orbit', this._canvas)
        camera.name = 'Default Camera'
        options.camera?.position ? camera.position.copy(options.camera.position) : camera.position.set(0, 0, 5)
        options.camera?.target ? camera.target.copy(options.camera.target) : camera.target.set(0, 0, 0)
        camera.setDirty()
        camera.userData.autoLookAtTarget = true // only for when controls are disabled / not available

        // Update camera controls postFrame if allowed to interact
        this.addEventListener('postFrame', () => { // todo: move inside RootScene.
            const cam = this._scene.mainCamera
            if (cam && cam.canUserInteract) {
                const d = this.getPlugin<ProgressivePlugin>('Progressive')?.postFrameConvergedRecordingDelta()
                // if (d && d > 0) delta = d
                if (d !== undefined && d === 0) return // not converged yet.
                // if d < 0 or undefined: not recording, do nothing

                cam.controls?.update()
            }
        })

        // if camera position or target changed in last frame, call setDirty on camera
        this.addEventListener('preFrame', () => { // todo: move inside RootScene.
            const cam = this._scene.mainCamera
            if (
                cam.getWorldPosition(this._tempVec).sub(this._lastCameraPosition).lengthSq() // position is in local space
                + this._tempVec.subVectors(cam.target, this._lastCameraTarget).lengthSq() // target is in world space
                + cam.getWorldQuaternion(this._tempQuat).angleTo(this._lastCameraQuat)
                > 0.000001) cam.setDirty()
        })

        // scene

        this._scene = new RootScene(camera, this._objectProcessor)
        this._scene.setBackgroundColor('#ffffff')
        // this._scene.addEventListener('addSceneObject', this._addSceneObject)
        this._scene.addEventListener('setView', this._setActiveCameraView)
        this._scene.addEventListener('activateMain', this._setActiveCameraView)
        this._scene.addEventListener('materialUpdate', (e) => this.setDirty(this._scene, e))
        this._scene.addEventListener('materialChanged', (e) => this.setDirty(this._scene, e))
        this._scene.addEventListener('objectUpdate', (e) => this.setDirty(this._scene, e))
        this._scene.addEventListener('textureUpdate', (e) => this.setDirty(this._scene, e))
        this._scene.addEventListener('sceneUpdate', (e) => {
            this.setDirty(this._scene, e)
            if (e.geometryChanged === false) return
            this.renderManager.resetShadows()
        })
        this._scene.addEventListener('mainCameraUpdate', () => {
            this._scene.mainCamera.getWorldPosition(this._lastCameraPosition)
            this._lastCameraTarget.copy(this._scene.mainCamera.target)
            this._scene.mainCamera.getWorldQuaternion(this._lastCameraQuat)
        })


        // render manager

        if (options.isAntialiased !== undefined || options.useRgbm !== undefined || options.useGBufferDepth !== undefined) {
            this.console.warn('isAntialiased, useRgbm and useGBufferDepth are deprecated, use msaa, rgbm and zPrepass instead.')
        }
        this.renderManager = new ViewerRenderManager({
            canvas: this._canvas,
            msaa: options.msaa ?? options.isAntialiased ?? false,
            rgbm: options.rgbm ?? options.useRgbm ?? false,
            zPrepass: options.zPrepass ?? options.useGBufferDepth ?? false,
            depthBuffer: !(options.zPrepass ?? options.useGBufferDepth ?? false),
            screenShader: options.screenShader,
            renderScale: options.renderScale,
        })
        this.renderManager.addEventListener('animationLoop', this._animationLoop as any)
        this.renderManager.addEventListener('resize', ()=> this._scene.mainCamera.refreshAspect())
        this.renderManager.addEventListener('update', (e) => {
            if (e.change === 'registerPass' && e.pass?.materialExtension)
                this.assetManager.materials.registerMaterialExtension(e.pass.materialExtension)
            else if (e.change === 'unregisterPass' && e.pass?.materialExtension)
                this.assetManager.materials.unregisterMaterialExtension(e.pass.materialExtension)
            this.setDirty(this.renderManager, e)
        })

        this.assetManager = new AssetManager(this, options.assetManager)

        if (this.resizeObserver) this.resizeObserver.observe(this._canvas)
        // sometimes resize observer is late, so extra check
        window && window.addEventListener('resize', this.resize)

        this._canvas.addEventListener('webglcontextrestored', this._onContextRestore, false)
        this._canvas.addEventListener('webglcontextlost', this._onContextLost, false)

        if (options.dropzone) {
            this.addPluginSync(new DropzonePlugin(typeof options.dropzone === 'object' ? options.dropzone : undefined))
        }
        if (options.tonemap !== false) {
            this.addPluginSync(new TonemapPlugin())
        }

        this.console.log('ThreePipe Viewer instance initialized, version: ', ThreeViewer.VERSION)


    }

    /**
     * Add an object/model/material/viewer-config/plugin-preset/... to the viewer scene from url or an {@link IAsset} object.
     * Same as {@link AssetManager.addAssetSingle}
     * @param obj
     * @param options
     */
    async load<T extends ImportResult = ImportResult>(obj: string | IAsset | null, options?: ImportAddOptions) {
        if (!obj) return
        return await this.assetManager.addAssetSingle<T>(obj, options)
    }

    /**
     * Imports an object/model/material/texture/viewer-config/plugin-preset/... to the viewer scene from url or an {@link IAsset} object.
     * Same as {@link AssetImporter.importSingle}
     * @param obj
     * @param options
     */
    async import<T extends ImportResult = ImportResult>(obj: string | IAsset | null, options?: ImportAddOptions) {
        if (!obj) return
        return await this.assetManager.importer.importSingle<T>(obj, options)
    }

    /**
     * Set the environment map of the scene from url or an {@link IAsset} object.
     * @param map
     * @param setBackground - Set the background image of the scene from the same map.
     * @param options - Options for importing the asset. See {@link ImportAssetOptions}
     */
    async setEnvironmentMap(map: string | IAsset | null | ITexture, {setBackground = false, ...options}: ImportAssetOptions&{setBackground?: boolean} = {}): Promise<ITexture | null> {
        this._scene.environment = map && !(<ITexture>map).isTexture ? await this.assetManager.importer.importSingle<ITexture>(map as string|IAsset, options) || null : <ITexture>map || null
        if (setBackground) return this.setBackgroundMap(this._scene.environment)
        return this._scene.environment
    }

    /**
     * Set the background image of the scene from url or an {@link IAsset} object.
     * @param map
     * @param setEnvironment - Set the environment map of the scene from the same map.
     * @param options - Options for importing the asset. See {@link ImportAssetOptions}
     */
    async setBackgroundMap(map: string | IAsset | null | ITexture, {setEnvironment = false, ...options}: ImportAssetOptions&{setBackground?: boolean} = {}): Promise<ITexture | null> {
        this._scene.background = map && !(<ITexture>map).isTexture ? await this.assetManager.importer.importSingle<ITexture>(map as string|IAsset, options) || null : <ITexture>map || null
        if (setEnvironment) return this.setEnvironmentMap(this._scene.background)
        return this._scene.background
    }

    /**
     * Exports an object/mesh/material/texture/render-target/plugin-preset/viewer to a blob.
     * If no object is given, a glb is exported with the current viewer state.
     * @param obj
     * @param options
     */
    async export(obj?: IObject3D|IMaterial|ITexture|IRenderTarget|IViewerPlugin|(typeof this), options?: ExportFileOptions) {
        if (!obj) obj = this._scene // this will export the glb with the scene and viewer config
        if ((<typeof this>obj).type === this.type) return jsonToBlob((<typeof this>obj).exportConfig())
        if ((<IViewerPlugin>obj).constructor?.PluginType) return jsonToBlob(this.exportPluginConfig(<IViewerPlugin>obj))
        return await this.assetManager.exporter.exportObject(<IObject3D|IMaterial|ITexture|IRenderTarget>obj, options)
    }

    /**
     * Export the scene to a file (default: glb with viewer config) and return a blob
     * @param options
     */
    async exportScene(options?: ExportFileOptions): Promise<BlobExt | undefined> {
        return this.assetManager.exporter.exportObject(this._scene.modelRoot, options)
    }

    async getScreenshotBlob({mimeType = 'image/jpeg', quality = 90} = {}): Promise<Blob | null> {
        const blobPromise = async()=> new Promise<Blob|null>((resolve) => {
            this._canvas.toBlob((blob) => {
                resolve(blob)
            }, mimeType, quality)
        })
        if (!this.renderEnabled) return blobPromise()
        return await this.doOnce('postFrame', async() => {
            this.renderEnabled = false
            const blob = await blobPromise()
            this.renderEnabled = true
            return blob
        })
    }

    async getScreenshotDataUrl({mimeType = 'image/jpeg', quality = 90} = {}): Promise<string | null> {
        if (!this.renderEnabled) return this._canvas.toDataURL(mimeType, quality)
        return await this.doOnce('postFrame', () => this._canvas.toDataURL(mimeType, quality))
    }

    /**
     * Disposes the viewer and frees up all resource and events. Do not use the viewer after calling dispose.
     * @note - If you want to reuse the viewer, set viewer.enabled to false instead, then set it to true again when required. To dispose all the objects, materials in the scene use `viewer.scene.disposeSceneModels()`
     * This function is not fully implemented yet. There might be some memory leaks.
     * @todo - return promise?
     */
    public dispose(): void {
        // todo: dispose stuff from constructor etc
        for (const plugin of [...Object.values(this.plugins)]) {
            this.removePlugin(plugin, true)
        }

        this._scene.dispose()
        this.renderManager.dispose()

        this._canvas.removeEventListener('webglcontextrestored', this._onContextRestore, false)
        this._canvas.removeEventListener('webglcontextlost', this._onContextLost, false)

        ;(window as any).threeViewers?.splice((window as any).threeViewers.indexOf(this), 1)

        if (this.resizeObserver) this.resizeObserver.unobserve(this._canvas)
        else window.removeEventListener('resize', this.resize)

        this.dispatchEvent({type: 'dispose'})
    }

    /**
     * Mark that the canvas is resized. If the size is changed, the renderer and all render targets are resized. This happens before the render of the next frame.
     */
    resize = () => {
        this._needsResize = true
        this.setDirty()
    }

    /**
     * Set the viewer to dirty and trigger render of the next frame.
     * @param source - The source of the dirty event. like plugin or 3d object
     * @param event - The event that triggered the dirty event.
     */
    setDirty(source?: any, event?: Event): void {
        this._needsReset = true
        source = source ?? this
        this.dispatchEvent({...event ?? {}, type: 'update', source})
    }

    protected _animationLoop(event: IAnimationLoopEvent): void {
        if (!this.enabled || !this.renderEnabled) return
        if (this._isRenderingFrame) {
            this.console.warn('animation loop: frame skip') // not possible actually, since this is not async
            return
        }
        this._isRenderingFrame = true

        this.renderStats.begin()

        for (let i = 0; i < this.maxFramePerLoop; i++) {

            if (this._needsReset) {
                this.renderManager.reset()
                this._needsReset = false
            }

            if (this._needsResize) {
                const size = [this._canvas.clientWidth, this._canvas.clientHeight]
                if (event.xrFrame) { // todo: find a better way to resize for XR.
                    const cam = this.renderManager.webglRenderer.xr.getCamera()?.cameras[0]?.viewport
                    if (cam) {
                        if (cam.x !== 0 || cam.y !== 0) {
                            this.console.warn('x and y must be 0?')
                        }
                        size[0] = cam.width
                        size[1] = cam.height
                        this.console.log('resize for xr', size)
                    } else {
                        this._needsResize = false
                    }
                }
                if (this._needsResize) {
                    this.renderManager.setSize(...size)
                    this._needsResize = false
                }
            }

            this.dispatchEvent({...event, type: 'preFrame', target: this}) // event will have time, deltaTime and xrFrame

            const dirtyPlugins = Object.values(this.plugins).filter(value => value.dirty)
            if (dirtyPlugins.length > 0) {
                // console.log('dirty plugins', dirtyPlugins)
                this.setDirty(dirtyPlugins)
            }

            if (this._needsReset) {
                this.renderManager.reset()
                this._needsReset = false
            }

            // Check if the renderManger is dirty, which happens when it's reset above or if any pass in the composer is dirty
            const needsRender = this.renderManager.needsRender
            if (needsRender) {

                this.dispatchEvent({type: 'preRender', target: this})

                if (this.debug) this.renderManager.render(this._scene)
                else {
                    try {
                        this.renderManager.render(this._scene)
                    } catch (e) {
                        this.console.error(e)
                        // this.enabled = false
                    }
                }

                this.dispatchEvent({type: 'postRender', target: this})

            }

            this.dispatchEvent({type: 'postFrame', target: this})
            this.renderManager.onPostFrame()

            if (!needsRender) // break if no frame rendered
                break

        }

        this.renderStats.end()

        this._isRenderingFrame = false

    }

    /**
     * Get the Plugin by a constructor type or by the string type.
     * Use string type if the plugin is not a dependency and you don't want to bundle the plugin.
     * @param type - The class of the plugin to get, or the string type of the plugin to get which is in the static PluginType property of the plugin
     * @returns {T | undefined} - The plugin of the specified type.
     */
    getPlugin<T extends IViewerPlugin>(type: Class<T>|string): T | undefined {
        return this.plugins[typeof type === 'string' ? type : (type as any).PluginType] as T | undefined
    }

    /**
     * Get the Plugin by a constructor type or add a new plugin of the specified type if it doesn't exist.
     * @param type
     * @param args - arguments for the constructor of the plugin, used when a new plugin is created.
     */
    async getOrAddPlugin<T extends IViewerPlugin>(type: Class<T>, ...args: ConstructorParameters<Class<T>>): Promise<T> {
        const plugin = this.getPlugin(type)
        if (plugin) return plugin
        return this.addPlugin(type, ...args)
    }

    /**
     * Get the Plugin by a constructor type or add a new plugin to the viewer of the specified type if it doesn't exist(sync).
     * @param type
     * @param args - arguments for the constructor of the plugin, used when a new plugin is created.
     */
    getOrAddPluginSync<T extends IViewerPluginSync>(type: Class<T>, ...args: ConstructorParameters<Class<T>>): T {
        const plugin = this.getPlugin(type)
        if (plugin) return plugin
        return this.addPluginSync(type, ...args)
    }

    /**
     * Add a plugin to the viewer.
     * @param plugin - The instance of the plugin to add or the class of the plugin to add.
     * @param args - Arguments for the constructor of the plugin, in case a class is passed.
     * @returns {Promise<T>} - The plugin added.
     */
    async addPlugin<T extends IViewerPlugin>(plugin: T | Class<T>, ...args: ConstructorParameters<Class<T>>): Promise<T> {
        const p = this._resolvePluginOrClass(plugin, ...args)
        const type = p.constructor.PluginType
        if (!p.constructor.PluginType) {
            this.console.error('PluginType is not defined for', p)
            return p
        }

        for (const d of p.dependencies || []) {
            await this.getOrAddPlugin(d)
        }

        if (this.plugins[type]) {
            this.console.error(`Plugin of type ${type} already exists, removing and disposing old plugin. This might break functionality, ensure only one plugin of a type is added`, this.plugins[type], p)
            await this.removePlugin(this.plugins[type])
        }
        this.plugins[type] = p
        await p.onAdded(this)
        this.dispatchEvent({type: 'addPlugin', target: this, plugin: p})
        this.setDirty(p)
        return p
    }

    /**
     * Add a plugin to the viewer(sync).
     * @param plugin
     * @param args
     */
    addPluginSync<T extends IViewerPluginSync>(plugin: T|Class<T>, ...args: ConstructorParameters<Class<T>>): T {
        const p = this._resolvePluginOrClass(plugin, ...args)
        const type = p.constructor.PluginType
        if (!p.constructor.PluginType) {
            this.console.error('PluginType is not defined for', p)
            return p
        }
        for (const d of p.dependencies || []) {
            this.getOrAddPluginSync(d)
        }

        if (this.plugins[type]) {
            this.console.error(`Plugin of type ${type} already exists, removing and disposing old plugin. This might break functionality, ensure only one plugin of a type is added`, this.plugins[type], p)
            this.removePluginSync(this.plugins[type])
        }
        this.plugins[type] = p
        p.onAdded(this)
        this.dispatchEvent({type: 'addPlugin', target: this, plugin: p})
        this.setDirty(p)
        return p
    }

    /**
     * Add multiple plugins to the viewer.
     * @param plugins - List of plugin instances or classes
     */
    async addPlugins(plugins: (IViewerPlugin | Class<IViewerPlugin>)[]): Promise<void> {
        for (const p of plugins) await this.addPlugin(p)
    }

    /**
     * Add multiple plugins to the viewer(sync).
     * @param plugins - List of plugin instances or classes
     */
    async addPluginsSync(plugins: (IViewerPluginSync | Class<IViewerPluginSync>)[]): Promise<void> {
        for (const p of plugins) this.addPluginSync(p)
    }

    /**
     * Remove a plugin instance or a plugin class. Works similar to {@link ThreeViewer.addPlugin}
     * @param p
     * @param dispose
     * @returns {Promise<void>}
     */
    async removePlugin(p: IViewerPlugin<ThreeViewer, false>, dispose = true): Promise<void> {
        const type = p.constructor.PluginType
        if (!this.plugins[type]) return
        await p.onRemove(this)
        delete this.plugins[type]
        if (dispose) await p.dispose() // todo await?
        this.setDirty(p)
    }

    /**
     * Remove a plugin instance or a plugin class(sync). Works similar to {@link ThreeViewer.addPluginSync}
     * @param p
     * @param dispose
     */
    removePluginSync(p: IViewerPluginSync, dispose = true): void {
        const type = p.constructor.PluginType
        if (!this.plugins[type]) return
        p.onRemove(this)
        delete this.plugins[type]
        if (dispose) p.dispose()
        this.setDirty(p)
    }

    /**
     * Set size of the canvas and update the renderer.
     * If no width/height is passed, canvas is set to 100% of the container.
     * @param size
     */
    setSize(size?: {width?: number, height?: number}) {
        this._canvas.style.width = size?.width ? size.width + 'px' : '100%'
        this._canvas.style.height = size?.height ? size.height + 'px' : '100%'
        // this._canvas.style.maxWidth = '100%' // this is upto the app to do.
        // this._canvas.style.maxHeight = '100%'
        this.resize()
    }

    /**
     * Traverse all objects in scene model root.
     * @param callback
     */
    traverseSceneObjects<T extends IObject3D = IObject3D>(callback: (o: T)=>void): void {
        this._scene.modelRoot.traverse(callback)
    }

    /**
     * Add an object to the scene model root.
     * If an imported scene model root is passed, it will be loaded with viewer configuration, unless importConfig is false
     * @param imported
     * @param options
     */
    async addSceneObject<T extends IObject3D|Object3D|RootSceneImportResult = RootSceneImportResult>(imported: T, options?: AddObjectOptions): Promise<T> {
        if (imported.userData?.rootSceneModelRoot) {
            const obj = <RootSceneImportResult>imported
            if (obj.importedViewerConfig && options?.importConfig !== false) await this.importConfig(obj.importedViewerConfig)
            this._scene.loadModelRoot(obj, options)
            return this._scene.modelRoot as T
        }
        this._scene.addObject(imported, options)
        return imported
    }


    /**
     * Serialize all the plugins and their settings to save or create presets. Used in {@link toJSON}.
     * @param meta -  The meta object.
     * @param filter - List of PluginType for the to include. If empty, no plugins will be serialized. If undefined, all plugins will be serialized.
     * @returns {any[]}
     */
    serializePlugins(meta: SerializationMetaType, filter?: string[]): any[] {
        if (filter && filter.length === 0) return []
        return Object.entries(this.plugins).map(p=> {
            if (filter && !filter.includes(p[1].constructor.PluginType)) return
            // if (!p[1].toJSON) this.console.log(`Plugin of type ${p[0]} is not serializable`)
            return p[1].serializeWithViewer !== false ? p[1].toJSON?.(meta) : undefined
        }).filter(p=> !!p)
    }

    /**
     * Deserialize all the plugins and their settings from a preset. Used in {@link fromJSON}.
     * @param plugins - The output of {@link serializePlugins}.
     * @param meta - The meta object.
     * @returns {this}
     */
    deserializePlugins(plugins: any[], meta?: SerializationMetaType): this {
        plugins.forEach(p=>{
            if (!p.type) {
                this.console.warn('Invalid plugin to import ', p)
                return
            }
            const plugin = this.getPlugin(p.type)
            if (!plugin) {
                // this.console.warn(`Plugin of type ${p.type} is not added, cannot deserialize`)
                return
            }
            plugin.fromJSON?.(p, meta)
        })
        return this
    }

    /**
     * Serialize a single plugin settings.
     */
    exportPluginConfig(plugin?: string|Class<IViewerPlugin>|IViewerPlugin): ISerializedConfig | Record<string, never> {
        if (plugin && typeof plugin === 'string' || (plugin as any).PluginType) plugin = this.getPlugin(plugin as any)
        if (!plugin) return {}
        const meta = getEmptyMeta()
        const data = (<IViewerPlugin>plugin).toJSON?.(meta)
        if (!data) return {}
        data.resources = metaToResources(meta)
        return data
    }

    /**
     * Deserialize and import a single plugin settings.
     * Can also use {@link ThreeViewer.importConfig} to import only plugin config.
     * @param json
     * @param plugin
     */
    async importPluginConfig(json: ISerializedConfig, plugin?: IViewerPlugin) {
        // this.console.log('importing plugin preset', json, plugin)
        const type = json.type
        plugin = plugin || this.getPlugin(type)
        if (!plugin) {
            this.console.warn(`No plugin found for type ${type} to import config`)
            return undefined
        }
        if (!plugin.fromJSON) {
            this.console.warn(`Plugin ${type} does not support importing presets`)
            return undefined
        }
        const resources = json.resources || {}
        if (json.resources) delete json.resources
        const meta = await this.loadConfigResources(resources)
        await plugin.fromJSON(json, meta)
        if (meta) json.resources = meta
        return plugin
    }

    /**
     * Serialize multiple plugin settings.
     * @param filter - List of PluginType to include. If empty, no plugins will be serialized. If undefined, all plugins will be serialized.
     */
    exportPluginsConfig(filter?: string[]): ISerializedViewerConfig {
        const meta = getEmptyMeta()
        const plugins = this.serializePlugins(meta, filter)
        convertArrayBufferToStringsInMeta(meta) // assuming not binary
        return {
            ...this._defaultConfig,
            plugins, resources: metaToResources(meta),
        }
    }


    /**
     * Serialize all the viewer and plugin settings.
     * @param binary - Indicate that the output will be converted and saved as binary data. (default: false)
     * @param pluginFilter - List of PluginType to include. If empty, no plugins will be serialized. If undefined, all plugins will be serialized.
     */
    exportConfig(binary = false, pluginFilter?: string[]) {
        return this.toJSON(binary, pluginFilter)
    }

    /**
     * Deserialize and import all the viewer and plugin settings, exported with {@link exportConfig}.
     */
    async importConfig(json: ISerializedConfig|ISerializedViewerConfig) {
        if (json.type !== this.type && <string>json.type !== 'ViewerApp') {
            if (this.getPlugin(json.type)) {
                return this.importPluginConfig(json)
            } else {
                this.console.error(`Unknown config type ${json.type} to import`)
                return undefined
            }
        }
        const resources = await this.loadConfigResources(json.resources || {})
        this.fromJSON(<ISerializedViewerConfig>json, resources)
    }

    /**
     * Serialize all the viewer and plugin settings and versions.
     * @param binary - Indicate that the output will be converted and saved as binary data. (default: true)
     * @param pluginFilter - List of PluginType to include. If empty, no plugins will be serialized. If undefined, all plugins will be serialized.
     * @returns {any} - Serializable JSON object.
     */
    toJSON(binary = true, pluginFilter?: string[]): ISerializedViewerConfig {
        const meta = getEmptyMeta()
        const data: ISerializedViewerConfig = Object.assign({
            ...this._defaultConfig,
            plugins: this.serializePlugins(meta, pluginFilter),
        }, ThreeSerialization.Serialize(this, meta, true))
        // this.console.log(dat)

        if (!binary) convertArrayBufferToStringsInMeta(meta)

        data.resources = metaToResources(meta)

        return data
    }

    /**
     * Deserialize all the viewer and plugin settings.
     * @note use async {@link ThreeViewer.importConfig} to import a json/config exported with {@link ThreeViewer.exportConfig} or {@link ThreeViewer.toJSON}.
     * @param data - The serialized JSON object retured from {@link toJSON}.
     * @param meta - The meta object
     * @returns {this}
     */
    fromJSON(data: ISerializedViewerConfig, meta?: SerializationMetaType): this|null {
        const data2: Partial<ISerializedViewerConfig> = {...data} // shallow copy

        // region legacy
        if (data2.backgroundIntensity !== undefined && data2.scene?.backgroundIntensity === undefined) {
            this.console.warn('old file format, backgroundIntensity moved to RootScene')
            this._scene.backgroundIntensity = data2.backgroundIntensity
            delete data2.backgroundIntensity
        }
        if (data2.useLegacyLights !== undefined && data2.renderManager?.useLegacyLights === undefined) {
            this.console.warn('old file format, useLegacyLights moved to RenderManager')
            this.renderManager.useLegacyLights = data2.useLegacyLights
            delete data2.useLegacyLights
        }
        if (data2.background !== undefined && data2.scene?.background === undefined) {
            this.console.warn('old file format, background moved to RootScene')
            if (data2.background === 'envMapBackground') data2.background = 'environment'
            else if (typeof data2.background === 'number')
                data2.background = new Color().setHex(data2.background, LinearSRGBColorSpace)
            else if (typeof data2.background === 'string')
                data2.background = new Color().setStyle(data2.background, LinearSRGBColorSpace)
            else if (data2.background?.isColor) data2.background = new Color(data2.background)

            if (data2.background?.isColor) { // color
                this._scene.backgroundColor = data2.background
                this._scene.background = null
            } else if (!data2.background) { // null
                this._scene.backgroundColor = null
                this._scene.background = null
            } else { // texture or 'environment'
                this._scene.backgroundColor = new Color('#ffffff')
                if (!data2.scene) data2.scene = {}
                data2.scene.background = data2.background
            }
            delete data2.background
        }

        // endregion

        if (!meta && data2.resources && data2.resources.__isLoadedResources) {
            meta = data2.resources as SerializationMetaType
            delete data2.resources
        }

        if (!meta?.__isLoadedResources) {
            this.console.error('meta in fromJSON is not available or is not loaded resources, call viewer.loadConfigResources first, or directly use viewer.importConfig')
            return null
        }

        if (Array.isArray(data2.plugins)) {
            this.deserializePlugins(data2.plugins, meta)
            delete data2.plugins
        }

        // meta = meta || data.resources
        ThreeSerialization.Deserialize(data2, this, meta, true)


        // todo: handle
        // __useCount set in ThreeSerialization while deserializing resources
        // for (const mat of Object.values(resources.materials) as any) {
        //     if (!mat.__useCount) this.materialManager?.unregisterMaterial(mat) // todo: also dispose?
        //     else delete mat.__useCount
        // }
        // for (const tex of Object.values(resources.textures) as any) {
        //     if (!tex.__useCount) {
        //         // todo: dispose?
        //     } else {
        //         delete tex.__useCount
        //     }
        // }


        return this
    }

    loadConfigResources = async(json: Partial<SerializationMetaType>, extraResources?: Partial<SerializationResourcesType>): Promise<any> => {
        // this.console.log(json)
        if (json.__isLoadedResources) return json
        const meta = metaFromResources(json, this)
        return await MetaImporter.ImportMeta(meta, extraResources)
    }

    async doOnce<TRet>(event: IViewerEventTypes, func: (...args: any[]) => TRet): Promise<TRet> {
        return new Promise((resolve) => {
            const listener = async(...args: any[]) => {
                this.removeEventListener(event, listener)
                resolve(await func(...args))
            }
            this.addEventListener(event, listener)
        })
    }

    private _setActiveCameraView(event: any = {}): void {
        if (event.type === 'setView') {
            if (!event.camera) {
                this.console.warn('Cannot find camera', event)
                return
            }
            this._scene.mainCamera.copy(event.camera)
            const worldPos = event.camera.getWorldPosition(this._scene.mainCamera.position)
            // camera.getWorldQuaternion(this.quaternion) // todo: do if autoLookAtTarget is false
            if (this._scene.mainCamera.parent) {
                this._scene.mainCamera.position.copy(this._scene.mainCamera.parent.worldToLocal(worldPos))
            //     this.quaternion.premultiply(this.parent.quaternion.clone().invert())
            }
            this._scene.mainCamera.setDirty()
        } else if (event.type === 'activateMain')
            this._scene.mainCamera = event.camera || undefined // event.camera should have been upgraded when added to the scene.
    }

    private _resolvePluginOrClass<T extends IViewerPlugin>(plugin: T | Class<T>, ...args: ConstructorParameters<Class<T>>): T {
        let p: T
        if ((plugin as Class<IViewerPlugin>).prototype) p = new (plugin as Class<T>)(...args)
        else p = plugin as T
        if ((plugin as Class<IViewerPlugin>).prototype) {
            const p1 = this.getPlugin(plugin as Class<T>)
            if (p1) {
                this.console.error(`Plugin of type ${p1.constructor.PluginType} already exists, no new plugin created`, p1)
                return p1
            }
            p = new (plugin as Class<T>)(...args)
        } else p = plugin as T
        return p
    }

    private _renderEnabledChanged(): void {
        this.dispatchEvent({type: this.renderEnabled ? 'renderEnabled' : 'renderDisabled'})
    }

    private readonly _defaultConfig: ISerializedViewerConfig = {
        assetType: 'config',
        type: this.type,
        version: ThreeViewer.VERSION,
        metadata: {
            generator: 'ThreePipe',
            version: 1,
        },
        plugins: [],
    }

    // todo: find a better fix for context loss and restore?
    private _lastSize = new Vector2()
    private _onContextRestore = (_: Event) => {
        this.enabled = true
        this._canvas.width = this._lastSize.width
        this._canvas.height = this._lastSize.height
        this.resize()
        this._scene.setDirty({refreshScene: true, frameFade: false})
    }
    private _onContextLost = (_: Event) => {
        this._lastSize.set(this._canvas.width, this._canvas.height)
        this._canvas.width = 2
        this._canvas.height = 2
        this.resize()
        this.enabled = false
    }

    // private _addSceneObject = (e: IEvent<any>) => {
    //     if (!e || !e.object) return
    //     const config = e.object.__importedViewerConfig // this is set in gltf.ts when gltf file is imported. This is done here so that scene settings are applied whenever the imported object is added to scene.
    //     if (!config) return
    //     this.fromJSON(config, config.resources)
    // }

    // todo
    // public async fitToView(selected?: Object3D, distanceMultiplier = 1.5, duration?: number, ease?: Easing|EasingFunctionType) {
    //     const camViews = this.getPluginByType<CameraViewPlugin>('CameraViews')
    //     if (!camViews) {
    //         this.console.error('CameraViews plugin is required for fitToView to work')
    //         return
    //     }
    //     await camViews?.animateToFitObject(selected, distanceMultiplier, duration, ease, {min: (this.scene.activeCamera.getControls<OrbitControls3>()?.minDistance ?? 0.5) + 0.5, max: 1000.0})
    // }

    // todo: create/load texture utils

    // region legacy creation functions

    // /**
    //  * Converts a three.js Camera instance to be used in the viewer.
    //  * @param camera - The three.js OrthographicCamera or PerspectiveCamera instance
    //  * @returns {CameraController} - A wrapper around the camera with some useful methods and properties.
    //  */
    // createCamera(camera: OrthographicCamera | PerspectiveCamera): CameraController {
    //     const cam: CameraController = camera.userData.iCamera ?? new CameraController(camera, {
    //         controlsMode: '',
    //         controlsEnabled: false,
    //     }, this._canvas)
    //     if (camera.userData.autoLookAtTarget === undefined) {
    //         cam.autoLookAtTarget = false
    //         camera.userData.autoLookAtTarget = false
    //     } else {
    //         cam.autoLookAtTarget = camera.userData.autoLookAtTarget
    //     }
    //     return cam
    // }

    // /**
    //  * Create a new empty object in the scene or add an existing three.js object to the scene.
    //  * @param object
    //  */
    // async createObject3D(object?: Object3D): Promise<Object3DModel | undefined> {
    //     return this.getManager()?.addImportedSingle<Object3DModel>(object || new Object3D(), {autoScale: false, pseudoCenter: false})
    // }

    // /**
    //  * Create a new physical material from a template or another material. It returns the same material if a material is passed created by the material manager.
    //  * @param material
    //  */
    // createPhysicalMaterial(material?: Material|MeshPhysicalMaterialParameters): MeshStandardMaterial2 | undefined {
    //     return this.createMaterial<MeshStandardMaterial2>('standard', material)
    // }

    // /**
    //  * Create a new material from a template or another material. It returns the same material if a material is passed created by the material manager.
    //  * @param template - template name registered in MaterialManager
    //  * @param material - three.js material object or material params to create a new material
    //  */
    // createMaterial<T extends IMaterial<any>>(template: 'standard' | 'basic' | 'diamond' | string, material?: Material|any): T | undefined {
    //     if ((material as Material)?.isMaterial) {
    //         const f = this.getManager()?.materials?.findMaterial((material as Material).uuid)
    //         if (f) return f as T
    //     }
    //     return this.getManager()?.materials?.generateFromTemplate(template, material) as T
    // }

    // endregion

    /**
     * The renderer for the viewer that's attached to the canvas. This is wrapper around WebGLRenderer and EffectComposer and manages post-processing passes and rendering logic
     * @deprecated - use {@link renderManager} instead
     */
    get renderer(): ViewerRenderManager {
        this.console.error('renderer is deprecated, use renderManager instead')
        return this.renderManager
    }

    /**
     * @deprecated use {@link assetManager} instead.
     * Gets the Asset manager, contains useful functions for managing, loading and inserting assets.
     */
    getManager(): AssetManager|undefined {
        return this.assetManager
    }

    /**
     * Get the Plugin by the string type.
     * @deprecated - Use {@link getPlugin} instead.
     * @param type
     * @returns {T | undefined}
     */
    getPluginByType<T extends IViewerPlugin>(type: string): T | undefined {
        return this.plugins[type] as T | undefined
    }

}
