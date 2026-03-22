import {uiButton, uiColor, uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from './PickingPlugin'
import {JSUndoManager, onChange} from 'ts-browser-helpers'
import {OrbitControls3, TransformControls} from '../../three'
import {Group2, IObject3D, IWidget, UnlitLineMaterial, UnlitMaterial} from '../../core'
import {Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3} from 'three'
import type {UndoManagerPlugin} from './UndoManagerPlugin'
import type {TransformControlsPlugin} from './TransformControlsPlugin'
import type {PivotControlsPlugin} from './PivotControlsPlugin'
import {Box3B} from '../../three/math/Box3B'

// eslint-disable-next-line @typescript-eslint/naming-convention
const _pos = new Vector3()
// eslint-disable-next-line @typescript-eslint/naming-convention
const _camPos = new Vector3()

/**
 * PivotEditPlugin provides interactive pivot point (origin) editing for objects.
 * Toggle "Edit Pivot" mode to show a translate-only gizmo at the object's pivot.
 * Dragging moves only the pivot while the object mesh stays visually in place.
 *
 * Works alongside both TransformControlsPlugin and PivotControlsPlugin.
 *
 * @category Plugins - Interaction
 */
@uiFolderContainer('Pivot Edit')
export class PivotEditPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'PivotEditPlugin'

    dependencies = [PickingPlugin]

    @uiToggle()
    @onChange(PivotEditPlugin.prototype._onEnabledChange)
        enabled = true

    @uiToggle('Edit Pivot')
    @onChange(PivotEditPlugin.prototype._onEditPivotChange)
        editPivot = false

    @uiToggle('Show Pivot Marker')
    @onChange(PivotEditPlugin.prototype._onDirty)
        showPivotMarker = true

    @uiSlider('Marker Scale', [0.1, 5], 0.1)
    @onChange(PivotEditPlugin.prototype._onDirty)
        markerScale = 0.5

    @uiColor('Marker Color')
    @onChange(PivotEditPlugin.prototype._onMarkerColorChange)
        markerColor = 0xffff00

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    toJSON: any = undefined

    private _pivotGizmo: TransformControls | null = null
    private _markerRoot: Group2 | null = null // assetType='model' root for raycasting
    private _markerWidget: (Group2 & IWidget) | null = null // assetType='widget' wrapper for handle resolution
    private _pivotMarker: Mesh<SphereGeometry, MeshBasicMaterial> | null = null
    private _selectedObject: IObject3D | null = null
    undoManager?: JSUndoManager

    protected _viewerListeners = {
        preFrame: () => this._updateMarker(),
    }

    private _onKeyDown: ((e: KeyboardEvent) => void) | null = null

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        const picking = viewer.getPlugin(PickingPlugin)!

        // Intercept pivot marker clicks before selection happens.
        // hitObject fires before setSelected, so setting selectedObject to the
        // current selection prevents any selection change — no other plugin sees the click.
        picking.addEventListener('hitObject', (event) => {
            if (event.intersects?.selectedHandle?.userData.isPivotMarker) {
                // Mark consumed so the picker skips selection changes for this click
                event.intersects.consumed = true
                this.editPivot = !this.editPivot
                this._onEditPivotChange()
            }
        })

        picking.addEventListener('selectedObjectChanged', (event) => {
            const newObject = event.object as IObject3D | null
            const objectChanged = newObject !== this._selectedObject
            this._selectedObject = newObject
            if (this._markerWidget) this._markerWidget.object = this._selectedObject
            // Exit edit mode on object change or deselection
            if (this.editPivot && objectChanged) {
                this.editPivot = false
                this._onEditPivotChange()
            }
            this._updateMarker()
        })

        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um) => {
            this.undoManager = um.undoManager
        }, () => this.undoManager = undefined, this)

        this._onKeyDown = (event: KeyboardEvent) => {
            if (this.isDisabled()) return
            if (event.metaKey || event.ctrlKey) return
            if ((event.target as any)?.tagName === 'TEXTAREA' || (event.target as any)?.tagName === 'INPUT') return
            if (event.code === 'KeyP') {
                this.editPivot = !this.editPivot
                this._onEditPivotChange()
            } else if (event.code === 'Escape' && this.editPivot) {
                this.editPivot = false
                this._onEditPivotChange()
            }
        }
        window.addEventListener('keydown', this._onKeyDown)

        // Create pivot marker as a widget handle, pickable via PickingPlugin.
        // Structure: _markerRoot (Group2, assetType='model', isWidgetRoot)
        //            └── _markerWidget (Group, assetType='widget', object=selectedObject)
        //                └── _pivotMarker (Mesh, isWidgetHandle, isPivotMarker)
        const mat = new MeshBasicMaterial({
            color: this.markerColor, depthTest: false, depthWrite: false,
            toneMapped: false, transparent: true, opacity: 0.9,
        })
        this._pivotMarker = new Mesh(new SphereGeometry(1, 8, 8), mat)
        this._pivotMarker.renderOrder = 1000
        this._pivotMarker.userData.isWidgetHandle = true
        this._pivotMarker.userData.isPivotMarker = true

        const markerWidget = new Group2() as Group2 & IWidget
        markerWidget.isWidget = true as const
        markerWidget.assetType = 'widget' as const
        markerWidget.object = this._selectedObject
        markerWidget.attach = (obj: any) => { markerWidget.object = obj; return markerWidget }
        markerWidget.detach = () => { markerWidget.object = undefined; return markerWidget }
        this._markerWidget = markerWidget
        this._markerWidget.add(this._pivotMarker)

        this._markerRoot = new Group2()
        this._markerRoot.userData.isWidgetRoot = true
        this._markerRoot.add(this._markerWidget)
        this._markerRoot.visible = false

        this._markerRoot.traverse(c => {
            c.castShadow = false
            c.receiveShadow = false
            c.userData.__keepShadowDef = true
        })
        viewer.scene.addObject(this._markerRoot, {addToRoot: true})
    }

    onRemove(viewer: ThreeViewer) {
        if (this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown)
            this._onKeyDown = null
        }
        this._destroyGizmo(viewer)
        if (this._markerRoot) {
            viewer.scene.remove(this._markerRoot)
            if (this._pivotMarker) {
                this._pivotMarker.geometry.dispose()
                this._pivotMarker.material.dispose()
            }
            this._markerRoot = null
            this._markerWidget = null
            this._pivotMarker = null
        }
        super.onRemove(viewer)
    }

    // ========================================================================
    // Presets
    // ========================================================================

    @uiButton('Pivot to Center')
    pivotToCenter(): void {
        if (!this._selectedObject?.pivotToBoundsCenter) return
        this._recordUndo(this._selectedObject.pivotToBoundsCenter(true))
        this._refreshAfterPivotChange()
    }

    @uiButton('Pivot to Bottom')
    pivotToBottom(): void {
        if (!this._selectedObject?.pivotToPoint) return
        const bb = new Box3B().expandByObject(this._selectedObject, true, true)
        const center = bb.getCenter(new Vector3())
        this._applyPivot(new Vector3(center.x, bb.min.y, center.z))
    }

    @uiButton('Pivot to Origin')
    pivotToOrigin(): void {
        this._applyPivot(new Vector3(0, 0, 0))
    }

    pivotToPoint(point: Vector3): void {
        this._applyPivot(point)
    }

    private _applyPivot(target: Vector3): void {
        if (!this._selectedObject?.pivotToPoint) return
        const undoFn = (this._selectedObject.pivotToPoint(target, true) as unknown) as () => void
        this._recordUndo(undoFn)
        this._refreshAfterPivotChange()
    }

    // ========================================================================
    // Marker
    // ========================================================================

    private _updateMarker(): void {
        if (!this._markerRoot || !this._pivotMarker || !this._viewer) return
        if (this.isDisabled() || !this.showPivotMarker || !this._selectedObject) {
            this._markerRoot.visible = false
            return
        }
        this._selectedObject.updateWorldMatrix(true, false)
        _pos.setFromMatrixPosition(this._selectedObject.matrixWorld)
        this._markerRoot.position.copy(_pos)
        this._markerRoot.visible = true

        // Constant screen-size (same formula as TransformControls)
        const camera = this._viewer.scene.mainCamera as any
        let factor: number
        if (camera.isOrthographicCamera) {
            factor = (camera.top - camera.bottom) / camera.zoom
        } else {
            _camPos.setFromMatrixPosition(camera.matrixWorld)
            factor = _pos.distanceTo(_camPos) *
                Math.min(1.9 * Math.tan(Math.PI * camera.fov / 360) / camera.zoom, 7)
        }
        this._pivotMarker.scale.setScalar(factor * this.markerScale * 0.05)
    }

    // ========================================================================
    // Gizmo
    // ========================================================================

    private _onEditPivotChange(): void {
        if (!this._viewer) return
        if (this.editPivot) this._attachGizmo()
        else this._detachGizmo()
        this._viewer.setDirty()
    }

    private _attachGizmo(): void {
        if (!this._viewer || !this._selectedObject) return
        this._setTransformControlsEnabled(false)

        if (!this._pivotGizmo) {
            TransformControls.ObjectConstructors.MeshBasicMaterial = UnlitMaterial as any
            TransformControls.ObjectConstructors.LineBasicMaterial = UnlitLineMaterial as any
            this._pivotGizmo = new TransformControls(this._viewer.scene.mainCamera, this._viewer.canvas)
            this._pivotGizmo.setMode('translate')
            this._pivotGizmo.userData.bboxVisible = false
            this._pivotGizmo.visible = false
            this._pivotGizmo.traverse(c => {
                c.castShadow = false
                c.receiveShadow = false
                c.userData.__keepShadowDef = true
            })

            this._pivotGizmo.addEventListener('mouseUp', () => {
                if (!this._selectedObject?.pivotToPoint || !this._pivotGizmo?.object) return
                const newPos = new Vector3().setFromMatrixPosition(this._pivotGizmo.object.matrixWorld)
                const undoFn = (this._selectedObject.pivotToPoint(newPos, true) as unknown) as () => void
                this._recordUndo(undoFn)
                // Update dummy position to the new pivot (pivotToPoint moved the object's origin)
                this._refreshAfterPivotChange()
            })

            this._pivotGizmo.addEventListener('change', () => {
                if (this._viewer) this._viewer.setDirty()
            })

            this._pivotGizmo.addEventListener('dragging-changed', (event: any) => {
                if (!this._viewer) return
                const controls = this._viewer.scene.mainCamera.controls
                if (typeof (controls as any)?.stopDamping === 'function' && controls?.enabled) (controls as OrbitControls3).stopDamping()
                this._viewer.scene.mainCamera.setInteractions(!event.value, PivotEditPlugin.PluginType)
            })

            this._viewer.scene.addObject(this._pivotGizmo as any, {addToRoot: true})
        }

        this._selectedObject.updateWorldMatrix(true, false)
        const pivotPos = new Vector3().setFromMatrixPosition(this._selectedObject.matrixWorld)

        if (!this._pivotGizmo.object) {
            const dummy = new Object3D()
            dummy.position.copy(pivotPos)
            this._viewer.scene.addObject(dummy as any, {addToRoot: true})
            this._pivotGizmo.attach(dummy)
        } else {
            this._pivotGizmo.object.position.copy(pivotPos)
            this._pivotGizmo.object.updateMatrixWorld(true)
        }
    }

    private _detachGizmo(): void {
        if (this._pivotGizmo) {
            const dummy = this._pivotGizmo.object
            this._pivotGizmo.detach()
            if (dummy && this._viewer) this._viewer.scene.remove(dummy)
        }
        this._setTransformControlsEnabled(true)
    }

    private _destroyGizmo(viewer: ThreeViewer): void {
        if (!this._pivotGizmo) return
        this._detachGizmo()
        viewer.scene.remove(this._pivotGizmo as any)
        this._pivotGizmo.dispose()
        this._pivotGizmo = null
    }

    private _setTransformControlsEnabled(enabled: boolean): void {
        if (!this._viewer) return
        const tcp = this._viewer.getPlugin<TransformControlsPlugin>('TransformControlsPlugin')
        if (tcp) {
            if (enabled) tcp.setDirty()
            else tcp.transformControls?.detach()
        }
        const pcp = this._viewer.getPlugin<PivotControlsPlugin>('PivotControlsPlugin')
        if (pcp) {
            if (enabled) pcp.setDirty()
            else pcp.pivotControls?.detach()
        }
    }

    private _onEnabledChange(): void {
        if (this.isDisabled() && this.editPivot) {
            this.editPivot = false
            this._onEditPivotChange()
        }
        this._updateMarker()
        if (this._viewer) this._viewer.setDirty()
    }

    private _refreshAfterPivotChange(): void {
        if (!this._viewer) return
        if (this.editPivot && this._selectedObject && this._pivotGizmo?.object) {
            this._selectedObject.updateWorldMatrix(true, false)
            this._pivotGizmo.object.position.setFromMatrixPosition(this._selectedObject.matrixWorld)
            this._pivotGizmo.object.updateMatrixWorld(true)
        }
        this._updateMarker()
        this._viewer.setDirty()
    }

    private _onDirty(): void {
        if (this._viewer) this._viewer.setDirty()
    }

    private _onMarkerColorChange(): void {
        if (this._pivotMarker) this._pivotMarker.material.color.set(this.markerColor)
        if (this._viewer) this._viewer.setDirty()
    }

    // ========================================================================
    // Undo
    // ========================================================================

    private _recordUndo(undoFn: () => void): void {
        if (!this.undoManager || !this._selectedObject) return
        const obj = this._selectedObject
        obj.updateWorldMatrix(true, false)
        const newPivotPos = new Vector3().setFromMatrixPosition(obj.matrixWorld)

        this.undoManager.record({
            undo: () => {
                undoFn()
                this._refreshAfterPivotChange()
            },
            redo: () => {
                if (obj.pivotToPoint) {
                    obj.pivotToPoint(newPivotPos, true)
                    this._refreshAfterPivotChange()
                }
            },
        })
    }
}
