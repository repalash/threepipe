import {EventListener2, Object3D, Vector3} from 'three'
import {Class, JSUndoManager, onChange, safeSetProperty, serialize} from 'ts-browser-helpers'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {bindToValue, ObjectPicker} from '../../three'
import {
    deleteObjects,
    duplicateObjects,
    IGeometry,
    IMaterial,
    IObject3D,
    IScene,
    ISceneEventMap,
    ITexture,
    IWidget,
    LineMaterial2,
    PhysicalMaterial,
    UnlitLineMaterial,
    UnlitMaterial,
} from '../../core'
import {UiObjectConfig} from 'uiconfig.js'
import {FrameFadePlugin} from '../pipeline/FrameFadePlugin'
import {type UndoManagerPlugin} from './UndoManagerPlugin'
import {ObjectPickerEventMap, SelectionObject} from '../../three/utils/ObjectPicker'
import {CameraViewPlugin} from '../animation/CameraViewPlugin'
import {DropzonePlugin, DropzonePluginEventMap} from './DropzonePlugin'
import {AssetImporter} from '../../assetmanager'
import {BoxSelectionWidget, SelectionWidget} from '../../three/widgets'
import {DuplicateTracker} from './DuplicateTracker'
import {ObjectClipboard} from './ObjectClipboard'

export interface PickingPluginEventMap extends AViewerPluginEventMap, ObjectPickerEventMap{
}

function getRootIfWidget(selected: IObject3D) {
    while (selected.parent && selected.assetType !== 'widget') {
        if (selected.userData.allowPicking) break // this is diff from userSelectable, its for widgets
        selected = selected.parent
    }
    return selected
}

export class PickingPlugin extends AViewerPluginSync<PickingPluginEventMap> {
    @serialize()
    @onChange(PickingPlugin.prototype.setDirty)
        enabled = true

    get picker(): ObjectPicker|undefined {
        return this._picker
    }
    static readonly PluginType = 'Picking'
    static readonly OldPluginType = 'PickingPlugin' // todo: swap
    private _picker?: ObjectPicker
    private _widget?: SelectionWidget
    private _extraWidgets: SelectionWidget[] = []
    private _selectionWidgetClass?: Class<SelectionWidget>
    private _hoverWidget?: SelectionWidget
    private _pickUi: boolean
    private _clipboard = new ObjectClipboard()
    private _undoManager?: JSUndoManager
    private _duplicateTracker = new DuplicateTracker()

    dependencies = [CameraViewPlugin]

    get hoverEnabled() {
        return this._picker?.hoverEnabled ?? false
    }
    set hoverEnabled(v: boolean) {
        if (!this._picker) return
        this._picker.hoverEnabled = v
        this.uiConfig && this.uiConfig.uiRefresh?.()
    }

    @bindToValue({obj: '_picker', key: 'selectionMode'})
        selectionMode: 'object' | 'material' | 'geometry' | 'texture' = 'object'

    @serialize()
        autoFocus

    // @serialize()  // todo
    autoFocusHover = false

    // @serialize()  // todo
    autoApplyMaterialOnDrop = true

    /**
     * Note: this is for runtime use only, not serialized
     */
    @onChange(PickingPlugin.prototype._widgetEnabledChange)
        widgetEnabled = true

    @bindToValue({obj: '_picker', key: 'multiSelectEnabled'})
        multiSelectEnabled = true

    protected _widgetEnabledChange() {
        if (!this._widget) return
        if (this.widgetEnabled && (this._picker?.selectedObject as IObject3D)?.isObject3D)
            this._widget.attach(this._picker!.selectedObject as IObject3D)
        else
            this._widget.detach()
        this._updateExtraWidgets()
        this.uiConfig?.uiRefresh?.(true)
    }

