/**
 * An interactive modal over the redo-last mechanism: run an operator once with its defaults, then
 * let the mouse - or typed digits - drive one of its props until a click or Enter confirms, or Esc or
 * a right click cancels.
 *
 * Blender's inset and bevel modals (`editmesh_inset.cc` `edbm_inset_invoke` :342 / `edbm_inset_modal`
 * :378, `editmesh_bevel.cc` `edbm_bevel_invoke` :529 / `edbm_bevel_modal` :716; Blender main
 * e4e6c79a), from the user's side:
 * - the value follows the mouse's distance from the selection's centre on screen, one pixel being
 *   one pixel's worth of world units at that depth (`ED_view3d_pixel_size`). Inset gets thicker as the
 *   mouse moves *towards* the centre (`amount = old_thickness - (len - initial_length) * pixel_size`,
 *   :427), bevel wider as it moves *away* (`edbm_bevel_mouse_set_value`, :572);
 * - Shift slows it down tenfold from where Shift went down ("fake shift-transform", :432, :587);
 * - digits type the value (`handleNumInput`, :384 and :562): while a typed value is active the mouse
 *   no longer drives it, and the header shows what was typed;
 * - the wheel changes the segment count (bevel);
 * - Enter or a left click confirms, Esc or a right click cancels.
 *
 * Blender re-executes in place on a cached copy of the mesh; here each change is Blender's own redo
 * path - pop the step, exec with the new value, push - which is exactly what the panel does, so the
 * modal and the panel cannot disagree. The cost is one command run per change, throttled to a frame.
 *
 * One deviation: Blender takes the reference distance where the operator was invoked, which is always
 * inside the 3D view. Started from the toolbar, the pointer is outside the canvas, so the reference is
 * taken where the pointer first moves over it instead.
 */

import {
    applyNumInput,
    handleNumInput,
    hasNumInput,
    initNumInput,
    NumInput,
    outputNumInput,
} from '@threepipe/plugin-mesh-edit'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {StatusHints} from '../registry'

export interface PropDragSpec {
    /** The operator to run and then adjust. */
    operatorId: string
    /** The prop the mouse drives. */
    prop: string
    /** Props to start with (the operator's defaults). */
    initial?: Record<string, unknown>
    /**
     * +1: the value grows as the mouse moves away from the selection's centre (bevel); -1: as it moves
     * towards it (inset). Default +1.
     */
    direction?: 1 | -1
    /** World units per screen pixel of mouse travel. Default: measured at the selection's depth. */
    unitsPerPixel?: number
    /** Clamp. */
    min?: number
    max?: number
    /** An integer prop the mouse wheel steps (bevel segments). */
    wheelProp?: string
    /** Status-bar label. Default: the operator's label. */
    label?: string
    /**
     * Keys (`KeyboardEvent.code`) that flip a boolean prop while the modal runs, as the inset modal's
     * O / B / I flip outset, boundary and individual (`editmesh_inset.cc:514`, `:528`, `:542`).
     */
    toggles?: Record<string, {prop: string, label: string, default?: boolean}>
}

export class PropDragModal {
    private _initialValue = 0
    private _value = 0
    private _props: Record<string, unknown> = {}
    private _frame = 0
    private _pendingValue: number | null = null
    private _done = false
    private _step: unknown = null
    /** The selection's median centre on screen, client pixels (`opdata->mcenter`). */
    private _centre = {x: 0, y: 0}
    /** The pointer's distance from the centre when the modal started (`opdata->initial_length`). */
    private _initialLength: number | null = null
    private _pixelSize = 0.005
    /** The value when Shift went down (`opdata->shift_amount`), null while Shift is up. */
    private _shiftAmount: number | null = null
    /** Typed input (`opdata->num_input`). */
    private readonly _num = new NumInput()
    /** Re-runs are serialised: a change waits for the one before it. */
    private _running: Promise<void> = Promise.resolve()
    private _applying = false
    /** The last re-run's warnings, shown once the modal is confirmed. */
    private _warnings: string[] = []

    constructor(private _engine: EditorEnginePlugin, readonly spec: PropDragSpec) {
        initNumInput(this._num)
        this._num.idxMax = 0
        this._num.unitType[0] = 'length'
    }

    get active(): boolean {
        return !this._done && this._engine.propDrag === this
    }

    /**
     * True while the modal itself re-runs its operator. Operators refuse to run while a modal is
     * active (`notModalMessage`); the modal's own re-runs are the exception.
     */
    get applying(): boolean {
        return this._applying
    }

