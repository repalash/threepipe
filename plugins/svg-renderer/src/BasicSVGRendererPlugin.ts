import {
    AViewerPluginSync,
    type IViewerEvent,
    ThreeViewer,
    uiButton,
    uiConfig,
    uiFolderContainer,
    uiToggle,
} from 'threepipe'
import {BasicSVGRenderer} from './basic/BasicSVGRenderer'

/**
 * SVG rendering of 3d objects using SVGRenderer from three/addons
 */
@uiFolderContainer('SVG Renderer')
export class BasicSVGRendererPlugin extends AViewerPluginSync {
    static readonly PluginType = 'BasicSVGRendererPlugin'

    @uiToggle()
        enabled = true

    @uiConfig()
    readonly renderer = new BasicSVGRenderer()

    /**
     * @param enabled
     * @param autoAddToContainer - automatically add the svg to the viewer container and style it same as the viewer is position is absolute
     */
    constructor(enabled = true, readonly autoAddToContainer = true) {
        super()
        this._onResize = this._onResize.bind(this)
        this.enabled = enabled
        this.renderer.domElement.style.position = 'absolute'
        this.renderer.domElement.style.display = 'none'
    }

    protected _lastStyles?: string = undefined
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.renderer.setSize(viewer.canvas.clientWidth, viewer.canvas.clientHeight)
        this._refreshParams()
        if (this.autoAddToContainer) {
            viewer.container.prepend(this.renderer.domElement) // behind the canvas so that we get pointer events
            const element = this.renderer.domElement
            element.style.pointerEvents = 'none'
            const canvasStyles = getComputedStyle(viewer.canvas)
            if (canvasStyles.position === 'absolute') {
                this._lastStyles = element.style.cssText
                // copy styles from canvas to svg so it looks the same.
                element.style.top = canvasStyles.top
                element.style.left = canvasStyles.left
                element.style.width = canvasStyles.width
                element.style.height = canvasStyles.height
                // element.style.zIndex = '999999' // svg should be behind the canvas
            } else {
                this._viewer?.console.warn('BasicSVGRendererPlugin: canvas position should be absolute for proper rendering')
            }
            viewer.renderManager.addEventListener('resize', this._onResize)
        }
        this.renderer.domElement.style.display = this.enabled ? '' : 'none'
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        if (this.autoAddToContainer) {
            viewer.container.removeChild(this.renderer.domElement)
        }
        if (this._lastStyles !== undefined) {
            this.renderer.domElement.style.cssText = this._lastStyles
            this._lastStyles = undefined
        }
        viewer.renderManager.removeEventListener('resize', this._onResize)
        this.renderer.domElement.style.display = 'none'
    }


    @uiToggle()
        autoRender = true

    @uiButton()
    render() {
        if (!this._viewer) return
        if (this.isDisabled()) return
        this.renderer.render(this._viewer.scene, this._viewer.scene.mainCamera)
    }

    @uiButton()
    download() {
        const svg = this.renderer.domElement.outerHTML
        const blob = new Blob([svg], {type: 'image/svg+xml'})
        this._viewer?.exportBlob(blob, 'scene.svg')
    }

    protected _viewerListeners = {
        postRender: (_: IViewerEvent)=>{
            if (this.autoRender) this.render()
        },
    }

    get svgNode() {
        return this.renderer.domElement
    }

    protected _refreshParams() {
        if (this.isDisabled()) return
        this.renderer.setQuality('medium')
    }
    protected _onResize() {
        if (!this._viewer) return
        this.renderer.setSize(this._viewer.canvas.clientWidth, this._viewer.canvas.clientHeight)
    }

}
