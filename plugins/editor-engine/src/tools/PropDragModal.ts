/**
 * An interactive modal over the redo-last mechanism: run an operator once with its defaults, then
 * let the mouse drive one of its props until a click confirms or Esc cancels.
 *
 * Blender's inset and bevel modals (`editmesh_inset.cc` `edbm_inset_modal`, `editmesh_bevel.cc`
 * `edbm_bevel_modal`) work the same way from the user's side: the horizontal mouse distance from where
 * the operator started maps to the thickness/offset, the wheel changes the segment count, and the
 * operator is re-executed on every change. Blender re-executes in place on a cached copy of the mesh;
 * here each change is Blender's own redo path - pop the step, exec with the new value, push - which is
 * exactly what the panel does, so the modal and the panel cannot disagree. The cost is one command run
 * per mouse move, throttled to a frame.
 */

import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {StatusHints} from '../registry'

export interface PropDragSpec {
    /** The operator to run and then adjust. */
    operatorId: string
    /** The prop the mouse drives. */
    prop: string
    /** Props to start with (the operator's defaults). */
    initial?: Record<string, unknown>
    /** World units per screen pixel of mouse travel. Default: measured at the selection's depth. */
    unitsPerPixel?: number
    /** Clamp. */
    min?: number
    max?: number
    /** An integer prop the mouse wheel steps (bevel segments). */
    wheelProp?: string
    /** Status-bar label. Default: the operator's label. */
    label?: string
}

export class PropDragModal {
    private _startX = 0
    private _initialValue = 0
    private _value = 0
    private _props: Record<string, unknown> = {}
    private _frame = 0
    private _pendingValue: number | null = null
    private _done = false
    private _step: unknown = null

    constructor(private _engine: EditorEnginePlugin, readonly spec: PropDragSpec) {}

    get active(): boolean {
        return !this._done && this._engine.propDrag === this
    }

    /** Run the operator with its defaults and take over the pointer. */
    async start(): Promise<boolean> {
        const engine = this._engine
        const op = engine.operators.get(this.spec.operatorId)
        if (!op) return false
        this._props = {...this.spec.initial}
        this._startX = engine.input.pointer.clientX
        const result = await engine.run(op.id, Object.keys(this._props).length ? this._props : undefined)
        if (!result.ok || !engine.lastOperation?.redo || engine.lastOperation.operator.id !== op.id) return false
        this._props = {...engine.lastOperation.props}
        this._initialValue = Number(this._props[this.spec.prop] ?? 0)
        this._value = this._initialValue
        this._step = engine.history.peek()
        engine.propDrag = this
        const canvas = engine.viewer.canvas
        canvas.addEventListener('pointermove', this._onMove)
        canvas.addEventListener('pointerdown', this._onDown, true)
        canvas.addEventListener('wheel', this._onWheel, {capture: true, passive: false})
        engine.dispatchEvent({type: 'statusChanged', hints: engine.status})
        return true
    }

    private _unitsPerPixel(): number {
        if (this.spec.unitsPerPixel) return this.spec.unitsPerPixel
        // World units per pixel at the selection's depth, as `MeshEditPlugin._unitsPerPixel` measures it.
        const viewer = this._engine.viewer
        const camera = viewer.scene.mainCamera as any
        const object = this._engine.meshEdit.editObject
        const bm = this._engine.meshEdit.state?.bm
        const rect = viewer.canvas.getBoundingClientRect()
        if (!object || !bm) return 0.005
        let x = 0, y = 0, z = 0, n = 0
        for (const v of bm.verts) {
            if (!(v.hflag & 1)) continue
            x += v.x; y += v.y; z += v.z; n++
        }
        const centre = {x: n ? x / n : 0, y: n ? y / n : 0, z: n ? z / n : 0}
        object.updateWorldMatrix(true, false)
        const e = object.matrixWorld.elements
        const wx = e[0] * centre.x + e[4] * centre.y + e[8] * centre.z + e[12]
        const wy = e[1] * centre.x + e[5] * centre.y + e[9] * centre.z + e[13]
        const wz = e[2] * centre.x + e[6] * centre.y + e[10] * centre.z + e[14]
        if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / (camera.zoom || 1) / Math.max(1, rect.height)
        const c = camera.matrixWorld.elements
        const dist = Math.max(0.001, Math.hypot(wx - c[12], wy - c[13], wz - c[14]))
        const fov = (camera.fov ?? 45) * Math.PI / 180
        return 2 * Math.tan(fov / 2) * dist / Math.max(1, rect.height)
    }

