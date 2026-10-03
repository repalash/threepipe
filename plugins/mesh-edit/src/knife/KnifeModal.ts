/**
 * The knife as a modal edit-mode interaction: Blender's `MESH_OT_knife_tool` invoke and modal
 * (`editors/mesh/editmesh_knife.cc:4579`, `:4220`) on top of the kernel's {@link KnifeTool}.
 *
 * The kernel decides everything about the cut; this class turns DOM input into the knife's modal
 * events (through {@link knifeKeyToModal} / {@link knifeButtonToModal}, the Knife Tool Modal Map),
 * keeps the view current (the camera may orbit mid-cut, as `MIDDLEMOUSE` passes through in Blender),
 * types the angle-snapping increment (Blender's number input while angle snapping is on), and says what
 * the status bar shows (`knife_update_header`, `:1061`).
 *
 * It does not touch the scene or the undo stack: {@link MeshEditPlugin.startKnife} owns the overlay and
 * records one undo step when {@link status} becomes `'finished'`.
 */

import {BMesh, BMFace, KnifeAngleSnap, KnifeEvent, KnifeStatus, KnifeTool, KnifeView, KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT} from '@threepipe/mesh-kernel'
import {KNIFE_STATUS_KEYS, KnifeButtonInput, knifeButtonToModal, KnifeKeyInput, knifeKeyToModal} from './keymap'

/** Options of a knife run: `MESH_OT_knife_tool`'s properties (`:4686`). */
export interface KnifeOptions {
    /** `only_selected`: only cut selected faces. Shift+K. Default false. */
    onlySelected?: boolean
    /** `!use_occlude_geometry`: cut through to the back. Shift+K turns this on. Default false. */
    cutThrough?: boolean
    /**
     * `wait_for_input`. False when a click on the canvas started the knife (the knife tool on the shelf):
     * that click is the first cut point, as `knifetool_invoke` feeds it straight to the modal (`:4629`).
     * Default true.
     */
    waitForInput?: boolean
    /** `angle_snapping_increment`, degrees. Default 30. */
    angleSnappingIncrement?: number
}

export interface KnifeModalSetup extends KnifeOptions {
    bm: BMesh
    view: KnifeView
    objectMatrix: number[]
    /** The face selection buffer's nearest face (`EDBM_face_find_nearest`), region pixels. */
    findNearestFace?: (mval: [number, number]) => BMFace | null
    /** Face select mode only: the cut's edges are not selected afterwards (`select_result`, `:3958`). */
    faceSelectMode?: boolean
    /** Where the cursor is, region pixels (bottom-left origin). */
    mval: [number, number]
    /** `UI_SCALE_FAC` for the snap distances. Default 1 (region pixels are CSS pixels). */
    uiScale?: number
}

export interface KnifeHints {
    modal: string
    keys: {key: string, label: string}[]
}

export class KnifeModal {
    readonly tool: KnifeTool
    status: KnifeStatus = 'running'
    private _mval: [number, number]
    private readonly _angleIncrementDefault: number
    /** Blender's `kcd->num` string for the angle increment. */
    private _num = ''

    constructor(s: KnifeModalSetup) {
        this._angleIncrementDefault = s.angleSnappingIncrement ?? KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT
        this.tool = new KnifeTool(s.bm, {
            view: s.view,
            objectMatrix: s.objectMatrix,
            onlySelect: !!s.onlySelected,
            cutThrough: !!s.cutThrough,
            isInteractive: true,
            findNearestFace: s.findNearestFace,
            selectModeIsFaceOnly: s.faceSelectMode,
            angleSnappingIncrement: this._angleIncrementDefault,
            uiScale: s.uiScale,
        })
        this._mval = s.mval
        this.tool.updateMval(s.mval)
        if (s.waitForInput === false) {
            // `knifetool_invoke`: an ADD_CUT whose `prev_val` is not a release - a press.
            this._run({type: 'modal', item: 'ADD_CUT', release: false, mval: s.mval})
        }
    }

