import {
    type AnimationObjectPlugin,
    AViewerPluginSync, createStyles,
    IViewerPluginSync,
    onChange,
    ThreeViewer,
    uiFolderContainer,
    uiToggle,
    UndoManagerPlugin,
} from 'threepipe'
import {TimelineManager} from './TimelineManager'
import {createRoot} from 'react-dom/client'
import {createElement} from 'react'
import {Timeline} from './timeline'
import timelineCss from './timeline.css?inline'

/**
 * Global Timeline UI Plugin for ThreePipe Viewer.
 * It includes support for extensions to add custom tracks, and built in support for core plugin tracks.
 */
@uiFolderContainer('Timeline UI')
export class TimelineUiPlugin extends AViewerPluginSync implements IViewerPluginSync {
    static readonly PluginType = 'TimelineUiPlugin'

    @onChange(TimelineUiPlugin.prototype.enabledChanged)
    @uiToggle()
        enabled: boolean

    dependencies = [UndoManagerPlugin]

    static CONTAINER_SLOT = 'timeline-ui-container'

    readonly container: HTMLElement
    constructor(enabled = true, container?: HTMLElement) {
        super()
        this.enabled = enabled
        this.container = container || document.getElementById(TimelineUiPlugin.CONTAINER_SLOT) || document.body
        createStyles(timelineCss)
    }

    manager?: TimelineManager
    root?: HTMLDivElement
    reactRoot?: ReturnType<typeof createRoot>
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        document.documentElement.style.overscrollBehavior = 'contain' // to prevent accidental back/forward

        this.manager = new TimelineManager(viewer)
        this.enabledChanged()
    }

    private _createRoot() {
        if (!this.container) return
        const root = document.createElement('div')
        root.style.position = 'absolute'
        root.style.top = '0'
        root.style.left = '0'
        root.style.width = '100%'
        root.style.height = '100%'
        root.style.zIndex = '1000'
        root.id = 'timeline-root'
        root.style.pointerEvents = 'none'
        root.style.background = 'transparent'
        root.style.display = 'none'

        this.root = root
        this.container.appendChild(root)
        this.reactRoot = createRoot(root)

        this._renderRoot()
    }

    private _removeRoot() {
        if (this.reactRoot) {
            this.reactRoot.unmount()
            this.reactRoot = undefined
        }
        if (this.root) {
            this.root.remove()
            this.root = undefined
        }
    }

    enabledChanged() {
        if (!this.container) return
        if (this.enabled) {
            if (!this.root) this._createRoot()
            else this._renderRoot()
            if (this.root) this.root.style.display = 'block'
        } else {
            // if (this.root) this.root.style.display = 'none'
            this._removeRoot()
        }
        this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.showTriggers(this.enabled)
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    private _renderRoot() {
        if (this.reactRoot && this.manager) {
            this.reactRoot.render(createElement(Timeline, {manager: this.manager, closeTimeline: ()=> this.enabled = false}))
        }
    }

    onRemove(viewer: ThreeViewer) {
        super.onRemove(viewer)
        this.dispose()
    }

    dispose() {
        this._removeRoot()
        this.manager?.destroy()
        this.manager = undefined
        super.dispose()
    }

}
