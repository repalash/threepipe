import {Plane, Ray, Raycaster, Vector2, Vector3} from 'three'
import {createStyles} from 'ts-browser-helpers'
import type {ThreeViewer} from '../../../viewer'
import type {UndoManagerPlugin} from '../UndoManagerPlugin'
import styles from './ScreenHandles.css?inline'

/** A point in the viewer container, in pixels. `behind`: the world point is behind the camera */
export interface ScreenPoint {
    x: number
    y: number
    behind: boolean
}

/** `dot`: filled, `ring`: hollow, `plus`: a marker that adds something, `square` and `diamond`: other kinds of handles */
export type ScreenHandleShape = 'dot' | 'ring' | 'plus' | 'square' | 'diamond'

/** A handle that a layer draws and hit-tests, from its `draw` callback */
export interface ScreenHandle<T = unknown> {
    /** Unique in a draw; keeps the hover across draws */
    id: string
    /** World position */
    position: Vector3
    /** Default `dot` */
    shape?: ScreenHandleShape
    /** Diameter in pixels. Default 9 */
    size?: number
    /** Press distance in pixels. Default 10. 0: drawn only, never hovered or pressed (a marker) */
    hitRadius?: number
    /** Drawn with a halo */
    selected?: boolean
    /** CSS cursor over the handle. Default `move` */
    cursor?: string
    /** The owner's data, given back on a press */
    data: T
}

/**
 * A drag that the `press` callback of a layer starts. The layer moves the pointer on a plane (default: facing the
 * camera through `origin`) or along a line, and records one undo step for the drag with `snapshot` and `restore`.
 */
export interface ScreenHandleDrag<S = unknown> {
    /** World position of the dragged thing at the press */
    origin: Vector3
    /** World plane of the drag. Default: facing the camera, through `origin` */
    plane?: Plane
    /** World direction: the drag moves along the line through `origin` (for a length). Used instead of `plane` */
    axis?: Vector3
    /** Called on each pointer move after the drag started, with the new world position of `origin` */
    move(position: Vector3, e: PointerEvent): void
    /** Called at the end of the drag (also when cancelled, with `moved` false) */
    end?(moved: boolean): void
    /** The state to restore on undo; taken at the press and at the end */
    snapshot?(): S
    /** The state before the press, when the press already changed something (e.g. added a point), else `snapshot()` */
    before?: S
    restore?(state: S): void
    /** `moved` (default): an undo step only when the pointer moved. `always`: also for a click (the press changed something) */
    record?: 'moved' | 'always'
}

export interface ScreenHandlesOptions<T> {
    /** Draw the handles and lines (with {@link ScreenHandles.handle}, {@link ScreenHandles.line}, ...); called after each frame and on hover */
    draw(layer: ScreenHandles<T>): void
    /**
     * A left press on a handle. Return a drag to start one, true to take the press without a drag (e.g. a remove), or
     * nothing to leave the press to the viewer (orbit, picking).
     */
    press(handle: ScreenHandle<T>, e: PointerEvent): ScreenHandleDrag<any> | boolean | undefined | void
    /**
     * A left press on the canvas that no handle took (a tool that draws, like the pen). Return a drag to start one,
     * true to take the press without a drag, or nothing to leave the press to the viewer.
     * @param s - the position in the container
     */
    pressCanvas?(e: PointerEvent, s: Vector2): ScreenHandleDrag<any> | boolean | undefined | void
    /**
     * A pointer move that is not a drag of the layer: a hover, or a drag of the viewer (a button is held, e.g. an orbit)
     * @param s - the position in the container
     */
    move?(e: PointerEvent, s: Vector2): void
    /** A pointer release that the layer did not take: the end of a press left to the viewer (e.g. an orbit) */
    pointerUp?(e: PointerEvent): void
    /** A left click on the canvas that is not on a handle (the press is not taken: the viewer also gets it) */
    click?(e: PointerEvent): void
}

/** A press that moves less than this is a click, and a handle drag starts after it, px */
const DRAG_START = 3
const SVG_NS = 'http://www.w3.org/2000/svg'

