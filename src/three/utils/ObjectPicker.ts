import {EventDispatcher, Intersection, Object3D, Raycaster, Vector2} from 'three'
import {JSUndoManager, now, onChangeDispatchEvent} from 'ts-browser-helpers'
import {ICamera, IMaterial, IObject3D, ITexture, IGeometry, IWidget} from '../../core'

export type SelectionObject = IObject3D | IMaterial | ITexture | IGeometry | null
export type SelectionObjectArr = IObject3D[] | IMaterial[] | ITexture[] | IGeometry[]
export type SelectionModeType = 'object' | 'material' | 'texture' | 'geometry'

export interface HitIntersects{
    selectedObject: IObject3D | null,
    intersect: Intersection<IObject3D> | null,
    intersects: Intersection<IObject3D>[],
    mouse: Vector2,
    selectedWidget?: (IWidget&IObject3D) | null,
    selectedHandle?: Object3D | null,
}

export interface ObjectPickerEventMap{
    hoverObjectChanged: {object: IObject3D | null, material: IMaterial | null, value: SelectionObject, intersects?: HitIntersects},
    selectedObjectChanged: {object: IObject3D | null, material: IMaterial | null, value: SelectionObject, intersects?: HitIntersects},
    hitObject: {time: number, intersects: HitIntersects} // selectedObject should be renamed to hitObject
    selectionModeChanged: {detail: {key: 'selectionMode', value: SelectionModeType, oldValue: SelectionModeType}}
}

export class ObjectPicker extends EventDispatcher<ObjectPickerEventMap> {
    private _firstHit: IObject3D | undefined

    hoverEnabled = false
    @onChangeDispatchEvent('selectionModeChanged')
        selectionMode: SelectionModeType = 'object'

    /**
     * Time threshold for a pointer click event
     */
    static PointerClickMaxTime = 200
    /**
     * Distance threshold for a pointer click event
     */
    static PointerClickMaxDistance = 0.1 // 1/20 of the canvas

    undoManager?: JSUndoManager
    private _root: IObject3D
    extraObjects: IObject3D[] = []
    private _camera: ICamera
    private _mouseDownTime: number
    private _mouseDownPos: Vector2 = new Vector2()
    private _mouseUpTime: number
    private _time: number
    public selectionCondition: (o: IObject3D) => boolean
    public raycaster: Raycaster
    public mouse: Vector2
    private _selected: SelectionObjectArr
    private _selectedIntersects: HitIntersects|undefined
    private _hovering: SelectionObjectArr
    private _hoveringIntersects: HitIntersects|undefined
    public cursorStyles: {default: string; down: string}
    public domElement: HTMLElement
    constructor(root: IObject3D, domElement: HTMLElement, camera: ICamera, selectionCondition?: (o:IObject3D)=>boolean) {
        super()
        this._root = root
        this._camera = camera
        this.domElement = domElement

        this._time = this.time
        this._mouseDownTime = 0
        this._mouseUpTime = 1

        this.selectionCondition = selectionCondition ?? (
            (selectedObject: any) => {
                return selectedObject.userData.userSelectable !== false && selectedObject.userData.bboxVisible !== false && selectedObject.material != null && selectedObject.material.type !== 'ShadowMaterial' // sample to select only mesh with material and not shadowmaterial.
            })

        this.raycaster = new Raycaster()
        this.raycaster.params.Line2 = {threshold: 0.01} // for picking fat lines. todo separate thresh for world and localspace?

        this.mouse = new Vector2()
        this._selected = []
        this._hovering = []

        this.cursorStyles = {
            default: 'grab',
            down: 'grabbing',
        }

        this.domElement.style.touchAction = 'none'
        // this.domElement.style.cursor = this.cursorStyles.default
        this.domElement.addEventListener('pointermove', this._onPointerMove)
        this.domElement.addEventListener('pointerleave', this._onPointerLeave)
        this.domElement.addEventListener('pointerout', this._onPointerLeave)
        this.domElement.addEventListener('pointercancel', this._onPointerCancel)
        this.domElement.addEventListener('pointerenter', this._onPointerEnter)
        this.domElement.addEventListener('pointerdown', this._onPointerDown)
        this.domElement.addEventListener('pointerup', this._onPointerUp)

    }

