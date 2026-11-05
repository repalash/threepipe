import {Color, CubicBezierCurve3, Object3D, Plane, Ray, Vector2, Vector3} from 'three'
import {onChange} from 'ts-browser-helpers'
import {uiButton, uiColor, uiFolderContainer, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IObject3D} from '../../core'
import {CurvePath3} from '../../three'
import {isEditableTarget} from '../../utils'
import {GeometryGeneratorPlugin} from './GeometryGeneratorPlugin'
import type {UndoManagerPlugin} from '../interaction/UndoManagerPlugin'
import type {PickingPlugin} from '../interaction/PickingPlugin'
import type {PathEditPlugin} from './PathEditPlugin'
import {ScreenHandle, ScreenHandleDrag, ScreenHandles} from '../interaction/helpers/ScreenHandles'

interface Anchor {
    p: Vector3
    /** Handle towards the previous point (world) */
    hIn: Vector3
    /** Handle towards the next point (world) */
    hOut: Vector3
}

export interface PenToolOptions {
    /** Color of new paths. Default `'#ff6b3d'` */
    color?: string
    /** Width of new paths, in pixels. Default `3` */
    linewidth?: number
}

export interface PenToolPluginEventMap extends AViewerPluginEventMap {
    /** Drawing started, finished or was cancelled */
    change: object
    /** A path was made (not on undo or redo) */
    created: {object: IObject3D}
}

/**
 * Where the ray hits the plane, null when it misses. Also null when the ray starts on the plane (a camera at the
 * height of the plane): every hit would be the camera position.
 */
function onPlane(ray: Ray, plane: Plane): Vector3 | null {
    if (Math.abs(plane.distanceToPoint(ray.origin)) < 1e-6) return null
    return ray.intersectPlane(plane, new Vector3())
}

/** The Space key; by `code` too, as Option + Space on a Mac types a non-breaking space */
function isSpace(e: KeyboardEvent) {
    return e.code === 'Space' || e.key === ' '
}

/** True when the object and all its parents are visible (a raycast also hits the children of a hidden group) */
function isVisible(o: Object3D | null): boolean {
    for (; o; o = o.parent) if (!o.visible) return false
    return true
}
/** A click closer than this to the first point closes the path, px */
const CLOSE_DISTANCE = 10
/** A drag shorter than this makes a corner, px */
const CORNER_DRAG = 4
/** Points per curve segment in the overlay */
const CURVE_SAMPLES = 20
const HINT = 'Pen · click: point · drag: curve · <kbd>Shift</kbd> keep the height · first point: close · <kbd>Space</kbd> or <kbd>Alt</kbd> + drag: rotate · <kbd>⌫</kbd> remove point · <kbd>Enter</kbd> done · <kbd>Esc</kbd> cancel'

/**
 * PenToolPlugin is a pen tool like the one of Figma or Illustrator, for 3D paths.
 *
 * Call {@link start} (or {@link toggle}), then on the canvas: click to add a point, click and drag to pull out smooth
 * Bezier handles, click the first point to close the path, Enter or double-click to finish, Backspace (or Delete)
 * removes the last point, Esc cancels. Points go on the surface under the pointer, else on the ground (y = 0); with
 * Shift (or when the pointer misses the ground) on a level plane at the height of the previous point, to draw in the
 * air. While drawing, the pen takes the left mouse button on the canvas (no selection, no orbit); hold Space or Alt and
 * drag to rotate the camera instead (the orbit controls get the pointer), the right button pans and the wheel zooms.
 *
 * The result is a `line` object of {@link GeometryGeneratorPlugin} with a {@link CurvePath3} of cubic Beziers, added
 * to the model root. Its points stay editable as a generated geometry, and it is saved in a glb. Adding it is one
 * undo step with {@link UndoManagerPlugin}, and it is selected with {@link PickingPlugin} when they are added.
 *
 * The overlay (the path, the handles and a hint) is drawn on the screen handle layer of the editing plugins (the same
 * as `PathEditPlugin`), in the viewer container. Starting the pen ends the editing of `PathEditPlugin`.
 *
 * @example
 * ```ts
 * viewer.addPluginSync(GeometryGeneratorPlugin)
 * const pen = viewer.addPluginSync(new PenToolPlugin({color: '#0d99ff', linewidth: 2}))
 * pen.addEventListener('created', ({object}) => console.log('new path', object.name))
 * pen.start()
 * ```
 *
 * @category Plugins
 */