    private _updateExtraWidgets() {
        if (!this._viewer || !this._selectionWidgetClass) return
        const allSelected = this._picker?.selectedObjects as IObject3D[] || []
        // Extra objects = all selected except the primary (index 0, handled by _widget)
        const extras = allSelected.filter((o, i) => i > 0 && o?.isObject3D)

        // Detach unused extra widgets
        for (let i = extras.length; i < this._extraWidgets.length; i++) {
            this._extraWidgets[i].detach()
        }

        // Create new widgets if needed, attach to objects
        for (let i = 0; i < extras.length; i++) {
            if (!this._extraWidgets[i]) {
                const w = new this._selectionWidgetClass()
                if (w.lineMaterial) {
                    w.lineMaterial.color!.set('#ff8844')
                    w.lineMaterial.opacity = 0.7
                }
                this._extraWidgets.push(w)
                this._viewer.scene.addObject(w, {addToRoot: true})
            }
            if (this.widgetEnabled) this._extraWidgets[i].attach(extras[i])
            else this._extraWidgets[i].detach()
        }
    }

    setDirty() {
        if (!this._viewer) return
        if (this.isDisabled() && this.getSelectedObject()) this.setSelectedObject(undefined)
        this._viewer.setDirty()
    }
    constructor(selection: Class<SelectionWidget>|undefined = BoxSelectionWidget, pickUi = true, autoFocus = false) {
        super()
        this._selectionWidgetClass = selection
        if (selection) {
            this._widget = new selection()
            this._hoverWidget = new selection()
            if (this._hoverWidget.lineMaterial) {
                this._hoverWidget.lineMaterial.linewidth! /= 2
                this._hoverWidget.lineMaterial.color!.set('#aa2222')
            }
        }
        this._pickUi = pickUi
        this.autoFocus = autoFocus
        this.dispatchEvent = this.dispatchEvent.bind(this)

    }

    getSelectedObject<T extends SelectionObject = SelectionObject>(): T|undefined {
        return this._picker?.selectedObject as T || undefined
    }

    getSelectedObjects<T extends SelectionObject = SelectionObject>(): T[] {
        return (this._picker?.selectedObjects || []) as T[]
    }

    toggleSelectedObject(object: SelectionObject) {
        if (!this._picker || this.isDisabled() || !object || !this.multiSelectEnabled) return
        const current = [...this._picker.selectedObjects] as any[]
        const idx = current.indexOf(object)
        if (idx >= 0) {
            current.splice(idx, 1)
        } else {
            current.unshift(object) // last clicked = primary (index 0)
        }
        this._picker.setSelected(current.length ? current.length === 1 ? current[0] : current : null, true)
    }

    selectAll() {
        if (!this._picker || !this._viewer || this.isDisabled() || !this.multiSelectEnabled) return
        const objects: IObject3D[] = []
        this._viewer.scene.modelRoot.traverse((o: any) => {
            if (o.isObject3D && o.visible && o.assetType === 'model' && o.userData.userSelectable !== false && o.material) {
                objects.push(o)
            }
        })
        if (objects.length) {
            this._picker.setSelected(objects.length === 1 ? objects[0] : objects as any, true)
        }
    }

    clearSelection() {
        if (!this._picker) return
        this._picker.setSelected(null, true)
    }

    private _onKeyDown = (event: KeyboardEvent) => {
        if (this.isDisabled()) return
        if ((event.target as any)?.tagName === 'TEXTAREA' || (event.target as any)?.tagName === 'INPUT') return
        const ctrl = event.ctrlKey || event.metaKey

        if (ctrl && event.code === 'KeyA') {
            event.preventDefault()
            this.selectAll()
        } else if (ctrl && event.code === 'KeyD') {
            event.preventDefault()
            this.duplicateSelected()
        } else if (ctrl && event.code === 'KeyC') {
            event.preventDefault()
            this.copySelected()
        } else if (ctrl && event.code === 'KeyX') {
            event.preventDefault()
            this.cutSelected()
        } else if (ctrl && event.code === 'KeyV') {
            event.preventDefault()
            this.pasteFromClipboard()
        } else if (event.code === 'Escape') {
            this.clearSelection()
        } else if (event.code === 'Delete' || event.code === 'Backspace') {
            event.preventDefault()
            this.deleteSelected()
        } else if (event.code === 'KeyH' && !ctrl) {
            event.preventDefault()
            if (event.shiftKey) this.unhideAll()
            else this.toggleVisibilitySelected()
        }
    }

