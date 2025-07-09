import {
    AViewerPluginSync,
    Euler,
    NoColorSpace,
    onChange,
    ProgressivePlugin,
    Scene,
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

    // public ptMaterial: any
    // public ptGenerator: any
    // public sceneInfo: any

    // @uiSlider('Environment Multiplier', [0, 10], 0.01)
    // @serialize()
    // @onChange(ThreeGpuPathTracerPlugin.prototype.reset)
    //     environmentMultiplier = 1
    //
    // @uiSlider('Max Iterations', [0, 10000], 1)
    // @serialize()
    //     maxIterations = 100
    //
    // @uiSlider('Bounces', [1, 30], 1)
    // @serialize()
    // @onChange(ThreeGpuPathTracerPlugin.prototype.reset)
    //     bounces = 10
    //
    // @uiSlider('filterGlossyFactor', [0, 1], 0.01)
    // @serialize()
    // @onChange(ThreeGpuPathTracerPlugin.prototype.reset)
    //     filterGlossyFactor = 0.25

    // @uiSlider('environmentBlur', [0, 1], 0.01)
    // @onChange(ThreeGpuPathTracerPlugin.prototype.reset)
    // environmentBlur = 0.0

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

    // @uiSlider('tiles', [1, 5], 1)
    //     tiles = 2

    // @uiMonitor()
    // private _lastEnvMap: any = null
    // private _lastBgMap: any = null

    dependencies = [ProgressivePlugin]

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this.refreshScene = this.refreshScene.bind(this)
        this.reset = this.reset.bind(this)
        this._enableChange = this._enableChange.bind(this)
        this._refreshScene = this._refreshScene.bind(this)
    }

    private async _enableChange() {
        if (!this.isDisabled()) this.refreshScene()

        this.setDirty()
    }

    setDirty() {
        if (!this._viewer) return

        this._viewer.renderManager.defaultRenderToScreen = this.isDisabled()
        this._viewer.setDirty()
    }

    // todo: onremove and ondispose (dispose sceneInfo in that and remove event listeners)

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        // removed
        // if (viewer.renderer.useLegacyLights) {
        //     viewer.console.warn('Set viewer.renderer.useLegacyLights to false to get consistent lighting')
        // }

        // todo diamond
        // if (viewer.getPluginByType<any>('Diamond'))
        //     viewer.getPluginByType<any>('Diamond').forceSceneEnvMap = true // we dont have separate env map support in path tracing

        this.tracer = new WebGLPathTracer2(viewer.renderManager.webglRenderer)
        this.tracer.setScene(viewer.scene, viewer.scene.mainCamera) // todo: handle active camera change

        // this.ptMaterial = new PhysicalPathTracingMaterial()
        // this.ptRenderer.alpha = !this._viewer?.getBackground() // for transparent background
        // this.ptRenderer.camera = viewer.scene.activeCamera.cameraObject
        // this.ptRenderer.material = this.ptMaterial
        // this.ptRenderer.setSize(viewer.renderer.renderSize.width, viewer.renderer.renderSize.height)
        // this.ptRenderer.tiles.set(this.tiles, this.tiles)

        viewer.scene.addEventListener('sceneUpdate', () => {
            this.refreshScene()
        })
        viewer.scene.addEventListener('mainCameraChange', () => {
            this.refreshScene()
        })
        viewer.scene.addEventListener('materialUpdate', () => {
            if (this.isDisabled() || !this.tracer || this._refreshing) return
            this.tracer.updateMaterials() // todo do post frame?
            this.reset()
        })
        viewer.scene.addEventListener('environmentChanged', () => {
            if (this.isDisabled() || !this.tracer || this._refreshing) return
            this.tracer.updateEnvironment() // todo do post frame?
            this.reset()
        })
        viewer.renderManager.addEventListener('resize', () => {
            if (this.isDisabled() || !this.tracer || this._refreshing) return
            // this.ptRenderer.setSize(viewer.renderer.renderSize.width, viewer.renderer.renderSize.height)
            // if (this._refreshing) return
            // console.log('resize')
            this.tracer.updateCamera()// todo do post frame?
            this.reset()
        })
        viewer.scene.mainCamera.addEventListener('update', () => {
            if (this.isDisabled() || !this.tracer || this._refreshing) return
            this.tracer.updateCamera()// todo do post frame?
            this.reset()
        })
        viewer.addEventListener('preFrame', () => {
            if (this.isDisabled() || this._refreshing || !this._viewer || !this.tracer) return
            // if (viewer.getPlugin(ProgressivePlugin)?.isConverged(true)) {

            // todo on no rasterize don't render rasterize pipeline
            const rasterize = viewer.renderManager.frameCount < 16 - 1 // min 16 required for path tracing to show up
            viewer.renderManager.defaultRenderToScreen = rasterize
            if (viewer.renderManager.frameCount > 0 && viewer.renderManager.frameCount < this.maxFrameCount) {
                // const outline = viewer.getPluginByType<OutlinePlugin>('Outline')
                // if (outline) outline.mouseInOutAnimationEnabled = false

                if (this._sceneNeedsRefresh) {
                    this._refreshScene()
                    return
                }
                //
                // if (!this.ptMaterial.bvh.bvhBounds.source.data.data) {
                //     return
                // }
                this._viewer.renderEnabled = false
                // this.ptRenderer.material.environmentMap = (viewer.renderManager.webglRenderer as any).cubeuvmaps
                // const env = viewer.scene.getEnvironment()
                // let bg = viewer.scene.getBackground() as any
                // if (!bg || !bg.isTexture || bg === env) bg = null
                // if (this._lastEnvMap !== env) {
                //     this._lastEnvMap = env
                //     this.ptRenderer.material.envMapInfo.updateFrom(env)
                // }
                // if (this._lastBgMap !== bg) {
                //     this._lastBgMap = bg
                //     this.ptRenderer.material.backgroundMap = bg
                // }
                // // viewer.getPlugin(DiamondPlugin)?.envMap || viewer.scene.getEnvironment()
                // // this.ptRenderer.material.environmentMap = viewer.scene.getEnvironment()
                // this.ptRenderer.material.environmentRotation.makeRotationY(viewer.scene.getEnvironment()?.rotation || 0)
                // // console.log(this.ptRenderer.material.environmentMap)
                // // console.log(viewer.getPlugin(DiamondPlugin)?.envMap)
                //
                // this.ptRenderer.material.filterGlossyFactor = this.filterGlossyFactor
                // this.ptRenderer.material.environmentIntensity = (viewer.scene.envMapIntensity || 1) * this.environmentMultiplier
                // this.ptRenderer.material.bounces = this.bounces
                // this.ptRenderer.camera.updateMatrixWorld()
                //
                // this.ptRenderer.camera.clearViewOffset()
                //
                // this._updateDiamondMaterials(this._modelRoot())
                //

                const encoding = viewer.renderManager.webglRenderer.outputColorSpace
                viewer.renderManager.webglRenderer.outputColorSpace = NoColorSpace

                // const pcl = (viewer.renderManager.webglRenderer as any).useLegacyLights;
                // (viewer.renderManager.webglRenderer as any).useLegacyLights = true
                for (let i = 0, l = this.samplesPerFrame; i < l; i++)
                    this.tracer.renderSample()

                // ;(viewer.renderManager.webglRenderer as any).useLegacyLights = pcl
                viewer.renderManager.webglRenderer.outputColorSpace = encoding

                // this.ptRenderer.camera.clearViewOffset() // todo?

                // viewer.renderManager.webglRenderer.autoClear = false
                // ;(fsQuad.material as any).map = this.ptRenderer.target.texture
                // fsQuad.render(viewer.renderManager.webglRenderer)
                // viewer.renderManager.webglRenderer.autoClear = true

                // todo
                // const combinedPost = this._viewer.getPlugin(CombinedPostPlugin)!
                if (!rasterize) {
                    const combinedPass = viewer.renderManager.screenPass
                    // if (this._iterationCount < 10 || this._iterationCount > 5 && this._iterationCount % 5 === 0) {
                    combinedPass.render(viewer.renderManager.renderer, null, this.tracer.target, 0, false)
                    viewer.renderManager.incRenderToScreen()
                }
                // }
                // viewer.renderer.blit(this.ptRenderer.target.texture, undefined)

                // console.log(this.ptRenderer.target.texture)
                this._viewer.renderEnabled = true
            }
        })
    }

    private _refreshing = false

    private _sceneNeedsRefresh = false
    @uiButton()
    refreshScene() {
        this._sceneNeedsRefresh = true
    }

    // private readonly _diaPhysicalMaterial = new MeshPhysicalMaterial({
    //     color: 0xffffff,
    //     metalness: 0,
    //     roughness: 0,
    //     fog: false,
    //     transmission: 1.0,
    //     opacity: 1,
    //     transparent: true,
    //     thickness: 0,
    //     attenuationDistance: 100,
    // })
    // private readonly _diaMatMap: Record<string, MeshPhysicalMaterial> = {}

    // private _modelRoot = ()=>this._viewer?.scene.modelRoot.modelObject
    private async _refreshScene() {
        if (!this._viewer) return
        if (this.isDisabled() || !this.tracer) return
        if (!this._sceneNeedsRefresh) return

        if (this._refreshing) {
            console.warn('ThreeGpuPathTracerPlugin: refreshing already')
            return
        }
        //     const root = this._modelRoot()
        //
        //     if (!root || !root.children.length) return
        this._sceneNeedsRefresh = false
        this._viewer.renderEnabled = false
        //     // if (this.sceneInfo) {
        //     //     this.sceneInfo.bvh.geometry.dispose()
        //     //     this.sceneInfo.bvh.geometry.disposeBoundsTree?.() // todo: check what this is and if required
        //     //     this.sceneInfo = undefined
        //     // }
        // this.reset()
        //
        //     let geoms = 0
        //     root.traverse((node:any)=>{
        //         if (node.geometry) geoms++
        //     })
        //     if (geoms < 1) return
        //
        this._refreshing = true

        const viewer = this._viewer

        const async = false // todo needs bvh worker?
        if (async) {
            await this.tracer.setSceneAsync(viewer.scene, viewer.scene.mainCamera, {
                onProgress: (progress)=>{
                    console.log('Path Tracing Scene Generation Progress:', progress)
                },
            })
        } else {
            this.tracer.setScene(viewer.scene, viewer.scene.mainCamera, {
                onProgress: (progress) => {
                    console.log('Path Tracing Scene Generation Progress:', progress)
                },
            })
        }
        //
        //     const generator = new PathTracingSceneGenerator()
        //     this._updateDiamondMaterials(root)
        //
        //     const matMap: any = {}
        //
        //     root.traverse((node: any) => {
        //         if (node.material?.isDiamondMaterial) {
        //             matMap[node.uuid] = node.material
        //             node.material = this._diaMatMap[this._diamondMaterialKey(node.material)]
        //         }
        //     })
        //
        //     const result = generator.generate([root, ...this._viewer!.scene.children.filter(c=>(c as any)?.isLight)] as any)
        //     // const result = generator.generate(root as any)
        //
        //     root.traverse((node: any) => {
        //         if (matMap[node.uuid]) {
        //             node.material = matMap[node.uuid]
        //         }
        //     })
        //
        //     this.sceneInfo = result
        //     const geometry = result.bvh.geometry
        //     // update bvh and geometry attribute textures
        //     this.ptMaterial.bvh.updateFrom(result.bvh)
        //     this.ptMaterial.attributesArray.updateFrom(
        //         geometry.attributes.normal,
        //         geometry.attributes.tangent,
        //         geometry.attributes.uv,
        //         geometry.attributes.color,
        //     )
        //     // this.ptMaterial.normalAttribute.updateFrom(geometry.attributes.normal)
        //     // this.ptMaterial.tangentAttribute.updateFrom(geometry.attributes.tangent)
        //     // this.ptMaterial.uvAttribute.updateFrom(geometry.attributes.uv)
        //     // this.ptMaterial.colorAttribute.updateFrom(geometry.attributes.color)
        //
        //     // console.log(this.ptMaterial, result.materials)
        //
        //     // update lights
        //     this.ptMaterial.lights.updateFrom(result.lights)
        //     // this.ptMaterial.lightCount = result.lights.length
        //
        //     // update materials and texture arrays
        //     this.ptMaterial.materialIndexAttribute.updateFrom(geometry.attributes.materialIndex)
        //     this.ptMaterial.textures.setTextures(this._viewer.renderManager.webglRenderer, 2048, 2048, result.textures)
        //
        //     // this is done before render also
        //     this.ptMaterial.materials.updateFrom(result.materials, result.textures)
        //
        //     result.matera
        //
        //     // generator.dispose()
        //
        this._viewer.renderEnabled = true

        this._refreshing = false
    }

    // private _updateDiamondMaterials(root?: Object3D) {
    //     root?.traverse((node: any) => {
    //         if (node.material?.isDiamondMaterial) {
    //             const matKey = this._diamondMaterialKey(node.material)
    //             if (!this._diaMatMap[matKey]) {
    //                 this._diaMatMap[matKey] = this._diaPhysicalMaterial.clone()
    //             }
    //             this._diaMatMap[matKey].color.set(node.material.color)
    //             this._diaMatMap[matKey].ior = node.material.refractiveIndex
    //         }
    //     })
    // }
    //
    // private _diamondMaterialKey = (mat: any)=>mat.color.getHexString() + mat.refractiveIndex

    reset() {
        if (this.isDisabled() || !this.tracer) return
        this.tracer.reset()
        this.setDirty()
    }

    dispose() {
        super.dispose()
        if (this.tracer) { // todo do on plugin remove
            this.tracer.dispose()
            // this.tracer = undefined
        }
    }

    static {
        // @ts-expect-error polyfill for new threejs
        Scene.prototype.backgroundRotation = new Euler(0, 0, 0, 'XYZ')
        // @ts-expect-error polyfill
        Scene.prototype.environmentRotation = new Euler(0, 0, 0, 'XYZ')
    }
}