@uiFolderContainer('Pen Tool')
export class PenToolPlugin extends AViewerPluginSync<PenToolPluginEventMap> {
    static readonly PluginType = 'PenToolPlugin'
    declare uiConfig: UiObjectConfig
    dependencies = [GeometryGeneratorPlugin]
    serializeWithViewer = false

    /** False cancels a path being drawn, and {@link start} does nothing */
    @uiToggle('Enabled')
    @onChange(PenToolPlugin.prototype._enabledChanged)
        enabled = true

    /** Color of new paths */
    @uiColor('Color')
        color: string
    /** Width of new paths, in pixels */
    @uiSlider('Line Width', [1, 20], 0.5)
        linewidth: number

    private _active = false
    private _anchors: Anchor[] = []
    /** The point of the press being dragged: its handles follow the pointer */
    private _drag: {anchor: Anchor, start: Vector2} | null = null
    /** Space held (outside a text field) */
    private _space = false
    /** Alt held, for the cursor; a pointer event has its own `altKey` */
    private _alt = false
    /** A left drag on the canvas that started with Space or Alt: the orbit controls own it until pointerup */
    private _orbit = false
    private _hover: Vector3 | null = null
    private _count = 0
    private _layer = new ScreenHandles<'first' | 'point'>({
        draw: (layer) => this._draw(layer),
        press: (h, e) => this._pressHandle(h, e),
        pressCanvas: (e, s) => this._press(e, s),
        move: (e, s) => this._onMove(e, s),
        pointerUp: () => this._endOrbit(),
    }, 'pen')

    constructor(options: PenToolOptions = {}) {
        super()
        this.color = options.color ?? '#ff6b3d'
        this.linewidth = options.linewidth ?? 3
    }

    protected _enabledChanged() {
        if (!this.enabled) this.cancel()
    }

    /** True while a path is drawn */
    get active() {
        return this._active
    }

    /** The points placed so far (world positions), while drawing */
    get points(): Vector3[] {
        return this._anchors.map(a => a.p.clone())
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._layer.attach(viewer)
    }

    onRemove(viewer: ThreeViewer) {
        this.cancel()
        this._layer.detach()
        super.onRemove(viewer)
    }

    /** Start drawing a new path */
    start() {
        if (this._active || !this._viewer || this.isDisabled()) return
        // one tool at a time on the canvas
        this._viewer.getPlugin<PathEditPlugin>('PathEditPlugin')?.stopEditing()
        this._active = true
        this._anchors = []
        window.addEventListener('keydown', this._onKey, {capture: true})
        window.addEventListener('keyup', this._onKeyUp, {capture: true})
        // not capture: the blur of an element does not bubble, only the window blur reaches here
        window.addEventListener('blur', this._onBlur)
        window.addEventListener('dblclick', this._onDbl, {capture: true})
        this._layer.active = true
        this._layer.hint = HINT
        this._cursor()
        this._changed()
    }

    /** Stop without making a path */
    cancel() {
        this._anchors = []
        this._stop()
    }

    /**
     * Make the path from the points placed so far (2 or more) and stop. With fewer points it stops without a path.
     * @param closed - Join the last point to the first
     * @returns the new path object, if one was made
     */
    finish(closed = false): IObject3D | undefined {
        const anchors = this._anchors
        this._anchors = []
        this._stop()
        if (anchors.length < 2) return undefined
        return this._create(anchors, closed)
    }

    /** {@link finish} while drawing, else {@link start} */
    toggle() {
        if (this._active) this.finish()
        else this.start()
    }

