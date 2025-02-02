import {
    AViewerPluginSync,
    IObject3D,
    type IViewerEvent,
    Mesh,
    onChange,
    PerspectiveCamera2,
    ThreeViewer,
    timeout,
    uiButton,
    uiFolderContainer,
    uiToggle,
    uiVector,
    Vector2,
} from 'threepipe'
import {FillPass, HiddenChainPass, SVGMesh, SVGRenderer, VisibleChainPass} from './three-svg-renderer'
import {Vertex} from './three-mesh-halfedge'

/**
* SVG Rendering from 3d scenes helper plugin using [three-svg-renderer](https://www.npmjs.com/package/three-svg-renderer) (GPLV3 Licenced)
*/
@uiFolderContainer('SVG Renderer')
export class ThreeSVGRendererPlugin extends AViewerPluginSync {
    static readonly PluginType = 'ThreeSVGRendererPlugin'

    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        enabled = true
    /**
     * Automatically render when camera or any object changes.
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        autoRender = true

    /**
     * Use the fill pass to draw polygons.(both fills and strokes)
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        drawPolygons = true
    /**
     * Draw polygon fills. (fill color from material.color)
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        drawPolygonFills = true
    /**
     * Draw polygon strokes. (stroke color from material.color)
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        drawPolygonStrokes = true
    /**
     * Draw image fills. (fill image from rendered canvas image).
     * Make sure canvas is rendered(and render pipeline has a render pass) before calling this.
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        drawImageFills = false
    /**
     * Draw visible contours of meshes.
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        drawVisibleContours = true
    /**
     * Draw hidden contours of meshes.
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        drawHiddenContours = true

    /**
     * Update meshes on every render. If this is false, meshes will only be updated when they change. (tracked using objectUpdate event)
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        alwaysUpdateMeshes = true

    /**
     * Min and Max Crease angle for mesh edges.
     */
    @uiVector()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        creaseAngle = new Vector2(80, 100)

    /**
     * Automatically create SVG objects for all meshes in the scene.
     * If this is false, you will have to manually create SVG objects for meshes using `makeSVGObject` method.
     */
    @uiToggle()
    @onChange(ThreeSVGRendererPlugin.prototype.setDirty)
        autoMakeSvgObjects = true

    readonly renderer = new SVGRenderer()
    readonly svgNodeContainer = document.createElement('div')
    protected readonly _fillPass: FillPass

    setDirty(...args: any[]): any {
        if (args[0] === 'enabled') {
            const last = args[2]
            const current = args[1]
            if (last !== current && this._meshes?.size) {
                this._toggleMaterialRendering([...this._meshes.values()], !current)
            }
            if (this.svgNodeContainer) {
                this.svgNodeContainer.style.display = current ? '' : 'none'
            }
        }
        this._viewer?.setDirty()
    }

    /**
     * @param enabled
     * @param autoAddToContainer - automatically add the svg to the viewer container and style it same as the viewer is position is absolute
     */
    constructor(enabled = true, readonly autoAddToContainer = true) {
        super()
        this._onResize = this._onResize.bind(this)
        this._onMeshDispose = this._onMeshDispose.bind(this)
        this._onMeshUpdate = this._onMeshUpdate.bind(this)
        this.updateMeshes = this.updateMeshes.bind(this)
        this.enabled = enabled
        this.svgNodeContainer.style.position = 'absolute'
        this.svgNodeContainer.style.display = 'none'
        // This pass will draw fills for meshes using the three.js material color
        this._fillPass = new FillPass()

        // This pass will draw visible contours of meshes on top of fills
        // using black color and solid line of width 1
        const visibleChainPass = new VisibleChainPass({
            // color: '#000000',
            // width: 1,
        })

        // This pass will draw hidden contours on top of visible and fills
        // using red color, dash line of width 1
        const hiddenChainPass = new HiddenChainPass({
            // color: '#FF0000',
            // width: 1,
            // dasharray: '2,2',
        })

        this.renderer.addPass(this._fillPass)
        this.renderer.addPass(visibleChainPass)
        this.renderer.addPass(hiddenChainPass)

        Vertex.MAX_LOOP = 10000 // todo; this is for large models that get stuck.
        // this.renderer.addPass(new SingularityPointPass())
        // this.renderer.addPass(new TexturePass())
    }

