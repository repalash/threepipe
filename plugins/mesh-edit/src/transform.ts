/**
 * The modal transform: move, rotate and scale a selection interactively.
 *
 * Ported in structure from `editors/transform/` (`transform.cc`, `transform_mode_translate.cc`,
 * `transform_constraints.cc`). Blender's design is worth following closely because the ergonomics are
 * load-bearing: press `G`, move the mouse, type `X` to lock an axis, type a number to be exact, click
 * to confirm or `Esc` to cancel. Every part of that is a state machine over one snapshot of the
 * starting positions.
 *
 * The rules ported here:
 * - **Positions are snapshotted on start** and every update recomputes from the snapshot, never from
 *   the previous frame. That is what makes axis changes and numeric entry mid-drag behave.
 * - **Constraints project the free delta** onto an axis or a plane, rather than zeroing components,
 *   so a constrained drag still tracks the mouse sensibly at any camera angle.
 * - **Cancel restores the snapshot exactly**; it does not apply an inverse transform.
 *
 * This module is renderer-free and takes the few camera-dependent values it needs as inputs, so the
 * whole state machine is testable without a viewport.
 */

import {BMVert, BMesh, ElemFlag, SelectMode} from '@threepipe/mesh-kernel'

export type TransformMode = 'translate' | 'rotate' | 'resize'

/** Which axes the transform is confined to. Empty means unconstrained. */
export interface TransformConstraint {
    /** Axis indices, 0 = x, 1 = y, 2 = z. One entry is a line, two is a plane. */
    axes: number[]
    /** `local` uses the object's axes; `global` uses world axes. */
    orientation: 'global' | 'local'
}

export interface TransformStartOptions {
    mode: TransformMode
    /** Screen position where the drag began. */
    startX: number
    startY: number
    /**
     * World units per pixel at the pivot's depth, so drags feel the same at any zoom.
     * The caller computes this from the camera.
     */
    unitsPerPixel: number
    /** Camera right and up in the object's space, for mapping screen motion into the mesh. */
    cameraRight: [number, number, number]
    cameraUp: [number, number, number]
    /** Camera forward, used as the rotation axis when unconstrained. */
    cameraForward: [number, number, number]
}

interface VertSnapshot {
    v: BMVert
    x: number
    y: number
    z: number
}

/** A numeric-entry buffer, mirroring Blender's `NumInput`: type digits to be exact. */
export class NumericInput {
    private _text = ''
    active = false

    get text(): string {
        return this._text
    }

    get value(): number | null {
        if (!this.active || !this._text || this._text === '-' || this._text === '.') return null
        const n = Number(this._text)
        return Number.isFinite(n) ? n : null
    }

    /** Feed a key. Returns true when the key was consumed. */
    handleKey(key: string): boolean {
        if (key >= '0' && key <= '9') {
            this._text += key
            this.active = true
            return true
        }
        switch (key) {
        case '.':
            if (!this._text.includes('.')) this._text += '.'
            this.active = true
            return true
        case '-':
            this._text = this._text.startsWith('-') ? this._text.slice(1) : '-' + this._text
            this.active = true
            return true
        case 'Backspace':
            this._text = this._text.slice(0, -1)
            if (!this._text) this.active = false
            return true
        default:
            return false
        }
    }

    reset(): void {
        this._text = ''
        this.active = false
    }
}

function normalise(v: [number, number, number]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2])
    return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1]
}

/**
 * One interactive transform, from first mouse move to confirm or cancel.
 *
 * Construct on `G`/`R`/`S`, feed it mouse positions and keys, then `confirm()` or `cancel()`.
 */
export class ModalTransform {
    readonly mode: TransformMode
    readonly constraint: TransformConstraint = {axes: [], orientation: 'global'}
    readonly numeric = new NumericInput()

    /** Multiplies mouse motion; Blender's `Shift` precision modifier. */
    precision = false

    private _snapshot: VertSnapshot[] = []
    private _pivot: [number, number, number] = [0, 0, 0]
    private _opts: TransformStartOptions
    private _currentX: number
    private _currentY: number
    private _done = false