    private _stop() {
        if (!this._active) return
        this._active = false
        this._drag = null
        this._hover = null
        this._space = false
        this._alt = false
        this._orbit = false
        window.removeEventListener('keydown', this._onKey, {capture: true})
        window.removeEventListener('keyup', this._onKeyUp, {capture: true})
        window.removeEventListener('blur', this._onBlur)
        window.removeEventListener('dblclick', this._onDbl, {capture: true})
        // ends the drag of a point, clears the overlay, the hint and the cursor
        this._layer.active = false
        this._changed()
    }

    private _changed() {
        this.uiConfig?.uiRefresh?.(true)
        this.dispatchEvent({type: 'change'})
    }

    /** Draw a path, or finish the one being drawn (the button in the UI) */
    @uiButton('Draw Path', (p: PenToolPlugin) => ({label: () => p._active ? 'Finish Path' : 'Draw Path'}))
    toggleDraw() {
        this.toggle()
    }

    // region input

    private _onCanvas(e: Event) {
        return e.target === this._viewer?.canvas
    }

    /** Space or Alt is held: a left drag rotates the camera */
    private _orbitKey(e: {altKey: boolean}) {
        return this._space || e.altKey
    }

    /** A crosshair while drawing; grab while Space or Alt is held (not in a pen drag), grabbing during the orbit */
    private _cursor() {
        if (!this._active) return
        this._layer.canvasCursor = this._orbit ? 'grabbing' : !this._drag && (this._space || this._alt) ? 'grab' : 'crosshair'
    }

    private _held(space: boolean, alt: boolean) {
        if (space === this._space && alt === this._alt) return
        this._space = space
        this._alt = alt
        this._hover = null // no preview to the pointer while rotating; the next move places it again
        this._cursor()
        this._layer.redraw()
    }

    /** A press on the first point closes the path (it is a handle of the layer once the path has 3 points) */
    private _pressHandle(h: ScreenHandle<'first' | 'point'>, e: PointerEvent) {
        if (h.data !== 'first' || this._orbitKey(e) || this._anchors.length < 3) return undefined
        this.finish(true)
        return true
    }

    /** A left press on the canvas: adds a point, and its drag pulls out the handles */
    private _press(e: PointerEvent, s: Vector2): ScreenHandleDrag | boolean | undefined {
        if (!this._viewer) return undefined
        // Space or Alt: the pen does not take the pointer, the orbit controls rotate, until the button is released
        this._orbit = this._orbitKey(e)
        if (this._orbit) {
            this._hover = null
            this._cursor()
            this._layer.redraw()
            return undefined
        }
        const p = this._place(s, e.shiftKey)
        // the pen owns the left button on the canvas while active: no selection, no orbit, also off the ground
        if (!p) return true
        const a: Anchor = {p, hIn: p.clone(), hOut: p.clone()}
        this._anchors.push(a)
        this._hover = null
        this._drag = {anchor: a, start: s}
        // a drag pulls out the handles on a level plane, so a path on the floor stays on it; on a plane facing the
        // camera when the camera looks along the floor (the level plane would be edge-on)
        const view = this._viewer.scene.mainCamera.getWorldDirection(new Vector3())
        const n = Math.abs(view.y) > 0.25 ? new Vector3(0, 1, 0) : view.negate()
        return {
            origin: p,
            plane: new Plane().setFromNormalAndCoplanarPoint(n, p),
            move: (hit, ev) => {
                if (this._drag?.anchor !== a) return // removed with Backspace during the drag
                if (this._layer.pointer(ev).distanceTo(s) < CORNER_DRAG) {
                    // still a corner (a press without a drag), so the overlay shows what a release makes
                    a.hOut.copy(a.p)
                    a.hIn.copy(a.p)
                } else {
                    a.hOut.copy(hit)
                    a.hIn.copy(a.p).multiplyScalar(2).sub(hit) // symmetric, a smooth point
                }
            },
            // also a lost pointerup (window blur, pointercancel, a move with no button): the point keeps the handles
            // of the last move, which applied the corner rule
            end: () => {
                this._drag = null
                this._cursor()
            },
        }
    }

    /** The end of an orbit drag: its release, a window blur, or a move with no button (a missed release) */
    private _endOrbit() {
        if (!this._orbit) return
        this._orbit = false
        this._cursor()
        this._layer.redraw()
    }

