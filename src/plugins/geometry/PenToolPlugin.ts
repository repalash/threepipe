import {Color, CubicBezierCurve3, Object3D, Plane, Ray, Raycaster, Vector2, Vector3} from 'three'
import {createStyles} from 'ts-browser-helpers'
import type {UiObjectConfig} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IObject3D} from '../../core'
import {CurvePath3} from '../../three'
import {GeometryGeneratorPlugin} from './GeometryGeneratorPlugin'
import type {UndoManagerPlugin} from '../interaction/UndoManagerPlugin'
import type {PickingPlugin} from '../interaction/PickingPlugin'
import styles from './PenToolPlugin.css?inline'

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

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Where the ray hits the plane, null when it misses. Also null when the ray starts on the plane (a camera at the
 * height of the plane): every hit would be the camera position.
 */
function onPlane(ray: Ray, plane: Plane): Vector3 | null {
    if (Math.abs(plane.distanceToPoint(ray.origin)) < 1e-6) return null
    return ray.intersectPlane(plane, new Vector3())
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

/**
 * PenToolPlugin is a pen tool like the one of Figma or Illustrator, for 3D paths.
 *
 * Call {@link start} (or {@link toggle}), then on the canvas: click to add a point, click and drag to pull out smooth
 * Bezier handles, click the first point to close the path, Enter or double-click to finish, Backspace (or Delete)
 * removes the last point, Esc cancels. Points go on the surface under the pointer, else on the ground (y = 0); with
 * Shift (or when the pointer misses the ground) on a level plane at the height of the previous point, to draw in the
 * air. While drawing, the pen takes the left mouse button on the canvas (no selection, no orbit); the wheel still zooms.
 *
 * The result is a `line` object of {@link GeometryGeneratorPlugin} with a {@link CurvePath3} of cubic Beziers, added
 * to the model root. Its points stay editable as a generated geometry, and it is saved in a glb. Adding it is one
 * undo step with {@link UndoManagerPlugin}, and it is selected with {@link PickingPlugin} when they are added.
 *
 * The overlay (the path, the handles and a hint) is SVG and DOM in the viewer container.
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
export class PenToolPlugin extends AViewerPluginSync<PenToolPluginEventMap> {
    static readonly PluginType = 'PenToolPlugin'
    dependencies = [GeometryGeneratorPlugin]
    serializeWithViewer = false

    /** Color of new paths */
    color: string
    /** Width of new paths, in pixels */
    linewidth: number

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Pen Tool',
        children: [
            {type: 'checkbox', label: 'Enabled', property: [this, 'enabled']},
            {type: 'button', label: () => this._active ? 'Finish Path' : 'Draw Path', value: () => this.toggle()},
            {type: 'color', label: 'Color', property: [this, 'color']},
            {type: 'slider', label: 'Line Width', property: [this, 'linewidth'], bounds: [1, 20], stepSize: 0.5},
        ],
    }

    private _enabled = true
    private _active = false
    private _anchors: Anchor[] = []
    private _drag: {anchor: Anchor, plane: Plane} | null = null
    private _hover: Vector3 | null = null
    private _svg?: SVGSVGElement
    private _hint?: HTMLDivElement
    private _stylesheet?: HTMLStyleElement
    private _ray = new Raycaster()
    private _count = 0

    constructor(options: PenToolOptions = {}) {
        super()
        this.color = options.color ?? '#ff6b3d'
        this.linewidth = options.linewidth ?? 3
    }

    get enabled() {
        return this._enabled
    }

    /** False cancels a path being drawn, and {@link start} does nothing */
    set enabled(v: boolean) {
        if (v === this._enabled) return
        this._enabled = v
        if (!v) this.cancel()
        this.uiConfig.uiRefresh?.(true)
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
        this._stylesheet = createStyles(styles, viewer.container)
        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.setAttribute('class', 'pen-overlay')
        viewer.container.appendChild(svg)
        this._svg = svg
        const hint = document.createElement('div')
        hint.className = 'pen-hint'
        hint.innerHTML = 'Pen · click: point · drag: curve · <kbd>Shift</kbd> keep the height · first point: close · <kbd>⌫</kbd> remove point · <kbd>Enter</kbd> done · <kbd>Esc</kbd> cancel'
        viewer.container.appendChild(hint)
        this._hint = hint
        viewer.addEventListener('postFrame', this._draw)
    }

    onRemove(viewer: ThreeViewer) {
        this.cancel()
        viewer.removeEventListener('postFrame', this._draw)
        this._svg?.remove()
        this._svg = undefined
        this._hint?.remove()
        this._hint = undefined
        this._stylesheet?.remove()
        this._stylesheet = undefined
        super.onRemove(viewer)
    }

    /** Start drawing a new path */
    start() {
        if (this._active || !this._viewer || this.isDisabled()) return
        this._active = true
        this._anchors = []
        window.addEventListener('pointerdown', this._onDown, {capture: true})
        window.addEventListener('pointermove', this._onMove, {capture: true})
        window.addEventListener('pointerup', this._onUp, {capture: true})
        window.addEventListener('keydown', this._onKey, {capture: true})
        window.addEventListener('dblclick', this._onDbl, {capture: true})
        this._viewer.container.classList.add('pen-drawing')
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
        window.removeEventListener('pointerdown', this._onDown, {capture: true})
        window.removeEventListener('pointermove', this._onMove, {capture: true})
        window.removeEventListener('pointerup', this._onUp, {capture: true})
        window.removeEventListener('keydown', this._onKey, {capture: true})
        window.removeEventListener('dblclick', this._onDbl, {capture: true})
        this._viewer?.container.classList.remove('pen-drawing')
        this._draw()
        this._changed()
    }

    private _changed() {
        this.uiConfig.uiRefresh?.(true)
        this.dispatchEvent({type: 'change'})
    }

    // region input

    private _onCanvas(e: Event) {
        return e.target === this._viewer?.canvas
    }

    private _onDown = (e: PointerEvent) => {
        if (!this._viewer || !this._onCanvas(e) || e.button !== 0) return
        // the pen owns the left button on the canvas while active: no selection, no orbit
        e.stopPropagation()
        e.preventDefault()
        const s = this._screen(e)
        const first = this._anchors[0]
        if (first && this._anchors.length > 2 && this._near(first.p, s)) {
            this.finish(true)
            return
        }
        const p = this._place(s, e.shiftKey)
        if (!p) return
        const a: Anchor = {p, hIn: p.clone(), hOut: p.clone()}
        this._anchors.push(a)
        // a drag pulls out the handles on a level plane, so a path on the floor stays on it; on a plane facing the
        // camera when the camera looks along the floor (the level plane would be edge-on)
        const view = this._viewer.scene.mainCamera.getWorldDirection(new Vector3())
        const n = Math.abs(view.y) > 0.25 ? new Vector3(0, 1, 0) : view.negate()
        this._drag = {anchor: a, plane: new Plane().setFromNormalAndCoplanarPoint(n, p)}
        this._draw()
    }

    private _onMove = (e: PointerEvent) => {
        if (!this._viewer) return
        const s = this._screen(e)
        if (this._drag) {
            e.stopPropagation()
            const hit = onPlane(this._rayAt(s).ray, this._drag.plane)
            if (hit) {
                const {anchor} = this._drag
                anchor.hOut.copy(hit)
                anchor.hIn.copy(anchor.p).multiplyScalar(2).sub(hit) // symmetric, a smooth point
            }
        } else this._hover = this._onCanvas(e) ? this._place(s, e.shiftKey) : null
        this._draw()
    }

    private _onUp = (e: PointerEvent) => {
        if (!this._drag) return
        e.stopPropagation()
        // a click without a drag: a corner
        const a = this._drag.anchor
        if (a.hOut.distanceTo(a.p) < this._worldPerPixel(a.p) * CORNER_DRAG) {
            a.hOut.copy(a.p)
            a.hIn.copy(a.p)
        }
        this._drag = null
        this._draw()
    }

    private _onDbl = (e: MouseEvent) => {
        if (!this._onCanvas(e)) return
        e.stopPropagation()
        // the second click of the double-click added a point at the same place: drop it
        const as = this._anchors
        const n = as.length
        if (n > 1 && as[n - 1].p.distanceTo(as[n - 2].p) < this._worldPerPixel(as[n - 1].p) * CORNER_DRAG) as.pop()
        this.finish()
    }

    private _onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        const own = () => {
            e.preventDefault()
            e.stopImmediatePropagation()
        }
        if (e.key === 'Escape') {
            own()
            this.cancel()
        } else if (e.key === 'Enter') {
            own()
            this.finish()
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            own()
            const removed = this._anchors.pop()
            if (removed && this._drag?.anchor === removed) this._drag = null
            this._draw()
        }
    }

    // endregion

    // region geometry

    private _screen(e: {clientX: number, clientY: number}) {
        const r = this._viewer!.container.getBoundingClientRect()
        return new Vector2(e.clientX - r.left, e.clientY - r.top)
    }

    /**
     * The canvas rectangle in the container, in which the overlay positions are. The canvas can be smaller than the
     * container, e.g. with `viewer.setRenderSize(size, 'contain')`.
     */
    private _viewport() {
        const viewer = this._viewer!
        const c = viewer.container.getBoundingClientRect()
        const r = viewer.canvas.getBoundingClientRect()
        return {x: r.left - c.left, y: r.top - c.top, width: r.width || 1, height: r.height || 1}
    }

    /** The ray through a point in the container */
    private _rayAt(s: Vector2) {
        const viewer = this._viewer!
        const v = this._viewport()
        const ndc = new Vector2((s.x - v.x) / v.width * 2 - 1, -((s.y - v.y) / v.height) * 2 + 1)
        // setFromCamera also sets the raycaster camera, which fat lines need to raycast
        this._ray.setFromCamera(ndc, viewer.scene.mainCamera)
        return this._ray
    }

    /**
     * The surface under the pointer, else the ground (y = 0). With `keepHeight` (Shift), or when the pointer misses
     * the ground (above the horizon), the level plane through the previous point.
     */
    private _place(s: Vector2, keepHeight = false): Vector3 | null {
        const viewer = this._viewer!
        const ray = this._rayAt(s)
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

    /** The position of a world point in the container */
    private _toScreen(p: Vector3, viewport = this._viewport()) {
        const v = p.clone().project(this._viewer!.scene.mainCamera)
        return {x: viewport.x + (v.x + 1) / 2 * viewport.width, y: viewport.y + (1 - v.y) / 2 * viewport.height, behind: v.z > 1}
    }

    private _near(p: Vector3, s: Vector2) {
        const q = this._toScreen(p)
        return Math.hypot(q.x - s.x, q.y - s.y) < CLOSE_DISTANCE
    }

    /** World size of one screen pixel at `p` */
    private _worldPerPixel(p: Vector3) {
        const cam = this._viewer!.scene.mainCamera as any
        const h = this._viewport().height
        if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / (cam.zoom || 1) / h
        return 2 * cam.getWorldPosition(new Vector3()).distanceTo(p) * Math.tan((cam.fov || 45) * Math.PI / 360) / h
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
            // neighbouring segments share their end point, so moving it in the geometry editor keeps them joined
            path.add(new CubicBezierCurve3(a.p, a.hOut, b.hIn, b.p))
        }
        const segments = Math.min(400, Math.max(48, n * 32))
        const obj = gen.generateObject('line', {curve: path, segments}) as IObject3D
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

    private _draw = () => {
        const svg = this._svg
        if (!svg || !this._viewer) return
        if (!this._active || !this._anchors.length && !this._hover) {
            if (svg.childNodes.length) svg.innerHTML = ''
            return
        }
        const viewport = this._viewport()
        const S = (p: Vector3) => this._toScreen(p, viewport)
        const f = (n: number) => n.toFixed(1)
        const as = this._anchors
        let d = ''
        for (let i = 0; i < as.length; i++) {
            const a = S(as[i].p)
            if (i === 0) {
                d += `M${f(a.x)} ${f(a.y)}`
                continue
            }
            const c1 = S(as[i - 1].hOut), c2 = S(as[i].hIn)
            d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(a.x)} ${f(a.y)}`
        }
        const hov = this._hover && !this._drag ? S(this._hover) : null
        // the next segment, to the pointer
        let preview = ''
        if (as.length && hov) {
            const last = as[as.length - 1], a = S(last.p), c1 = S(last.hOut)
            preview = `M${f(a.x)} ${f(a.y)}C${f(c1.x)} ${f(c1.y)} ${f(hov.x)} ${f(hov.y)} ${f(hov.x)} ${f(hov.y)}`
        }
        let handles = ''
        let dots = ''
        as.forEach((a, i) => {
            const p = S(a.p)
            if (p.behind) return
            for (const h of [a.hIn, a.hOut]) {
                if (h.distanceToSquared(a.p) < 1e-12) continue
                const q = S(h)
                handles += `<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" class="pen-hl"/><circle cx="${f(q.x)}" cy="${f(q.y)}" r="3" class="pen-h"/>`
            }
            const close = i === 0 && as.length > 2 && hov && Math.hypot(p.x - hov.x, p.y - hov.y) < CLOSE_DISTANCE
            dots += `<rect x="${f(p.x - 4)}" y="${f(p.y - 4)}" width="8" height="8" rx="1.5" class="pen-a${close ? ' pen-close' : ''}"/>`
        })
        svg.innerHTML = `<path d="${d}" class="pen-path"/><path d="${preview}" class="pen-preview"/>${handles}${dots}` +
            (hov ? `<circle cx="${f(hov.x)}" cy="${f(hov.y)}" r="3.5" class="pen-cursor"/>` : '')
    }
}