    constructor(bm: BMesh, options: TransformStartOptions) {
        this._opts = options
        this.mode = options.mode
        this._currentX = options.startX
        this._currentY = options.startY

        // Snapshot every vertex the selection touches. Working from the snapshot rather than from the
        // last frame is what lets the axis or the typed number change mid-drag.
        const verts = collectTransformVerts(bm)
        this._snapshot = verts.map(v => ({v, x: v.x, y: v.y, z: v.z}))

        if (this._snapshot.length) {
            let px = 0, py = 0, pz = 0
            for (const s of this._snapshot) {
                px += s.x
                py += s.y
                pz += s.z
            }
            const n = this._snapshot.length
            this._pivot = [px / n, py / n, pz / n]
        }
    }

    get isEmpty(): boolean {
        return this._snapshot.length === 0
    }

    get pivot(): readonly [number, number, number] {
        return this._pivot
    }

    get elementCount(): number {
        return this._snapshot.length
    }

    /** Human-readable status, the text Blender puts in the header during a modal op. */
    get status(): string {
        const axisNames = this.constraint.axes.map(a => 'XYZ'[a]).join('')
        const axis = axisNames ? ` [${axisNames}${this.constraint.orientation === 'local' ? ' local' : ''}]` : ''
        const num = this.numeric.active ? ` = ${this.numeric.text}` : ''
        const value = this._scalarValue()
        const shown = this.numeric.active ? this.numeric.text : value.toFixed(3)
        switch (this.mode) {
        case 'translate': return `Move ${shown}${axis}${num ? '' : ''}`
        case 'rotate': return `Rotate ${(value * 180 / Math.PI).toFixed(1)}°${axis}`
        case 'resize': return `Scale ${shown}${axis}`
        }
    }

    setMousePosition(x: number, y: number): void {
        this._currentX = x
        this._currentY = y
        this.apply()
    }

    /** Constrain to one axis, or to the plane perpendicular to it when `plane` is set. */
    setAxis(axis: number, plane = false): void {
        const wanted = plane ? [0, 1, 2].filter(a => a !== axis) : [axis]
        const same = wanted.length === this.constraint.axes.length
            && wanted.every(a => this.constraint.axes.includes(a))
        if (same && this.constraint.orientation === 'global') {
            // Pressing the same key again cycles to local, then off, as Blender does.
            this.constraint.orientation = 'local'
        } else if (same) {
            this.constraint.axes = []
            this.constraint.orientation = 'global'
        } else {
            this.constraint.axes = wanted
            this.constraint.orientation = 'global'
        }
        this.apply()
    }

    clearConstraint(): void {
        this.constraint.axes = []
        this.constraint.orientation = 'global'
        this.apply()
    }

    handleNumericKey(key: string): boolean {
        const consumed = this.numeric.handleKey(key)
        if (consumed) this.apply()
        return consumed
    }

    /** The scalar the mode is driven by: distance, angle, or factor. */
    private _scalarValue(): number {
        const numeric = this.numeric.value
        if (numeric !== null) return this.mode === 'rotate' ? numeric * Math.PI / 180 : numeric

        const dx = this._currentX - this._opts.startX
        const dy = this._currentY - this._opts.startY
        const scale = this.precision ? 0.1 : 1

        switch (this.mode) {
        case 'translate':
            return Math.hypot(dx, dy) * this._opts.unitsPerPixel * scale
        case 'rotate':
            // Angle swept about the pivot, as seen on screen.
            return Math.atan2(dy, dx) * scale
        case 'resize': {
            const d = Math.hypot(dx, dy)
            return 1 + d * this._opts.unitsPerPixel * scale * Math.sign(dx || 1)
        }
        }
    }

    /** Free-space translation from the mouse delta, before constraints. */
    private _freeDelta(): [number, number, number] {
        const dx = (this._currentX - this._opts.startX) * this._opts.unitsPerPixel
        const dy = -(this._currentY - this._opts.startY) * this._opts.unitsPerPixel
        const s = this.precision ? 0.1 : 1
        const r = this._opts.cameraRight
        const u = this._opts.cameraUp
        return [
            (r[0] * dx + u[0] * dy) * s,
            (r[1] * dx + u[1] * dy) * s,
            (r[2] * dx + u[2] * dy) * s,
        ]
    }

    /**
     * Project a free delta onto the constraint.
     *
     * A single axis keeps the component along it. A plane removes the component along its normal.
     * Blender builds a projection matrix for this; the result is the same and this is clearer.
     */
    private _constrain(delta: [number, number, number]): [number, number, number] {
        const axes = this.constraint.axes
        if (!axes.length) return delta

        if (axes.length === 1) {
            const a = axes[0]
            const out: [number, number, number] = [0, 0, 0]
            out[a] = delta[a]
            return out
        }
        // Plane: drop the one axis not listed.
        const missing = [0, 1, 2].find(a => !axes.includes(a))!
        const out: [number, number, number] = [delta[0], delta[1], delta[2]]
        out[missing] = 0
        return out
    }