    /** A pointer move that is not a drag of a point: the preview of the next point, or the end of an orbit */
    private _onMove(e: PointerEvent, s: Vector2) {
        if (e.buttons === 0) this._endOrbit()
        this._held(this._space, e.altKey)
        if (this._orbit) return
        this._hover = this._onCanvas(e) && !e.buttons && !this._orbitKey(e) ? this._place(s, e.shiftKey) : null
        this._layer.redraw()
    }

    private _onDbl = (e: MouseEvent) => {
        // two clicks with Space or Alt are not a finish
        if (!this._onCanvas(e) || this._orbitKey(e)) return
        e.stopPropagation()
        // the second click of the double-click added a point at the same place: drop it
        const as = this._anchors
        const n = as.length
        if (n > 1) {
            const a = this._layer.project(as[n - 1].p), b = this._layer.project(as[n - 2].p)
            if (Math.hypot(a.x - b.x, a.y - b.y) < CORNER_DRAG) as.pop()
        }
        this.finish()
    }

    private _onKey = (e: KeyboardEvent) => {
        if (e.key === 'Alt') this._held(this._space, true) // not taken: only for the cursor
        if (isEditableTarget(e.target)) return
        const own = () => {
            e.preventDefault()
            e.stopImmediatePropagation()
        }
        if (isSpace(e)) {
            // no page scroll and no other handler; also each key repeat
            own()
            this._held(true, this._alt)
        } else if (e.key === 'Escape') {
            own()
            this.cancel()
        } else if (e.key === 'Enter') {
            own()
            this.finish()
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            own()
            const removed = this._anchors.pop()
            if (removed && this._drag?.anchor === removed) this._layer.cancelDrag()
            this._layer.redraw()
        }
    }

    private _onKeyUp = (e: KeyboardEvent) => {
        if (isSpace(e)) {
            // a focused button (e.g. Draw Path after a click on it) clicks on the keyup of Space
            if (!isEditableTarget(e.target)) {
                e.preventDefault()
                e.stopImmediatePropagation()
            }
            this._held(false, this._alt)
        } else if (e.key === 'Alt') this._held(this._space, false)
    }

    /** A keyup or a pointerup after the window lost the focus never comes (the layer ends a drag of a point) */
    private _onBlur = () => {
        this._endOrbit()
        this._held(false, false)
    }

    // endregion

    // region geometry

    /**
     * The surface under the pointer, else the ground (y = 0). With `keepHeight` (Shift), or when the pointer misses
     * the ground (above the horizon), the level plane through the previous point.
     */
    private _place(s: Vector2, keepHeight = false): Vector3 | null {
        const viewer = this._viewer!
        const ray = this._layer.raycasterAt(s)
        const last = this._anchors[this._anchors.length - 1]
        if (!(keepHeight && last)) {
            const hit = ray.intersectObject(viewer.scene.modelRoot, true)
                .find(h => (h.object as any).isMesh && !(h.object as any).isLine2 && isVisible(h.object))
            if (hit) return hit.point.clone()
            const ground = onPlane(ray.ray, new Plane(new Vector3(0, 1, 0), 0))
            if (ground) return ground
        }
        return onPlane(ray.ray, new Plane(new Vector3(0, 1, 0), -(last?.p.y ?? 0)))
    }

