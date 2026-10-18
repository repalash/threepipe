/**
 * The Loop Cut modal: hover an edge to preview the ring it would cut, change the number of cuts, and
 * click to cut. Blender's `MESH_OT_loopcut` while it runs (`editors/mesh/editmesh_loopcut.cc`:
 * `loopcut_init` `:369`, `loopcut_mouse_move` `:341`, `loopcut_modal` `:552`); the cut and the preview
 * geometry are the kernel's `editMeshLoopCut` / `edgeringPreviewFromEdge`. In Loop Cut and Slide the
 * confirmed cut is followed by an edge slide, which the plugin starts.
 *
 * Like the transform, it knows nothing about the DOM: the plugin feeds it pointer, wheel and key
 * events and reads its preview and status.
 */

import {BMEdge, edgeringPreviewFromEdge, EdgeRingPreview, SubdFalloff} from '@threepipe/mesh-kernel'
import {
    applyNumInput,
    handleNumInput,
    hasNumInput,
    initNumInput,
    NUM_NO_FRACTION,
    NUM_NO_NEGATIVE,
    NumInput,
    NumInputEvent,
    outputNumInput,
} from './transform/numinput'
import type {ModalKeyEvent} from './transform/keymap'

/** `SUBD_SMOOTH_MAX`, `SUBD_CUTS_MAX` (`editmesh_loopcut.cc:49`). */
export const SUBD_SMOOTH_MAX = 4
export const SUBD_CUTS_MAX = 500

export interface LoopCutModalOptions {
    /** The edge nearest a point (`EDBM_edge_find_nearest_ex`), canvas pixels; null for none in reach. */
    pickEdge(x: number, y: number): BMEdge | null
    /** `number_cuts` to start with. Default 1. */
    cuts?: number
    /** `smoothness` to start with. Default 0. */
    smoothness?: number
    /** `falloff`. Default `inverseSquare`. */
    falloff?: SubdFalloff
}

export type LoopCutState = 'running' | 'confirm' | 'cancel'

export class LoopCutModal {
    /** `cuts as float so smooth mouse pan works in small increments`. */
    cuts: number
    smoothness: number
    readonly falloff: SubdFalloff
    /** The edge under the cursor, whose ring is cut. */
    edge: BMEdge | null = null
    preview: EdgeRingPreview = {edges: [], verts: []}
    state: LoopCutState = 'running'
    /** The header text, `Cuts: 1, Smoothness: 0.00`. */
    status = ''
    readonly num = new NumInput()
    private readonly _pick: (x: number, y: number) => BMEdge | null

    /** `loopcut_init` (`:369`) and `ringsel_init` (`:276`), interactive. */
    constructor(opts: LoopCutModalOptions, x: number, y: number) {
        this._pick = opts.pickEdge
        this.cuts = opts.cuts ?? 1
        this.smoothness = opts.smoothness ?? 0
        this.falloff = opts.falloff ?? 'inverseSquare'

        initNumInput(this.num)
        this.num.idxMax = 1
        this.num.valFlag[0] |= NUM_NO_NEGATIVE | NUM_NO_FRACTION
        // No specific flags for smoothness.
        this.num.unitType = ['none', 'none', 'none']

        this._mouseMove(x, y, 1)
        this._updateStatus(this.smoothness)
    }

    get isDone(): boolean {
        return this.state !== 'running'
    }

    /** `loopcut_mouse_move` (`:341`) + `loopcut_update_edge` (`:322`). */
    private _mouseMove(x: number, y: number, previewlines: number): void {
        const e = this._pick(x, y)
        if (e !== this.edge) {
            this.edge = e
            this._findEdge(previewlines)
        }
    }

    /** `ringsel_find_edge` (`:137`). */
    private _findEdge(previewlines: number): void {
        this.preview = this.edge ? edgeringPreviewFromEdge(this.edge, previewlines) : {edges: [], verts: []}
    }

    /** The cursor moved, canvas pixels: preview the ring of the edge under it. */
    mouseMove(x: number, y: number): void {
        if (this.isDone) return
        this._mouseMove(x, y, Math.trunc(this.cuts))
    }

