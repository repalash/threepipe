import {
    BaseEvent,
    CanvasTexture,
    Color,
    Event,
    EventDispatcher,
    EventListener2,
    LinearSRGBColorSpace,
    Object3D,
    Quaternion,
    Scene,
    Vector2,
    Vector3, Vector3Tuple,
} from 'three'
import {Class, createCanvasElement, downloadBlob, onChange, serialize, ValOrArr} from 'ts-browser-helpers'
import {TViewerScreenShader} from '../postprocessing'
import {
    AddObjectOptions,
    IAnimationLoopEvent,
    ICamera,
    iCameraCommons,
    IGeometry,
    IMaterial,
    IObject3D,
    ISceneEventMap,
    ITexture,
    OrthographicCamera2,
    PerspectiveCamera2,
    RootScene,
    TCameraControlsMode,
} from '../core'
import {ViewerRenderManager} from './ViewerRenderManager'
import {
    convertArrayBufferToStringsInMeta,
    EasingFunctionType,
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
import {uiConfig, UiObjectConfig, uiPanelContainer, uiToggle} from 'uiconfig.js'
import {IRenderTarget} from '../rendering'
import {
    AssetExporterPlugin,
    CameraViewPlugin,
    CanvasSnapshotPlugin,
    FileTransferPlugin,
    ProgressivePlugin,
} from '../plugins'
// noinspection ES6PreferShortImport
import {DropzonePlugin, DropzonePluginOptions} from '../plugins/interaction/DropzonePlugin'
// noinspection ES6PreferShortImport
import {TonemapPlugin} from '../plugins/postprocessing/TonemapPlugin'
import {VERSION} from './version'
import {OrbitControls3} from '../three'

import {Object3DManager} from '../assetmanager/Object3DManager'
import {ViewerTimeline} from '../utils/ViewerTimeline'
import {defaultObjectProcessor} from '../utils/objectProcessor'
import {AViewerPlugin} from './AViewerPlugin'

// todo make proper event map
export interface IViewerEvent extends BaseEvent, Partial<IAnimationLoopEvent> {
    type: '*'|'update'|'preRender'|'postRender'|'preFrame'|'postFrame'|'dispose'|'addPlugin'|'removePlugin'|'renderEnabled'|'renderDisabled'|'renderError'
    eType?: '*'|'update'|'preRender'|'postRender'|'preFrame'|'postFrame'|'dispose'|'addPlugin'|'removePlugin'|'renderEnabled'|'renderDisabled'|'renderError'
    [p: string]: any
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
     * Renders objects in a multi-sampled buffer.
     * @default false
     */
    msaa?: boolean,
    /**
     * Use Uint8 RGBM HDR Render Pipeline.
     * Provides better performance with post-processing.
     * RenderManager Uses Half-float if set to false.
     * @default true
     */
    rgbm?: boolean
    /**
     * Use rendered gbuffer as depth-prepass / z-prepass. (Requires DepthBufferPlugin/GBufferPlugin).
     * Set it to true if you only have opaque objects in the scene to get better performance.
     *
     * @default false
     *
     * todo fix: It should be disabled when there are any transparent/transmissive objects with render to depth buffer enabled, see forceZPrepass
     */
    zPrepass?: boolean
    // /**
    //  * Force z-prepass even if there are transparent/transmissive objects with render to depth buffer enabled.
    //  * Not implemented
    //  */
    // forceZPrepass?: boolean // todo

    /**
     * Render scale, 1 = full resolution, 0.5 = half resolution, 2 = double resolution.
     * Same as pixelRatio in three.js
     * Can be set to `window.devicePixelRatio` to render at device resolution in browsers.
     * An optimal value is `Math.min(2, window.devicePixelRatio)` to prevent issues on mobile. This is set when 'auto' is passed.
     * @default 1
     */
    renderScale?: number | 'auto'
    /**
     * Max render scale when set to 'auto'
     * @default 2
     */
    maxRenderScale?: number

    /**
     * Model Root Scale
     * @default 1
     */
    modelRootScale?: number
    /**
     * Enable stencil in renderer and stencilBuffer in composer render targets.
     * @default false
     */
    stencil?: boolean

    debug?: boolean

    /**
     * Add initial plugins.
     */
    plugins?: (IViewerPluginSync | Class<IViewerPluginSync>)[]

    load?: {
        /**
         * Load one or more source files
         */
        src?: ValOrArr<string | IAsset | null>

        /**
         * Load environment map
         */
        environment?: string | IAsset | ITexture | undefined | null

        /**
         * Load background map
         */
        background?: string | IAsset | ITexture | undefined | null

    }
    onLoad?: (results: any) => void

    /**
     * TonemapPlugin is added to the viewer if this is true.
     * @default true
     */
    tonemap?: boolean

    camera?: {
        type?: 'perspective'|'orthographic',
        controlsMode?: TCameraControlsMode,
        position?: Vector3|Vector3Tuple,
        target?: Vector3|Vector3Tuple,
    } | ICamera

    rootScene?: RootScene

    /**
     * Max HDR intensity for rendering and post-processing.
     * Values above this might be clamped during post-processing.
     * @default 72 (when rgbm is false), 16 (when rgbm is true)
     */
    maxHDRIntensity?: number

    /**
     * Power preference for the WebGL context.
     * @default 'high-performance'
     */
    powerPreference?: WebGLPowerPreference

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
     * If true, will stop event propagation on all pointer events on the viewer container (when camera interactions are enabled).
     *
     * Set this to true when the viewer is inside a carousel or similar component that might interfere with pointer events.
     * @default false
     */
    stopPointerEventPropagation?: boolean


    /**
     * By default, all imported assets are cached in memory, so that calling import/load would return the same instance of an asset if the same source and options is passed again.
     * Set this to `false` to disable this caching.
     * @default true
     */
    cacheImportedAssets?: boolean

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
@uiPanelContainer('Viewer')
export class ThreeViewer extends EventDispatcher<Record<IViewerEventTypes, IViewerEvent>> {
    public static readonly VERSION = VERSION

    public static readonly ConfigTypeSlug = 'vjson'

    declare uiConfig: UiObjectConfig

    static Console: IConsoleWrapper = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    }

    static Dialog: IDialogWrapper = windowDialogWrapper

    @serialize() readonly type = 'ThreeViewer'

    /**
     * If the viewer is enabled. Set this `false` to disable RAF loop.
     * @type {boolean}
     */
    enabled = true
    /**
     * Enable or disable all rendering, Animation loop including any frame/render events won't be fired when this is false.
     */
    @onChange(ThreeViewer.prototype._renderEnabledChanged)

    @uiToggle('Enable Rendering', {tags: ['advanced']})
        renderEnabled = true // todo rename to animation loop enabled?

    readonly assetManager: AssetManager
    readonly object3dManager: Object3DManager

    /**
     * The Scene attached to the viewer, this cannot be changed.
     * @type {RootScene}
     */
    @uiConfig(undefined, {label: 'Scene', expanded: true}) @serialize('scene')
    private readonly _scene: RootScene

    /**
     * Main timeline for the viewer.
     *
     * It's a WIP, API might change.
     */
    @uiConfig(undefined, {label: 'Timeline', expanded: true, tags: ['advanced']})
    @serialize('timeline')
    readonly timeline = new ViewerTimeline()

    @uiConfig(undefined, {label: 'Rendering', expanded: true}) @serialize('renderManager')
    readonly renderManager: ViewerRenderManager

    get materialManager() {
        return this.assetManager.materials
    }

    public readonly plugins: Record<string, IViewerPlugin> = {}

    /**
     * Scene with object hierarchy used for rendering
     */
    get scene(): RootScene&Scene {
        return this._scene as RootScene&Scene
    }

    /**
     * Specifies how many frames to render in a single request animation frame. Keep to 1 for realtime rendering.
     * Note: should be max (screen refresh rate / animation frame rate) like 60Hz / 30fps
     */
    maxFramePerLoop = 1

    readonly debug: boolean

    /**
     * Number of times to run composer render. If set to more than 1, preRender and postRender events will also be called multiple times.
     */
    rendersPerFrame = 1

    /**
     * Get the HTML Element containing the canvas
     * @returns {HTMLElement}
     */
    get container(): HTMLElement {
        // todo console.warn('container is deprecated, NOTE: subscribe to events when the canvas is moved to another container')
        if (this._canvas.parentElement !== this._container) {
            this.console.error('ThreeViewer: Canvas is not in the container, this might cause issues with some plugins.')
        }
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

    /**
     * Helper to track and visualize rendering performance while in debug mode.
     */
    renderStats?: GLStatsJS

    /**
     * The ResizeObserver observing the canvas element. Add more elements to this observer to resize viewer on their size change.
     * @type {ResizeObserver | undefined}
     */
    readonly resizeObserver = window?.ResizeObserver ? new window.ResizeObserver(_ => this.resize()) : undefined

    private readonly _canvas: HTMLCanvasElement
    // this can be used by other plugins to add ui elements alongside the canvas
    private readonly _container: HTMLElement // todo: add a way to move the canvas to a new container... and dispatch event...
    private _needsResize = false
    private _isRenderingFrame = false
    private _needsReset = true // renderer needs reset

    // Helpers for tracking main camera change and setting dirty automatically
    private _lastCameraPosition: Vector3 = new Vector3()
    private _lastCameraQuat: Quaternion = new Quaternion()
    private _lastCameraTarget: Vector3 = new Vector3()
    private _tempVec: Vector3 = new Vector3()
    private _tempQuat: Quaternion = new Quaternion()

    /**
     * If any of the viewers are in debug mode, this will be true.
     * This is required for debugging/logging in some cases.
     */
    public static ViewerDebugging = false // todo use in shaderReplaceString

    /**
     * plugins that are not serialized/deserialized with the viewer from config. useful when loading files exported from the editor, etc
     * (runtime only, not serialized itself)
     */
    serializePluginsIgnored: string[] = []

    /**
     * Create a viewer instance for using the webgi viewer SDK.
     * @param options - {@link ThreeViewerOptions}
     */
    constructor({debug = false, ...options}: ThreeViewerOptions) {
        super()
        this.debug = debug
        if (debug) ThreeViewer.ViewerDebugging = true
        this._canvas = options.canvas || createCanvasElement()
        let container = options.container
        if (container && !options.canvas) container.appendChild(this._canvas)
        if (!container) container = this._canvas.parentElement ?? undefined
        if (!container) throw new Error('No container(or canvas).')
        this._container = container // todo listen to canvas container change
        // if (getComputedStyle(this._container).position === 'static') {
        //     this.console.warn('ThreeViewer - The canvas container has static position, it must be set to relative or absolute for some plugins to work properly.')
        // }
        this.setDirty = this.setDirty.bind(this)
        this._animationLoop = this._animationLoop.bind(this)

        if (debug && (options as any).statsJS !== false) {
            this.renderStats = new GLStatsJS(this._container)
            this.renderStats.show()
        }

        if (!(window as any).threeViewers) (window as any).threeViewers = [];
        (window as any).threeViewers.push(this)

        // camera

        let camera
        if ((options.camera as ICamera)?.isCamera) {
            camera = options.camera as ICamera
            if (!camera.assetType) iCameraCommons.upgradeCamera.call(camera)
        } else {
            camera =
                options.camera?.type === 'orthographic' ?
                    new OrthographicCamera2(options.camera?.controlsMode ?? 'orbit', this._canvas) :
                    new PerspectiveCamera2(options.camera?.controlsMode ?? 'orbit', this._canvas)
            camera.name = 'Default Camera' + (camera.type === 'OrthographicCamera' ? ' (Ortho)' : '')
            const pos = options.camera?.position || [0, 0, 5]
            if (Array.isArray(pos)) camera.position.fromArray(pos)
            else camera.position.copy(pos)
            const tar = options.camera?.target || [0, 0, 0]
            if (Array.isArray(tar)) camera.target.fromArray(tar)
            else camera.target.copy(tar)
            camera.setDirty()
            camera.userData.autoLookAtTarget = true // only for when controls are disabled / not available

            if (options.rootScene) {
                this.console.error('ThreeViewer: Camera must also be passed in options when rootScene is passed in options.')
            }
        }

        // Update camera controls postFrame if allowed to interact
        this.addEventListener('postFrame', () => { // todo: move inside RootScene.
            const cam = this._scene.mainCamera
            if (cam && cam.canUserInteract) {
                const d = this.getPlugin<ProgressivePlugin>('ProgressivePlugin')?.postFrameConvergedRecordingDelta()
                // if (d && d > 0) delta = d
                if (d !== undefined && d === 0) return // not converged yet.
                // if d < 0 or undefined: not recording, do nothing

                cam.controls?.update()
            }
        })

        // if camera position or target changed in last frame, call setDirty on camera
        this.addEventListener('preFrame', () => { // todo: move inside RootScene. and maybe check the world matrix and target vector change
            const cam = this._scene.mainCamera
            if (
                cam.getWorldPosition(this._tempVec).sub(this._lastCameraPosition).lengthSq() // position is in local space
                + this._tempVec.subVectors(cam.target, this._lastCameraTarget).lengthSq() // target is in world space
                + cam.getWorldQuaternion(this._tempQuat).angleTo(this._lastCameraQuat)
                > 0.000001) cam.setDirty()
        })

        // scene

        this.object3dManager = new Object3DManager()
        this._scene = options.rootScene ?? new RootScene(camera, defaultObjectProcessor(this))
        if (this._scene.mainCamera !== camera) this._scene.mainCamera = camera // just in case
        this._scene.setBackgroundColor('#ffffff')
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
        this._scene.modelRoot.scale.setScalar(options.modelRootScale ?? 1)
        this.object3dManager.setRoot(this._scene)

        // render manager

        if (options.isAntialiased !== undefined || options.useRgbm !== undefined || options.useGBufferDepth !== undefined) {
            this.console.warn('isAntialiased, useRgbm and useGBufferDepth are deprecated, use msaa, rgbm and zPrepass instead.')
        }
        const rmClass: Class<ViewerRenderManager> = (options as any).rmClass ?? ViewerRenderManager
        this.renderManager = new rmClass({
            canvas: this._canvas,
            msaa: options.msaa ?? options.isAntialiased ?? false,
            rgbm: options.rgbm ?? options.useRgbm ?? true,
            zPrepass: options.zPrepass ?? options.useGBufferDepth ?? false,
            depthBuffer: !(options.zPrepass ?? options.useGBufferDepth ?? false),
            stencilBuffer: options.stencil,
            screenShader: options.screenShader,
            renderScale: typeof options.renderScale === 'string' ? options.renderScale === 'auto' ?
                Math.min(options.maxRenderScale || 2, window.devicePixelRatio) : parseFloat(options.renderScale) :
                options.renderScale,
            maxHDRIntensity: options.maxHDRIntensity,
            powerPreference: options.powerPreference,
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
        if (options.cacheImportedAssets !== undefined)
            this.assetManager.importer.cacheImportedAssets = options.cacheImportedAssets

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
        for (const p of options.plugins ?? []) this.addPluginSync(p)

        this.console.log('ThreePipe Viewer instance initialized, version: ', ThreeViewer.VERSION)

        if (options.load) {
            const sources = [options.load.src].flat().filter(s=> s)
            const promises: Promise<any>[] = sources.map(async s=> s && this.load(s))
            if (options.load.environment) promises.push(this.setEnvironmentMap(options.load.environment))
            if (options.load.background) promises.push(this.setBackgroundMap(options.load.background))
            Promise.all(promises).then(options.onLoad)
        }

        if (options.stopPointerEventPropagation) {
            // Stop event propagation in the viewer to prevent flickity etc. from dragging
            this._canvas.addEventListener('pointerdown', this._stopPropagation)
            this._canvas.addEventListener('touchstart', this._stopPropagation)
            this._canvas.addEventListener('mousedown', this._stopPropagation)
        }

    }

    /**
     * Add an object/model/material/viewer-config/plugin-preset/... to the viewer scene from url or an {@link IAsset} object.
     * Same as {@link AssetManager.addAssetSingle}
     * @param obj
     * @param options
     */
    async load<T extends ImportResult = ImportResult>(obj: string | IAsset | File | null, options?: ImportAddOptions) {
        if (!obj) return
        return await this.assetManager.addAssetSingle<T>(obj, options)
    }

    /**
     * Imports an object/model/material/texture/viewer-config/plugin-preset/... to the viewer scene from url or an {@link IAsset} object.
     * Same as {@link AssetImporter.importSingle}
     * @param obj
     * @param options
     */
    async import<T extends ImportResult = ImportResult>(obj: string | IAsset | File | null, options?: ImportAssetOptions) {
        if (!obj) return
        return await this.assetManager.importer.importSingle<T>(obj, options)
    }

    /**
     * Set the environment map of the scene from url or an {@link IAsset} object.
     * @param map
     * @param setBackground - Set the background image of the scene from the same map.
     * @param options - Options for importing the asset. See {@link ImportAssetOptions}
     */
    async setEnvironmentMap(map: string | IAsset | null | ITexture | File | undefined, {setBackground = false, ...options}: ImportAssetOptions&{setBackground?: boolean} = {}): Promise<ITexture | null> {
        this._scene.environment = map && !(<ITexture>map).isTexture ? await this.assetManager.importer.importSingle<ITexture>(map as string|IAsset|File, options) || null : <ITexture>map || null
        if (setBackground) return this.setBackgroundMap(this._scene.environment)
        return this._scene.environment
    }

    /**
     * Set the background image of the scene from url or an {@link IAsset} object.
     * @param map
     * @param setEnvironment - Set the environment map of the scene from the same map.
     * @param options - Options for importing the asset. See {@link ImportAssetOptions}
     */
    async setBackgroundMap(map: string | IAsset | null | ITexture | File | undefined, {setEnvironment = false, ...options}: ImportAssetOptions&{setBackground?: boolean} = {}): Promise<ITexture | null> {
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
        if (!obj) obj = this._scene.modelRoot // this will export the glb with the scene and viewer config
        if ((<typeof this>obj).type === this.type) return jsonToBlob((<typeof this>obj).exportConfig())
        if ((<IViewerPlugin>obj).constructor?.PluginType) return jsonToBlob(this.exportPluginConfig(<IViewerPlugin>obj))
        return await this.assetManager.exporter.exportObject(<IObject3D|IMaterial|ITexture|IRenderTarget>obj, options)
    }

    /**
     * Export the scene to a file (default: glb with viewer config) and return a blob
     * @param options
     * @param useExporterPlugin - uses the {@link AssetExporterPlugin} if available. This is useful to use the options configured by the user in the plugin.
     */
    async exportScene(options?: ExportFileOptions, useExporterPlugin = true): Promise<BlobExt | undefined> {
        const exporter = useExporterPlugin ? this.getPlugin<AssetExporterPlugin>('AssetExporterPlugin') : undefined
        if (exporter) return exporter.exportScene(options)
        return this.assetManager.exporter.exportObject(this._scene.modelRoot, options)
    }

    /**
     * Returns a blob with the screenshot of the canvas.
     * If {@link CanvasSnapshotPlugin} is added, it will be used, otherwise canvas.toBlob will be used directly.
     * @param mimeType default image/jpeg
     * @param quality between 0 and 100
     */
    async getScreenshotBlob({mimeType = 'image/jpeg', quality = 90} = {}): Promise<Blob | null | undefined> {
        const plugin = this.getPlugin<CanvasSnapshotPlugin>('CanvasSnapshotPlugin')
        if (plugin) {
            return plugin.getFile('snapshot.' + mimeType.split('/')[1], {mimeType, quality, waitForProgressive: true})
        }
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

    async getScreenshotDataUrl({mimeType = 'image/jpeg', quality = 0.9} = {}): Promise<string | null | undefined> {
        if (!this.renderEnabled) return this._canvas.toDataURL(mimeType, quality)
        return await this.doOnce('postFrame', () => this._canvas.toDataURL(mimeType, quality))
    }

    /**
     * Disposes the viewer and frees up all resource and events. Do not use the viewer after calling dispose.
     * NOTE - If you want to reuse the viewer, set viewer.enabled to false instead, then set it to true again when required.
     * To dispose all the objects, materials in the scene, but not the viewer itself, use `viewer.scene.disposeSceneModels()`
     */
    public dispose(clear = true): void {
        this.renderEnabled = false
        // TODO - return promise?

        // todo: dispose stuff from constructor etc
        if (clear) {
            for (const [key, plugin] of [...Object.entries(this.plugins)]) {
                if (key === plugin.constructor.OldPluginType) continue
                this.removePlugin(plugin, true)
            }
        }

        this._scene.dispose(clear)
        this.renderManager.dispose(clear)

        if (clear) {
            this.object3dManager.dispose()
            this._canvas.removeEventListener('webglcontextrestored', this._onContextRestore, false)
            this._canvas.removeEventListener('webglcontextlost', this._onContextLost, false)

            ;((window as any).threeViewers as any[])?.splice((window as any).threeViewers.indexOf(this), 1)

            if (this.resizeObserver) this.resizeObserver.unobserve(this._canvas)
            window.removeEventListener('resize', this.resize)
        }

        this.dispatchEvent({type: 'dispose', clear})
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
     *
     * This also triggers the 'update' event on the viewer. Note - update event might be triggered multiple times in a single frame, use preFrame or preRender events to get notified only once per frame.
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

        this.renderStats?.begin()

        for (let i = 0; i < this.maxFramePerLoop; i++) {

            // from setDirty
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

            const dirtyPlugins = Object.entries(this.plugins).filter(([key, plugin]) => plugin.dirty && key !== plugin.constructor.OldPluginType)
            if (dirtyPlugins.length > 0) {
                // console.log('dirty plugins', dirtyPlugins)
                this.setDirty(dirtyPlugins)
            }

            // again, setDirty might have been called in preFrame
            if (this._needsReset) {
                this.renderManager.reset()
                this._needsReset = false
            }

            // Check if the renderManger is dirty, which happens when it's reset above or if any pass in the composer is dirty
            const needsRender = this.renderManager.needsRender
            if (needsRender) {
                for (let j = 0; j < this.rendersPerFrame; j++) {
                    this.dispatchEvent({type: 'preRender', target: this})
                    // console.log('render')

                    const render = ()=>{
                        const cam = this._scene.mainCamera
                        this._scene.renderCamera = cam
                        if (cam.visible) this.renderManager.render(this._scene, this.renderManager.defaultRenderToScreen)
                    }
                    if (this.debug) {
                        render()
                    } else {
                        try {
                            render()
                        } catch (e) {
                            this.console.error('ThreeViewer: Uncaught error while rendering frame.')
                            this.console.error(e)
                            if (this.debug) throw e
                            this.renderEnabled = false
                            this.dispatchEvent({type: 'renderError', error: e})
                        }
                    }

                    this.dispatchEvent({type: 'postRender', target: this})
                }

            }

            this.timeline.update(this)

            this.dispatchEvent({type: 'postFrame', target: this})
            this.renderManager.onPostFrame()
            this.object3dManager.onPostFrame(this.timeline)

            // this is update after postFrame, because other plugins etc will update the scene in postFrame or preFrame listeners
            this.timeline.update2(this)
            // if (!needsRender) // break if no frame rendered (should not break)
            //     break

        }

        this.renderStats?.end()

        this._isRenderingFrame = false

    }

    /**
     * Get the Plugin by a constructor type or by the string type.
     * Use string type if the plugin is not a dependency, and you don't want to bundle the plugin.
     * @param type - The class of the plugin to get, or the string type of the plugin to get which is in the static PluginType property of the plugin
     * @returns {T extends IViewerPlugin | undefined} - The plugin of the specified type.
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
        if (!p) {
            throw new Error('ThreeViewer: Plugin is not defined')
        }
        const type = p.constructor.PluginType
        if (!p.constructor.PluginType) {
            this.console.error('ThreeViewer: PluginType is not defined for', p)
            return p
        }

        for (const d of p.dependencies || []) {
            await this.getOrAddPlugin(d)
        }

        if (this.plugins[type]) {
            this.console.error(`ThreeViewer: Plugin of type ${type} already exists, removing and disposing old plugin. This might break functionality, ensure only one plugin of a type is added`, this.plugins[type], p)
            await this.removePlugin(this.plugins[type])
        }
        this.plugins[type] = p
        const oldType = p.constructor.OldPluginType
        if (oldType && this.plugins[oldType]) this.console.error(`ThreeViewer: Plugin type mismatch ${oldType}`)
        if (oldType) this.plugins[oldType] = p

        await p.onAdded(this)
        this._onPluginAdd(p)
        return p
    }

    /**
     * Add a plugin to the viewer(sync).
     * @param plugin
     * @param args
     */
    addPluginSync<T extends IViewerPluginSync>(plugin: T|Class<T>, ...args: ConstructorParameters<Class<T>>): T {
        const p = this._resolvePluginOrClass(plugin, ...args)
        if (!p) {
            throw new Error('ThreeViewer: Plugin is not defined')
        }
        const type = p.constructor.PluginType
        if (!p.constructor.PluginType) {
            this.console.error('ThreeViewer: PluginType is not defined for', p)
            return p
        }
        for (const d of p.dependencies || []) {
            this.getOrAddPluginSync(d)
        }

        if (this.plugins[type]) {
            this.console.error(`ThreeViewer: Plugin of type ${type} already exists, removing and disposing old plugin. This might break functionality, ensure only one plugin of a type is added`, this.plugins[type], p)
            this.removePluginSync(this.plugins[type])
        }
        const add = ()=>{
            this.plugins[type] = p
            const oldType = p.constructor.OldPluginType
            if (oldType && this.plugins[oldType]) this.console.error(`ThreeViewer: Plugin type mismatch ${oldType}`)
            if (oldType) this.plugins[oldType] = p
            p.onAdded(this)
        }
        if (this.debug) {
            add()
        } else {
            try {
                add()
            } catch (e) {
                this.console.error('ThreeViewer: Error adding plugin, check console for details', e)
                delete this.plugins[type]
            }
        }
        this._onPluginAdd(p)
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
    addPluginsSync(plugins: (IViewerPluginSync | Class<IViewerPluginSync>)[]): void {
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
        this._onPluginRemove(p, dispose)
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
        this._onPluginRemove(p, dispose)
    }

    /**
     * Set size of the canvas and update the renderer.
     * If no size or width/height is passed, canvas is set to 100% of the container.
     *
     * See also {@link ThreeViewer.setRenderSize} to set the size of the render target by automatically calculating the renderScale and fitting in container.
     *
     * Note: Apps using this should ideally set `max-width: 100%` for the canvas in css.
     * @param size
     */
    setSize(size?: {width?: number, height?: number}) {
        this._canvas.style.width = size?.width ? size.width + 'px' : '100%'
        this._canvas.style.height = size?.height ? size.height + 'px' : '100%'
        // this._canvas.style.maxWidth = '100%' // this is upto the app to do.
        // this._canvas.style.maxHeight = '100%'
        // https://stackoverflow.com/questions/21664940/force-browser-to-trigger-reflow-while-changing-css
        void this._canvas.offsetHeight
        this.resize() // this is also required in case the browwser doesnt support/fire observer
    }

    // todo make a constructor parameter for renderSize
    // todo make getRenderSize or get renderSize
    /**
     * Set the render size of the viewer to fit in the container according to the specified mode, maintaining aspect ratio.
     * Changes the renderScale accordingly.
     * Note: the canvas needs to be centered in the container to work properly, this can be done with the following css on the container:
     * ```css
     * display: flex;
     * justify-content: center;
     * align-items: center;
     * ```
     * or in js:
     * ```js
     * viewer.container.style.display = 'flex';
     * viewer.container.style.justifyContent = 'center';
     * viewer.container.style.alignItems = 'center';
     * ```
     * Modes:
     * 'contain': The canvas is scaled to fit within the container while maintaining its aspect ratio. The canvas will be fully visible, but there may be empty space around it.
     * 'cover': The canvas is scaled to fill the entire container while maintaining its aspect ratio. Part of the canvas may be clipped to fit the container.
     * 'fill': The canvas is stretched to completely fill the container, ignoring its aspect ratio.
     * 'scale-down': The canvas is scaled down to fit within the container while maintaining its aspect ratio, but it won't be scaled up if it's smaller than the container.
     * 'none': container size is ignored, but devicePixelRatio is used
     *
     * Check the example for more details - https://threepipe.org/examples/#viewer-render-size/
     * @param size - The size to set the render to. The canvas will render to this size.
     * @param mode - 'contain', 'cover', 'fill', 'scale-down' or 'none'. Default is 'contain'.
     * @param devicePixelRatio - typically set to `window.devicePixelRatio`, or `Math.min(1.5, window.devicePixelRatio)` for performance. Use this only when size is derived from dom elements.
     * @param containerSize - (optional) The size of the container, if not passed, the bounding client rect of the container is used.
     */
    setRenderSize(size: {width: number, height: number},
        mode: 'contain' | 'cover' | 'fill' | 'scale-down' | 'none' = 'contain',
        devicePixelRatio = 1,
        containerSize?: {width: number, height: number}) {
        // todo what about container resize?
        const containerRect = containerSize || this.container.getBoundingClientRect()
        const containerHeight = containerRect.height
        const containerWidth = containerRect.width
        const width = Math.floor(size.width)
        const height = Math.floor(size.height)
        const aspect = width / height
        const containerAspect = containerWidth / containerHeight
        const dpr = devicePixelRatio

        let renderWidth, renderHeight

        switch (mode) {
        case 'contain':
            if (containerAspect > aspect) {
                renderWidth = containerHeight * aspect
                renderHeight = containerHeight
            } else {
                renderWidth = containerWidth
                renderHeight = containerWidth / aspect
            }
            break
        case 'cover':
            if (containerAspect > aspect) {
                renderWidth = containerWidth
                renderHeight = containerWidth / aspect
            } else {
                renderWidth = containerHeight * aspect
                renderHeight = containerHeight
            }
            break
        case 'fill':
            renderWidth = containerWidth
            renderHeight = containerHeight
            break
        case 'scale-down':
            if (width < containerWidth && height < containerHeight) {
                renderWidth = width
                renderHeight = height
            } else if (containerAspect > aspect) {
                renderWidth = containerHeight * aspect
                renderHeight = containerHeight
            } else {
                renderWidth = containerWidth
                renderHeight = containerWidth / aspect
            }
            break
        case 'none':
            renderWidth = width
            renderHeight = height
            break
        default:
            throw new Error(`Invalid mode: ${mode}`)
        }

        this.setSize({width: renderWidth, height: renderHeight})
        this.renderManager.renderScale = dpr * height / renderHeight
    }

    /**
     * Traverse all objects in scene model root.
     * @param callback
     */
    traverseSceneObjects<T extends IObject3D = IObject3D>(callback: (o: T)=>void): void {
        this._scene.modelRoot.traverse(callback)
    }

    deleteImportedViewerConfigOnLoad = true
    deleteImportedViewerConfigOnLoadWait = 2000 // ms

    /**
     * Add an object to the scene model root.
     * If an imported scene model root is passed, it will be loaded with viewer configuration, unless importConfig is false
     * @param imported
     * @param options
     */
    async addSceneObject<T extends IObject3D|Object3D|RootSceneImportResult = RootSceneImportResult>(imported: T, options?: AddObjectOptions): Promise<T> {
        let res = imported
        if (imported.userData?.rootSceneModelRoot) {
            const obj = <RootSceneImportResult>imported
            this._scene.loadModelRoot(obj, options)
            if (options?.importConfig !== false) {
                if (obj.importedViewerConfig) {
                    await this.importConfig(obj.importedViewerConfig)
                    // @ts-expect-error no type for this
                    if (obj._deletedImportedViewerConfig) delete obj._deletedImportedViewerConfig
                // @ts-expect-error no type for this
                } else if (obj._deletedImportedViewerConfig)
                    this.console.error('ThreeViewer - Imported viewer config was deleted, cannot import it again. Set `viewer.deleteImportedViewerConfigOnLoad` to `false` to keep it in the object for reuse workflows.')
            }
            if (this.deleteImportedViewerConfigOnLoad && obj.importedViewerConfig) {
                setTimeout(()=>{
                    if (!obj.importedViewerConfig) return
                    delete obj.importedViewerConfig // any useful data in the config should be loaded into userData.__importData by then
                    // @ts-expect-error no type for this
                    obj._deletedImportedViewerConfig = true // for console warning above
                }, this.deleteImportedViewerConfigOnLoadWait)
            }
            res = this._scene.modelRoot as T
        } else {
            this._scene.addObject(imported, options)
        }
        return res
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
            if (p[0] === p[1].constructor.OldPluginType) return
            if (this.serializePluginsIgnored.includes((p[1].constructor as any).PluginType)) return
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
            if (this.serializePluginsIgnored.includes(p.type)) return
            const plugin = this.getPlugin(p.type)
            if (!plugin) {
                // this.console.warn(`Plugin of type ${p.type} is not added, cannot deserialize`)
                return
            }
            plugin.fromJSON && plugin.fromJSON(p, meta)
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
     *
     * @param json - The serialized JSON object returned from {@link exportConfig} or {@link toJSON}.
     * @returns {Promise<this>} - The viewer instance with the imported config.
     */
    async importConfig(json: ISerializedConfig|ISerializedViewerConfig): Promise<this | IViewerPlugin | undefined> {
        if (json.type !== this.type && <string>json.type !== 'ViewerApp' && <string>json.type !== 'ThreeViewer') {
            if (this.getPlugin(json.type)) {
                return this.importPluginConfig(json)
            } else {
                this.console.error(`Unknown config type ${json.type} to import`)
                return undefined
            }
        }
        const resources = await this.loadConfigResources(json.resources || {})
        this.fromJSON(<ISerializedViewerConfig>json, resources)
        return this
    }

    /**
     * Serialize all the viewer and plugin settings and versions.
     * @param binary - Indicate that the output will be converted and saved as binary data. (default: true)
     * @param pluginFilter - List of PluginType to include. If empty, no plugins will be serialized. If undefined/not-passed, all plugins will be serialized.
     * @returns {any} - Serializable JSON object.
     */
    toJSON(binary = true, pluginFilter?: string[]): ISerializedViewerConfig {
        if (typeof binary !== 'boolean') binary = true // its a meta, ignore it
        if (pluginFilter !== undefined && !Array.isArray(pluginFilter)) pluginFilter = undefined // non standard param.
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
     * NOTE - use async {@link ThreeViewer.importConfig} to import a json/config exported with {@link ThreeViewer.exportConfig} or {@link ThreeViewer.toJSON}.
     * @param data - The serialized JSON object returned from {@link toJSON}.
     * @param meta - The meta object, see {@link SerializationMetaType}
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
            this.console.error('ThreeViewer: meta in fromJSON is not available or is not loaded resources, call viewer.loadConfigResources first, or directly use viewer.importConfig')
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

    async doOnce<TRet>(event: IViewerEventTypes, func?: (...args: any[]) => TRet): Promise<TRet|undefined> {
        return new Promise((resolve) => {
            const listener = async(...args: any[]) => {
                this.removeEventListener(event, listener)
                resolve(await func?.(...args))
            }
            this.addEventListener(event, listener)
        })
    }

    dispatchEvent(event: IViewerEvent) {
        super.dispatchEvent(event)
        super.dispatchEvent({...event, type: '*', eType: event.type})
    }

    /**
     * Uses the {@link FileTransferPlugin} to export a Blob/File. If the plugin is not available, it will download the blob.
     * {@link FileTransferPlugin} can be configured by other plugins to export the blob to a specific location like local file system, cloud storage, etc.
     * @param blob - The blob or file to export/download
     * @param name - name of the file, if not provided, the name of the file is used if it's a file.
     */
    async exportBlob(blob: Blob|File, name?: string) {
        const tr = this.getPlugin<FileTransferPlugin>('FileTransferPlugin')
        name = name ?? (blob as File).name ?? 'file'
        if (!tr) {
            downloadBlob(blob, name)
            return
        }
        await tr.exportFile(blob, name)
    }

    private _setActiveCameraView: EventListener2<'setView'|'activateMain', ISceneEventMap, RootScene> = (event) => {
        if (event.type === 'setView') {
            if (!event.camera) {
                this.console.warn('Cannot find camera', event)
                return
            }
            const camera = this._scene.mainCamera
            camera.setViewFromCamera(event.camera) // default is worldSpace
        } else if (event.type === 'activateMain') {
            event.camera?.setCanvas(this._canvas, false)
            // this._scene.mainCamera.setCanvas(undefined, false) // todo is this required?
            this._scene.mainCamera = event.camera || undefined // event.camera should have been upgraded when added to the scene.
        }
    }

    private _resolvePluginOrClass<T extends IViewerPlugin>(plugin: T | Class<T>, ...args: ConstructorParameters<Class<T>>): T|undefined {
        let p: T
        if ((plugin as Class<IViewerPlugin>).prototype) {
            const p1 = this.getPlugin(plugin as Class<T>)
            if (p1) {
                this.console.error(`Plugin of type ${p1.constructor.PluginType} already exists, no new plugin created`, p1)
                return p1
            }
            try {
                p = new (plugin as Class<T>)(...args)
            } catch (e) {
                this.console.error('ThreeViewer: Error creating plugin', e)
                return undefined
            }
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

    public async fitToView(selected?: Object3D|Object3D[]|IMaterial|IMaterial[]|ITexture|ITexture[]|IGeometry|IGeometry[], distanceMultiplier = 1.5, duration?: number, ease?: ((v: number) => number)|EasingFunctionType) {
        const camViews = this.getOrAddPluginSync(CameraViewPlugin)
        await camViews?.animateToFitObject(selected, distanceMultiplier, duration, ease, {min: ((<OrbitControls3> this.scene.mainCamera.controls)?.minDistance ?? 0.5) + 0.5, max: 1000.0})
    }

    private _canvasTexture?: CanvasTexture&ITexture

    /**
     * Create and get a three.js CanvasTexture from the viewer's canvas.
     */
    get canvasTexture(): CanvasTexture {
        if (!this._canvas) throw new Error('Canvas not found')
        if (!this._canvasTexture) {
            this._canvasTexture = new CanvasTexture(this._canvas)
            this._canvasTexture.flipY = false
            this._canvasTexture.needsUpdate = true
        }
        return this._canvasTexture
    }

    private _stopPropagation = (e: PointerEvent | MouseEvent | TouchEvent) => {
        if (!this.scene.mainCamera.canUserInteract) return
        e.stopPropagation()
    }

    // todo: create/load texture utils?

    /**
     * The renderer for the viewer that's attached to the canvas. This is wrapper around WebGLRenderer and EffectComposer and manages post-processing passes and rendering logic
     * @deprecated - use {@link renderManager} instead
     */
    get renderer(): ViewerRenderManager {
        this.console.error('ThreeViewer: renderer is deprecated, use renderManager instead')
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

    private _onPluginAdd(p: IViewerPlugin) {
        const ev = {type: 'addPlugin', target: this, plugin: p} as const
        this.dispatchEvent(ev)
        this._pluginListeners.add.filter(l=> !l.p.length || l.p.includes(p.constructor.PluginType) || p.constructor.OldPluginType && l.p.includes(p.constructor.OldPluginType)).forEach(l=> l.l(ev))
        this.setDirty(p)
    }

    private _onPluginRemove(p: IViewerPlugin, dispose = false) {
        const ev = {type: 'removePlugin', target: this, plugin: p} as const
        this.dispatchEvent(ev)
        this._pluginListeners.remove.filter(l=> !l.p.length || l.p.includes(p.constructor.PluginType) || p.constructor.OldPluginType && l.p.includes(p.constructor.OldPluginType)).forEach(l=> l.l(ev))
        delete this.plugins[p.constructor.PluginType]
        if (p.constructor.OldPluginType) delete this.plugins[p.constructor.OldPluginType]
        if (dispose) p.dispose() // todo await?
        this.setDirty(p)
    }

    private _pluginListeners: Record<'add' | 'remove', ({p: string[], l: (event: IViewerEvent) => void})[]> = {
        add: [],
        remove: [],
    }

    addPluginListener(type: 'add' | 'remove', listener: (event: IViewerEvent) => void, ...plugins: (string|undefined)[]): void {
        this._pluginListeners[type].push({p: plugins.filter(p=>!!p) as string[], l: listener})
    }

    removePluginListener(type: 'add' | 'remove', listener: (event: IViewerEvent) => void): void {
        this._pluginListeners[type] = this._pluginListeners[type].filter(l=> l.l !== listener)
    }

    /**
     * Can be used to "subscribe" to plugins.
     * @param plugin
     * @param mount
     * @param unmount
     */
    forPlugin<T extends IViewerPlugin>(plugin: string|Class<T>, mount: (p: T) => void, unmount?: (p: T) => void, thisPlugin?: AViewerPlugin): void {
        const um = ()=>{
            if (unmount) {
                const lis = () => {
                    const p1 = this.getPlugin(plugin)
                    if (!p1) return
                    this.removePluginListener('remove', lis)
                    unmount(p1)
                }
                this.addPluginListener('remove', lis, typeof plugin === 'string' ? plugin : (plugin as any).PluginType)
                if (thisPlugin?.constructor.PluginType) {
                    this.addPluginListener('remove', lis, thisPlugin.constructor.PluginType)
                }
            }
        }

        const p = this.getPlugin(plugin)
        if (p) {
            mount(p)
            um()
        } else {
            const lis = () => {
                const p1 = this.getPlugin(plugin)
                if (!p1) return
                this.removePluginListener('add', lis)
                mount(p1)
                um()
            }
            this.addPluginListener('add', lis, typeof plugin === 'string' ? plugin : (plugin as any).PluginType, typeof plugin === 'string' ? undefined : (plugin as any).OldPluginType)
        }

    }

}