    protected _lastStyles?: string = undefined
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // this.renderer.setSize(viewer.canvas.clientWidth, viewer.canvas.clientHeight)
        // this._refreshParams() // this is done before rendering
        if (this.autoAddToContainer) {
            viewer.container.prepend(this.svgNodeContainer) // behind the canvas so that we get pointer events and see other stuff
            this.svgNodeContainer.style.pointerEvents = 'none'
            const canvasStyles = getComputedStyle(viewer.canvas)
            if (canvasStyles.position === 'absolute') {
                this._lastStyles = this.svgNodeContainer.style.cssText
                // copy styles from canvas to svg so it looks the same.
                this.svgNodeContainer.style.top = canvasStyles.top
                this.svgNodeContainer.style.left = canvasStyles.left
                this.svgNodeContainer.style.width = canvasStyles.width
                this.svgNodeContainer.style.height = canvasStyles.height
                // this.svgNodeContainer.style.zIndex = '999999' // svg should be behind the canvas
            } else {
                this._viewer?.console.warn('ThreeSVGRendererPlugin: canvas position should be absolute for proper rendering')
            }
            viewer.renderManager.addEventListener('resize', this._onResize)
        }
        this.svgNodeContainer.style.display = this.enabled ? '' : 'none'
        viewer.scene.modelRoot.addEventListener('objectUpdate', this.updateMeshes)
    }

    private _meshesNeedsUpdate = true
    updateMeshes() {
        console.log('updateMeshes')
        this._meshesNeedsUpdate = true
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        if (this.autoAddToContainer) {
            viewer.container.removeChild(this.svgNodeContainer)
        }
        if (this._lastStyles !== undefined) {
            this.svgNodeContainer.style.cssText = this._lastStyles
            this._lastStyles = undefined
        }
        viewer.renderManager.removeEventListener('resize', this._onResize)
        this._meshes.clear() // ?
        this.svgNodeContainer.style.display = 'none'
        viewer.scene.modelRoot.removeEventListener('objectUpdate', this.updateMeshes)
    }

    protected _onMeshDispose(ev: any) {
        if (!ev.target) return
        const mesh = ev.target as Mesh
        const svgMesh = this._meshes.get(mesh.uuid)
        if (!svgMesh) return
        svgMesh.dispose()
        this._meshes.delete(mesh.uuid)
        mesh.removeEventListener('dispose', this._onMeshDispose)
        mesh.removeEventListener('objectUpdate', this._onMeshUpdate)
    }
    protected _onMeshUpdate(ev: any) {
        if (!ev.target) return
        const mesh = ev.target as Mesh
        const svgMesh = this._meshes.get(mesh.uuid)
        if (!svgMesh) return
        svgMesh.updateObject()
    }
    protected _meshes = new Map<string, SVGMesh>()
    protected _refreshMeshes(root?: IObject3D) {
        if (!this.autoMakeSvgObjects) return []
        if (!root && this._viewer) root = this._viewer.scene.modelRoot
        if (!root) return []
        root.traverse(o=>{
            this.makeSVGObject(o)
        })
    }

    makeSVGObject(o: IObject3D) {
        if (!(o.isMesh && !this._meshes.has(o.uuid))) return
        const ud = o.userData
        o.userData = {}
        const svgMesh = new SVGMesh(o as any as Mesh)
        o.userData = ud
        this._meshes.set(o.uuid, svgMesh)
        this._toggleMaterialRendering([svgMesh], !this.enabled)
        o.addEventListener('dispose', this._onMeshDispose)
        o.addEventListener('objectUpdate', this._onMeshUpdate) // todo: check if we need to do object update everytime and what actions specifically.
        this._meshesNeedsUpdate = true // because we have a new mesh
    }

    private _rendering = false

    static SVG_RENDER_TIMEOUT = 2000

    protected _toggleMaterialRendering(meshes: SVGMesh[], enable: boolean) {
        const materials = []
        for (const mesh of meshes) {
            materials.push(...Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        }
        // enable rendering of material colors
        for (const mat of materials) {
            if (mat.colorWrite !== undefined) {
                if (enable && !mat.colorWrite) {
                    mat.colorWrite = true
                    delete mat.userData.forcedLinearDepth
                    // mat.userData._colorWriteSet = true
                } else if (!enable /* && mat.userData._colorWriteSet*/) {
                    mat.colorWrite = false
                    mat.userData.forcedLinearDepth = 1 // for gbuffer plugin
                    // delete mat.userData._colorWriteSet
                }
            }
        }

    }

    @uiButton()
    async render() {
        if (!this._viewer || !this._viewer.renderEnabled) return
        if (this.isDisabled()) return
        if (this._rendering) return
        this._rendering = true
        this._refreshParams()
        this._refreshMeshes()

        const meshes = [...this._meshes.values()]
        // todo: make sure all meshes are in the scene
        // todo only use meshes that should be rendered.
        if (!meshes.length) {
            this._rendering = false
            return ''
        }
        const camera = this._viewer.scene.mainCamera as PerspectiveCamera2
        try {
            if (this.drawImageFills) {
                this._toggleMaterialRendering(meshes, true)
                this._viewer.setDirty()
                this._viewer.canvas.style.opacity = '0'
                await this._viewer.doOnce('preFrame') // because we are already in postRender or postFrame.
                await this._viewer.doOnce('postFrame') // todo wait for progressive also maybe

                await this._viewer.doOnce('postFrame') // once more
                this._fillPass.options.fillImage = this._viewer.canvas.toDataURL('image/png')

                // disable rendering of material colors
                this._toggleMaterialRendering(meshes, false)

                this._viewer.setDirty()
                await this._viewer.doOnce('preFrame') // already in postFrame
                await this._viewer.doOnce('postFrame')
                this._viewer.canvas.style.opacity = '1'
            }

            // this._fillPass.options.fillImage = this._viewer.canvas.toDataURL('image/png')
            // this._viewer.renderEnabled = false
            this.renderer.viewmap.skipActions = false
            const svgPromise = this.renderer.generateSVG(meshes, camera, {
                w: this._viewer.canvas.width,
                h: this._viewer.canvas.height,
            })
            let svgResolved = false
            timeout(ThreeSVGRendererPlugin.SVG_RENDER_TIMEOUT).then(()=>{ // todo: make support in libs to cancel the promise. this will just wait for an action to complete.
                if (!svgResolved) {
                    console.warn('timeout')
                    this.renderer.viewmap.skipActions = true
                }
            })
            const svg = await svgPromise
            svgResolved = true
            this.renderer.viewmap.skipActions = false
            // this._viewer.renderEnabled = true
            this.svgNodeContainer.innerHTML = svg.node.outerHTML
            this._rendering = false
            return svg.svg()
        } catch (e) {
            console.error(e)
        }
        this._rendering = false
        return ''
    }

    @uiButton()
    download() {
        const svg = this.svgNodeContainer.innerHTML
        const blob = new Blob([svg], {type: 'image/svg+xml'})
        this._viewer?.exportBlob(blob, 'scene.svg')
    }

    protected _viewerListeners = {
        postRender: (_: IViewerEvent)=>{
            if (this.autoRender) this.render()
        },
    }

    get svgNode() {
        if (!this.svgNodeContainer.children.length) return undefined
        if (this.svgNodeContainer.children.length > 1) {
            this._viewer?.console.warn('ThreeSVGRenderer: Multiple svg nodes in container, should not be possible')
        }
        return this.svgNodeContainer.children[0]
    }

    protected _refreshParams() {
        if (this.isDisabled()) return
        if (this._meshesNeedsUpdate) {
            this.renderer.viewmap.options.updateMeshes = true
            this._meshesNeedsUpdate = false
        } else this.renderer.viewmap.options.updateMeshes = this.alwaysUpdateMeshes
        this.renderer.viewmap.options.creaseAngle.min = this.creaseAngle.x
        this.renderer.viewmap.options.creaseAngle.max = this.creaseAngle.y

        const passes = this.renderer.drawHandler.passes
        const fillPass = passes.find(p=>p instanceof FillPass)!
        const visibleContourPass = passes.find(p=>p instanceof VisibleChainPass)!
        const hiddenContourPass = passes.find(p=>p instanceof HiddenChainPass)!
        if (fillPass) {
            fillPass.enabled = this.drawPolygons && (this.drawPolygonFills || this.drawPolygonStrokes || this.drawImageFills)
            fillPass.drawFills = this.drawPolygonFills
            fillPass.drawStrokes = this.drawPolygonStrokes
            fillPass.drawImageFills = this.drawImageFills
        }
        if (visibleContourPass) {
            visibleContourPass.enabled = this.drawVisibleContours
        }
        if (hiddenContourPass) {
            hiddenContourPass.enabled = this.drawHiddenContours
        }

    }
    protected _onResize() {
        if (!this._viewer) return
        // this.renderer.setSize(this._viewer.canvas.clientWidth, this._viewer.canvas.clientHeight)
    }

}


// adding here since they dont show up in dependencies.txt somehow
/**
 * @license
 * three-svg-renderer
 *
 * GNU GENERAL PUBLIC LICENSE
 * Version 3, 29 June 2007
 *
 * Copyright (c) 2022 Axel Antoine
 */
/**
 * @license
 * three-mesh-halfedge
 *
 * MIT License
 *
 * Copyright (c) 2022 Axel Antoine
 */