    /** `WHEELUPMOUSE` / `WHEELDOWNMOUSE` (`:625`, `:639`): one cut more or fewer, or with Alt the smoothness. */
    wheel(up: boolean, alt: boolean): void {
        if (this.isDone) return
        let cuts = this.cuts
        let smoothness = this.smoothness
        if (up) {
            if (!alt) cuts += 1
            else smoothness += 0.05
        } else if (!alt) {
            cuts = Math.max(cuts - 1, 1)
        } else {
            smoothness -= 0.05
        }
        this._apply(cuts, smoothness)
    }

    /** A left click (`LEFTMOUSE` press, `:582`) confirms, a right click (`:590`) cancels. */
    pointerDown(button: number): void {
        if (this.isDone) return
        if (button === 0) this.state = 'confirm'
        else if (button === 2) this.state = 'cancel'
    }

    /**
     * `loopcut_modal`'s keys (`:569-683`): numeric input first when active, Enter confirms, Escape
     * cancels on release, PageUp/PageDown and numpad +/- step the cuts (Alt: the smoothness), else the
     * key may start numeric input. Every key is the modal's (Blender returns `RUNNING_MODAL`).
     */
    key(e: ModalKeyEvent): boolean {
        if (this.isDone) return true
        let cuts = this.cuts
        let smoothness = this.smoothness
        const numEvent: NumInputEvent = {key: e.key, code: e.code, ctrl: e.ctrl, shift: e.shift, alt: e.alt}
        const values = (): void => {
            const v = [cuts, smoothness]
            applyNumInput(this.num, v)
            cuts = v[0]
            smoothness = v[1]
        }
        if (e.press && hasNumInput(this.num) && handleNumInput(this.num, numEvent)) {
            values()
        } else {
            let handled = false
            switch (e.code) {
            case 'Enter':
            case 'NumpadEnter':
                if (e.press) {
                    this.state = 'confirm'
                    return true
                }
                handled = true
                break
            case 'Escape':
                if (!e.press) {
                    this.state = 'cancel'
                    return true
                }
                handled = true
                break
            case 'NumpadAdd':
            case 'PageUp':
                if (!e.press) break
                if (!e.alt) cuts += 1
                else smoothness += 0.05
                handled = true
                break
            case 'NumpadSubtract':
            case 'PageDown':
                if (!e.press) break
                if (!e.alt) cuts = Math.max(cuts - 1, 1)
                else smoothness -= 0.05
                handled = true
                break
            default:
                break
            }
            // Modal numinput inactive, try to handle numeric inputs last...
            if (!handled && e.press && handleNumInput(this.num, numEvent)) values()
        }
        this._apply(cuts, smoothness)
        return true
    }

    /** The tail of `loopcut_modal` (`:685-715`): clamp, re-preview, update the header. */
    private _apply(cuts: number, smoothness: number): void {
        let show = false
        if (cuts !== this.cuts) {
            // allow zero so you can backspace and type in a value otherwise 1 as minimum would make
            // more sense
            this.cuts = Math.max(0, Math.min(SUBD_CUTS_MAX, cuts))
            this._findEdge(Math.trunc(this.cuts))
            show = true
        }
        if (smoothness !== this.smoothness) {
            this.smoothness = Math.max(-SUBD_SMOOTH_MAX, Math.min(SUBD_SMOOTH_MAX, smoothness))
            show = true
        }
        if (show) this._updateStatus(smoothness)
    }

    /** `Cuts: %s, Smoothness: %s` (`:706-713`). */
    private _updateStatus(smoothness: number): void {
        if (hasNumInput(this.num)) {
            const s = outputNumInput(this.num)
            this.status = `Cuts: ${s[0]}, Smoothness: ${s[1]}`
        } else {
            this.status = `Cuts: ${Math.trunc(this.cuts)}, Smoothness: ${smoothness.toFixed(2)}`
        }
    }

    /**
     * The `number_cuts` the cut uses: `RNA_int_set(op->ptr, "number_cuts", int(lcd->cuts))`, which the
     * property's minimum of 1 clamps (`editmesh_loopcut.cc:742`).
     */
    get numberCuts(): number {
        return Math.max(1, Math.trunc(this.cuts))
    }
}
