import type {VolumeMaterial} from '../VolumeMaterial'
import {volumePresets} from '../library'

/**
 * What the editor needs from an undo manager (the `undoManager` of `UndoManagerPlugin`).
 */
export interface TransferFunctionEditorUndo {
    record(command: {undo: () => void, redo: () => void}): unknown
}

export interface TransferFunctionEditorOptions {
    /**
     * Height of the drawing in CSS pixels. Default 164.
     */
    height?: number
    /**
     * The undo manager to record one step per drag in; default: the one {@link VolumeMaterial.undoManager} has
     * (set by `VolumePlugin`).
     */
    undoManager?: TransferFunctionEditorUndo
}

interface Snapshot {
    colors: number[][]
    opacities: number[][]
    range: [number, number]
}

type DragKind = 'opacity' | 'color' | 'range-move' | 'range-low' | 'range-high'

const css = `
.tp-vol-tfe{font:11px/1.3 system-ui,sans-serif;color:inherit;user-select:none;-webkit-user-select:none;padding:4px 0;width:100%;box-sizing:border-box}
.tp-vol-tfe-bar{display:flex;gap:4px;align-items:center;margin-bottom:4px;flex-wrap:wrap}
.tp-vol-tfe-bar select,.tp-vol-tfe-bar button{font:inherit;color:inherit;background:rgba(127,127,127,.15);border:1px solid rgba(127,127,127,.3);border-radius:4px;padding:2px 6px;min-height:22px}
.tp-vol-tfe-bar select{flex:1;min-width:0}
.tp-vol-tfe canvas{display:block;width:100%;touch-action:none;cursor:crosshair;border-radius:4px}
.tp-vol-tfe-hint{opacity:.6;margin-top:2px}
`
let cssAdded = false

/**
 * An editor for the transfer function and the value range of a {@link VolumeMaterial}, as plain DOM (no UI library):
 *
 * - the opacity curve over the histogram of the field: drag a point, click to add one, double-click (or long press)
 *   a point to remove it;
 * - the colour strip below: drag a stop, tap a stop to pick its colour, double-click the strip to add a stop,
 *   double-click a stop to remove it;
 * - the window bar at the bottom, over the value range of the data: drag it to move the window (level), drag its
 *   ends to change its width;
 * - a preset menu, and load and save of `.clut` and JSON files.
 *
 * Each drag is one undo step. Put {@link element} anywhere: the material's uiConfig shows it in Tweakpane
 * (`domChildren`), and an example card can take it as content.
 *
 * @category UI
 */
export class TransferFunctionEditor {
    readonly element: HTMLDivElement
    readonly canvas: HTMLCanvasElement
    private _ctx: CanvasRenderingContext2D
    private _presetSelect: HTMLSelectElement
    private _height: number
    private _width = 0
    private _drawQueued = false
    private _resize?: ResizeObserver
    private _drag?: {kind: DragKind, index: number, startX: number, startY: number, moved: boolean, before: Snapshot, rangeStart: [number, number]}
    private _longPress?: ReturnType<typeof setTimeout>
    private _colorInput: HTMLInputElement

    constructor(readonly material: VolumeMaterial, readonly options: TransferFunctionEditorOptions = {}) {
        this._height = options.height ?? 164
        if (!cssAdded && typeof document !== 'undefined') {
            const style = document.createElement('style')
            style.textContent = css
            document.head.appendChild(style)
            cssAdded = true
        }
        const el = this.element = document.createElement('div')
        el.className = 'tp-vol-tfe'

        const bar = document.createElement('div')
        bar.className = 'tp-vol-tfe-bar'
        this._presetSelect = document.createElement('select')
        this._presetSelect.title = 'Preset'
        this._presetSelect.addEventListener('change', () => {
            const name = this._presetSelect.value
            if (!name) return
            this._recordAround(() => this.material.setPreset(name))
        })
        bar.appendChild(this._presetSelect)
        bar.appendChild(this._button('Load', 'Load a .clut colour table, a NiiVue colour map or a saved transfer function', () => this._load()))
        bar.appendChild(this._button('Save', 'Save as an MRIcroGL .clut colour table', () => this._save()))
        bar.appendChild(this._button('Fit', 'Fit the window to the value range of the data', () => this._recordAround(() => this.material.resetRange())))
        el.appendChild(bar)

        const canvas = this.canvas = document.createElement('canvas')
        canvas.style.height = this._height + 'px'
        el.appendChild(canvas)
        this._ctx = canvas.getContext('2d')!

        const hint = document.createElement('div')
        hint.className = 'tp-vol-tfe-hint'
        hint.textContent = 'Curve: drag, click to add, double-click to remove. Colours: drag, tap to pick. Bottom: window.'
        el.appendChild(hint)

        this._colorInput = document.createElement('input')
        this._colorInput.type = 'color'
        this._colorInput.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0'
        el.appendChild(this._colorInput)

        canvas.addEventListener('pointerdown', this._down)
        canvas.addEventListener('pointermove', this._move)
        canvas.addEventListener('pointerup', this._up)
        canvas.addEventListener('pointercancel', this._up)
        canvas.addEventListener('dblclick', this._dblclick)
        canvas.addEventListener('contextmenu', this._contextmenu)

        material.transferFunction.addEventListener('update', this._queueDraw)
        ;(material as any).addEventListener('materialUpdate', this._queueDraw)
        if (typeof ResizeObserver !== 'undefined') {
            this._resize = new ResizeObserver(() => this._queueDraw())
            this._resize.observe(canvas)
        }
        this._fillPresets()
        this._queueDraw()
    }

