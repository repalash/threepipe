import {
    AViewerPluginSync,
    NoColorSpace,
    onChange,
    ProgressivePlugin,
    serialize,
    ThreeViewer,
    uiButton,
    uiConfig,
    uiFolderContainer,
    uiSlider,
    uiToggle,
} from 'threepipe'
import {WebGLPathTracer} from 'three-gpu-pathtracer'
import {WebGLPathTracer2} from './WebGLPathTracer2'

/**
 * ThreeGpuPathTracerPlugin
 *
 * Path Tracing plugin for Threepipe using [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer).
 *
 * This plugin allows for GPU-accelerated path tracing in Three.js scenes. (using webgl2)
 *
 * It provides options to configure the path tracing parameters such as bounces, samples per frame, and more.
 * It also integrates with the Three.js scene and camera, updating materials and lights as needed.
 * Serialization and deserialization are supported for plugin state management.
 * It listens to scene updates, camera changes, and material updates to refresh the path tracing setup.
 * It can be enabled or disabled, and it automatically handles rendering to the screen or to a texture.
 * It supports progressive rendering, allowing for a smooth transition of rendered frames.
 *
 */
@uiFolderContainer('Path Tracing', {expanded: false})
export class ThreeGpuPathTracerPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'ThreeGpuPathTracerPlugin'

    @uiToggle()
    @serialize()
    @onChange(ThreeGpuPathTracerPlugin.prototype._enableChange)
        enabled = true

    @uiSlider('maxFrameCount', [16, 10000], 1)
    get maxFrameCount(): number {
        return this._viewer?.getPlugin(ProgressivePlugin)?.maxFrameCount ?? 32
    }
    set maxFrameCount(value: number) {
        const p = this._viewer?.getPlugin(ProgressivePlugin)
        if (!p) {
            console.warn('ThreeGpuPathTracerPlugin: ProgressivePlugin not found, cannot set maxFrameCount')
            return
        }
        p.maxFrameCount = value
    }

    @uiSlider('samplesPerFrame', [1, 5], 1)
        samplesPerFrame = 1

    @uiConfig(undefined, {expanded: true})
    @serialize()
        tracer: WebGLPathTracer | undefined

    dependencies = [ProgressivePlugin]

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this.refreshScene = this.refreshScene.bind(this)
        this.reset = this.reset.bind(this)
        this._enableChange = this._enableChange.bind(this)
    }

    private _enableChange() {
        if (!this.isDisabled()) this.refreshScene()
        this.setDirty()
    }

    setDirty() {
        if (!this._viewer) return

        this._viewer.renderManager.defaultRenderToScreen = this.isDisabled()
        this._viewer.setDirty()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // the scene is set on the first frame that path traces, not while the plugin is disabled
        this.tracer = new WebGLPathTracer2(viewer.renderManager.webglRenderer)
        this.refreshScene()

        viewer.scene.addEventListener('sceneUpdate', this.refreshScene)
        viewer.scene.addEventListener('mainCameraChange', this.refreshScene)
        viewer.scene.addEventListener('materialUpdate', this._materialUpdate)
        viewer.scene.addEventListener('environmentChanged', this._environmentChanged)
        // the main camera at any time (an editor can make another camera main after this plugin is added)
        viewer.scene.addEventListener('mainCameraUpdate', this._cameraUpdate)
        viewer.renderManager.addEventListener('resize', this._cameraUpdate)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('sceneUpdate', this.refreshScene)
        viewer.scene.removeEventListener('mainCameraChange', this.refreshScene)
        viewer.scene.removeEventListener('materialUpdate', this._materialUpdate)
        viewer.scene.removeEventListener('environmentChanged', this._environmentChanged)
        viewer.scene.removeEventListener('mainCameraUpdate', this._cameraUpdate)
        viewer.renderManager.removeEventListener('resize', this._cameraUpdate)
        this.tracer?.dispose()
        this.tracer = undefined
        this._sceneNeedsRefresh = false
        // the raster pipeline draws to the screen again
        viewer.renderManager.defaultRenderToScreen = true
        viewer.renderEnabled = true
        viewer.setDirty()
        super.onRemove(viewer)
    }

    /** Disabled, or a scene refresh is running or pending (it sets the materials, environment and camera again) */
    private _skipUpdate() {
        return this.isDisabled() || this._refreshing || this._sceneNeedsRefresh
    }

    private _materialUpdate = () => {
        if (!this.tracer || this._skipUpdate()) return
        this.tracer.updateMaterials()
        this.reset()
    }

    private _environmentChanged = () => {
        if (!this.tracer || this._skipUpdate()) return
        this.tracer.updateEnvironment()
        this.reset()
    }

    private _cameraUpdate = () => {
        if (!this.tracer || this._skipUpdate()) return
        this.tracer.updateCamera()
        this.reset()
    }

    protected _viewerListeners = {
        preFrame: () => {
            const viewer = this._viewer
            if (this.isDisabled() || this._refreshing || !viewer || !this.tracer) return
            const rm = viewer.renderManager

            // the raster frames show until the path tracer has 16 samples
            const rasterize = rm.frameCount < 16 - 1
            rm.defaultRenderToScreen = rasterize
            if (rm.frameCount <= 0 || rm.frameCount >= this.maxFrameCount) return

            if (this._sceneNeedsRefresh) {
                this._refreshScene()
                return
            }
            viewer.renderEnabled = false

            const renderer = rm.webglRenderer
            const colorSpace = renderer.outputColorSpace
            renderer.outputColorSpace = NoColorSpace
            for (let i = 0, l = this.samplesPerFrame; i < l; i++)
                this.tracer.renderSample()
            renderer.outputColorSpace = colorSpace

            if (!rasterize) {
                rm.screenPass.render(rm.renderer, null, this.tracer.target, 0, false)
                rm.incRenderToScreen()
            }
            viewer.renderEnabled = true
        },
    }

    private _refreshing = false

    private _sceneNeedsRefresh = false
    @uiButton()
    refreshScene() {
        this._sceneNeedsRefresh = true
    }

    // todo: setSceneAsync builds the BVH in a worker (tracer.setBVHWorker), so a large scene does not freeze the page
    private _refreshScene() {
        const viewer = this._viewer
        if (!viewer || this.isDisabled() || !this.tracer || !this._sceneNeedsRefresh || this._refreshing) return
        this._sceneNeedsRefresh = false
        this._refreshing = true
        viewer.renderEnabled = false
        this.tracer.setScene(viewer.scene, viewer.scene.mainCamera)
        viewer.renderEnabled = true
        this._refreshing = false
    }

    reset() {
        if (this.isDisabled() || !this.tracer) return
        this.tracer.reset()
        this.setDirty()
    }

    dispose() {
        this.tracer?.dispose()
        this.tracer = undefined
        super.dispose()
    }

}