/** One stylesheet for each container, removed with its last layer */
const sheets = new WeakMap<HTMLElement, {el: HTMLStyleElement, count: number}>()

const f = (n: number) => n.toFixed(1)

/**
 * A layer of handles on the screen, over the canvas of a viewer: SVG in the viewer container, drawn from world points
 * after each frame, with hover, press, drag (on a plane facing the camera, or along a line) and one undo step per
 * drag with `UndoManagerPlugin`. Used by `PathEditPlugin` for the points of a curve, and by `PenToolPlugin` for the path
 * being drawn (with `pressCanvas`, `move`, `pointerUp` and `canvasCursor`, for a tool that draws on the canvas).
 *
 * While {@link active}, the layer takes a left press on a handle (in the capture phase, so the camera controls, the
 * picking and the transform controls do not get it), and a press on the canvas that `pressCanvas` takes; it leaves every
 * other press to the viewer.
 *
 * Internal: not exported from the package.
 */
export class ScreenHandles<T = unknown> {
    readonly svg: SVGSVGElement
    readonly hintElement: HTMLDivElement
    /** The handle under the pointer */
    hovered: ScreenHandle<T> | null = null

    private _viewer?: ThreeViewer
    private _active = false
    private _handles: {h: ScreenHandle<T>, s: ScreenPoint}[] = []
    private _lines = ''
    private _shapes = ''
    /** The SVG content written last: a frame with the same drawing does not write the DOM */
    private _html = ''
    private _hoverId: string | null = null
    private _press: {s: Vector2} | null = null
    private _taken = false
    /** A drag of a handle, or of the canvas (`pressCanvas`, no handle) */
    private _drag: {spec: ScreenHandleDrag<any>, start: Vector2, offset: Vector3, before: any, moved: boolean, handle?: ScreenHandle<T>} | null = null
    private _canvasCursor = ''
    private _ray = new Raycaster()

    constructor(private _options: ScreenHandlesOptions<T>, readonly className = '') {
        this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
        this.svg.setAttribute('class', 'sh-overlay' + (className ? ' ' + className : ''))
        this.hintElement = document.createElement('div')
        this.hintElement.className = 'sh-hint' + (className ? ' ' + className + '-hint' : '')
    }

    attach(viewer: ThreeViewer) {
        if (this._viewer) return
        this._viewer = viewer
        const sheet = sheets.get(viewer.container)
        if (sheet) sheet.count++
        else sheets.set(viewer.container, {el: createStyles(styles, viewer.container), count: 1})
        viewer.container.appendChild(this.svg)
        viewer.container.appendChild(this.hintElement)
        viewer.addEventListener('postFrame', this.redraw)
    }

    detach() {
        const viewer = this._viewer
        if (!viewer) return
        this.active = false
        viewer.removeEventListener('postFrame', this.redraw)
        this.svg.remove()
        this.hintElement.remove()
        const sheet = sheets.get(viewer.container)
        if (sheet && --sheet.count <= 0) {
            sheet.el.remove()
            sheets.delete(viewer.container)
        }
        this._viewer = undefined
    }

    get viewer() {
        return this._viewer
    }

    /** Listen to the pointer and draw. False clears the layer and ends a drag (kept as it is) */
    get active() {
        return this._active
    }

    set active(v: boolean) {
        if (v === this._active || v && !this._viewer) return
        this._active = v
        const capture = {capture: true}
        // a press taken before the last deactivation never got its pointerup here
        this._taken = false
        this._press = null
        if (v) {
            window.addEventListener('pointerdown', this._onDown, capture)
            window.addEventListener('pointermove', this._onMove, capture)
            window.addEventListener('pointerup', this._onUp, capture)
            window.addEventListener('pointercancel', this._release, capture)
            // not capture: the blur of an element does not bubble, only the window blur reaches here
            window.addEventListener('blur', this._release)
        } else {
            this._release()
            this._press = null
            this._taken = false
            window.removeEventListener('pointerdown', this._onDown, capture)
            window.removeEventListener('pointermove', this._onMove, capture)
            window.removeEventListener('pointerup', this._onUp, capture)
            window.removeEventListener('pointercancel', this._release, capture)
            window.removeEventListener('blur', this._release)
            this._setHover(null)
            this.hint = ''
            this.canvasCursor = ''
        }
        this.redraw()
    }