    private _create(anchors: Anchor[], closed: boolean): IObject3D | undefined {
        const viewer = this._viewer
        const gen = viewer?.getPlugin(GeometryGeneratorPlugin)
        if (!viewer || !gen) return undefined
        // the points are in world space; the path goes in the model root, which can be moved or scaled (modelRootScale)
        const root = viewer.scene.modelRoot
        root.updateWorldMatrix(true, false)
        const toRoot = (v: Vector3) => root.worldToLocal(v.clone())
        const inRoot = anchors.map(a => ({p: toRoot(a.p), hIn: toRoot(a.hIn), hOut: toRoot(a.hOut)}))
        // the object sits at the centre of its points; the curve is in its local space
        const center = inRoot.reduce((c, a) => c.add(a.p), new Vector3()).divideScalar(inRoot.length)
        const pts = inRoot.map(a => ({p: a.p.sub(center), hIn: a.hIn.sub(center), hOut: a.hOut.sub(center)}))
        const path = new CurvePath3()
        const n = closed ? pts.length : pts.length - 1
        for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length]
            // neighbouring segments share their end point, so moving it with PathEditPlugin keeps them joined
            path.add(new CubicBezierCurve3(a.p, a.hOut, b.hIn, b.p))
        }
        // 32 divisions for each curve, so every point of the path is a vertex of the line
        const obj = gen.generateObject('line', {curve: path, segments: 32, samplePerCurve: true}) as IObject3D
        // the default line material: LineMaterial2 (fat lines), or a basic line material with `UseMeshLines` false
        const material = obj.material as {color?: Color, linewidth?: number} | undefined
        material?.color?.set(this.color)
        if (material?.linewidth !== undefined) material.linewidth = this.linewidth
        obj.name = `Path ${++this._count}`
        obj.position.copy(center)
        const add = () => {
            root.add(obj)
            viewer.scene.setDirty({refreshScene: true})
        }
        const remove = () => {
            obj.removeFromParent()
            viewer.scene.setDirty({refreshScene: true})
        }
        add()
        viewer.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.undoManager?.record({undo: remove, redo: add})
        // selected without an undo step of its own: one undo removes the new path
        viewer.getPlugin<PickingPlugin>('PickingPlugin')?.setSelectedObject(obj, false, false)
        this.dispatchEvent({type: 'created', object: obj})
        return obj
    }

    // endregion

    /** The overlay, on the layer: the path, the preview of the next segment, the points and handles, the pointer */
    private _draw(layer: ScreenHandles<'first' | 'point'>) {
        const as = this._anchors
        if (!as.length && !this._hover) return
        // A perspective projection of a 3D cubic is not the SVG cubic through the projected control points (the
        // perspective division is not linear), so the 3D curve is sampled and drawn as a polyline. A segment
        // without handles is a straight line, also in the projection.
        const curve = new CubicBezierCurve3()
        const segment = (out: Vector3[], p0: Vector3, h0: Vector3, h1: Vector3, p1: Vector3) => {
            const straight = h0.equals(p0) && h1.equals(p1)
            curve.v0.copy(p0)
            curve.v1.copy(h0)
            curve.v2.copy(h1)
            curve.v3.copy(p1)
            for (let i = straight ? CURVE_SAMPLES : 1; i <= CURVE_SAMPLES; i++) out.push(curve.getPoint(i / CURVE_SAMPLES))
        }
        if (as.length) {
            const path = [as[0].p]
            for (let i = 1; i < as.length; i++) segment(path, as[i - 1].p, as[i - 1].hOut, as[i].hIn, as[i].p)
            layer.polyline(path)
        }
        const hover = this._hover && !this._drag ? this._hover : null
        if (as.length && hover) {
            // the next segment, to the pointer
            const last = as[as.length - 1]
            const preview = [last.p]
            segment(preview, last.p, last.hOut, hover, hover)
            layer.polyline(preview, 'sh-path sh-preview')
        }
        as.forEach((a, i) => {
            for (const [k, h] of [['in', a.hIn], ['out', a.hOut]] as const) {
                if (h.distanceToSquared(a.p) < 1e-12) continue
                layer.line(a.p, h)
                layer.handle({id: `h${i}${k}`, position: h, shape: 'ring', size: 6, hitRadius: 0, data: 'point'})
            }
            // the first point closes the path: hovered (larger) under the pointer, and pressed to close
            const first = i === 0 && as.length > 2
            layer.handle({id: 'p' + i, position: a.p, shape: 'square', size: 8, hitRadius: first ? CLOSE_DISTANCE : 0, cursor: 'pointer', data: first ? 'first' : 'point'})
        })
        if (hover) layer.handle({id: 'pointer', position: hover, shape: 'dot', size: 7, hitRadius: 0, data: 'point'})
    }
}
