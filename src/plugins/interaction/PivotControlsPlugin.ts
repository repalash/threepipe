import {uiConfig, uiDropdown, uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from './PickingPlugin'
import {JSUndoManager, onChange} from 'ts-browser-helpers'
import {OrbitControls3} from '../../three'
import {PivotControls} from '../../three/controls/PivotControls'
import {
    ICamera,
    IObject3D,
    iObjectCommons,
    IWidget,
    UnlitLineMaterial,
    UnlitMaterial,
} from '../../core'
import {Euler, Object3D, Vector3} from 'three'
import {MultiSelectHelper} from './MultiSelectHelper'
import type {UndoManagerPlugin} from './UndoManagerPlugin'

/**
 * PivotControlsPlugin adds drei-style pivot controls to the viewer.
 * Unlike TransformControls which shows one mode at a time, PivotControls
 * displays all handles simultaneously: translation arrows, plane sliders,
 * rotation arcs, and scaling spheres.
 *
 * Integrates with PickingPlugin for object selection and UndoManagerPlugin
 * for undo/redo support.
 *
 * @category Plugins - Interaction
 */
@uiFolderContainer('Pivot Controls')
export class PivotControlsPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'PivotControlsPlugin'

    @uiToggle()
    @onChange(PivotControlsPlugin.prototype.setDirty)
        enabled = true

    setDirty() {
        if (!this._viewer) return
        const picking = this._viewer.getPlugin(PickingPlugin)!
        const enabled = !this.isDisabled()
        if (this.pivotControls) {
            if (!enabled) {
                this.pivotControls.detach()
                this._multi.clear(this._viewer!)
            } else {
                const objects = picking.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
                if (objects.length > 1) {
                    this.pivotControls.attach(this._multi.setup(objects, this._viewer!))
                } else if (objects.length === 1) {
                    this._multi.clear(this._viewer!)
                    this.pivotControls.attach(objects[0])
                } else {
                    this._multi.clear(this._viewer!)
                    this.pivotControls.detach()
                }
            }
        }
        this._viewer.setDirty()
    }

    constructor(enabled = true) {
        super()
        PivotControls.ObjectConstructors.MeshBasicMaterial = UnlitMaterial as any
        PivotControls.ObjectConstructors.LineBasicMaterial = UnlitLineMaterial as any
        this.enabled = enabled
    }

    toJSON: any = undefined

    dependencies = [PickingPlugin]

    @uiConfig(undefined, {expanded: true})
        pivotControls: PivotControls2 | undefined

    protected _isInteracting = false
    protected _viewerListeners = {
        preFrame: () => {
            if (!this.pivotControls || !this._viewer) return
            this.pivotControls.updateGizmoScale()
        },
    }

    private _transformState = {
        obj: null as Object3D | null,
        position: new Vector3(),
        rotation: new Euler(),
        scale: new Vector3(),
    }
    undoManager?: JSUndoManager

    private _multi = new MultiSelectHelper()

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.setDirty()
        this.pivotControls = new PivotControls2(viewer.scene.mainCamera, viewer.canvas)
        this._mainCameraChange = this._mainCameraChange.bind(this)
        viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)

        this.pivotControls.addEventListener('dragging-changed', (event) => {
            if (!this?._viewer) return
            const controls = this._viewer.scene.mainCamera.controls
            if (typeof (controls as any)?.stopDamping === 'function' && controls?.enabled) (controls as OrbitControls3).stopDamping()
            this._viewer.scene.mainCamera.setInteractions(!event.value, PivotControlsPlugin.PluginType)
        })

        this.pivotControls.addEventListener('change', () => {
            if (!this?._viewer) return
            this._viewer.setDirty()
        })

        viewer.scene.addObject(this.pivotControls as any, {addToRoot: true})

        const picking = viewer.getPlugin(PickingPlugin)!
        picking.addEventListener('selectedObjectChanged', (event) => {
            if (!this.pivotControls) return
            if (this.isDisabled()) {
                if (this.pivotControls.object) this.pivotControls.detach()
                this._multi.clear(this._viewer!)
                return
            }
            const objects = (event.objects || []).filter((o: any) => o?.isObject3D) as IObject3D[]
            if (objects.length > 1) {
                this.pivotControls.attach(this._multi.setup(objects, this._viewer!))
            } else if (event.object) {
                this._multi.clear(this._viewer!)
                const obj: IObject3D | null = event.intersects?.selectedHandle ?? event.intersects?.selectedObject ?? event.object
                if (!obj || !obj.isObject3D) {
                    this.pivotControls.detach()
                    return
                }
                this.pivotControls.attach(obj)
            } else {
                this._multi.clear(this._viewer!)
                this.pivotControls.detach()
            }
        })

        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um) => {
            this.undoManager = um.undoManager
        }, () => this.undoManager = undefined, this)

        this.pivotControls.addEventListener('mouseDown', () => {
            if (!this.pivotControls) return
            if (this._multi.hasMultiSelect) {
                this._multi.captureStart()
                return
            }
            const object = this.pivotControls.object
            if (!object) return
            this._transformState.obj = object
            this._transformState.position = object.position.clone()
            this._transformState.rotation = object.rotation.clone()
            this._transformState.scale = object.scale.clone()
        })

        this.pivotControls.addEventListener('objectChange', () => {
            if (this._multi.hasMultiSelect) this._multi.applyDelta()
        })

        this.pivotControls.addEventListener('mouseUp', (event) => {
            if (!this.pivotControls) return
            if (this._multi.hasMultiSelect && this._multi.hasStartStates) {
                if (this.undoManager) this._multi.recordUndo(this.undoManager)
                if (this._viewer) this._multi.recordDuplicateMove(this._viewer)
                return
            }
            const object = this.pivotControls.object
            if (!object) return
            if (this._transformState.obj !== object || !this.undoManager) return

            const mode = event.mode
            const key = ({
                translate: 'position',
                rotate: 'rotation',
                scale: 'scale',
            } as const)[mode as 'translate' | 'rotate' | 'scale']
            if (!key) return
            if (this._transformState[key].equals(object[key] as any)) return

            // Record smart duplicate move delta for translate operations
            if (key === 'position') {
                const delta = object.position.clone().sub(this._transformState.position)
                this._viewer?.getPlugin(PickingPlugin)
                    ?.recordDuplicateMove(object as IObject3D, delta)
            }

            const command = {
                last: this._transformState[key].clone(),
                current: object[key].clone(),
                set: (value: any) => {
                    object[key].copy(value)
                    object.updateMatrixWorld(true)
                    this.pivotControls?.dispatchEvent({type: 'change'})
                    this.pivotControls?.dispatchEvent({type: 'objectChange'})
                },
                undo: () => command.set(command.last),
                redo: () => command.set(command.current),
            }
            this.undoManager.record(command)
        })
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        this._multi.clear(viewer)
        if (this.pivotControls) {
            this.pivotControls.detach()
            viewer.scene.remove(this.pivotControls as any)
            this.pivotControls.dispose()
        }
        this.pivotControls = undefined
        super.onRemove(viewer)
    }

    private _mainCameraChange = () => {
        if (!this.pivotControls || !this._viewer) return
        this.pivotControls.camera = this._viewer.scene.mainCamera
    }
}

