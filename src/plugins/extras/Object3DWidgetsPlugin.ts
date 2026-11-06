import {UiObjectConfig} from 'uiconfig.js'
import {Vector2, Vector3} from 'three'
import {Group2, IObject3D, IWidget} from '../../core'
import {AViewerPluginSync, type IViewerEvent, IViewerEventTypes, ThreeViewer} from '../../viewer'
import {IEvent, onChange} from 'ts-browser-helpers'
import {
    AHelperWidget,
    ALightHelperWidget,
    CameraHelper2,
    DirectionalLightHelper2,
    LineHelper,
    PointLightHelper2,
    SkeletonHelper2,
    SpotLightHelper2,
    WidgetIconMode,
    WidgetIconOverlay,
} from '../../three/widgets'
import type {HitIntersects} from '../../three/utils/ObjectPicker'
import {PartialRecord} from '../../utils'
import type {PickingPlugin} from '../interaction/PickingPlugin'
import {GBufferPlugin} from '../pipeline/GBufferPlugin'

export interface IObject3DHelper<T extends IWidget = IWidget>{
    Create: (o: IObject3D)=>T,
    Check: (o: IObject3D)=>boolean,
}

/**
 * Automatically creates and manages helper widgets for lights, cameras, lines, and skeletons.
 * Lights and cameras get a round icon that keeps its size in pixels and is drawn on top ({@link showIcons},
 * {@link iconSize}, {@link iconMode}); a click on it selects the light or the camera. Each kind of light and camera has
 * its own colour for its icon and lines ({@link widgetKinds}).
 * The widgets are not tone mapped (`toneMapped: false`): their pixels write only their GBuffer flags, so the plugin
 * depends on {@link GBufferPlugin} and adds it to the viewer. Without the GBuffer flags, the tone mapping applies to all
 * pixels.
 * Custom widget types can be registered via the `helpers` array.
 * See https://threepipe.org/notes/widgets-and-helpers for the full widget system documentation.
 * @category Plugins
 */
export class Object3DWidgetsPlugin extends AViewerPluginSync {
    @onChange(Object3DWidgetsPlugin.prototype.setDirty)
        enabled = true
    public static readonly PluginType = 'Object3DWidgetsPlugin'

    /** The GBuffer flags keep the colours of the widgets out of the tone mapping (see the class docs) */
    dependencies = [GBufferPlugin]

    helpers: IObject3DHelper[] = [
        DirectionalLightHelper2,
        SpotLightHelper2,
        PointLightHelper2,
        CameraHelper2,
        LineHelper,
        SkeletonHelper2,
        // BoneHelper,
    ]

    /** Show the icons of lights and cameras */
    @onChange(Object3DWidgetsPlugin.prototype._optionsChanged)
        showIcons = true

    /** The diameter of the icons of lights and cameras, in CSS pixels */
    @onChange(Object3DWidgetsPlugin.prototype._optionsChanged)
        iconSize = 22

    /**
     * How the icons of lights and cameras are drawn. Changing it switches all icons at once.
     * - `dom` (default): SVG elements in a layer over the canvas ({@link WidgetIconOverlay}). Sharp at any pixel ratio,
     * and never in a render, screenshot or recording of the canvas. Not seen in WebXR; without a viewer container in a
     * page (an offscreen canvas) the icons are sprites.
     * - `sprite`: quads in the scene that face the camera ({@link WidgetIcon}), drawn at about one texel per device pixel.
     * Seen in WebXR and with an offscreen canvas, and part of a render or screenshot of the canvas.
     */
    @onChange(Object3DWidgetsPlugin.prototype._optionsChanged)
        iconMode: WidgetIconMode = 'dom'

    /** Draw the frustum of the shadow camera of directional and spot lights that cast shadows */
    @onChange(Object3DWidgetsPlugin.prototype._optionsChanged)
        showShadowFrustum = false

    setDirty() {
        this.widgets?.forEach(w => w.visible = !this.isDisabled())
        this._viewer?.setDirty()
    }