    get done(): boolean {
        return this.status !== 'running' && this.status !== 'passThrough'
    }

    /** The camera moved: re-project, as each modal event does in Blender (`knife_snap_update_from_mval`). */
    setView(view: KnifeView): void {
        this.tool.view = view
        if (!this.done) this.tool.updateActive(this._mval)
    }

    /** `MOUSEMOVE`. Region pixels, bottom-left origin. */
    move(mval: [number, number]): void {
        this._mval = mval
        this._run({type: 'mousemove', mval})
    }

    /** A mouse button press or release. Returns whether the knife used it. */
    button(input: KnifeButtonInput, mval: [number, number]): boolean {
        this._mval = mval
        const m = knifeButtonToModal(input)
        if (!m) return false
        const status = this._run({type: 'modal', item: m.item, release: m.release, mval})
        // PANNING passes through to the view navigation.
        return status !== 'passThrough'
    }

    /** A key press or release. Returns whether the knife used it. */
    key(input: KnifeKeyInput): boolean {
        if (this.done) return false
        const tool = this.tool
        // Number input for the angle increment while angle snapping (`:4244`): Blender resets after
        // three characters or once the increment is past 18 degrees, so typing starts a new number.
        if (tool.angleSnapping && input.press) {
            if (this._num.length >= 3 || tool.angleSnappingIncrement > 180 / 10) this._num = ''
            const digit = /^Digit([0-9])$/.exec(input.code) ?? /^Numpad([0-9])$/.exec(input.code)
            const edit = this._num.length > 0 && input.code === 'Backspace'
            if (digit || (input.code === 'Period' && !this._num.includes('.')) || edit) {
                if (edit) this._num = this._num.slice(0, -1)
                else this._num += digit ? digit[1] : '.'
                const v = parseFloat(this._num)
                // Restrict number key input to 0 - 180 degree range.
                if (v > 0 && v <= 180) tool.angleSnappingIncrement = v
                tool.updateActive(this._mval)
                return true
            }
        }
        const m = knifeKeyToModal(input)
        if (!m) return false
        if (m.item === 'ANGLE_SNAP_TOGGLE') this._num = ''
        this._run({type: 'modal', item: m.item, release: m.release, mval: this._mval})
        return true
    }

    private _run(e: KnifeEvent): KnifeStatus {
        if (this.done) return this.status
        const status = this.tool.modal(e, this._angleIncrementDefault)
        if (status !== 'passThrough') this.status = status
        return status
    }

    /** The status bar while the knife runs (`knife_update_header`). */
    hints(): KnifeHints {
        const t = this.tool
        const deg = (t.angle >= 0 ? t.angle : Math.PI * 2 + t.angle) * 180 / Math.PI
        const inc = t.angleSnappingIncrement > 0 && t.angleSnappingIncrement <= 180 ? t.angleSnappingIncrement : KNIFE_DEFAULT_ANGLE_SNAPPING_INCREMENT
        const mode = t.angleSnapping ? (t.angleSnappingMode === KnifeAngleSnap.Screen ? 'Screen' : 'Relative') : 'Off'
        const angle = `Angle Constraint: ${deg.toFixed(2)}(${inc.toFixed(2)}) (${mode}${t.angleSnappingMode === KnifeAngleSnap.Relative ? ' - R: Cycle Edge' : ''})`
        const state: string[] = []
        if (t.cutThrough) state.push('Cut Through')
        if (t.snapMidpoints) state.push('Midpoint Snap')
        if (t.ignoreEdgeSnapping && !t.isDragHold) state.push('Ignore Snap')
        if (t.axisConstrained) state.push(`Axis ${t.axisString.trim()}`)
        if (!t.depthTest) state.push('X-Ray')
        return {
            modal: `Knife${state.length ? ' - ' + state.join(', ') : ''}. ${angle}`,
            keys: KNIFE_STATUS_KEYS.map(k => ({key: k.key, label: k.item === 'ANGLE_SNAP_TOGGLE' ? angle : k.label})),
        }
    }
}
