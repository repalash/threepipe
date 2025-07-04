import {EventDispatcher, Intersection, Raycaster, Vector2} from 'three'
import {JSUndoManager, now} from 'ts-browser-helpers'
import {ICamera, IObject3D} from '../../core'

export interface ObjectPickerEventMap{
    hoverObjectChanged: {object: IObject3D | null}
    selectedObjectChanged: {object: IObject3D | null}
    hitObject: {time: number, intersects: {selectedObject: IObject3D | null, intersect: Intersection<IObject3D> | null, intersects: Intersection<IObject3D>[]}}
}

export class ObjectPicker extends EventDispatcher<ObjectPickerEventMap> {
    private _firstHit: IObject3D | undefined

    hoverEnabled = false
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
    private _camera: ICamera
    private _mouseDownTime: number
    private _mouseDownPos: Vector2 = new Vector2()
    private _mouseUpTime: number
    private _time: number
    public selectionCondition: (o: IObject3D) => boolean
    public raycaster: Raycaster
    public mouse: Vector2
    private _selected: IObject3D[]
    private _hovering: IObject3D[]
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
        this.selectedObject = null
        this.hoverObject = null

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

    get selectedObject(): IObject3D | null {
        return this._selected.length > 0 ? this._selected[0] : null
    }

    set selectedObject(object) {
        this.setSelected(object)
    }

    setSelected(object: IObject3D|null, record = true) {
        if (!this._selected.length && !object || this._selected.length === 1 && this._selected[0] === object) return
        const current = [...this._selected]
        this._selected = object ? Array.isArray(object) ? [...object] : [object] : []
        this.dispatchEvent({type: 'selectedObjectChanged', object: this.selectedObject})
        record && this.undoManager?.record({
            undo: () => this.setSelected(current.length ? current[0] : null, false),
            redo: () => this.setSelected(object, false),
        })
    }

    get hoverObject(): IObject3D | null {
        return this._hovering.length > 0 ? this._hovering[0] : null
    }

    set hoverObject(object: IObject3D | IObject3D[] | null) {
        if (!this._hovering.length && !object || this._hovering.length === 1 && this._hovering[0] === object) return
        this._hovering = object ? Array.isArray(object) ? [...object] : [object] : []
        this.dispatchEvent({type: 'hoverObjectChanged', object: this.hoverObject})
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

        if (this.hoverEnabled)
            this.hoverObject = this.checkIntersection()?.intersects[0].object ?? null

    }

    private _onPointerLeave = (event: PointerEvent) => {
        if (event.isPrimary === false) return
        this.domElement.style.cursor = this.cursorStyles.default

        // this.updateMouseFromEvent(event);

        if (this.hoverEnabled || this.hoverObject)
            this.hoverObject = null

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

        const intersects = this.checkIntersection()
        if (intersects) this.dispatchEvent({type: 'hitObject', time: this._mouseUpTime, intersects})
        else this.dispatchEvent({type: 'hitObject', time: this._mouseUpTime, intersects: {selectedObject: null, intersect: null, intersects: []}})
        this.selectedObject = intersects?.selectedObject || null
    }

    checkIntersection() {
        const camera = this._camera

        if (!camera) return null

        this.raycaster.setFromCamera(this.mouse, camera)

        let intersects = this.raycaster.intersectObject<IObject3D>(this._root, true)

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
            if (selectedObject != null) intersects2.push(intersect1)
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
                return {selectedObject, intersect, intersects, mouse: this.mouse.toArray()}

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