    /** Run the operator with its defaults and take over the pointer. */
    async start(): Promise<boolean> {
        const engine = this._engine
        const op = engine.operators.get(this.spec.operatorId)
        if (!op) return false
        this._props = {...this.spec.initial}
        const result = await engine.run(op.id, Object.keys(this._props).length ? this._props : undefined)
        if (!result.ok || !engine.lastOperation?.redo || engine.lastOperation.operator.id !== op.id) return false
        this._props = {...engine.lastOperation.props}
        this._initialValue = Number(this._props[this.spec.prop] ?? 0)
        this._value = this._initialValue
        this._step = engine.history.peek()
        this._measure()
        engine.propDrag = this
        const canvas = engine.viewer.canvas
        canvas.addEventListener('pointermove', this._onMove)
        canvas.addEventListener('pointerdown', this._onDown, true)
        canvas.addEventListener('wheel', this._onWheel, {capture: true, passive: false})
        engine.dispatchEvent({type: 'statusChanged', hints: engine.status})
        return true
    }

    /**
     * The centre on screen, the pixel size at its depth and the reference distance
     * (`calculateTransformCenter`, `ED_view3d_pixel_size`, `edbm_inset_invoke` :358-368).
     */
    private _measure(): void {
        const viewer = this._engine.viewer
        const camera = viewer.scene.mainCamera as any
        const object = this._engine.meshEdit.editObject
        const bm = this._engine.meshEdit.state?.bm
        const rect = viewer.canvas.getBoundingClientRect()
        let x = 0, y = 0, z = 0, n = 0
        if (bm) {
            for (const v of bm.verts) {
                if (!(v.hflag & 1)) continue
                x += v.x; y += v.y; z += v.z; n++
            }
        }
        const local = {x: n ? x / n : 0, y: n ? y / n : 0, z: n ? z / n : 0}
        let world = local
        if (object) {
            object.updateWorldMatrix(true, false)
            const e = object.matrixWorld.elements
            world = {
                x: e[0] * local.x + e[4] * local.y + e[8] * local.z + e[12],
                y: e[1] * local.x + e[5] * local.y + e[9] * local.z + e[13],
                z: e[2] * local.x + e[6] * local.y + e[10] * local.z + e[14],
            }
        }
        camera.updateMatrixWorld?.()
        const p = new (camera.position.constructor)(world.x, world.y, world.z).project(camera)
        this._centre = {x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height}
        if (this.spec.unitsPerPixel) {
            this._pixelSize = this.spec.unitsPerPixel
        } else if (camera.isOrthographicCamera) {
            this._pixelSize = (camera.top - camera.bottom) / (camera.zoom || 1) / Math.max(1, rect.height)
        } else {
            const c = camera.matrixWorld.elements
            const dist = Math.max(0.001, Math.hypot(world.x - c[12], world.y - c[13], world.z - c[14]))
            const fov = (camera.fov ?? 45) * Math.PI / 180
            this._pixelSize = 2 * Math.tan(fov / 2) * dist / Math.max(1, rect.height)
        }
        // The router only sees the pointer over the canvas, so its last position is stale when the modal
        // was started from the tool shelf or a menu; `:hover` says where the pointer is now.
        const pointer = this._engine.input.pointer
        const inside = viewer.canvas.matches(':hover')
        this._initialLength = inside ? Math.hypot(pointer.clientX - this._centre.x, pointer.clientY - this._centre.y) : null
    }

    private _clamp(value: number): number {
        if (this.spec.min !== undefined) value = Math.max(this.spec.min, value)
        if (this.spec.max !== undefined) value = Math.min(this.spec.max, value)
        return value
    }

    private _onMove = (event: PointerEvent): void => {
        if (!this.active) return
        const len = Math.hypot(event.clientX - this._centre.x, event.clientY - this._centre.y)
        if (this._initialLength === null) {
            this._initialLength = len
            return
        }
        // A typed value is final until Backspace clears it (`if (!has_numinput)`, :414).
        if (hasNumInput(this._num)) return
        let value = this._initialValue + (this.spec.direction ?? 1) * (len - this._initialLength) * this._pixelSize
        if (event.shiftKey) {
            if (this._shiftAmount === null) this._shiftAmount = this._value
            value = (value - this._shiftAmount) * 0.1 + this._shiftAmount
        } else {
            this._shiftAmount = null
        }
        this._schedule(this._clamp(value))
    }

