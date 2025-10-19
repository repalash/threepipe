import {UiObjectConfig} from 'uiconfig.js'
import {Group2, IObject3D, IWidget} from '../../core'
import {AViewerPluginSync, type IViewerEvent, IViewerEventTypes, ThreeViewer} from '../../viewer'
import {IEvent, onChange} from 'ts-browser-helpers'
import {
    CameraHelper2,
    DirectionalLightHelper2,
    LineHelper,
    PointLightHelper2,
    SkeletonHelper2,
    SpotLightHelper2,
} from '../../three/widgets'
import {PartialRecord} from '../../utils'

export interface IObject3DHelper<T extends IWidget = IWidget>{
    Create: (o: IObject3D)=>T,
    Check: (o: IObject3D)=>boolean,
}

/**
 * Adds light and camera helpers/gizmos in the viewer.
 * A helper is automatically created when any supported light or camera is added to the scene.
 * @category Plugins
 */
export class Object3DWidgetsPlugin extends AViewerPluginSync {
    @onChange(Object3DWidgetsPlugin.prototype.setDirty)
        enabled = true
    public static readonly PluginType = 'Object3DWidgetsPlugin'

    helpers: IObject3DHelper[] = [
        DirectionalLightHelper2,
        SpotLightHelper2,
        PointLightHelper2,
        CameraHelper2,
        LineHelper,
        SkeletonHelper2,
        // BoneHelper,
    ]

    setDirty() {
        this.widgets?.forEach(w => w.visible = !this.isDisabled())
        this._viewer?.setDirty()
    }

    toJSON: any = null

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    private _widgetRoot = new Group2()

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._widgetRoot.userData.isWidgetRoot = true
        this._widgetRoot.name = 'Widgets Root'
        viewer.scene.addObject(this._widgetRoot, {addToRoot: true, autoScale: false, autoCenter: false})

        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)

    }
    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))
        this.widgets.forEach(w => w.dispose && w.dispose())
        this.widgets = []
        this._widgetRoot.removeFromParent()
        this._widgetRoot.clear()
        super.onRemove(viewer)
    }

    protected _viewerListeners: PartialRecord<IViewerEventTypes, (e: IViewerEvent)=>void> = {
        preRender: ()=>{
            this.widgets.forEach(w => w.preRender && w.preRender())
        },
    }

    widgets: (IWidget)[] = []

    private _widgetDisposed = (e: IEvent<any>)=> this._unregisterWidget(e.target)

    private _registerWidget(w: IWidget) {
        this.widgets.push(w)
        w.addEventListener('dispose', this._widgetDisposed) // todo: maybe unregister when removed from parent, dispose makes little sense.
    }
    private _unregisterWidget(w: IWidget) {
        w.removeEventListener('dispose', this._widgetDisposed)
        const i = this.widgets.indexOf(w)
        if (i >= 0) this.widgets.splice(i, 1)
    }

    private _createWidget(o?: IObject3D) {
        if (!o || o.assetType === 'widget' || o === this._widgetRoot || o.isWidget) {
            return
        }
        if (o.userData.disableWidgets) return
        let inWidget = false
        o.traverseAncestors(c=>inWidget = inWidget || c === this._widgetRoot || !!c.isWidget || c.assetType === 'widget')
        if (inWidget) return

        const widget = this.widgets.find(w => w.object === o)
        if (widget) {
            widget.update && widget.update()
            return
        }
        const helpers = this.helpers.filter(h => h.Check(o))
        for (const h of helpers) {
            const w = h.Create(o)
            w.visible = !this.isDisabled()
            this._widgetRoot.add(w)
            this._registerWidget(w)
        }
    }

    private _removeWidget(o?: IObject3D) {
        if (!o) return
        const widgetsToRemove = this.widgets.filter(w => w.object === o)
        for (const w of widgetsToRemove) {
            w.dispose && w.dispose(true)
            w.parent && w.removeFromParent()
            this._unregisterWidget(w)
        }
    }

    private _objectAdd = (e: {object?: IObject3D})=>{
        const l = e.object
        this._createWidget(l)
    }

    private _objectRemove = (e: {object?: IObject3D})=>{
        const l = e.object
        this._removeWidget(l)
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Widgets',
        children: [
            {
                type: 'checkbox',
                label: 'Enabled',
                property: [this, 'enabled'],
            },
        ],
    }
}