    /** The cursor over the canvas while the layer is active (a tool cursor, like `crosshair`); '' for the viewer's. A hovered or dragged handle shows its own */
    get canvasCursor() {
        return this._canvasCursor
    }

    set canvasCursor(cursor: string) {
        this._canvasCursor = cursor
        const c = this._viewer?.container
        if (!c) return
        if (cursor) {
            c.classList.add('sh-tool')
            c.style.setProperty?.('--sh-tool-cursor', cursor)
        } else c.classList.remove('sh-tool')
    }

    /** HTML of the hint at the bottom of the viewer; empty hides it */
    set hint(html: string) {
        this.hintElement.innerHTML = html
        if (html) this.hintElement.classList.add('sh-shown')
        else this.hintElement.classList.remove('sh-shown')
    }

    /** True during a handle drag */
    get dragging() {
        return !!this._drag
    }

    /** End the drag and put back the state of its press, with no undo step */
    cancelDrag() {
        const d = this._drag
        if (!d) return
        this._drag = null
        this._taken = true // the pointerup of the drag is still taken
        if (d.before !== undefined) d.spec.restore?.(d.before)
        d.spec.end?.(false)
        this._cursor()
        this.redraw()
    }

    // region drawing, from the draw callback

    /** Draw a handle; not drawn (and not pressable) behind the camera */
    handle(h: ScreenHandle<T>) {
        const s = this.project(h.position)
        if (s.behind) return
        this._handles.push({h, s})
        const hover = h.id === this._hoverId || this._drag?.handle?.id === h.id
        const r = (h.size ?? 9) / 2 * (hover ? 1.25 : 1)
        const shape = h.shape ?? 'dot'
        const cls = `sh-${shape}${hover ? ' sh-hover' : ''}${h.selected ? ' sh-selected' : ''}`
        const x = f(s.x), y = f(s.y)
        let el: string
        if (shape === 'square') el = `<rect x="${f(s.x - r)}" y="${f(s.y - r)}" width="${f(2 * r)}" height="${f(2 * r)}" rx="1.5" class="${cls}"/>`
        else if (shape === 'diamond') el = `<path d="M${x} ${f(s.y - r)}L${f(s.x + r)} ${y}L${x} ${f(s.y + r)}L${f(s.x - r)} ${y}Z" class="${cls}"/>`
        else if (shape === 'plus') {
            const p = r * 0.5
            el = `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${f(r)}"/><path d="M${f(s.x - p)} ${y}H${f(s.x + p)}M${x} ${f(s.y - p)}V${f(s.y + p)}"/></g>`
        } else el = `<circle cx="${x}" cy="${y}" r="${f(r)}" class="${cls}"/>`
        if (h.selected) el = `<circle cx="${x}" cy="${y}" r="${f(r + 3.5)}" class="sh-halo"/>` + el
        this._shapes += el
    }

    /** Draw a straight line between two world points (e.g. a Bezier tangent) */
    line(a: Vector3, b: Vector3, className = 'sh-line') {
        const p = this.project(a), q = this.project(b)
        if (p.behind || q.behind) return
        this._lines += `<path d="M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}" class="${className}"/>`
    }

    /** Draw a line through world points (e.g. a sampled curve), broken where it goes behind the camera */
    polyline(points: Vector3[], className = 'sh-path') {
        let d = '', pen = false
        for (const p of points) {
            const q = this.project(p)
            if (q.behind) {
                pen = false
                continue
            }
            d += `${pen ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`
            pen = true
        }
        if (d) this._lines += `<path d="${d}" class="${className}"/>`
    }

    // endregion

    // region screen and world