    dispose() {
        this.material.transferFunction.removeEventListener('update', this._queueDraw)
        ;(this.material as any).removeEventListener('materialUpdate', this._queueDraw)
        this._resize?.disconnect()
        this.element.remove()
    }

    // region layout: curve on top, the colour strip with its stops, the window bar at the bottom

    private get _pad() {
        return 7
    }
    private get _curveTop() {
        return 4
    }
    private get _curveBottom() {
        return this._height - 56
    }
    private get _stripTop() {
        return this._height - 50
    }
    private get _stripBottom() {
        return this._height - 36
    }
    // the bar from windowTop + 1 to + 9, its numbers below it
    private get _windowTop() {
        return this._height - 24
    }

    private _xToT(x: number) {
        return Math.min(1, Math.max(0, (x - this._pad) / Math.max(1, this._width - 2 * this._pad)))
    }
    private _tToX(t: number) {
        return this._pad + t * (this._width - 2 * this._pad)
    }
    private _yToOpacity(y: number) {
        return Math.min(1, Math.max(0, (this._curveBottom - y) / (this._curveBottom - this._curveTop)))
    }
    private _opacityToY(a: number) {
        return this._curveBottom - a * (this._curveBottom - this._curveTop)
    }

    // the value range of the data, over which the window bar is drawn
    private _dataRange(): [number, number] {
        const field = this.material.lastField
        const [r0, r1] = this.material.effectiveRange(field)
        const [d0, d1] = field ? field.valueRange : [r0, r1]
        return [Math.min(d0, r0), Math.max(d1, r1)]
    }

    // endregion

    // region drawing

    private _queueDraw = () => {
        if (this._drawQueued) return
        this._drawQueued = true
        requestAnimationFrame(() => {
            this._drawQueued = false
            this.draw()
        })
    }