    /** Helper to setSelected from an array without recording undo */
    private _setSelectedFromArray(objects: IObject3D[] | null): void {
        if (!objects || !objects.length) this._picker?.setSelected(null, false)
        else if (objects.length === 1) this._picker?.setSelected(objects[0], false)
        else this._picker?.setSelected(objects as any, false)
    }

    // region Clipboard & Object Operations

    /**
     * Delete selected objects. Always shows a confirmation dialog.
     */
    async deleteSelected(): Promise<void> {
        const selected = this.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
        if (!selected.length) return

        const result = await deleteObjects(selected)
        if (!result) return

        // Clear selection before recording undo (so undo restores selection properly)
        const prevSelection = [...selected]
        this._setSelectedFromArray(null)

        this._undoManager?.record({
            undo: () => {
                result.undo()
                this._setSelectedFromArray(prevSelection)
            },
            redo: () => {
                this._setSelectedFromArray(null)
                result.redo()
            },
        })
    }

    /**
     * Duplicate selected objects with smart offset support.
     */
    duplicateSelected(): void {
        const selected = this.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
        if (!selected.length) return

        const {clones, undo, redo} = duplicateObjects(selected)
        if (!clones.length) return

        // Apply smart offset if available
        const offset = this._duplicateTracker.getOffset()
        if (offset) {
            for (const clone of clones) {
                clone.position.add(offset)
                clone.updateMatrixWorld(true)
                clone.setDirty?.({change: 'transform'})
            }
        }

        this._setSelectedFromArray(clones)
        this._duplicateTracker.onDuplicated(clones)

        const prevSelection = [...selected]
        this._undoManager?.record({
            undo: () => {
                undo()
                this._setSelectedFromArray(prevSelection)
                this._duplicateTracker.onDuplicateUndone()
            },
            redo: () => {
                redo()
                this._setSelectedFromArray(clones)
                this._duplicateTracker.onDuplicated(clones)
            },
        })
    }

    /**
     * Record a move delta for smart duplicate tracking.
     * Call this from TransformControls after a duplicated object is moved.
     */
    recordDuplicateMove(object: IObject3D, delta: Vector3): void {
        this._duplicateTracker.onCloneMoved(object, delta)
    }

    /**
     * Copy selected objects to internal clipboard. No scene mutation.
     */
    copySelected(): void {
        const selected = this.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
        if (!selected.length) return
        this._clipboard.copy(selected, this._undoManager)
        this._viewer?.setDirty()
    }

    /**
     * Cut selected objects to internal clipboard. No scene mutation — applies visual tint.
     */
    cutSelected(): void {
        const selected = this.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
        if (!selected.length) return
        this._clipboard.cut(selected, this._undoManager)
        this._viewer?.setDirty()
    }

    /**
     * Paste from internal clipboard.
     */
    pasteFromClipboard(): void {
        if (this._clipboard.isEmpty) return

        const prevSelection = this.getSelectedObjects<IObject3D>()
        const result = this._clipboard.paste(this._undoManager)
        if (!result) return

        this._setSelectedFromArray(result.objects)
        this._viewer?.setDirty()

        // Wrap the clipboard's undo/redo to also handle selection
        const clipboardUndoRedo = result.undoRedo
        const pastedObjects = result.objects

        // Replace the last recorded command to include selection handling
        this._undoManager?.replaceLast({
            undo: () => {
                clipboardUndoRedo.undo()
                this._setSelectedFromArray(prevSelection)
                this._viewer?.setDirty()
            },
            redo: () => {
                clipboardUndoRedo.redo()
                this._setSelectedFromArray(pastedObjects)
                this._viewer?.setDirty()
            },
        })
    }

    // endregion

    // region Visibility