    /**
     * The canvas rectangle in the container, where the screen positions are. The canvas can be smaller than the
     * container, e.g. with `viewer.setRenderSize(size, 'contain')`.
     */
    viewport() {
        const viewer = this._viewer!
        const c = viewer.container.getBoundingClientRect()
        const r = viewer.canvas.getBoundingClientRect()
        return {x: r.left - c.left, y: r.top - c.top, width: r.width || 1, height: r.height || 1}
    }

    /** The position of a world point in the container */
    project(p: Vector3, viewport = this.viewport()): ScreenPoint {
        const v = p.clone().project(this._viewer!.scene.mainCamera)
        return {x: viewport.x + (v.x + 1) / 2 * viewport.width, y: viewport.y + (1 - v.y) / 2 * viewport.height, behind: v.z > 1}
    }

    /** The position of a pointer event in the container */
    pointer(e: {clientX: number, clientY: number}) {
        const r = this._viewer!.container.getBoundingClientRect()
        return new Vector2(e.clientX - r.left, e.clientY - r.top)
    }

    /** The world ray through a point in the container */
    rayAt(s: Vector2): Ray {
        return this.raycasterAt(s).ray
    }

    /** A raycaster through a point in the container, with the camera set (fat lines need it to raycast) */
    raycasterAt(s: Vector2): Raycaster {
        const v = this.viewport()
        const ndc = new Vector2((s.x - v.x) / v.width * 2 - 1, -((s.y - v.y) / v.height) * 2 + 1)
        this._ray.setFromCamera(ndc, this._viewer!.scene.mainCamera)
        return this._ray
    }

    /** The plane through a world point that faces the camera */
    cameraPlane(origin: Vector3) {
        const view = this._viewer!.scene.mainCamera.getWorldDirection(new Vector3())
        return new Plane().setFromNormalAndCoplanarPoint(view.negate(), origin)
    }

    /** The distance in pixels from a point in the container to a line through world points, Infinity when behind */
    distanceTo(s: Vector2, points: Vector3[]) {
        const viewport = this.viewport()
        let best = Infinity
        let prev: ScreenPoint | null = null
        const a = new Vector2(), b = new Vector2(), ab = new Vector2(), as = new Vector2()
        for (const p of points) {
            const q = this.project(p, viewport)
            if (q.behind) {
                prev = null
                continue
            }
            if (!prev) best = Math.min(best, Math.hypot(q.x - s.x, q.y - s.y))
            else {
                a.set(prev.x, prev.y)
                b.set(q.x, q.y)
                ab.subVectors(b, a)
                as.subVectors(s, a)
                const t = Math.max(0, Math.min(1, as.dot(ab) / (ab.lengthSq() || 1)))
                best = Math.min(best, a.addScaledVector(ab, t).distanceTo(s))
            }
            prev = q
        }
        return best
    }

    // endregion

    /** Draw again: the owner's draw callback, then the SVG */
    redraw = () => {
        if (!this._viewer) return
        this._handles = []
        this._lines = ''
        this._shapes = ''
        if (this._active) this._options.draw(this)
        const html = this._lines + this._shapes
        if (html !== this._html) {
            this.svg.innerHTML = html
            this._html = html
        }
        if (this._hoverId && !this._handles.some(x => x.h.id === this._hoverId)) this._setHover(null)
    }

    // region input

    private _onCanvas(e: Event) {
        return e.target === this._viewer?.canvas
    }

    /** The handle at a point in the container: the nearest in its hit radius, the last drawn of equal ones */
    private _hit(s: Vector2) {
        let best: ScreenHandle<T> | null = null, bestD = Infinity
        for (const {h, s: p} of this._handles) {
            const r = h.hitRadius ?? 10
            if (r <= 0) continue
            const d = Math.hypot(p.x - s.x, p.y - s.y)
            if (d <= r && d <= bestD) {
                best = h
                bestD = d
            }
        }
        return best
    }

    private _setHover(h: ScreenHandle<T> | null) {
        const id = h?.id ?? null
        this.hovered = h
        if (id === this._hoverId) return
        this._hoverId = id
        this._cursor()
    }

