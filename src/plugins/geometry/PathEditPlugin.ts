import {Curve, Matrix3, Plane, Vector2, Vector3} from 'three'
import {uiButton, uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {onChange} from 'ts-browser-helpers'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {isEditableTarget} from '../../utils'
import {IObject3D} from '../../core'
import {isInScene} from '../../three/utils/misc'
import {
    addCurvePoint,
    CurveEditPoint,
    curvePointMover,
    CurveSnapshot,
    getCurveEditPoints,
    getCurveSegments,
    removeCurvePoint,
    restoreCurve,
    setCurveEditPoint,
    snapshotCurve,
} from '../../three/utils/curve-edit'
import {GeometryGeneratorPlugin} from './GeometryGeneratorPlugin'
import type {PickingPlugin} from '../interaction/PickingPlugin'
import type {UndoManagerPlugin} from '../interaction/UndoManagerPlugin'
import {ScreenHandle, ScreenHandleDrag, ScreenHandles} from '../interaction/helpers/ScreenHandles'

export interface PathEditPluginEventMap extends AViewerPluginEventMap {
    /** Editing of an object started */
    editStart: {object: IObject3D}
    /** Editing of an object ended */
    editEnd: {object: IObject3D}
    /**
     * The curve of an object changed: a point moved (each pointer move of a drag), was added or removed, or an undo,
     * a redo or an Esc put a state back (`restore`)
     */
    pointChange: {object: IObject3D, change: 'move' | 'add' | 'remove' | 'restore'}
}

type PathHandle = {kind: 'point', index: number} | {kind: 'add', segment: number}

/** The state of a curve for undo: the curve object and each of its vectors with its value */
interface CurveState {
    object: IObject3D
    curve: Curve<any>
    values: CurveSnapshot
}

/** A press closer than this to the edited line keeps editing, px */
const LINE_DISTANCE = 6
/** A double-click closer than this to a line edits it, px */
const PICK_DISTANCE = 8
/** The + of a segment shows when its points are farther apart than this on the screen, px */
const ADD_MIN_SPACING = 36

/** The generator parameters of the geometry of an object (GeometryGeneratorPlugin) */
function genParams(o: IObject3D | null | undefined): {curve?: Curve<any>, closePath?: boolean} | undefined {
    return o?.geometry?.userData?.generationParams as any
}

function curveOf(o: IObject3D | null | undefined): Curve<any> | undefined {
    const c = genParams(o)?.curve
    return c && typeof c.getPoint === 'function' ? c : undefined
}

/** Points of the curve, for the overlay and the hit test (local space) */
function samples(curve: Curve<any>, closed: boolean): (Vector2 | Vector3)[] {
    const c = curve as any
    const pts: (Vector2 | Vector3)[] = Array.isArray(c.curves) ? c.getPoints(24) :
        c.isLineCurve || c.isLineCurve3 ? [c.v1, c.v2] :
            Array.isArray(c.points) ? c.getPoints(Math.max(32, 12 * c.points.length)) : c.getPoints(48)
    if (closed && pts.length) pts.push(pts[0])
    return pts
}

/**
 * PathEditPlugin edits the points of generated lines on the screen: any object whose geometry has a curve in
 * `geometry.userData.generationParams.curve`, like a `line` of {@link GeometryGeneratorPlugin}, a path of
 * `PenToolPlugin` or a camera path.
 *
 * Call {@link edit} with the object, or double-click the line (`editOnDoubleClick`). While editing:
 * - drag a point to move it, on a plane facing the camera through the point (with <kbd>Shift</kbd> at the press, on a
 *   level plane: the height stays). Moving an anchor moves its Bezier handles with it, a joint of two curves moves
 *   both, and a handle of a smooth point keeps the point smooth,
 * - click a `+` between two points to add one there (lines, Beziers, splines and paths of them), and drag it,
 * - <kbd>Alt</kbd> + click a point to remove it, or select it and press <kbd>Delete</kbd> (a Bezier handle goes back to
 *   its anchor),
 * - <kbd>Esc</kbd> (or a click away from the line) ends editing; <kbd>Esc</kbd> during a drag cancels the drag.
 *
 * Each drag, add and remove is one undo step with `UndoManagerPlugin`. The points are drawn in an SVG overlay in the
 * viewer container: anchors filled, Bezier handles hollow with their tangent lines. A press on a point is taken from
 * the camera controls and the picking, all other presses work as usual. The curve is in the local space of the
 * object, so the object can be moved, rotated and scaled.
 *
 * The plugin writes the curve in `geometry.userData.generationParams.curve` and regenerates the geometry with
 * `geometry.setDirty({regenerate: true})`. Adding a point to a line or a single Bezier makes the curve a
 * `CurvePath3` of two curves (the shape stays).
 *
 * @example
 * ```ts
 * viewer.addPluginSync(GeometryGeneratorPlugin)
 * const pathEdit = viewer.addPluginSync(PathEditPlugin)
 * pathEdit.edit(lineObject)
 * pathEdit.addEventListener('pointChange', ({object}) => console.log('changed', object.name))
 * ```
 *
 * @category Plugins
 */
@uiFolderContainer('Path Edit')
export class PathEditPlugin extends AViewerPluginSync<PathEditPluginEventMap> {
    static readonly PluginType = 'PathEditPlugin'
    declare uiConfig: UiObjectConfig
    dependencies = [GeometryGeneratorPlugin]
    serializeWithViewer = false

    /** False ends editing, and {@link edit} does nothing */
    @uiToggle('Enabled')
    @onChange(PathEditPlugin.prototype._enabledChanged)
        enabled = true

    /** Double-click a generated line to edit it */
    @uiToggle('Edit on double-click')
        editOnDoubleClick = true

    /** The selected point (an index in {@link getPoints}), removed with Delete */
    selectedPoint: number | null = null

    private _editing: IObject3D | null = null
    private _layer = new ScreenHandles<PathHandle>({
        draw: () => this._draw(),
        press: (h, e) => this._press(h, e),
        click: (e) => this._click(e),
    }, 'path-edit')

    protected _enabledChanged() {
        if (!this.enabled) this.stopEditing()
    }

    /** Edit the line selected with `PickingPlugin`, or end editing (the button in the UI) */
    @uiButton('Edit selected line', (p: PathEditPlugin) => ({label: () => p._editing ? 'Done' : 'Edit selected line'}))
    toggleEditSelected() {
        if (this._editing) this.stopEditing()
        else this.edit(this._viewer?.getPlugin<PickingPlugin>('PickingPlugin')?.getSelectedObject() ?? null)
    }

    /** The object being edited, or null */
    get editing() {
        return this._editing
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._layer.attach(viewer)
        // bubble on the canvas: a tool that takes the double-click on the window (the pen finishing a path) stops it
        viewer.canvas.addEventListener('dblclick', this._onDbl)
    }

    onRemove(viewer: ThreeViewer) {
        this.stopEditing()
        viewer.canvas.removeEventListener('dblclick', this._onDbl)
        this._layer.detach()
        super.onRemove(viewer)
    }

    /** True when the object has a generated curve with points to edit */
    canEdit(object: IObject3D | null | undefined): boolean {
        return getCurveEditPoints(curveOf(object)).length > 0
    }

    /**
     * Edit the points of an object (and end the editing of another one).
     * @returns false when the plugin is disabled or the object has no curve to edit
     */
    edit(object: IObject3D | null | undefined): boolean {
        if (!object || !this._viewer || this.isDisabled() || !this.canEdit(object)) return false
        if (this._editing === object) return true
        this.stopEditing()
        this._editing = object
        this.selectedPoint = null
        this._layer.active = true
        this._layer.hint = 'Editing points · drag: move · <kbd>Shift</kbd> keep the height · <b>+</b> add · <kbd>Alt</kbd> + click: remove · <kbd>Del</kbd> remove selected · <kbd>Esc</kbd> done'
        window.addEventListener('keydown', this._onKey, {capture: true})
        this.uiConfig.uiRefresh?.(true)
        this.dispatchEvent({type: 'editStart', object})
        return true
    }

    /** End editing */
    stopEditing() {
        const object = this._editing
        if (!object) return
        this._layer.cancelDrag()
        this._editing = null
        this.selectedPoint = null
        this._layer.active = false
        window.removeEventListener('keydown', this._onKey, {capture: true})
        this.uiConfig.uiRefresh?.(true)
        this.dispatchEvent({type: 'editEnd', object})
    }

    /** The points of the curve being edited (see `getCurveEditPoints`), in the local space of the object */
    getPoints(): CurveEditPoint[] {
        return getCurveEditPoints(curveOf(this._editing))
    }

    /** Move a point of the curve being edited to a local position (one undo step) */
    movePoint(index: number, position: Vector3) {
        const object = this._editing, curve = curveOf(object)
        if (!object || !curve || !getCurveEditPoints(curve)[index]) return
        const before = this._snapshot(object)
        setCurveEditPoint(curve, index, position)
        this._changed(object, 'move')
        this._record(before, this._snapshot(object))
    }

    /**
     * Add a point in the middle of a segment of the curve being edited (one undo step).
     * @returns the index of the new point, null when the curve cannot have a point there
     */
    addPoint(segment: number): number | null {
        const object = this._editing, curve = curveOf(object)
        if (!object || !curve) return null
        const before = this._snapshot(object)
        const res = addCurvePoint(curve, segment)
        if (!res) return null
        this._setCurve(object, res.curve)
        this.selectedPoint = res.index
        this._changed(object, 'add')
        this._record(before, this._snapshot(object))
        return res.index
    }

    /**
     * Remove a point of the curve being edited (one undo step). The curve stays valid (see `removeCurvePoint`).
     * @returns false when the point cannot be removed (a curve keeps 2 points)
     */
    removePoint(index: number): boolean {
        const object = this._editing, curve = curveOf(object)
        if (!object || !curve) return false
        const before = this._snapshot(object)
        const next = removeCurvePoint(curve, index)
        if (!next) return false
        this._setCurve(object, next)
        this.selectedPoint = null
        this._changed(object, 'remove')
        this._record(before, this._snapshot(object))
        return true
    }

    // region curve

    private _setCurve(object: IObject3D, curve: Curve<any>) {
        const g = object.geometry
        const params = genParams(object)
        if (!g || !params) return
        params.curve = curve
        // the generator ui follows the type and the number of points of the curve
        ;(g.userData as any).__generationParamsUiType = ''
    }

    /** Regenerate the geometry; `final` (not during a drag) also refreshes its ui and the overlay */
    private _changed(object: IObject3D, change: PathEditPluginEventMap['pointChange']['change'], final = true) {
        const g = object.geometry
        g?.setDirty?.({regenerate: true})
        // during a drag the layer draws after each move
        if (final) {
            (g as any)?.uiConfig?.uiRefresh?.(true, 'postFrame')
            this._layer.redraw()
        }
        this.dispatchEvent({type: 'pointChange', object, change})
    }

    private _snapshot(object: IObject3D): CurveState {
        const curve = curveOf(object)!
        return {object, curve, values: snapshotCurve(curve)}
    }

    private _restore = (s: CurveState) => {
        if (curveOf(s.object) !== s.curve) this._setCurve(s.object, s.curve)
        restoreCurve(s.curve, s.values)
        const n = getCurveEditPoints(s.curve).length
        if (this.selectedPoint !== null && this.selectedPoint >= n) this.selectedPoint = null
        this._changed(s.object, 'restore')
    }

    private _record(before: CurveState, after: CurveState) {
        this._viewer?.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.undoManager?.record({
            undo: () => this._restore(before),
            redo: () => this._restore(after),
        })
    }

    // endregion

    // region overlay and input

    private _world(object: IObject3D, p: {x: number, y: number, z?: number}) {
        return new Vector3(p.x, p.y, p.z ?? 0).applyMatrix4(object.matrixWorld)
    }

    private _samplesWorld(object: IObject3D, curve: Curve<any>) {
        const closed = !!genParams(object)?.closePath
        return samples(curve, closed).map(p => this._world(object, p))
    }

    private _draw() {
        const object = this._editing, layer = this._layer
        const curve = curveOf(object)
        if (!object || !curve || !isInScene(object)) {
            // removed from the scene (e.g. an undo of its creation) or no curve anymore
            if (object) queueMicrotask(() => this._editing === object && this.stopEditing())
            return
        }
        object.updateWorldMatrix(true, false)
        layer.polyline(this._samplesWorld(object, curve))
        const points = getCurveEditPoints(curve)
        const world = points.map(p => this._world(object, p.vec))
        points.forEach((p, i) => p.anchors.forEach(a => layer.line(world[i], world[a])))
        const viewport = layer.viewport()
        for (const seg of getCurveSegments(curve)) {
            const a = layer.project(world[seg.from], viewport), b = layer.project(world[seg.to], viewport)
            if (a.behind || b.behind || Math.hypot(a.x - b.x, a.y - b.y) < ADD_MIN_SPACING) continue
            layer.handle({id: 'add' + seg.index, position: this._world(object, seg.mid), shape: 'plus', size: 12, cursor: 'copy', data: {kind: 'add', segment: seg.index}})
        }
        points.forEach((p, i) => layer.handle({
            id: 'p' + i,
            position: world[i],
            shape: p.kind === 'anchor' ? 'dot' : 'ring',
            size: p.kind === 'anchor' ? 9 : 7,
            selected: this.selectedPoint === i,
            data: {kind: 'point', index: i},
        }))
    }

    /** The drag of point `index` from its world position, with the plane chosen at the press */
    private _pointDrag(object: IObject3D, index: number, shift: boolean, before?: CurveState): ScreenHandleDrag<CurveState> | undefined {
        const curve = curveOf(object)
        const point = getCurveEditPoints(curve)[index]
        // the vectors of the point from the press: the drag moves them also over another point
        const mover = curve && curvePointMover(curve, index)
        if (!curve || !point || !mover) return undefined
        const origin = this._world(object, point.vec)
        const view = this._viewer!.scene.mainCamera.getWorldDirection(new Vector3())
        let plane: Plane | undefined
        let keepY = false
        if (!(point.vec as Vector3).isVector3) {
            // a 2D curve is in the xy plane of the object
            // the normal matrix: with a sheared world matrix (a rotated child of a non-uniform scale) the z axis is not the normal
            const n = new Vector3(0, 0, 1).applyMatrix3(new Matrix3().getNormalMatrix(object.matrixWorld)).normalize()
            if (Math.abs(n.dot(view)) > 0.15) plane = new Plane().setFromNormalAndCoplanarPoint(n, origin)
        } else if (shift) {
            // the height stays: a level plane, or the camera plane at the same height when it is edge-on
            if (Math.abs(view.y) > 0.2) plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), origin)
            else keepY = true
        }
        return {
            origin,
            plane,
            before,
            record: before ? 'always' : 'moved',
            snapshot: () => this._snapshot(object),
            restore: this._restore,
            move: (p) => {
                if (keepY) p.y = origin.y
                mover(object.worldToLocal(p.clone()))
                this._changed(object, 'move', false)
            },
            end: () => {
                (object.geometry as any)?.uiConfig?.uiRefresh?.(true, 'postFrame')
            },
        }
    }

    private _press(h: ScreenHandle<PathHandle>, e: PointerEvent): ScreenHandleDrag<CurveState> | boolean | undefined {
        const object = this._editing
        if (!object) return undefined
        const d = h.data
        if (d.kind === 'point') {
            if (e.altKey) {
                this.removePoint(d.index)
                return true
            }
            this.selectedPoint = d.index
            return this._pointDrag(object, d.index, e.shiftKey)
        }
        if (e.altKey) return true
        // add the point and drag it: one undo step for both, from the state before the add
        const curve = curveOf(object)
        if (!curve) return undefined
        const before = this._snapshot(object)
        const res = addCurvePoint(curve, d.segment)
        if (!res) return true
        this._setCurve(object, res.curve)
        this.selectedPoint = res.index
        this._changed(object, 'add')
        return this._pointDrag(object, res.index, e.shiftKey, before)
    }

    private _click(e: PointerEvent) {
        const object = this._editing, curve = curveOf(object)
        if (!object || !curve) return
        // a click on the line keeps editing, a click away from it (empty space or another object) ends it
        if (this._layer.distanceTo(this._layer.pointer(e), this._samplesWorld(object, curve)) > LINE_DISTANCE) this.stopEditing()
        else if (this.selectedPoint !== null) {
            this.selectedPoint = null
            this._layer.redraw()
        }
    }

    private _onDbl = (e: MouseEvent) => {
        const viewer = this._viewer
        if (!viewer || this.isDisabled() || !this.editOnDoubleClick) return
        const s = this._layer.pointer(e)
        const found = {object: null as IObject3D | null, d: PICK_DISTANCE}
        viewer.scene.modelRoot.traverseVisible((o) => {
            const object = o as IObject3D
            const curve = curveOf(object)
            if (!curve || !this.canEdit(object)) return
            object.updateWorldMatrix(true, false)
            const d = this._layer.distanceTo(s, this._samplesWorld(object, curve))
            if (d <= found.d) {
                found.object = object
                found.d = d
            }
        })
        if (found.object) this.edit(found.object)
    }

    private _onKey = (e: KeyboardEvent) => {
        if (!this._editing || isEditableTarget(e.target)) return
        const own = () => {
            e.preventDefault()
            e.stopImmediatePropagation()
        }
        if (e.key === 'Escape') {
            own()
            if (this._layer.dragging) this._layer.cancelDrag()
            else this.stopEditing()
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            // also without a selected point: Delete does not delete the object while its points are edited
            own()
            if (this.selectedPoint !== null && !this._layer.dragging) this.removePoint(this.selectedPoint)
        }
    }

    // endregion
}