    /** Recompute every vertex from the snapshot. Idempotent, so it is safe to call on any input. */
    apply(): void {
        if (this._done || !this._snapshot.length) return

        switch (this.mode) {
        case 'translate': {
            let delta = this._freeDelta()
            const numeric = this.numeric.value
            if (numeric !== null) {
                // With a typed value, the constraint axis gives the direction; otherwise use the
                // free direction normalised to the typed length.
                if (this.constraint.axes.length === 1) {
                    delta = [0, 0, 0]
                    delta[this.constraint.axes[0]] = numeric
                } else {
                    const dir = normalise(delta)
                    delta = [dir[0] * numeric, dir[1] * numeric, dir[2] * numeric]
                }
            } else {
                delta = this._constrain(delta)
            }
            for (const s of this._snapshot) {
                s.v.x = s.x + delta[0]
                s.v.y = s.y + delta[1]
                s.v.z = s.z + delta[2]
            }
            break
        }
        case 'resize': {
            const factor = this._scalarValue()
            const axes = this.constraint.axes
            const per: [number, number, number] = axes.length
                ? [axes.includes(0) ? factor : 1, axes.includes(1) ? factor : 1, axes.includes(2) ? factor : 1]
                : [factor, factor, factor]
            for (const s of this._snapshot) {
                s.v.x = this._pivot[0] + (s.x - this._pivot[0]) * per[0]
                s.v.y = this._pivot[1] + (s.y - this._pivot[1]) * per[1]
                s.v.z = this._pivot[2] + (s.z - this._pivot[2]) * per[2]
            }
            break
        }
        case 'rotate': {
            const angle = this._scalarValue()
            const axis = this.constraint.axes.length === 1
                ? ([[1, 0, 0], [0, 1, 0], [0, 0, 1]][this.constraint.axes[0]] as [number, number, number])
                : normalise(this._opts.cameraForward)
            rotateAboutAxis(this._snapshot, this._pivot, axis, angle)
            break
        }
        }
    }

    /** Keep the current positions. */
    confirm(): void {
        this._done = true
    }

    /** Put every vertex back exactly where it started. */
    cancel(): void {
        for (const s of this._snapshot) {
            s.v.x = s.x
            s.v.y = s.y
            s.v.z = s.z
        }
        this._done = true
    }

    get isDone(): boolean {
        return this._done
    }
}

/** Rodrigues rotation of each snapshot vertex about an axis through the pivot. */
function rotateAboutAxis(
    snapshot: VertSnapshot[],
    pivot: readonly [number, number, number],
    axis: [number, number, number],
    angle: number,
): void {
    const [ax, ay, az] = normalise(axis)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const t = 1 - c

    // Rotation matrix built once for the whole selection.
    const m = [
        t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
        t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
        t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
    ]

    for (const p of snapshot) {
        const x = p.x - pivot[0]
        const y = p.y - pivot[1]
        const z = p.z - pivot[2]
        p.v.x = pivot[0] + m[0] * x + m[1] * y + m[2] * z
        p.v.y = pivot[1] + m[3] * x + m[4] * y + m[5] * z
        p.v.z = pivot[2] + m[6] * x + m[7] * y + m[8] * z
    }
}

/**
 * Every vertex the current selection moves.
 *
 * In vertex mode that is the selected vertices; in edge and face mode it is the vertices of the
 * selected elements, which is how Blender's `createTransEditVerts` gathers them.
 */
export function collectTransformVerts(bm: BMesh): BMVert[] {
    const out = new Set<BMVert>()

    if (bm.selectMode & SelectMode.Face) {
        for (const f of bm.faces) {
            if (!(f.hflag & ElemFlag.Select)) continue
            for (const l of f.eachLoop()) out.add(l.v)
        }
    }
    if (bm.selectMode & SelectMode.Edge) {
        for (const e of bm.edges) {
            if (!(e.hflag & ElemFlag.Select)) continue
            out.add(e.v1)
            out.add(e.v2)
        }
    }
    if (bm.selectMode & SelectMode.Vertex) {
        for (const v of bm.verts) if (v.hflag & ElemFlag.Select) out.add(v)
    }

    return [...out].filter(v => !(v.hflag & ElemFlag.Hidden))
}
