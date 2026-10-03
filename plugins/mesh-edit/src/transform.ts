/**
 * The modal transform: move, rotate and scale a selection interactively.
 *
 * `ModalTransform` is the façade the plugin, the gizmo and the editor engine drive; the maths lives
 * in {@link TransInfo}, a port of Blender's `editors/transform/` (`transform.cc`,
 * `transform_mode_translate.cc`, `transform_mode_rotate.cc`, `transform_mode_resize.cc`,
 * `transform_input.cc`, `transform_constraints.cc`, `transform_orientations.cc`,
 * `transform_snap.cc`, `transform_snap_object.cc`, `transform_generics.cc`,
 * `transform_convert_mesh.cc`) and `editors/util/numinput.cc`.
 *
 * The rules that make the ergonomics work are Blender's:
 * - **Positions are snapshotted on start** and every update recomputes from the snapshot, never from
 *   the previous frame, so the axis or the typed number can change mid-drag.
 * - **Constraints project the free motion** along the view onto the allowed axis or plane rather
 *   than zeroing components, so a constrained drag tracks the cursor at any camera angle.
 * - **Rotation is measured about the pivot's position on screen**, accumulated per move, and
 *   **scale is the ratio of the cursor's distance to the pivot** against the distance at the start.
 * - **Cancel restores the snapshot exactly**; it does not apply an inverse transform.
 *
 * This module is renderer-free: the camera comes in as matrices, so the whole state machine is
 * testable in Node.
 */

import {BMesh, BMVert, ElemFlag, SelectMode} from '@threepipe/mesh-kernel'
import {TransInfo, TransInfoOptions, TransformSavedProps} from './transform/TransInfo'
import type {Vec3} from './transform/math'
import type {ModalKeyEvent, TransformModalItem} from './transform/keymap'
import type {TransformMode} from './transform/types'

export type {TransformMode, TransformSavedProps}

/** Options for {@link ModalTransform}; the same as {@link TransInfoOptions}. */
export type ModalTransformOptions = TransInfoOptions

/**
 * One interactive transform, from first mouse move to confirm or cancel.
 *
 * Construct on `G`/`R`/`S` or a gizmo press, feed it mouse positions and keys, then `confirm()` or
 * `cancel()`. Coordinates are region pixels with `y` up, as in Blender; the plugin flips the
 * browser's `y` before calling in.
 */
export class ModalTransform {
    readonly t: TransInfo

    constructor(options: ModalTransformOptions) {
        this.t = new TransInfo(options)
    }

    get mode(): TransformMode {
        return this.t.mode
    }

    get isEmpty(): boolean {
        return this.t.isEmpty
    }

    get isDone(): boolean {
        return this.t.isDone
    }

    /** The pivot in world space. */
    get pivot(): readonly [number, number, number] {
        return this.t.centerGlobal
    }

    get elementCount(): number {
        return this.t.dataLenAll
    }

    /** The header text Blender shows during the transform, e.g. `Dx: 0.1000   Dy: ...`. */
    get status(): string {
        return this.t.header
    }

    /** `Shift`: a tenth of the motion. */
    get precision(): boolean {
        return this.t.mouse.precision
    }

    set precision(v: boolean) {
        this.t.handleEvent({type: 'modal', item: v ? 'precisionOn' : 'precisionOff'})
    }

    /** The cursor moved; region pixels, `y` up. */
    setMousePosition(x: number, y: number): void {
        this.t.handleEvent({type: 'mousemove', mval: [x, y]})
    }

    /** A key, down or up, through the transform's modal keymap and the numeric input. */
    handleKey(event: ModalKeyEvent): boolean {
        return this.t.handleEvent({type: 'key', event})
    }

    /** A modal item directly, for callers with their own keymap. */
    handleModal(item: TransformModalItem): boolean {
        return this.t.handleEvent({type: 'modal', item})
    }

    /** Type a character into the numeric input (`G 1 . 5`); returns true when consumed. */
    handleNumericKey(key: string): boolean {
        return this.handleKey({key, code: codeForKey(key), ctrl: false, shift: false, alt: false, press: true})
    }

    /** Constrain to one axis (`X`), or to the plane perpendicular to it (`Shift+X`). Repeats cycle the orientation. */
    setAxis(axis: 0 | 1 | 2, plane = false): void {
        const items: TransformModalItem[][] = [['axisX', 'planeX'], ['axisY', 'planeY'], ['axisZ', 'planeZ']]
        this.handleModal(items[axis][plane ? 1 : 0])
    }

    /** Drop the constraint (`C`). */
    clearConstraint(): void {
        this.handleModal('consOff')
    }

    /**
     * Switch to another mode mid-transform (`G` then `R`). Either slide mode asks for
     * `VERT_EDGE_SLIDE`: edge slide, or vertex slide when the selection is not edge loops (`G G`).
     */
    switchMode(mode: TransformMode): void {
        this.handleModal(mode === 'edgeSlide' || mode === 'vertSlide' ? 'vertEdgeSlide' : mode)
    }

    /** Resize the proportional editing circle (wheel, PageUp/PageDown). */
    proportionalSize(up: boolean): void {
        this.handleModal(up ? 'propsizeUp' : 'propsizeDown')
    }

    /**
     * What the redo panel needs to run this transform again exactly (Blender's `saveTransform`): pass it
     * back through {@link MeshEditPlugin.applyTransformValues}.
     */
    saved(): TransformSavedProps {
        return this.t.saveProps()
    }

    /** Keep the current positions. */
    confirm(): void {
        this.t.confirm()
    }

    /** Put every element back exactly where it started. */
    cancel(): void {
        this.t.cancel()
    }
}

function codeForKey(key: string): string {
    if (key >= '0' && key <= '9') return 'Digit' + key
    switch (key) {
    case '.': return 'Period'
    case '-': return 'Minus'
    case '/': return 'Slash'
    case '=': return 'Equal'
    case '*': return 'NumpadMultiply'
    case 'Backspace': return 'Backspace'
    case 'Tab': return 'Tab'
    default: return key
    }
}

/**
 * Every vertex the current selection moves.
 *
 * In vertex mode that is the selected vertices; in edge and face mode it is the vertices of the
 * selected elements, which is how Blender's `createTransEditVerts` gathers them (the selection
 * flushes down to vertices, so selected vertices are the whole answer).
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

/** The median of the selected vertices in the object's space, or null when nothing is selected. */
export function selectionMedian(bm: BMesh): Vec3 | null {
    let x = 0, y = 0, z = 0, n = 0
    for (const v of bm.verts) {
        if (!(v.hflag & ElemFlag.Select) || v.hflag & ElemFlag.Hidden) continue
        x += v.x
        y += v.y
        z += v.z
        n++
    }
    return n ? [x / n, y / n, z / n] : null
}
