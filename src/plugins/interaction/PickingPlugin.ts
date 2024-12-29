import {Object3D} from 'three'
import {Class, onChange, serialize} from 'ts-browser-helpers'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {BoxSelectionWidget, ObjectPicker, SelectionWidget} from '../../three'
import {IObject3D, IObject3DEvent, ISceneEvent} from '../../core'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {FrameFadePlugin} from '../pipeline/FrameFadePlugin'
import {type UndoManagerPlugin} from './UndoManagerPlugin'

export class PickingPlugin extends AViewerPluginSync<'selectedObjectChanged'|'hoverObjectChanged'|'hitObject'> {
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
    private _hoverWidget?: SelectionWidget
    private _pickUi: boolean

    get hoverEnabled() {
        return this._picker?.hoverEnabled ?? false
    }
    set hoverEnabled(v: boolean) {
        if (!this._picker) return
        this._picker.hoverEnabled = v
        this.uiConfig && this.uiConfig.uiRefresh?.()
    }

    @serialize()
        autoFocus

    // @serialize()  // todo
    autoFocusHover = false

    /**
     * Note: this is for runtime use only, not serialized
     */
    @onChange(PickingPlugin.prototype._widgetEnabledChange)
        widgetEnabled = true

    protected _widgetEnabledChange() {
        if (this.widgetEnabled && this._picker?.selectedObject)
            this._widget?.attach(this._picker.selectedObject)
        else
            this._widget?.detach()
        this.uiConfig?.uiRefresh?.(true)
    }

    setDirty() {
        if (!this._viewer) return
        if (this.isDisabled()) this.setSelectedObject(undefined)
        this._viewer.setDirty()
    }
    constructor(selection: Class<SelectionWidget>|undefined = BoxSelectionWidget, pickUi = true, autoFocus = false) {
        super()
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

    getSelectedObject<T extends IObject3D = IObject3D>(): T|undefined {
        if (this.isDisabled()) return
        return this._picker?.selectedObject as T || undefined
    }

    setSelectedObject(object: IObject3D|undefined, focusCamera = false) { // todo: listen to object disposed
        const disabled = this.isDisabled()
        if (disabled && !object) return
        if (!this._picker) return
        const t = this.autoFocus
        this.autoFocus = false
        this._picker.selectedObject = object || null
        this.autoFocus = t
        if (!disabled && object && (t || focusCamera)) this.focusObject(object)
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        this.setDirty()
        this._picker = new ObjectPicker(viewer.scene.modelRoot, viewer.canvas, viewer.scene.mainCamera, (obj)=>{
            const hasMat = obj.material
            if (!hasMat) return false
            let o: IObject3D|null = obj
            let ret = false
            while (o) {
                if (!o.visible) return false
                if (o.assetType === 'model' || o.assetType === 'light') ret = true
                if (o.assetType === 'widget') return false
                if (o.userData.userSelectable === false) return false
                if (o.userData.bboxVisible === false) return false
                o = o.parent
            }
            return ret
        })
        if (this._widget) viewer.scene.addObject(this._widget, {addToRoot: true})
        if (this._hoverWidget) viewer.scene.addObject(this._hoverWidget, {addToRoot: true})

        this._picker.addEventListener('selectedObjectChanged', this._selectedObjectChanged)
        this._picker.addEventListener('hoverObjectChanged', this._hoverObjectChanged)
        this._picker.addEventListener('hitObject', this._onObjectHit)

        // on material drop on selected object
        // viewer.scene.addEventListener('addSceneObject', async(e) => {
        //     const obj = e.object
        //     const selected: IModel<Mesh> = this.getSelectedObject()! as any
        //     if (selected
        //         && obj?.assetType === 'material'
        //         && typeof selected?.setMaterial === 'function'
        //         && selected?.modelObject?.isMesh
        //         && await viewer.confirm('Applying material: Apply material to the selected object?')
        //     ) {
        //         const oldMat = selected.material
        //         if (Array.isArray(oldMat)) {
        //             console.warn('Dropping on material array not yet fully supported.')
        //             selected.setMaterial(obj)
        //         } else {
        //             let meshes: IModel<Mesh>[] = Array.from(oldMat?.userData.__appliedMeshes ?? [])
        //             const c = meshes.length > 1 ? !await viewer.confirm('Applying material: Apply to all objects using this material?') : meshes.length < 1
        //             if (c) meshes = [selected]
        //             for (const mesh of meshes) {
        //                 if (mesh) mesh.setMaterial?.(obj)
        //             }
        //         }
        //     }
        // })
        viewer.scene.addEventListener('select', this._onObjectSelectEvent)
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.addEventListener('mainCameraChange', this._mainCameraChange)

        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=>{
            if (!this._picker) return
            this._picker.undoManager = um.undoManager
        }, ()=>{
            if (!this._picker) return
            this._picker.undoManager = undefined
        })

    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('select', this._onObjectSelectEvent)
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.removeEventListener('mainCameraChange', this._mainCameraChange)

        this._widget?.removeFromParent()
        this._hoverWidget?.removeFromParent()

        if (this._picker) {
            this._picker.removeEventListener('selectedObjectChanged', this._selectedObjectChanged)
            this._picker.removeEventListener('hoverObjectChanged', this._hoverObjectChanged)
            this._picker.removeEventListener('hitObject', this._onObjectHit)
            this._picker.dispose()
            this._picker.undoManager = undefined // because setting above
            this._picker = undefined
        }
        super.onRemove(viewer)
    }

