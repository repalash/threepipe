import {uiConfig, uiPanelContainer, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {OrbitControls3, TransformControls2} from '../../three'
import {PickingPlugin} from './PickingPlugin'
import {onChange} from 'ts-browser-helpers'

@uiPanelContainer('Transform Controls')
export class TransformControlsPlugin extends AViewerPluginSync<''> {
    public static readonly PluginType = 'TransformControlsPlugin'

    @uiToggle()
    @onChange(TransformControlsPlugin.prototype._enableChange)
        enabled = true

    private _pickingWidgetDisabled = false
    private _enableChange() {
        if (!this._viewer) return
        const picking = this._viewer.getPlugin(PickingPlugin)!
        if (this.enabled && picking.widgetEnabled) {
            picking.widgetEnabled = false
            this._pickingWidgetDisabled = true
        } else if (!this.enabled && this._pickingWidgetDisabled) {
            picking.widgetEnabled = true
            this._pickingWidgetDisabled = false
        }
        if (this.transformControls) {
            if (this.enabled && picking.getSelectedObject()) this.transformControls.attach(picking.getSelectedObject()!)
            else this.transformControls.detach()
        }
    }

    toJSON: any = undefined

    dependencies = [PickingPlugin]

    @uiConfig()
        transformControls: TransformControls2 | undefined

    protected _isInteracting = false
    protected _viewerListeners = {
        postFrame: ()=>{
            if (!this.transformControls || !this._viewer) return
            // this._viewer.scene.mainCamera.setInteractions(!this._isInteracting, TransformControlsPlugin.PluginType)
        },
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._enableChange()
        this.transformControls = new TransformControls2(viewer.scene.mainCamera, viewer.canvas)
        this._mainCameraChange = this._mainCameraChange.bind(this)
        viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)
        this.transformControls.addEventListener('dragging-changed', (event) => {
            if (!this?._viewer) return
            const controls = this._viewer.scene.mainCamera.controls
            if (typeof (controls as any)?.stopDamping === 'function' && controls?.enabled) (controls as OrbitControls3).stopDamping()
            this._viewer.scene.mainCamera.setInteractions(!event.value, TransformControlsPlugin.PluginType)
            // this._viewer.scene.mainCamera.autoNearFar = !event.value // todo: maintain state
        })
        this.transformControls.addEventListener('axis-changed', (event) => {
            if (!this?._viewer) return
            this._isInteracting = !!event.value
            const controls = this._viewer.scene.mainCamera.controls
            if (typeof (controls as any)?.stopDamping === 'function' && controls?.enabled) (controls as OrbitControls3).stopDamping()
            this._viewer.setDirty() // rerender for color change
        })
        viewer.scene.addObject(this.transformControls, {addToRoot: true})
        const picking = viewer.getPlugin(PickingPlugin)!
        picking.addEventListener('selectedObjectChanged', (event) => {
            if (!this.transformControls) return
            if (!this.enabled) {
                if (this.transformControls.object) this.transformControls.detach()
                return
            }
            event.object ? this.transformControls.attach(event.object) : this.transformControls.detach()
        })

    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        if (this.transformControls) {
            this.transformControls.detach()
            viewer.scene.remove(this.transformControls)
            this.transformControls.dispose()
        }
        this.transformControls = undefined
        super.onRemove(viewer)
    }

    private _mainCameraChange = () => {
        if (!this.transformControls || !this._viewer) return
        this.transformControls.camera = this._viewer.scene.mainCamera
    }


}