    private _onDown = (event: PointerEvent): void => {
        if (!this.active) return
        if (event.button === 0) {
            event.preventDefault()
            event.stopPropagation()
            void this.confirm()
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
        // Keep a value that is typed or moved but not applied yet.
        this._schedule(this._pendingValue ?? this._value)
    }

    /**
     * Keys the modal owns, in `edbm_inset_modal`'s order: typed input first while it is active, then
     * Esc cancels and Enter confirms, then a key that can start typed input (digits, `-`, `.`). Other
     * keys fall through (the keymap tells the user to finish first).
     */
    handleKey(event: KeyboardEvent): boolean {
        if (!this.active) return false
        const numEvent = {key: event.key, code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey}
        if (hasNumInput(this._num) && handleNumInput(this._num, numEvent)) {
            this._typed()
            return true
        }
        if (event.code === 'Escape') {
            this.cancel()
            return true
        }
        if (event.code === 'Enter' || event.code === 'NumpadEnter') {
            void this.confirm()
            return true
        }
        const toggle = this.spec.toggles?.[event.code]
        if (toggle && !event.ctrlKey && !event.altKey && !event.metaKey) {
            this._props = {...this._props, [toggle.prop]: !(this._props[toggle.prop] ?? toggle.default ?? false)}
            this._schedule(this._pendingValue ?? this._value)
            return true
        }
        if (handleNumInput(this._num, numEvent)) {
            this._typed()
            return true
        }
        return false
    }

    /** `applyNumInput(&opdata->num_input, amounts)` then the clamp (`max_ff(amounts[0], 0)`, :387). */
    private _typed(): void {
        const v = [this._value]
        applyNumInput(this._num, v)
        this._schedule(this._clamp(v[0]))
        this._engine.dispatchEvent({type: 'statusChanged', hints: this._engine.status})
    }

    private _schedule(value: number): void {
        this._pendingValue = value
        if (this._frame) return
        this._frame = requestAnimationFrame(() => {
            this._frame = 0
            void this._flush()
        })
    }

    /** Apply the latest pending value, after any re-run still in flight. */
    private _flush(): Promise<void> {
        this._running = this._running.then(async() => {
            const v = this._pendingValue
            this._pendingValue = null
            if (v === null || this._done) return
            await this._apply(v)
        })
        return this._running
    }

    private async _apply(value: number): Promise<void> {
        const engine = this._engine
        const last = engine.lastOperation
        if (!last || last.operator.id !== this.spec.operatorId) {
            this.cancel()
            return
        }
        this._value = Math.round(value * 10000) / 10000
        this._props = {...this._props, [this.spec.prop]: this._value}
        this._applying = true
        try {
            // A re-run that changed nothing (a bevel of width 0, while "0.15" is being typed) pushes no
            // undo step, so it has no redo; the mesh is then as it was before the operator, and the next
            // value runs it afresh.
            const result = last.redo ? await last.redo(this._props) : await engine.run(this.spec.operatorId, this._props)
            this._warnings = result.ok ? result.warnings ?? [] : []
        } finally {
            this._applying = false
        }
        // The step to take back on cancel; none when the last re-run changed nothing.
        this._step = engine.lastOperation?.operator.id === this.spec.operatorId && engine.lastOperation.redo ? engine.history.peek() : null
        engine.dispatchEvent({type: 'statusChanged', hints: engine.status})
    }

    /** Apply what is still pending (a value typed just before Enter), then leave. */
    async confirm(): Promise<void> {
        if (this._done) return
        cancelAnimationFrame(this._frame)
        this._frame = 0
        await this._flush()
        this._finish()
        for (const w of this._warnings) this._engine.message('warning', w)
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
        // `edbm_inset_update_header`: the typed text while typing, else the value.
        const value = hasNumInput(this._num) ? outputNumInput(this._num)[0] : this._value.toFixed(3)
        return {
            modal: `${label}: ${this.spec.prop} ${value}${extra}`,
            lmb: 'Confirm',
            rmb: 'Cancel',
            keys: [
                {key: 'Move', label: `Adjust ${this.spec.prop}`},
                {key: '0-9', label: 'Type a value'},
                ...(this.spec.wheelProp ? [{key: 'Wheel', label: `Change ${this.spec.wheelProp}`}] : []),
                ...Object.entries(this.spec.toggles ?? {}).map(([code, t]) => ({key: code.replace(/^Key/, ''), label: `${t.label}${(this._props[t.prop] ?? t.default) ? ' (on)' : ''}`})),
                {key: 'Shift', label: 'Precision'},
                {key: 'Enter', label: 'Confirm'},
                {key: 'Esc', label: 'Cancel'},
            ],
        }
    }
}