    dispose() {
        this.setSelected(null)
        this.setHoverObject(null)

        this.domElement.removeEventListener('pointermove', this._onPointerMove)
        this.domElement.removeEventListener('pointerleave', this._onPointerLeave)
        this.domElement.removeEventListener('pointerout', this._onPointerLeave)
        this.domElement.removeEventListener('pointercancel', this._onPointerCancel)
        this.domElement.removeEventListener('pointerenter', this._onPointerEnter)
        this.domElement.removeEventListener('pointerdown', this._onPointerDown)
        this.domElement.removeEventListener('pointerup', this._onPointerUp)
    }

    get camera() {
        return this._camera
    }

    set camera(value) {
        this._camera = value
    }

    get selectedObject(): SelectionObject {
        return this._selected.length > 0 ? this._selected[0] : null
    }

    // set selectedObject(object) {
    //     this.setSelected(object)
    // }

    setSelected(object: SelectionObject, record = true, intersects?: HitIntersects) {
        // Auto-switch selection mode based on object type
        if (object) {
            if ((object as IObject3D)?.isObject3D && this.selectionMode !== 'object') {
                this.selectionMode = 'object'
            } else if ((object as IMaterial)?.isMaterial && this.selectionMode !== 'material') {
                this.selectionMode = 'material'
            } else if ((object as ITexture)?.isTexture && this.selectionMode !== 'texture') {
                this.selectionMode = 'texture'
            } else if ((object as IGeometry)?.isBufferGeometry && this.selectionMode !== 'geometry') {
                this.selectionMode = 'geometry'
            }
        }

        const currentIntersects = this._selectedIntersects
        if (!this._selected.length && !object || this._selected.length === 1 && this._selected[0] === object
            && currentIntersects?.selectedObject === intersects?.selectedObject
            && currentIntersects?.selectedWidget === intersects?.selectedWidget
            && currentIntersects?.selectedHandle === intersects?.selectedHandle
        ) return
        const current = [...this._selected]
        this._selected = object ? Array.isArray(object) ? [...object] : [object] : []
        this._selectedIntersects = intersects || undefined

        const obj = this.selectedObject
        this.dispatchEvent({
            type: 'selectedObjectChanged',
            object: (obj as IObject3D)?.isObject3D ? (obj as IObject3D) : null,
            material: (obj as IMaterial)?.isMaterial ? (obj as IMaterial) : null,
            value: obj,
            intersects,
        })

        record && this.undoManager?.record({
            undo: () => this.setSelected(current.length ? current[0] : null, false, currentIntersects),
            redo: () => this.setSelected(object, false, intersects),
        })
    }

    get hoverObject(): SelectionObject {
        return this._hovering.length > 0 ? this._hovering[0] : null
    }

    // set hoverObject(object: SelectionObject | SelectionObject[] | null) {
    setHoverObject(object: SelectionObject, _record = true, intersects?: HitIntersects) {
        if (!this._hovering.length && !object || this._hovering.length === 1 && this._hovering[0] === object
            && this._hoveringIntersects?.selectedObject === intersects?.selectedObject
            && this._hoveringIntersects?.selectedWidget === intersects?.selectedWidget
            && this._hoveringIntersects?.selectedHandle === intersects?.selectedHandle
        ) return
        this._hovering = (object ? Array.isArray(object) ? [...object] : [object] : []) as SelectionObjectArr
        this._hoveringIntersects = intersects || undefined

        const obj = this.hoverObject
        this.dispatchEvent({
            type: 'hoverObjectChanged',
            object: (obj as IObject3D)?.isObject3D ? (obj as IObject3D) : null,
            material: (obj as IMaterial)?.isMaterial ? (obj as IMaterial) : null,
            value: obj,
            intersects,
        })
    }

    get time() {
        this._time = now()
        return this._time
    }

    get isMouseDown() {
        return this.mouseDownDeltaTime < 0
    }

    get mouseDownDeltaTime() {
        return this._mouseUpTime - this._mouseDownTime
    }

    private _onPointerMove = (event: PointerEvent) => {
        if (event.isPrimary === false) return
        this.updateMouseFromEvent(event)

        if (this.hoverEnabled) {
            const {obj, intersects} = this._hitObject()
            this.setHoverObject(obj, true, intersects || undefined)
        }

    }

    private _onPointerLeave = (event: PointerEvent) => {
        if (event.isPrimary === false) return
        this.domElement.style.cursor = this.cursorStyles.default

        // this.updateMouseFromEvent(event);

        if (this.hoverEnabled || this.hoverObject)
            this.setHoverObject(null)

    }

    private _onPointerEnter = (_: PointerEvent) => {
        // todo dispatch event?
    }
    private _onPointerCancel = (_: PointerEvent) => {
        // todo dispatch event?
    }