    /**
     * Toggle visibility of selected objects based on primary selected object's state.
     * If primary is visible → hide all selected. If primary is hidden → show all selected.
     */
    toggleVisibilitySelected(): void {
        const selected = this.getSelectedObjects<IObject3D>().filter(o => o?.isObject3D)
        if (!selected.length) return

        const primary = selected[0]
        const targetVisible = !primary.visible

        const prevStates = new Map<IObject3D, boolean>()
        for (const obj of selected) prevStates.set(obj, obj.visible)

        for (const obj of selected) {
            obj.visible = targetVisible
            obj.setDirty?.()
        }
        this._viewer?.setDirty()

        this._undoManager?.record({
            undo: () => {
                for (const [obj, was] of prevStates) {
                    obj.visible = was
                    obj.setDirty?.()
                }
                this._viewer?.setDirty()
            },
            redo: () => {
                for (const obj of selected) {
                    obj.visible = targetVisible
                    obj.setDirty?.()
                }
                this._viewer?.setDirty()
            },
        })
    }

    /**
     * Unhide all hidden objects in the model root.
     */
    unhideAll(): void {
        if (!this._viewer) return
        const hidden: IObject3D[] = []
        this._viewer.scene.modelRoot.traverse((o: any) => {
            if (o.isObject3D && !o.visible) hidden.push(o)
        })
        if (!hidden.length) return

        for (const obj of hidden) {
            obj.visible = true
            obj.setDirty?.()
        }
        this._viewer.setDirty()

        this._undoManager?.record({
            undo: () => {
                for (const obj of hidden) {
                    obj.visible = false
                    obj.setDirty?.()
                }
                this._viewer?.setDirty()
            },
            redo: () => {
                for (const obj of hidden) {
                    obj.visible = true
                    obj.setDirty?.()
                }
                this._viewer?.setDirty()
            },
        })
    }

    // endregion

    setSelectedObject(object: SelectionObject|undefined, focusCamera = false, trackUndo = true) { // todo: also listen to 'dispose' event on selected object (ObjectPicker only listens to '__unregister' for scene removal)
        const disabled = this.isDisabled()
        if (disabled && object) return
        if (!this._picker) return
        const t = this.autoFocus
        this.autoFocus = false
        this._picker.setSelected(object || null, trackUndo)
        this.autoFocus = t
        if (!disabled && object && this.selectionMode === 'object' && (t || focusCamera)) this.focusObject(object as IObject3D)
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this.setDirty()
        this._picker = new ObjectPicker(viewer.scene.modelRoot, viewer.canvas, viewer.scene.mainCamera, (obj)=>{
            const hasMat = obj.material
            if (!hasMat && !obj.userData.userSelectable) return false
            let o: IObject3D|null = obj
            o = getRootIfWidget(o)
            let ret = false
            while (o) {
                if (!o.visible) return false
                if (o.assetType === 'model' || o.assetType === 'light') ret = true
                // else if (o.assetType === 'widget' && o !== obj) return false // only select widget if itself is selected (not its children)
                if (o.userData.userSelectable === false) return false
                if (o.userData.bboxVisible === false) return false
                // todo colorwrite?
                o = o.parent
            }
            return ret
        })

        this._picker.extraObjects.push(...viewer.scene.children.filter(r=>r.userData.isWidgetRoot))
        this._viewer?.scene.addEventListener('addSceneObject', this._addSceneObject)
        this._viewer?.scene.addEventListener('sceneUpdate', this._sceneUpdate)

        if (this._widget) viewer.scene.addObject(this._widget, {addToRoot: true})
        if (this._hoverWidget) viewer.scene.addObject(this._hoverWidget, {addToRoot: true})

        this._picker.addEventListener('selectedObjectChanged', this._selectedObjectChanged)
        this._picker.addEventListener('hoverObjectChanged', this._hoverObjectChanged)
        this._picker.addEventListener('hitObject', this._onObjectHit)
        this._picker.addEventListener('selectionModeChanged', this._selectionModeChanged)
        this._picker.addEventListener('multiSelectChanged', this._multiSelectChanged)

        window.addEventListener('keydown', this._onKeyDown)

        viewer.scene.addEventListener('select', this._onObjectSelectEvent)
        viewer.scene.addEventListener('materialChanged', this._objCompChange)
        viewer.scene.addEventListener('geometryChanged', this._objCompChange)
        viewer.scene.addEventListener('texturesChanged', this._objCompChange)
        viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)