    protected _optionsChanged() {
        this._updateIconOverlay()
        this.widgets?.forEach(w => this._applyOptions(w))
        this._viewer?.setDirty()
    }

    protected _applyOptions(w: IWidget) {
        if (!(w instanceof AHelperWidget)) return
        w.batchUpdate(() => { // one update for all the options
            w.showIcon = this.showIcons
            w.iconSize = this.iconSize
            w.iconMode = this._iconOverlay ? 'dom' : 'sprite'
            if (w instanceof ALightHelperWidget) w.showShadowFrustum = this.showShadowFrustum
        })
    }

    toJSON: any = null
    inSceneRoot = false

    constructor(enabled = true, inSceneRoot = false) {
        super()
        this.enabled = enabled
        this.inSceneRoot = inSceneRoot
    }

    private _widgetRoot = new Group2()

    private _iconOverlay?: WidgetIconOverlay

    /** The DOM layer of the icons, while {@link iconMode} is `dom` and the plugin is added to a viewer in a page */
    get iconOverlay(): WidgetIconOverlay | undefined {
        return this._iconOverlay
    }

    private _viewerResize = ()=> this._iconOverlay?.invalidateViewport()

    /** Makes or removes the DOM layer of the icons for {@link iconMode} */
    protected _updateIconOverlay() {
        const viewer = this._viewer
        const dom = !!viewer && this.iconMode === 'dom' && typeof document !== 'undefined' && !!viewer.container?.appendChild
        if (dom && !this._iconOverlay) {
            this._iconOverlay = new WidgetIconOverlay({
                click: this._iconClick,
                canClick: w => !!this._iconPicker(w),
                hover: this._iconHover,
            })
            this._iconOverlay.attach(viewer.container, viewer.canvas)
        } else if (!dom && this._iconOverlay) {
            this._iconOverlay.dispose()
            this._iconOverlay = undefined
        }
    }

    /**
     * The picker of the PickingPlugin, when a click on the DOM icon of `widget` can select its object: the same check as
     * a ray hit on a sprite icon, the picker's `selectableFor` (its selection condition, `userSelectable`,
     * `bboxVisible`), on the widget
     */
    private _iconPicker(widget: AHelperWidget) {
        const picking = this._viewer?.getPlugin<PickingPlugin>('PickingPlugin')
        if (!picking || !widget.object || picking.isDisabled()) return undefined
        const picker = picking.picker
        return picker?.selectableFor(widget) === widget ? picker : undefined
    }

    /** A hit on the widget at its position, as a ray hit on its sprite icon gives (mapped to the object by the picking) */
    private _iconHit(widget: AHelperWidget): HitIntersects | null {
        const camera = this._viewer?.scene.renderCamera // the camera the icons are placed with
        if (!camera) return null
        const point = new Vector3().setFromMatrixPosition(widget.matrixWorld)
        const ndc = point.clone().project(camera)
        const intersect = {object: widget as IObject3D, point, distance: point.distanceTo(camera.getWorldPosition(new Vector3()))}
        return {selectedObject: widget as IObject3D, intersect, intersects: [intersect], mouse: new Vector2(ndc.x, ndc.y)}
    }

    /**
     * A click on a DOM icon picks the widget as a click on its sprite icon does: the hit goes through the picker's
     * `selectHit` (the `hitObject` event, which maps the widget to its object and can consume the click, the picking
     * mode, multi-select with shift, ctrl or cmd, undo)
     */
    private _iconClick = (widget: AHelperWidget, e: MouseEvent) => {
        const picker = this._iconPicker(widget)
        const hit = picker && this._iconHit(widget)
        if (picker && hit) picker.selectHit(hit, e)
    }

    /** The pointer on a DOM icon hovers the object as on a sprite icon (the picker's `hoverHit`, when hover is on) */
    private _iconHover = (widget: AHelperWidget | null) => {
        const picker = widget ? this._iconPicker(widget) : this._viewer?.getPlugin<PickingPlugin>('PickingPlugin')?.picker
        if (!picker?.hoverEnabled) return
        picker.hoverHit(widget && picker ? this._iconHit(widget) : null)
    }