    updateMouseFromEvent(event: PointerEvent) {
        const rect = this.domElement.getBoundingClientRect()
        this.mouse.x = (event.clientX - rect.x) / rect.width * 2 - 1
        this.mouse.y = -((event.clientY - rect.y) / rect.height) * 2 + 1
    }

    private _onPointerDown = (event: PointerEvent) => {
        if (event.isPrimary === false) return
        this.domElement.style.cursor = this.cursorStyles.down

        this._mouseDownTime = this.time
        this._mouseDownPos.copy(this.mouse)

        return undefined
    }

    private _onPointerUp = (event: PointerEvent) => {
        if (event.isPrimary === false) return
        this.domElement.style.cursor = this.cursorStyles.default

        this._mouseUpTime = this.time
        const delta = this.mouseDownDeltaTime
        const dist = this._mouseDownPos.distanceTo(this.mouse)
        if (delta < ObjectPicker.PointerClickMaxTime && dist < ObjectPicker.PointerClickMaxDistance) {
            // click
            this._onPointerClick(event)
        }

        return undefined
    }

    private _onPointerClick = (event: PointerEvent) => {
        if (event.isPrimary === false) return
        this.updateMouseFromEvent(event)
        const {obj, intersects} = this._hitObject()
        this.setSelected(obj, true, intersects || undefined)
    }

    private _hitObject() {
        const intersects = this.checkIntersection()
        if (intersects) this.dispatchEvent({type: 'hitObject', time: this.time, intersects})
        else this.dispatchEvent({
            type: 'hitObject',
            time: this.time,
            intersects: {selectedObject: null, intersect: null, intersects: [], mouse: this.mouse.clone()},
        })

        let obj: SelectionObject = intersects?.selectedObject || null

        // Handle selection based on current mode
        if (obj) {
            switch (this.selectionMode) {
            case 'material':
                if (obj.material) {
                    obj = Array.isArray(obj.material) ? obj.material[0] : obj.material
                }
                break
            case 'texture':
                // Find the first texture from the material
                if (obj.material) {
                    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material
                    // Look for common texture properties
                    obj = material.map || material.normalMap || material.roughnessMap || material.metalnessMap ||
                            material.aoMap || null
                } else {
                    obj = null
                }
                break
            case 'geometry':
                obj = obj.geometry || null
                break
            case 'object':
            default:
                // obj remains as the intersected object
                break
            }
        }
        return {obj, intersects}
    }

    checkIntersection() {
        const camera = this._camera

        if (!camera) return null

        this.raycaster.setFromCamera(this.mouse, camera)

        let intersects = this.raycaster.intersectObjects<IObject3D>([this._root, ...this.extraObjects], true)

        const uniqueIds: number[] = []

        const uniqueIntersects = intersects.filter(element => {
            const isDuplicate = uniqueIds.includes(element.object.id)

            if (!isDuplicate) {
                uniqueIds.push(element.object.id)
                return true
            }

            return false
        })

        intersects = uniqueIntersects

        let selectedObject:IObject3D | null = null
        let intersect: Intersection<IObject3D> | undefined

        const intersects2 = []
        for (const intersect1 of intersects) {
            selectedObject = intersect1.object
            intersect = intersect1
            while (selectedObject != null && (!selectedObject.visible || !this.selectionCondition(selectedObject))) {
                selectedObject = selectedObject.parent
            }
            if (selectedObject != null) {
                intersect1.object = selectedObject
                intersects2.push(intersect1)
            }
        }
        intersects = intersects2

        if (intersects.length > 0) {
            selectedObject = intersects[0].object
            intersect = intersects[0]

            if (this._firstHit && selectedObject.id !== this._firstHit.id) {
                selectedObject = intersect.object
            } else {
                for (let i = 0; i < intersects.length; i++) {
                    if (this.selectedObject && this.selectedObject.id === intersects[i].object.id) {
                        const n = i + 1 // Use ( i + 1 ) % intersects.length for looping through objects
                        if (n < intersects.length) {
                            intersect = intersects[n]
                            selectedObject = intersect.object
                        } else {
                            return null
                        }
                    }
                }
            }
            this._firstHit = intersects[0].object
        }

        if (selectedObject && intersect) {

            if (selectedObject) // sorted by distance
                return {selectedObject, intersect, intersects, mouse: this.mouse.clone()}

            return null

        } else {
            return null
        }

    }

    isHovering() {
        return this.hoverObject != null // if something is highlighted.
    }

    isSelected() {
        return this.selectedObject != null // if something is selected.
    }

}