        viewer.forPlugin<DropzonePlugin>('DropzonePlugin', (dz)=>{
            dz.addEventListener('drop', this._onDrop)
        }, (dz)=>{
            dz.removeEventListener('drop', this._onDrop)
        })

        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=>{
            if (!this._picker) return
            this._picker.undoManager = um.undoManager
            this._undoManager = um.undoManager
        }, ()=>{
            if (!this._picker) return
            this._picker.undoManager = undefined
            this._undoManager = undefined
        }, this)

    }

    onRemove(viewer: ThreeViewer) {
        window.removeEventListener('keydown', this._onKeyDown)
        viewer.scene.removeEventListener('select', this._onObjectSelectEvent)
        viewer.scene.removeEventListener('materialChanged', this._objCompChange)
        viewer.scene.removeEventListener('geometryChanged', this._objCompChange)
        viewer.scene.removeEventListener('texturesChanged', this._objCompChange)
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)
        viewer.scene.removeEventListener('addSceneObject', this._addSceneObject)
        viewer.scene.removeEventListener('sceneUpdate', this._sceneUpdate)

        this._widget?.removeFromParent()
        this._hoverWidget?.removeFromParent()
        for (const w of this._extraWidgets) w.removeFromParent()
        this._extraWidgets = []

        if (this._picker) {
            this._picker.removeEventListener('selectedObjectChanged', this._selectedObjectChanged)
            this._picker.removeEventListener('hoverObjectChanged', this._hoverObjectChanged)
            this._picker.removeEventListener('hitObject', this._onObjectHit)
            this._picker.removeEventListener('selectionModeChanged', this._selectionModeChanged)
            this._picker.removeEventListener('multiSelectChanged', this._multiSelectChanged)
            this._picker.dispose()
            this._picker.undoManager = undefined // because setting above
            this._picker = undefined
        }
        this._undoManager = undefined
        this._clipboard.clear()
        this._duplicateTracker.reset()
        super.onRemove(viewer)
    }

    dispose() {
        super.dispose()
        this._widget?.dispose?.()
        this._hoverWidget?.dispose?.()
        for (const w of this._extraWidgets) w.dispose?.()
        this._extraWidgets = []
    }

    private _mainCameraChange = ()=>{
        if (!this._picker || !this._viewer) return
        this._picker.camera = this._viewer.scene.mainCamera
    }

    private _addSceneObject: EventListener2<'addSceneObject', ISceneEventMap, IScene> = (e)=>{
        // to be able to pick widgets. see onObjectHit
        if (e.object?.userData?.isWidgetRoot && e.object.parent === this._viewer?.scene) {
            this._picker?.extraObjects.push(e.object)
        }
    }

    private _sceneUpdate = (e: any)=>{
        // Clean up extraObjects when widget roots are removed from scene
        if (e?.change === 'removedFromParent' && e.object?.userData?.isWidgetRoot && this._picker) {
            const idx = this._picker.extraObjects.indexOf(e.object)
            if (idx >= 0) this._picker.extraObjects.splice(idx, 1)
        }
    }

    private _objCompChange: EventListener2<'geometryChanged'|'materialChanged'|'texturesChanged', ISceneEventMap, IScene> = (e)=>{
        if (e.object && e.object === this.getSelectedObject()) {
            this.refreshUiChildren(e.object)
        }
    }

    private _onObjectSelectEvent: EventListener2<'select', ISceneEventMap, IScene> = (e)=>{
        if (e.source === PickingPlugin.PluginType) return
        if (e.object === undefined && e.value === undefined) console.error('PickingPlugin - Error handling object/material `select` event `e.object` or `e.value` must be set for picking, `value` can be null to unselect')
        else this.setSelectedObject(e.object || e.value, this.autoFocus || e.focusCamera, e.trackUndo ?? true)
    }

    private _selectedObjectChanged: EventListener2<'selectedObjectChanged', ObjectPickerEventMap, ObjectPicker> = (e: any) => {
        if (!this._viewer) return
        this._duplicateTracker.onSelectionChanged()
        this.dispatchEvent(e)

        const selected = this._picker?.selectedObject || undefined // or use e.object. doing this so that listeners can change the selected object in dispatch above

        const frameFade = this._viewer.getPlugin(FrameFadePlugin)
        if (frameFade) {
            if (selected) frameFade.disable(this)
            else frameFade.enable(this)
        }

        // for widgets etc, this can be removed when they are rendered in a separate pass
        if (selected) {
            this._viewer.scene.disableAutoNearFar('PickingPlugin')
        } else {
            this._viewer.scene.enableAutoNearFar('PickingPlugin')
        }

        this.refreshUiChildren(selected)

        const widget = this._widget
        if (widget && this.widgetEnabled) {
            if ((selected as IObject3D)?.isObject3D) widget.attach((selected as IObject3D))
            else widget.detach()
        }

        // Multi-selection: attach extra widgets to additional selected objects
        this._updateExtraWidgets()

        this._viewer.setDirty()

        if (this.autoFocus && this.selectionMode === 'object') {
            this.focusObject(selected as IObject3D | undefined)
        }

    }

    private _hoverObjectChanged = (e: any) => {
        if (!this._viewer) return
        this.dispatchEvent(e)
        const selected = this._picker?.hoverObject || undefined

        const widget = this._hoverWidget
        if (widget && this.widgetEnabled) {
            if ((selected as IObject3D)?.isObject3D) widget.attach((selected as IObject3D))
            else widget.detach()
        }

        this._viewer?.setDirty()

        if (this.autoFocusHover && this.selectionMode === 'object') {
            this.focusObject(selected as IObject3D | undefined)
        }

    }

    private _onObjectHit = (e: PickingPluginEventMap['hitObject']&{type: 'hitObject'})=>{
        if (!this._viewer) return
        if (this.isDisabled()) {
            e.intersects.selectedObject = null
            return
        }
        let selected = e.intersects.selectedObject
        // if a widget is picked, select the object its bound to instead
        if (selected) {
            const obj = selected
            selected = getRootIfWidget(selected)
            if (selected.assetType === 'widget' && (selected as IObject3D&IWidget).object) {
                e.intersects.selectedObject = (selected as IObject3D&IWidget).object
                e.intersects.selectedWidget = (selected as IObject3D&IWidget)
                e.intersects.selectedHandle = obj.userData.isWidgetHandle ? obj : undefined
            }
        }
        this.dispatchEvent(e)
    }

    private _selectionModeChanged = (e: any)=>{
        if (!this._viewer) return
        this.dispatchEvent(e)
        if (this.isDisabled()) return
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    }

    private _multiSelectChanged = (e: any)=>{
        if (!this._viewer) return
        this.dispatchEvent(e)
        // When disabling, reduce to primary object only
        if (!this.multiSelectEnabled && this._picker && this._picker.selectedObjects.length > 1) {
            const primary = this._picker.selectedObject
            this._picker.setSelected(primary, false)
        }
    }

    public async focusObject(selected?: Object3D|null): Promise<void> {
        this._viewer?.fitToView(selected ?? undefined, 1.25, 1000, 'easeOut')
    }

    // todo this should be done with undo support, see UndoManagerPlugin.recordAction
    private _onDrop = async(e: DropzonePluginEventMap['drop'])=>{
        if (!this._viewer || !this.autoApplyMaterialOnDrop) return
        const obj = e.assets
        const assetMat = obj?.find(m=>(m as IMaterial).isMaterial) as IMaterial
        const selected = this.getSelectedObject()
        if (selected
            && (selected as IObject3D)?.isObject3D
            && assetMat
            && await this._viewer.dialog.confirm('Applying material: Apply material to the selected object?')
        ) {
            let oldMat = (selected as IObject3D).material
            if (Array.isArray(oldMat)) {
                console.warn('Dropping on material array not yet fully supported.')
                oldMat = oldMat[0]
            }
            let meshes = Array.from(oldMat?.appliedMeshes ?? [])
            const c = meshes.length > 1 ? !await this._viewer.dialog.confirm('Applying material: Apply to all objects using this material?') : meshes.length < 1
            if (c) meshes = [selected as IObject3D]
            for (const mesh of meshes) {
                if (mesh) mesh.material = assetMat
            }
        }
    }

    private _pickPromptUi: UiObjectConfig = {
        type: 'button',
        label: 'Select an object to see its properties',
        readOnly: true,
        hidden: () => this.getSelectedObject() !== undefined,
    }
    private _uiConfigChildren: UiObjectConfig[] = [
        {
            label: 'Enabled',
            type: 'checkbox',
            property: [this, 'enabled'],
        },
        {
            label: 'Hover Enabled',
            type: 'checkbox',
            property: [this, 'hoverEnabled'],
            onChange: ()=>this.uiConfig.uiRefresh?.(true), // for autoFocusHover
        },
        // {
        //     label: 'Selection Mode',
        //     type: 'dropdown',
        //     children: ['object', 'material'].map(v=>({label: v, value: v})),
        //     onChange: ()=>this.uiConfig.uiRefresh?.(true),
        // },
        {
            label: 'Auto Focus',
            type: 'checkbox',
            property: [this, 'autoFocus'],
            onChange: ()=>{
                const o = this.getSelectedObject()
                if (this.autoFocus && o) this.setSelectedObject(o, true)
            },
        },
        {
            label: 'Auto Focus on Hover',
            type: 'checkbox',
            hidden: ()=>!this.hoverEnabled,
            property: [this, 'autoFocusHover'],
        },
        {
            label: 'Widget Enabled',
            type: 'checkbox',
            property: [this, 'widgetEnabled'],
        },
        {
            label: 'Multi-Select',
            type: 'checkbox',
            property: [this, 'multiSelectEnabled'],
        },
    ]

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Picker',
        expanded: true,
        children: [
            ...this._uiConfigChildren,
            this._pickPromptUi,
        ],
    }

    get widget(): SelectionWidget | undefined {
        return this._widget
    }

    // UI utils

    refreshUiChildren(selected: IObject3D | IMaterial | ITexture | IGeometry | undefined) {
        if (this._pickUi) {
            const ui = this.uiConfig
            ui.children = [...this._uiConfigChildren]
            if (selected) {
                if ((selected as IObject3D).isObject3D) {
                    const obj = (selected as IObject3D)
                    ui.children.push(...this.objectSelectionUiConfig(obj))
                }
                const c = selected.uiConfig
                if (c?.type === 'folder') safeSetProperty(c, 'expanded', true, true)
                if (c) ui.children.push(c)

                const object = (selected as IObject3D)?.isObject3D ? (selected as IObject3D) : undefined
                const materials1 = (selected as IMaterial)?.isMaterial ? selected as IMaterial : object?.material
                const materials = materials1 ? Array.isArray(materials1) ? materials1 : [materials1] : []
                const geometry = (selected as IGeometry)?.isBufferGeometry ? selected as IGeometry : object?.geometry

                if (geometry?.uiConfig && geometry !== selected) {
                    const c1 = geometry.uiConfig
                    if (c1.type === 'folder') safeSetProperty(c1, 'expanded', true, true)
                    ui.children.push(c1)
                }
                materials.forEach(m => {
                    if (m?.uiConfig && m !== selected) ui.children?.push(m.uiConfig)
                })
                if ((selected as IObject3D).isObject3D) {
                    ui.children.push(...this.objectMaterialManageUiConfig(selected as IObject3D))
                }

            } else {
                ui.children.push(this._pickPromptUi)
            }

            ui.uiRefresh?.()
        }
    }

    objectSelectionUiConfig(obj: IObject3D): UiObjectConfig[] {
        return [
            {
                type: 'button',
                label: 'Focus',
                value: () => {
                    if (!obj.isObject3D) return
                    // const selected = this.getSelectedObject()
                    if (obj.assetType && obj.parentRoot) // todo also check if acceptChildEvents is set on some parent?
                        obj.dispatchEvent({
                            type: 'select',
                            ui: true,
                            object: obj,
                            bubbleToParent: true,
                            focusCamera: true,
                        })
                    else
                        this.setSelectedObject(obj, true)
                },
            },
            {
                type: 'button',
                label: 'Select Parent',
                hidden: () => !obj.parent,
                value: () => {
                    if (!obj.isObject3D) return
                    const parent = obj.parent
                    if (parent) {
                        if (parent.assetType && parent.parentRoot) // todo also check if acceptChildEvents is set on some parent?
                            parent.dispatchEvent({
                                type: 'select',
                                ui: true,
                                bubbleToParent: true,
                                object: parent,
                            })
                        else
                            this.setSelectedObject(parent, false)
                    }
                },
            },
        ]
    }

    objectMaterialManageUiConfig(obj: IObject3D): UiObjectConfig[] {
        return [
            {
                label: 'Remove Material(s)',
                type: 'button',
                hidden: ()=>!this.canRemoveMaterial(obj),
                value: ()=> this.removeMaterial(obj),
            },
            ...this.materialTypes.map(matType=>({
                label: `New ${matType.name} Material`,
                type: 'button',
                hidden: matType.line ?
                    // ()=>(!obj.isLineSegments2 && !obj.isLine && !obj.isLineSegments) || !(!obj.materials?.length || obj.materials.length === 1 && obj.materials[0].userData?.isPlaceholder) :
                    ()=>!obj.isLineSegments2 && !obj.isLine && !obj.isLineSegments && !obj.isWireframe || !(!obj.materials?.length || obj.materials.length === 1 && obj.materials[0] === matType.def) :
                    ()=>!(!obj.materials?.length || obj.materials.length === 1 && obj.materials[0].userData?.isPlaceholder) || !obj.isMesh,
                value: ()=>{
                    const mat = obj.material
                    obj.material = new matType.cls()
                    return ()=> obj.material = mat
                },
            })),
        ]
    }

    canRemoveMaterial = (obj: IObject3D)=>{
        if (!obj.material) return false
        const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
        // return materials.length && (materials.length !== 1 || !(this.materialTypes.map(m=>m.def) as IMaterial[]).includes(materials[0]))
        return materials.length && (materials.length !== 1 || !materials[0].userData?.isPlaceholder)
    }

    removeMaterial = (obj: IObject3D)=>{
        if (!obj.material) return
        const matC = obj.material
        obj.material = this.getPlaceholderMaterial(obj)
        return ()=> obj.material = matC // returns undo function
    }

    getPlaceholderMaterial(obj: IObject3D): IMaterial {
        const def = [this.materialTypes[0].def!]
        if (!def[0]) throw new Error('No default material found')
        const mat = obj.isLineSegments2 || obj.isWireframe ? this.materialTypes.find(m => m.cls === LineMaterial2)?.def :
            obj.isLine || obj.isLineSegments ? this.materialTypes.find(m => m.cls === UnlitLineMaterial)?.def :
                null
        return mat ? mat : def[0]
    }

    // to be able to remove material from object
    materialTypes = [{
        cls: UnlitMaterial,
        def: AssetImporter.DummyMaterial,
        name: 'Unlit',
    }, {
        cls: UnlitLineMaterial,
        def: AssetImporter.DummyLineBasicMaterial,
        line: true,
        name: 'Basic Line',
    }, {
        cls: LineMaterial2,
        def: AssetImporter.DummyLineMaterial,
        line: true,
        name: 'Line',
    }, {
        cls: PhysicalMaterial,
        // def: new PhysicalMaterial(),
        name: 'Physical',
    }]

}