    private _onMove = (event: PointerEvent): void => {
        if (!this.active) return
        const dx = event.clientX - this._startX
        const scale = this._unitsPerPixel() * (event.shiftKey ? 0.1 : 1)
        let value = this._initialValue + dx * scale
        if (this.spec.min !== undefined) value = Math.max(this.spec.min, value)
        if (this.spec.max !== undefined) value = Math.min(this.spec.max, value)
        this._schedule(value)
    }

    private _onDown = (event: PointerEvent): void => {
        if (!this.active) return
        if (event.button === 0) {
            event.preventDefault()
            event.stopPropagation()
            this.confirm()
        } else if (event.button === 2) {
            event.preventDefault()
            event.stopPropagation()
            this.cancel()
        }
    }

    private _onWheel = (event: WheelEvent): void => {
        if (!this.active || !this.spec.wheelProp) return
        event.preventDefault()
        event.stopPropagation()
        const current = Number(this._props[this.spec.wheelProp] ?? 1)
        this._props[this.spec.wheelProp] = Math.max(1, Math.round(current + (event.deltaY < 0 ? 1 : -1)))
        this._schedule(this._value)
    }

    /** Keys the modal owns: Esc cancels, Enter confirms, digits type the value. */
    handleKey(event: KeyboardEvent): boolean {
        if (!this.active) return false
        if (event.code === 'Escape') {
            this.cancel()
            return true
        }
        if (event.code === 'Enter' || event.code === 'NumpadEnter') {
            this.confirm()
            return true
        }
        return false
    }

    private _schedule(value: number): void {
        this._pendingValue = value
        if (this._frame) return
        this._frame = requestAnimationFrame(() => {
            this._frame = 0
            const v = this._pendingValue
            this._pendingValue = null
            if (v === null || !this.active) return
            void this._apply(v)
        })
    }

    private async _apply(value: number): Promise<void> {
        const last = this._engine.lastOperation
        if (!last?.redo || last.operator.id !== this.spec.operatorId) {
            this.cancel()
            return
        }
        this._value = Math.round(value * 10000) / 10000
        this._props = {...this._props, [this.spec.prop]: this._value}
        await last.redo(this._props)
        this._step = this._engine.history.peek()
        this._engine.dispatchEvent({type: 'statusChanged', hints: this._engine.status})
    }

    confirm(): void {
        if (this._done) return
        this._finish()
    }

    /** Undo the operator's step and leave. */
    cancel(): void {
        if (this._done) return
        this._finish()
        if (this._step) this._engine.history.undoTo(this._step as object)
        this._engine.setLastOperation(null)
    }

    private _finish(): void {
        this._done = true
        cancelAnimationFrame(this._frame)
        this._frame = 0
        const canvas = this._engine.viewer.canvas
        canvas.removeEventListener('pointermove', this._onMove)
        canvas.removeEventListener('pointerdown', this._onDown, true)
        canvas.removeEventListener('wheel', this._onWheel, true)
        if (this._engine.propDrag === this) this._engine.propDrag = null
        this._engine.dispatchEvent({type: 'statusChanged', hints: this._engine.status})
        this._engine.dispatchEvent({type: 'toolChanged', tool: this._engine.activeTool})
    }

    hints(): StatusHints {
        const label = this.spec.label ?? this._engine.operators.get(this.spec.operatorId)?.label ?? this.spec.operatorId
        const extra = this.spec.wheelProp ? ` · ${this.spec.wheelProp}: ${this._props[this.spec.wheelProp] ?? 1}` : ''
        return {
            modal: `${label}: ${this.spec.prop} ${this._value.toFixed(3)}${extra}`,
            lmb: 'Confirm',
            rmb: 'Cancel',
            keys: [
                {key: 'Drag', label: `Adjust ${this.spec.prop}`},
                ...(this.spec.wheelProp ? [{key: 'Wheel', label: `Change ${this.spec.wheelProp}`}] : []),
                {key: 'Shift', label: 'Precision'},
                {key: 'Enter', label: 'Confirm'},
                {key: 'Esc', label: 'Cancel'},
            ],
        }
    }
}