    private _modelRoot?: IObject3D

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._widgetRoot.userData.isWidgetRoot = true
        this._widgetRoot.name = 'Widgets Root'
        this._modelRoot = this.inSceneRoot ? viewer.scene : viewer.scene.modelRoot

        viewer.scene.addObject(this._widgetRoot, {addToRoot: true, autoScale: false, autoCenter: false})
        viewer.renderManager.addEventListener('resize', this._viewerResize)
        this._updateIconOverlay()

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
        this._iconOverlay?.dispose()
        this._iconOverlay = undefined
        viewer.renderManager.removeEventListener('resize', this._viewerResize)
        this._widgetRoot.removeFromParent()
        this._widgetRoot.clear()
        super.onRemove(viewer)
    }

    refreshObject = (object?: IObject3D)=>{
        const r = this._createWidget(object)
        if (!r) {
            this._removeWidget(object)
        }
    }

    protected _viewerListeners: PartialRecord<IViewerEventTypes, (e: IViewerEvent)=>void> = {
        preRender: ()=>{
            this.widgets.forEach(w => w.preRender && w.preRender())
        },
        // the camera of the render, which the sprites and the lines are drawn with
        postRender: ()=>{
            if (this._iconOverlay && this._viewer) this._iconOverlay.update(this.widgets, this._viewer.scene.renderCamera)
        },
        // a change that can change which DOM icons can be selected: the picking plugin, its options, the selection
        update: ()=> this._iconOverlay?.invalidateClickable(),
        addPlugin: ()=> this._iconOverlay?.invalidateClickable(),
        removePlugin: ()=> this._iconOverlay?.invalidateClickable(),
    }

    widgets: (IWidget)[] = []

    private _widgetDisposed = (e: IEvent<any>)=> this._unregisterWidget(e.target)

    private _registerWidget(w: IWidget) {
        this.widgets.push(w)
        w.addEventListener('dispose', this._widgetDisposed) // todo: maybe unregister when removed from parent, dispose makes little sense.
    }
    private _unregisterWidget(w: IWidget) {
        w.removeEventListener('dispose', this._widgetDisposed)
        if (w instanceof AHelperWidget) this._iconOverlay?.removeIcon(w) // now, not at the next render
        const i = this.widgets.indexOf(w)
        if (i >= 0) this.widgets.splice(i, 1)
    }

    private _createWidget(o?: IObject3D) {
        if (!o || o.assetType === 'widget' || o === this._widgetRoot || o.isWidget) {
            return false
        }
        if (o.userData.disableWidgets) return false
        let ignored = false
        let inSceneRoot = false
        o.traverseAncestors(c=> {
            ignored = ignored
                || c === this._widgetRoot || !!c.isWidget || c.assetType === 'widget' // inside a widget
                || !!c.userData.disableWidgets
            inSceneRoot = inSceneRoot || c === this._modelRoot
        })
        if (ignored) return false
        if (!inSceneRoot) return false

        const widget = this.widgets.find(w => w.object === o)
        if (widget) {
            widget.update && widget.update()
            return true
        }
        const helpers = this.helpers.filter(h => h.Check(o))
        for (const h of helpers) {
            const w = h.Create(o)
            this._applyOptions(w)
            w.visible = !this.isDisabled()
            this._widgetRoot.add(w)
            this._registerWidget(w)
        }
        return true
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
            {
                type: 'checkbox',
                label: 'Show icons',
                property: [this, 'showIcons'],
            },
            {
                type: 'dropdown',
                label: 'Icon mode',
                property: [this, 'iconMode'],
                children: [
                    {label: 'DOM', value: 'dom'},
                    {label: 'Sprite', value: 'sprite'},
                ],
            },
            {
                type: 'slider',
                label: 'Icon size (px)',
                bounds: [8, 64],
                stepSize: 1,
                property: [this, 'iconSize'],
            },
            {
                type: 'checkbox',
                label: 'Shadow frustum',
                property: [this, 'showShadowFrustum'],
            },
        ],
    }
}