    private _cursor() {
        const c = this._viewer?.container
        if (!c) return
        const h = this._drag?.handle ?? this.hovered
        if (h && this._active) {
            c.classList.add('sh-hovering')
            c.style.setProperty?.('--sh-cursor', h.cursor ?? 'move')
        } else c.classList.remove('sh-hovering')
    }

    private _own(e: Event) {
        e.stopPropagation()
        e.preventDefault()
    }

    /** Where the pointer is on the plane or the line of the drag, null when it misses */
    private _dragPoint(spec: ScreenHandleDrag<any>, s: Vector2) {
        const ray = this.rayAt(s)
        if (spec.axis) {
            // the point of the line nearest to the ray: closest points of two lines
            const dir = spec.axis.clone().normalize()
            const w0 = ray.origin.clone().sub(spec.origin)
            const b = ray.direction.dot(dir), d = ray.direction.dot(w0), e = dir.dot(w0)
            const den = 1 - b * b
            if (den < 1e-6) return null // looking along the line
            return spec.origin.clone().addScaledVector(dir, (e - b * d) / den)
        }
        const plane = spec.plane ?? this.cameraPlane(spec.origin)
        return ray.intersectPlane(plane, new Vector3())
    }

    private _onDown = (e: PointerEvent) => {
        if (!this._viewer || !this._onCanvas(e) || e.button !== 0 || this._drag) return
        const s = this.pointer(e)
        let h = this._hit(s)
        let res = h ? this._options.press(h, e) : undefined
        if (!res) {
            h = null
            res = this._options.pressCanvas?.(e, s)
        }
        if (!res) {
            this._press = {s}
            return
        }
        this._own(e)
        this._taken = true
        this._press = null
        if (res === true) {
            this.redraw()
            return
        }
        const spec = res
        const hit = this._dragPoint(spec, s)
        const offset = hit ? spec.origin.clone().sub(hit) : new Vector3()
        const before = spec.before !== undefined ? spec.before : spec.snapshot?.()
        this._drag = {spec, start: s, offset, before, moved: false, handle: h ?? undefined}
        this._cursor()
        this.redraw()
    }

    private _onMove = (e: PointerEvent) => {
        if (!this._viewer) return
        const d = this._drag
        if (d) {
            // no button: the pointerup was missed (released outside the window); this move is a hover, for the viewer too
            if (e.buttons === 0) return this._release()
            e.stopPropagation()
            const s = this.pointer(e)
            if (!d.moved && s.distanceTo(d.start) < DRAG_START) return
            d.moved = true
            const p = this._dragPoint(d.spec, s)
            if (p) d.spec.move(p.add(d.offset), e)
            this.redraw()
            return
        }
        this._options.move?.(e, this.pointer(e))
        // hover only without a button: not during an orbit drag
        if (e.buttons) return
        const h = this._onCanvas(e) ? this._hit(this.pointer(e)) : null
        if ((h?.id ?? null) !== this._hoverId) {
            this._setHover(h)
            this.redraw()
        } else this.hovered = h
    }

    private _onUp = (e: PointerEvent) => {
        if (this._drag) {
            this._own(e)
            this._release()
        } else if (this._taken) {
            this._own(e)
            this._taken = false
        } else {
            if (this._press && e.button === 0) {
                const click = this.pointer(e).distanceTo(this._press.s) < DRAG_START + 1
                this._press = null
                if (click && this._onCanvas(e)) this._options.click?.(e)
            }
            this._options.pointerUp?.(e)
        }
    }

    /** End the drag: the release, also a lost one (window blur, pointercancel, a move with no button) */
    private _release = () => {
        const d = this._drag
        this._taken = false
        if (!d) return
        this._drag = null
        const {spec, before, moved} = d
        spec.end?.(moved)
        if ((moved || spec.record === 'always') && spec.snapshot && spec.restore) {
            const after = spec.snapshot()
            const restore = spec.restore.bind(spec)
            this._viewer?.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.undoManager?.record({
                undo: () => restore(before),
                redo: () => restore(after),
            })
        }
        this._cursor()
        this.redraw()
    }

    // endregion
}
