import {UiObjectConfig} from 'uiconfig.js'
import {IObject3D, IScene, ISceneEventMap, IWidget} from '../../core'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IEvent, onChange} from 'ts-browser-helpers'
import {EventListener2, Object3D} from 'three'
import {
    CameraHelper2,
    DirectionalLightHelper2,
    LineHelper,
    PointLightHelper2,
    SkeletonHelper2,
    SpotLightHelper2,
} from '../../three'

export interface IObject3DHelper<T extends Object3D&IWidget = Object3D&IWidget>{
    Create: (o: Object3D)=>T,
    Check: (o: Object3D)=>boolean,
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

    private _widgetRoot = new Object3D()

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._widgetRoot.userData.isWidgetRoot = true
        this._widgetRoot.name = 'Widgets Root'
        viewer.scene.addObject(this._widgetRoot, {addToRoot: true, autoScale: false, autoCenter: false})
        // todo use object3dmanager here
        viewer.scene.addEventListener('addSceneObject', this._addSceneObject)
    }
    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('addSceneObject', this._addSceneObject)
        this.widgets.forEach(w => w.dispose && w.dispose())
        this.widgets = []
        this._widgetRoot.removeFromParent()
        this._widgetRoot.clear()
        super.onRemove(viewer)
    }
    private _addSceneObject: EventListener2<'addSceneObject', ISceneEventMap, IScene> = (e)=>{
        this._createWidgets(e.object)
    }

    refresh() {
        this._createWidgets(this._viewer?.scene.modelRoot)
    }

    widgets: (IWidget&Object3D)[] = []

    private _widgetDisposed = (e: IEvent<any>)=> this._unregisterWidget(e.target)

    private _registerWidget(w: IWidget&Object3D) {
        this.widgets.push(w)
        w.addEventListener('dispose', this._widgetDisposed) // todo: maybe unregister when removed from parent, dispose makes little sense.
    }
    private _unregisterWidget(w: IWidget&Object3D) {
        w.removeEventListener('dispose', this._widgetDisposed)
        const i = this.widgets.indexOf(w)
        if (i >= 0) this.widgets.splice(i, 1)
    }

    private _createWidgets(o?: Object3D) {
        if ((o as IObject3D).assetType === 'widget') {
            return
        }
        o?.traverse((l: any) => {
            const widget = this.widgets.find(w => w.object === l)
            if (widget) {
                widget.update && widget.update()
                return
            }
            const helpers = this.helpers.filter(h => h.Check(l))
            helpers.forEach(h => {
                const w = h.Create(l)
                w.visible = !this.isDisabled()
                this._widgetRoot.add(w)
                this._registerWidget(w)
            })
        })
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
            {
                type: 'button',
                label: 'Refresh',
                value: ()=>this.refresh(),
            },
        ],
    }
}