    dispose() {
        super.dispose()
        this._widget?.dispose()
        this._hoverWidget?.dispose()
    }

    private _mainCameraChange = ()=>{
        if (!this._picker || !this._viewer) return
        this._picker.camera = this._viewer.scene.mainCamera
    }
    private _onSceneUpdate = (e: ISceneEvent)=>{
        if (!e.hierarchyChanged) return
        const s = this.getSelectedObject()
        let inScene = false
        s?.traverseAncestors((o)=>{
            if (o === this._viewer?.scene) inScene = true
        })
        if (!inScene) this.setSelectedObject(undefined)
    }

    private _onObjectSelectEvent = (e: IObject3DEvent)=>{
        if (e.source === PickingPlugin.PluginType) return
        if (e.object === undefined && e.value === undefined) console.error('e.object or e.value must be set for picking, can be null to unselect')
        else this.setSelectedObject(e.object || e.value, this.autoFocus || e.focusCamera)
    }

    private _selectedObjectChanged = (e: any) => {
        if (!this._viewer) return
        this.dispatchEvent(e)

        const selected = this._picker?.selectedObject || undefined // or use e.object. doing this so that listeners can change the selected object in dispatch above

        const frameFade = this._viewer.getPlugin(FrameFadePlugin)
        if (frameFade) {
            if (selected) frameFade.disable(this)
            else frameFade.enable(this)
        }

        this._viewer.scene.autoNearFarEnabled = !selected // for widgets etc, this can be removed when they are rendered in a separate pass

        if (this._pickUi) {
            const sUiConfig = (selected as IUiConfigContainer)?.uiConfig
            const ui = this.uiConfig
            ui.children = [...this._uiConfigChildren]
            if (sUiConfig) ui.children.push(sUiConfig)
            ui.uiRefresh?.()
        }

        const widget = this._widget
        if (widget && this.widgetEnabled) {
            if (selected) widget.attach(selected)
            else widget.detach()
        }

        // if (selected) selected.dispatchEvent({type: 'selected', source: PickingPlugin.PluginType, object: selected})

        this._viewer.setDirty()

        if (this.autoFocus) {
            // this._viewer.resetCamera({rootObject: selected, centerOffset: new Vector3(4, 4, 4)})
            this.focusObject(selected)
        }

    }

    private _hoverObjectChanged = (e: any) => {
        this.dispatchEvent(e)
        const selected = this._picker?.hoverObject || undefined

        const widget = this._hoverWidget
        if (widget && this.widgetEnabled) {
            if (selected) widget.attach(selected)
            else widget.detach()
        }

        // if (selected) selected.dispatchEvent({type: 'selected', source: PickingPlugin.PluginType, object: selected})

        this._viewer?.setDirty()

        if (this.autoFocusHover) {
            // this._viewer?.resetCamera({rootObject: selected, centerOffset: new Vector3(4, 4, 4)})
            this.focusObject(selected)
        }


    }

    private _onObjectHit = (e: any)=>{
        if (!this._viewer) return
        if (this.isDisabled()) {
            e.intersects.selectedObject = null
            return
        }
        this.dispatchEvent(e)
    }

    public async focusObject(selected?: Object3D) {
        this._viewer?.fitToView(selected, 1.25, 1000, 'easeOut')
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
    ]

    uiConfig: UiObjectConfig = {
        type: 'panel',
        label: 'Picker',
        expanded: true,
        children: [
            ...this._uiConfigChildren,
        ],
    }

    get widget(): SelectionWidget | undefined {
        return this._widget
    }

}

