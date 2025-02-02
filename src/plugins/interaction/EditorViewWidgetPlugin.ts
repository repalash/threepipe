import {AViewerPluginSync, type IViewerEvent, ThreeViewer} from '../../viewer'
import {DomPlacement, GizmoOrientation, ViewHelper2} from '../../three'
import {uiFolderContainer, uiToggle} from 'uiconfig.js'
import {onChange} from 'ts-browser-helpers'

@uiFolderContainer('Editor View Widget')
export class EditorViewWidgetPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'EditorViewWidgetPlugin'

    @uiToggle()
    @onChange(EditorViewWidgetPlugin.prototype.setDirty)
        enabled = true

    setDirty() {
        if (!this._viewer || !this.widget) return
        this.widget.domContainer.style.display = !this.isDisabled() ? 'block' : 'none'
    }

    constructor(public readonly placement: DomPlacement = 'top-left', public readonly size = 128) {
        super()
    }

    widget?: ViewHelper2

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        this.widget = new ViewHelper2(v.scene.mainCamera as any, v.canvas, this.placement, this.size)
        this.widget.target = v.scene.mainCamera.target
        this.widget.addEventListener('animating-changed', (e)=>{
            const val = e.detail.value
            v.scene.mainCamera.setInteractions(!val, EditorViewWidgetPlugin.PluginType)
        })
        this.widget.addEventListener('update', ()=>this._needsRender = true) // when mouse hover and leave.
        v.scene.addEventListener('mainCameraChange', this._mainCameraChange)
        v.scene.addEventListener('mainCameraUpdate', this._mainCameraUpdate)
    }

    onRemove(viewer: ThreeViewer) {
        this.widget?.dispose()
        this.widget = undefined
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        viewer.scene.removeEventListener('mainCameraUpdate', this._mainCameraUpdate)
        super.onRemove(viewer)
    }

    protected _mainCameraChange() {
        if (!this._viewer || !this.widget) return
        this.widget.camera = this._viewer.scene.mainCamera as any
    }
    protected _mainCameraUpdate() {
        if (!this._viewer || !this.widget) return
        this.widget.target = this._viewer.scene.mainCamera.target
    }

    // this is required separately so that when we hover on the gizmo we dont need to set dirty for the whole viewer
    protected _needsRender = false
    protected _viewerListeners = {
        postRender: (_: IViewerEvent)=>{
            if (!this._viewer || !this.widget || this.isDisabled()) return
            this._needsRender = true
        },
        postFrame: (_: IViewerEvent)=>{
            if (!this._viewer || !this.widget || this.isDisabled() || !this._needsRender) return
            this.widget.update()
            this.widget.render()
            if (this.widget.animating) this._viewer.scene.mainCamera.setDirty()
            this._needsRender = false
        },
    }

    setOrientation(orientation: GizmoOrientation) {
        if (!this.widget) return
        this.widget.setOrientation(orientation)
    }

}