    /**
     * Draw now (the editor draws itself on changes; call after resizing its container while hidden).
     */
    draw() {
        const canvas = this.canvas
        const w = canvas.clientWidth
        if (!w) return
        const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(this._height * dpr)) {
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(this._height * dpr)
        }
        this._width = w
        const ctx = this._ctx
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, this._height)
        const fg = getComputedStyle(this.element).color || '#ccc'
        const tf = this.material.transferFunction
        const field = this.material.lastField
        const [r0, r1] = this.material.effectiveRange(field)

        // curve area background and histogram (log counts) over the window
        ctx.fillStyle = 'rgba(127,127,127,0.1)'
        ctx.fillRect(this._pad, this._curveTop, w - 2 * this._pad, this._curveBottom - this._curveTop)
        if (field) {
            const bins = Math.max(16, Math.min(256, Math.floor((w - 2 * this._pad) / 2)))
            const h = field.histogram(bins, [r0, r1])
            let max = 0
            for (let i = 0; i < bins; i++) max = Math.max(max, Math.log1p(h[i]))
            if (max > 0) {
                ctx.fillStyle = 'rgba(127,127,127,0.35)'
                const bw = (w - 2 * this._pad) / bins
                for (let i = 0; i < bins; i++) {
                    const bh = Math.log1p(h[i]) / max * (this._curveBottom - this._curveTop)
                    ctx.fillRect(this._pad + i * bw, this._curveBottom - bh, Math.max(1, bw - 0.5), bh)
                }
            }
        }

        // the area under the opacity curve, in the colours of the function
        const ops = sorted(tf.opacityPoints)
        const grad = ctx.createLinearGradient(this._tToX(0), 0, this._tToX(1), 0)
        for (let i = 0; i <= 16; i++) {
            const [cr, cg, cb] = tf.evaluate(i / 16)
            grad.addColorStop(i / 16, rgb(cr, cg, cb))
        }
        ctx.beginPath()
        ctx.moveTo(this._tToX(0), this._curveBottom)
        ctx.lineTo(this._tToX(0), this._opacityToY(ops[0][1]))
        for (const [t, a] of ops) ctx.lineTo(this._tToX(t), this._opacityToY(a))
        ctx.lineTo(this._tToX(1), this._opacityToY(ops[ops.length - 1][1]))
        ctx.lineTo(this._tToX(1), this._curveBottom)
        ctx.closePath()
        ctx.globalAlpha = 0.55
        ctx.fillStyle = grad
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = fg
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ops.forEach(([t, a], i) => i ? ctx.lineTo(this._tToX(t), this._opacityToY(a)) : ctx.moveTo(this._tToX(t), this._opacityToY(a)))
        ctx.stroke()
        for (const [t, a] of ops) this._dot(this._tToX(t), this._opacityToY(a), fg)

        // colour strip and its stops
        ctx.fillStyle = grad
        ctx.fillRect(this._pad, this._stripTop, w - 2 * this._pad, this._stripBottom - this._stripTop)
        for (const [t, cr, cg, cb] of sorted(tf.colorPoints)) {
            const x = this._tToX(t)
            ctx.beginPath()
            ctx.moveTo(x, this._stripBottom)
            ctx.lineTo(x - 5, this._stripBottom + 8)
            ctx.lineTo(x + 5, this._stripBottom + 8)
            ctx.closePath()
            ctx.fillStyle = rgb(cr, cg, cb)
            ctx.fill()
            ctx.strokeStyle = fg
            ctx.lineWidth = 1
            ctx.stroke()
        }

        // window bar over the value range of the data, with the numbers at its ends
        const [d0, d1] = this._dataRange()
        const toX = (v: number) => this._pad + (v - d0) / ((d1 - d0) || 1) * (w - 2 * this._pad)
        ctx.fillStyle = 'rgba(127,127,127,0.25)'
        ctx.fillRect(this._pad, this._windowTop + 3, w - 2 * this._pad, 4)
        const x0 = toX(r0), x1 = toX(r1)
        ctx.fillStyle = fg
        ctx.globalAlpha = 0.8
        ctx.fillRect(Math.min(x0, x1), this._windowTop + 1, Math.max(2, Math.abs(x1 - x0)), 8)
        ctx.globalAlpha = 1
        ctx.font = '10px system-ui,sans-serif'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = fg
        ctx.textAlign = 'left'
        ctx.fillText(fmt(r0), Math.max(this._pad, Math.min(x0, w - 80)), this._height - 1)
        ctx.textAlign = 'right'
        ctx.fillText(fmt(r1), Math.min(w - this._pad, Math.max(x1, 80)), this._height - 1)

        if (this._presetSelect.value !== this.material.preset) this._presetSelect.value = this.material.preset && volumePresets[this.material.preset] ? this.material.preset : ''
    }

    private _dot(x: number, y: number, color: string) {
        const ctx = this._ctx
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(20,20,20,0.85)'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.stroke()
    }

    // endregion

    // region interaction

    private _local(e: PointerEvent | MouseEvent) {
        const r = this.canvas.getBoundingClientRect()
        return [e.clientX - r.left, e.clientY - r.top] as const
    }

    private _hitRadius(e: PointerEvent | MouseEvent) {
        return (e as PointerEvent).pointerType === 'touch' ? 14 : 8
    }

    private _nearestOpacity(x: number, y: number, radius: number) {
        const ops = this.material.transferFunction.opacityPoints
        let best = -1, bestD = radius
        ops.forEach(([t, a], i) => {
            const d = Math.hypot(this._tToX(t) - x, this._opacityToY(a) - y)
            if (d <= bestD) {
                bestD = d
                best = i
            }
        })
        return best
    }

    private _nearestColor(x: number, radius: number) {
        const cols = this.material.transferFunction.colorPoints
        let best = -1, bestD = radius
        cols.forEach(([t], i) => {
            const d = Math.abs(this._tToX(t) - x)
            if (d <= bestD) {
                bestD = d
                best = i
            }
        })
        return best
    }

    private _snapshot(): Snapshot {
        const tf = this.material.transferFunction
        const [r0, r1] = this.material.effectiveRange(this.material.lastField)
        return {colors: tf.colorPoints.map(p => [...p]), opacities: tf.opacityPoints.map(p => [...p]), range: [r0, r1]}
    }

    private _apply(s: Snapshot) {
        const m = this.material
        m.transferFunction.colorPoints = s.colors.map(p => [...p])
        m.transferFunction.opacityPoints = s.opacities.map(p => [...p])
        m.transferFunction.setDirty()
        this._setRange(s.range[0], s.range[1], true)
    }

    private _setRange(lo: number, hi: number, last: boolean) {
        const m = this.material
        m.range.set(lo, hi)
        m.setDirty({change: 'range', needsUpdate: false, refreshUi: last})
    }

    private _record(before: Snapshot) {
        const after = this._snapshot()
        if (JSON.stringify(before) === JSON.stringify(after)) return
        const um = this.options.undoManager ?? this.material.undoManager
        um?.record({undo: () => this._apply(before), redo: () => this._apply(after)})
        this.material.setDirty({change: 'transferFunction'}) // the panels show the final values
    }

    private _recordAround(change: () => void) {
        const before = this._snapshot()
        change()
        this._record(before)
        this._queueDraw()
    }

    private _down = (e: PointerEvent) => {
        if (e.button !== 0) return
        const [x, y] = this._local(e)
        const r = this._hitRadius(e)
        const tf = this.material.transferFunction
        // the drag code below indexes the points in order
        tf.opacityPoints = sorted(tf.opacityPoints)
        tf.colorPoints = sorted(tf.colorPoints)
        const before = this._snapshot()
        const start = {startX: x, startY: y, moved: false, before, rangeStart: before.range}
        if (y >= this._windowTop - 4) {
            const [d0, d1] = this._dataRange()
            const toX = (v: number) => this._pad + (v - d0) / ((d1 - d0) || 1) * (this._width - 2 * this._pad)
            const x0 = toX(before.range[0]), x1 = toX(before.range[1])
            const kind: DragKind = Math.abs(x - x0) <= r ? 'range-low' : Math.abs(x - x1) <= r ? 'range-high' : 'range-move'
            this._drag = {kind, index: -1, ...start}
        } else if (y >= this._stripTop - 2) {
            const i = this._nearestColor(x, r)
            if (i < 0) return
            this._drag = {kind: 'color', index: i, ...start}
        } else {
            let i = this._nearestOpacity(x, y, r)
            if (i < 0) {
                // add a point here and drag it
                tf.opacityPoints.push([this._xToT(x), this._yToOpacity(y)])
                tf.opacityPoints = sorted(tf.opacityPoints)
                i = tf.opacityPoints.findIndex(p => p[0] === this._xToT(x))
                tf.setDirty()
                start.moved = true
            }
            this._drag = {kind: 'opacity', index: i, ...start}
            // a long press on a point removes it (touch has no double-click)
            if (e.pointerType === 'touch') this._longPress = setTimeout(() => this._removeOpacity(this._drag?.index ?? -1, true), 600)
        }
        try {
            this.canvas.setPointerCapture(e.pointerId)
        } catch { /* a synthetic event has no pointer to capture */ }
        e.preventDefault()
    }

    private _move = (e: PointerEvent) => {
        const d = this._drag
        if (!d) return
        const [x, y] = this._local(e)
        if (!d.moved && Math.hypot(x - d.startX, y - d.startY) < 3) return
        d.moved = true
        clearTimeout(this._longPress)
        const tf = this.material.transferFunction
        if (d.kind === 'opacity') {
            const ops = tf.opacityPoints
            const lo = d.index > 0 ? ops[d.index - 1][0] : 0
            const hi = d.index < ops.length - 1 ? ops[d.index + 1][0] : 1
            ops[d.index] = [Math.min(hi, Math.max(lo, this._xToT(x))), this._yToOpacity(y)]
            tf.setDirty()
        } else if (d.kind === 'color') {
            const cols = tf.colorPoints
            const lo = d.index > 0 ? cols[d.index - 1][0] : 0
            const hi = d.index < cols.length - 1 ? cols[d.index + 1][0] : 1
            cols[d.index][0] = Math.min(hi, Math.max(lo, this._xToT(x)))
            tf.setDirty()
        } else {
            const [d0, d1] = this._dataRange()
            const perPx = ((d1 - d0) || 1) / Math.max(1, this._width - 2 * this._pad)
            const dv = (x - d.startX) * perPx
            let [lo, hi] = d.rangeStart
            if (d.kind === 'range-move') {
                lo += dv
                hi += dv
            } else if (d.kind === 'range-low') lo = Math.min(hi - perPx, lo + dv)
            else hi = Math.max(lo + perPx, hi + dv)
            this._setRange(lo, hi, false)
        }
        this._queueDraw()
    }

    private _up = (e: PointerEvent) => {
        const d = this._drag
        clearTimeout(this._longPress)
        if (!d) return
        this._drag = undefined
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
        if (d.kind === 'color' && !d.moved) {
            this._pickColor(d.index, d.before)
            return
        }
        this._record(d.before)
    }

    private _dblclick = (e: MouseEvent) => {
        const [x, y] = this._local(e)
        const r = this._hitRadius(e)
        if (y >= this._windowTop - 4) return
        if (y >= this._stripTop - 2) {
            const i = this._nearestColor(x, r)
            const before = this._snapshot()
            const tf = this.material.transferFunction
            if (i >= 0) {
                if (tf.colorPoints.length <= 2) return
                tf.colorPoints.splice(i, 1)
            } else {
                const t = this._xToT(x)
                const [cr, cg, cb] = tf.evaluate(t)
                tf.colorPoints = sorted([...tf.colorPoints, [t, cr, cg, cb]])
            }
            tf.setDirty()
            this._record(before)
        } else {
            // the first click of the double-click added a point and recorded it; remove the point under the cursor
            this._removeOpacity(this._nearestOpacity(x, y, r), false)
        }
    }

    private _contextmenu = (e: MouseEvent) => {
        const [x, y] = this._local(e)
        if (y < this._stripTop - 2) {
            const i = this._nearestOpacity(x, y, this._hitRadius(e))
            if (i >= 0) {
                e.preventDefault()
                this._removeOpacity(i, false)
            }
        }
    }

    private _removeOpacity(i: number, fromDrag: boolean) {
        const tf = this.material.transferFunction
        if (i < 0 || tf.opacityPoints.length <= 2) return
        const before = fromDrag && this._drag ? this._drag.before : this._snapshot()
        if (fromDrag) this._drag = undefined
        tf.opacityPoints.splice(i, 1)
        tf.setDirty()
        this._record(before)
    }

    private _pickColor(i: number, before: Snapshot) {
        const input = this._colorInput
        const [, cr, cg, cb] = this.material.transferFunction.colorPoints[i]
        input.value = hex(cr, cg, cb)
        const onInput = () => {
            const c = input.value
            const p = this.material.transferFunction.colorPoints[i]
            if (!p) return
            p[1] = parseInt(c.slice(1, 3), 16) / 255
            p[2] = parseInt(c.slice(3, 5), 16) / 255
            p[3] = parseInt(c.slice(5, 7), 16) / 255
            this.material.transferFunction.setDirty()
        }
        const onChange = () => {
            input.removeEventListener('input', onInput)
            input.removeEventListener('change', onChange)
            onInput()
            this._record(before)
        }
        input.addEventListener('input', onInput)
        input.addEventListener('change', onChange)
        input.click()
    }

    // endregion

    // region toolbar

    private _button(label: string, title: string, onClick: () => void) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.title = title
        b.addEventListener('click', onClick)
        return b
    }

    private _fillPresets() {
        const s = this._presetSelect
        s.innerHTML = ''
        const none = document.createElement('option')
        none.value = ''
        none.textContent = 'Preset…'
        s.appendChild(none)
        for (const name of Object.keys(volumePresets)) {
            const o = document.createElement('option')
            o.value = o.textContent = name
            s.appendChild(o)
        }
    }

    private _load() {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.clut,.json,.txt'
        input.addEventListener('change', async() => {
            const file = input.files?.[0]
            if (!file) return
            const text = await file.text()
            try {
                this._recordAround(() => this.material.importTransferFunction(text, file.name.replace(/\.[^.]+$/, '')))
            } catch (err) {
                console.error('TransferFunctionEditor: could not read', file.name, err)
            }
        })
        input.click()
    }

    private _save() {
        const m = this.material
        const range = m.effectiveRange(m.lastField)
        const blob = new Blob([m.transferFunction.toClut([range[0], range[1]])], {type: 'text/plain'})
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = (m.transferFunction.name || 'transfer-function').replace(/[^\w.-]+/g, '_') + '.clut'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }

    // endregion
}

function sorted(points: number[][]) {
    return [...points].sort((a, b) => a[0] - b[0])
}

function rgb(r: number, g: number, b: number) {
    const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
    return `rgb(${c(r)},${c(g)},${c(b)})`
}

function hex(r: number, g: number, b: number) {
    const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
    return '#' + c(r) + c(g) + c(b)
}

function fmt(v: number) {
    const a = Math.abs(v)
    return a >= 1000 || a === 0 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toPrecision(3)
}