/**
 * Extended PivotControls implementing threepipe's IWidget interface.
 */
@uiFolderContainer('Pivot Controls')
export class PivotControls2 extends PivotControls implements IWidget, IObject3D {
    isWidget = true as const
    assetType = 'widget' as const
    setDirty = iObjectCommons.setDirty.bind(this)
    refreshUi = iObjectCommons.refreshUi.bind(this)

    declare object: IObject3D | undefined

    constructor(camera: ICamera, canvas: HTMLCanvasElement) {
        super(camera, canvas)
        this.visible = false
        this.userData.bboxVisible = false

        this.addEventListener('objectChange', () => {
            this?.object?.setDirty && this.object.setDirty({frameFade: false, change: 'transform'})
        })
        this.addEventListener('change', () => {
            this.setDirty({frameFade: false})
        })

        this.traverse(c => {
            c.castShadow = false
            c.receiveShadow = false
            c.userData.__keepShadowDef = true
        })
    }

    // region UI properties

    @uiDropdown('Space', ['world', 'local'].map(label => ({label})))
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare space: 'world' | 'local'

    @uiSlider('Gizmo Scale', [0.1, 10], 0.01)
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare gizmoScale: number

    @uiToggle('Fixed Size')
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare fixed: boolean

    @uiToggle('Depth Test')
    @onChange(PivotControls2.prototype._onRebuild)
    declare depthTest: boolean

    @uiToggle('Annotations')
    declare annotations: boolean

    @uiSlider('Translation Snap', [0.01, 5], 0.01)
    declare translationSnap: number | null

    @uiSlider('Rotation Snap (deg)', [1, 90], 1)
    declare rotationSnap: number | null

    @uiSlider('Scale Snap', [0.01, 1], 0.01)
    declare scaleSnap: number | null

    @uiToggle('Uniform Scale (Alt)')
    declare uniformScaleEnabled: boolean

    @uiToggle('Disable Axes')
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare disableAxes: boolean

    @uiToggle('Disable Sliders')
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare disableSliders: boolean

    @uiToggle('Disable Rotations')
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare disableRotations: boolean

    @uiToggle('Disable Scaling')
    @onChange(PivotControls2.prototype._onVisibilityChange)
    declare disableScaling: boolean

    // endregion

    private _onVisibilityChange(): void {
        this.updateHandleVisibility()
        if (this.setDirty) this.setDirty({frameFade: false})
    }

    private _onRebuild(): void {
        if (!this.domElement) return
        this.rebuild()
        if (this.setDirty) this.setDirty({frameFade: false})
    }

    /**
     * @deprecated use object directly
     */
    get modelObject(): this {
        return this as any
    }

    // region inherited type fixes
    declare traverse: (callback: (object: IObject3D) => void) => void
    declare traverseVisible: (callback: (object: IObject3D) => void) => void
    declare traverseAncestors: (callback: (object: IObject3D) => void) => void
    declare getObjectById: (id: number) => IObject3D | undefined
    declare getObjectByName: (name: string) => IObject3D | undefined
    declare getObjectByProperty: (name: string, value: string) => IObject3D | undefined
    declare parent: IObject3D | null
    declare children: IObject3D[]
    // endregion
}
