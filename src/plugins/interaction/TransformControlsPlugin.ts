import {uiButton, uiConfig, uiPanelContainer, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {OrbitControls3, TransformControls2} from '../../three'
import {PickingPlugin} from './PickingPlugin'
import {JSUndoManager, onChange} from 'ts-browser-helpers'
import {TransformControls} from '../../three/controls/TransformControls'
import {IObject3D, UnlitLineMaterial, UnlitMaterial} from '../../core'
import {Euler, Object3D, Vector3} from 'three'
import type {UndoManagerPlugin} from './UndoManagerPlugin'

@uiPanelContainer('Transform Controls')
export class TransformControlsPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'TransformControlsPlugin'

    @uiToggle()
    @onChange(TransformControlsPlugin.prototype.setDirty)
        enabled = true

    private _pickingWidgetDisabled = false
    setDirty() { // todo rename to refresh or setEnabledDirty?
        if (!this._viewer) return
        const picking = this._viewer.getPlugin(PickingPlugin)!
        const enabled = !this.isDisabled()
        if (enabled && picking.widgetEnabled) {
            picking.widgetEnabled = false
            this._pickingWidgetDisabled = true
        } else if (!enabled && this._pickingWidgetDisabled) {
            picking.widgetEnabled = true
            this._pickingWidgetDisabled = false
        }
        if (this.transformControls) {
            if (enabled && picking.getSelectedObject<IObject3D>()?.isObject3D) this.transformControls.attach(picking.getSelectedObject<IObject3D>()!)
            else this.transformControls.detach()
        }
        this._viewer.setDirty()
    }

    constructor(enabled = true) {
        super()
        TransformControls.ObjectConstructors.MeshBasicMaterial = UnlitMaterial as any
        TransformControls.ObjectConstructors.LineBasicMaterial = UnlitLineMaterial as any
        this.enabled = enabled
    }

    toJSON: any = undefined

    dependencies = [PickingPlugin]

    @uiConfig(undefined, {expanded: true})
        transformControls: TransformControls2 | undefined

    protected _isInteracting = false
    protected _viewerListeners = {
        postFrame: ()=>{
            if (!this.transformControls || !this._viewer) return
            // this._viewer.scene.mainCamera.setInteractions(!this._isInteracting, TransformControlsPlugin.PluginType)
        },
    }

    private _transformState = {
        obj: null as Object3D|null,
        position: new Vector3(),
        rotation: new Euler(),
        scale: new Vector3(),
    }
    undoManager?: JSUndoManager

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.setDirty()
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
            if (this.isDisabled()) {
                if (this.transformControls.object) this.transformControls.detach()
                return
            }
            if (event.object) {
                const obj = event.intersects?.selectedHandle ?? event.intersects?.selectedObject ?? event.object
                this.transformControls.attach(obj)
            } else {
                this.transformControls.detach()
            }
        })

        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=> {
            this.undoManager = um.undoManager
        }, ()=> this.undoManager = undefined, this)

        // same logic for undo as three.js editor. todo It can be made better by syncing with the UI so it supports the hotkeys and other properties inside TransformControls2
        this.transformControls.addEventListener('mouseDown', ()=> {
            if (!this.transformControls) return
            const object = this.transformControls.object
            if (!object) return

            this._transformState.obj = object
            this._transformState.position = object.position.clone()
            this._transformState.rotation = object.rotation.clone()
            this._transformState.scale = object.scale.clone()
        })

        this.transformControls.addEventListener('mouseUp', ()=> {
            if (!this.transformControls) return
            const object = this.transformControls.object
            if (!object) return

            if (this._transformState.obj !== object || !this.undoManager) return

            const key = ({
                'translate': 'position',
                'rotate': 'rotation',
                'scale': 'scale',
            } as const)[this.transformControls.getMode()]
            if (!key) return
            if (this._transformState[key].equals(object[key] as any)) return

            const command = {
                last: this._transformState[key].clone(), current: object[key].clone(),
                set: (value: any) => {
                    object[key].copy(value)
                    object.updateMatrixWorld(true)
                    this.transformControls?.dispatchEvent({type: 'change'} as any)
                    this.transformControls?.dispatchEvent({type: 'objectChange'} as any)
                },
                undo: () => command.set(command.last),
                redo: () => command.set(command.current),
            }
            this.undoManager.record(command)
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

    @uiButton('Center All Meshes')
    centerAllMeshes() {
        return this._viewer?.scene.centerAllGeometries(true)
    }

}
