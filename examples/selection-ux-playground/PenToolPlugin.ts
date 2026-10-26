import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    CubicBezierCurve3,
    CurvePath3,
    GeometryGeneratorPlugin,
    IObject3D,
    LineMaterial2,
    PickingPlugin,
    Plane,
    Raycaster,
    ThreeViewer,
    UndoManagerPlugin,
    Vector2,
    Vector3,
} from 'threepipe'

interface Anchor {
    p: Vector3
    /** Handle towards the previous point (world) */
    hIn: Vector3
    /** Handle towards the next point (world) */
    hOut: Vector3
}

export interface PenToolOptions {
    /** Colour and width (px) of new paths */
    color?: string
    linewidth?: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * A pen tool like Figma's or Illustrator's for 3D paths: click to add a point, click and drag to pull out smooth
 * Bezier handles, click the first point to close the path, Enter or double-click to finish, Backspace removes the
 * last point, Esc cancels. Points go on the surface under the pointer, else on a level plane at the height of the
 * previous point (the ground for the first), so a camera path stays level unless it is drawn over objects.
 *
 * The result is a GeometryGeneratorPlugin 'line' with a CurvePath3 of cubic Beziers, so its points stay editable
 * (geometry edit) and it saves in the .glb. Undoable.
 */
export interface PenToolEventMap extends AViewerPluginEventMap {
    /** Drawing started, finished or was cancelled */
    change: object
    /** A path was made (not after undo or redo) */
    created: {object: IObject3D}
}

export class PenToolPlugin extends AViewerPluginSync<PenToolEventMap> {
    static readonly PluginType = 'PenToolPlugin'
    enabled = true
    dependencies = [GeometryGeneratorPlugin]

    color: string
    linewidth: number

    private _active = false
    private _anchors: Anchor[] = []
    private _drag: {anchor: Anchor, plane: Plane} | null = null
    private _hover: Vector3 | null = null
    private _svg?: SVGSVGElement
    private _hint?: HTMLDivElement
    private _ray = new Raycaster()
    private _count = 0

    constructor(options: PenToolOptions = {}) {
        super()
        this.color = options.color ?? '#ff6b3d'
        this.linewidth = options.linewidth ?? 3
    }

    get active() {
        return this._active
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        injectStyles()
        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.setAttribute('class', 'pen-overlay')
        viewer.container.appendChild(svg)
        this._svg = svg
        const hint = document.createElement('div')
        hint.className = 'pen-hint'
        hint.innerHTML = 'Pen · click: point · drag: curve · <kbd>Shift</kbd> keep the height · first point: close · <kbd>⌫</kbd> undo point · <kbd>Enter</kbd> done · <kbd>Esc</kbd> cancel'
        viewer.container.appendChild(hint)
        this._hint = hint
        viewer.addEventListener('postFrame', this._draw)
    }

    onRemove(viewer: ThreeViewer) {
        this.cancel()
        viewer.removeEventListener('postFrame', this._draw)
        this._svg?.remove()
        this._hint?.remove()
        super.onRemove(viewer)
    }

    /** Start drawing a new path */
    start() {
        if (this._active || !this._viewer) return
        this._active = true
        this._anchors = []
        window.addEventListener('pointerdown', this._onDown, {capture: true})
        window.addEventListener('pointermove', this._onMove, {capture: true})
        window.addEventListener('pointerup', this._onUp, {capture: true})
        window.addEventListener('keydown', this._onKey, {capture: true})
        window.addEventListener('dblclick', this._onDbl, {capture: true})
        // a body class: the selection UX sets the canvas cursor itself; it also hides the selection hints
        document.body.classList.add('pen-drawing')
        this._hint?.classList.add('show')
        this._changed()
    }

    /** Stop without making a path */
    cancel() {
        this._anchors = []
        this._stop()
    }

    /** Make the path from the points placed so far (2 or more), or cancel */
    finish(closed = false) {
        const anchors = this._anchors
        this._anchors = []
        this._stop()
        if (anchors.length < 2) return
        this._create(anchors, closed)
    }

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
        document.body.classList.remove('pen-drawing')
        this._hint?.classList.remove('show')
        this._draw()
        this._changed()
    }

    private _changed() {
        this.dispatchEvent({type: 'change'})
    }

    // region input

    private _onCanvas(e: Event) {
        return e.target === this._viewer?.canvas
    }

    private _onDown = (e: PointerEvent) => {
        if (!this._onCanvas(e) || e.button !== 0) return
        // the pen owns the canvas while active: no selection, no orbit (the wheel still zooms)
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
        // dragging pulls out the handles flat, so a path on the floor stays on it; facing the camera when it looks
        // along the floor (a flat plane would be edge-on)
        const view = this._viewer!.scene.mainCamera.getWorldDirection(new Vector3())
        const n = Math.abs(view.y) > 0.25 ? new Vector3(0, 1, 0) : view.negate()
        this._drag = {anchor: a, plane: new Plane().setFromNormalAndCoplanarPoint(n, p)}
        this._draw()
    }

    private _onMove = (e: PointerEvent) => {
        if (!this._viewer) return
        const s = this._screen(e)
        if (this._drag) {
            e.stopPropagation()
            const hit = this._rayAt(s).ray.intersectPlane(this._drag.plane, new Vector3())
            if (hit) {
                const {anchor} = this._drag
                anchor.hOut.copy(hit)
                anchor.hIn.copy(anchor.p).multiplyScalar(2).sub(hit) // symmetric, like a smooth point
            }
        } else if (this._onCanvas(e)) this._hover = this._place(s, e.shiftKey)
        else this._hover = null
        this._draw()
    }

    private _onUp = (e: PointerEvent) => {
        if (!this._drag) return
        e.stopPropagation()
        // a click without a drag: a sharp corner
        const a = this._drag.anchor
        if (a.hOut.distanceTo(a.p) < this._worldPerPixel(a.p) * 4) {
            a.hOut.copy(a.p)
            a.hIn.copy(a.p)
        }
        this._drag = null
        this._draw()
    }

    private _onDbl = (e: MouseEvent) => {
        if (!this._onCanvas(e)) return
        e.stopPropagation()
        // the double-click added one more point at the same place: drop it
        const n = this._anchors.length
        if (n > 1 && this._anchors[n - 1].p.distanceTo(this._anchors[n - 2].p) < this._worldPerPixel(this._anchors[n - 1].p) * 4) this._anchors.pop()
        this.finish()
    }

    private _onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement
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
            this._anchors.pop()
            this._draw()
        }
    }

    // endregion

    // region geometry

    private _screen(e: {clientX: number, clientY: number}) {
        const r = this._viewer!.container.getBoundingClientRect()
        return new Vector2(e.clientX - r.left, e.clientY - r.top)
    }

    private _rayAt(s: Vector2) {
        const viewer = this._viewer!
        const r = viewer.container.getBoundingClientRect()
        this._ray.setFromCamera(new Vector2(s.x / r.width * 2 - 1, -(s.y / r.height) * 2 + 1), viewer.scene.mainCamera)
        ;(this._ray as any).camera = viewer.scene.mainCamera // fat lines need it to raycast
        return this._ray
    }

    /**
     * The surface under the pointer, else the floor (y = 0). With `keepHeight` (Shift) the level plane through the
     * previous point, to draw in the air; also when the pointer is above the horizon and misses the floor.
     */
    private _place(s: Vector2, keepHeight = false): Vector3 | null {
        const viewer = this._viewer!
        const ray = this._rayAt(s)
        const last = this._anchors[this._anchors.length - 1]
        if (!(keepHeight && last)) {
            const hit = ray.intersectObject(viewer.scene.modelRoot, true).find(h => (h.object as any).isMesh && !(h.object as any).isLine2 && h.object.visible)
            if (hit) return hit.point.clone()
            const floor = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())
            if (floor) return floor
        }
        return ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -(last?.p.y ?? 0)), new Vector3())
    }

    private _toScreen(p: Vector3) {
        const viewer = this._viewer!
        const r = viewer.container.getBoundingClientRect()
        const v = p.clone().project(viewer.scene.mainCamera)
        return {x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, behind: v.z > 1}
    }

    private _near(p: Vector3, s: Vector2) {
        const q = this._toScreen(p)
        return Math.hypot(q.x - s.x, q.y - s.y) < 10
    }

    private _worldPerPixel(p: Vector3) {
        const cam = this._viewer!.scene.mainCamera as any
        const h = this._viewer!.container.clientHeight || 1
        return 2 * cam.position.distanceTo(p) * Math.tan((cam.fov || 45) * Math.PI / 360) / h
    }

    private _create(anchors: Anchor[], closed: boolean) {
        const viewer = this._viewer
        const gen = viewer?.getPlugin(GeometryGeneratorPlugin)
        if (!viewer || !gen) return
        // the object sits at the centre of its points; the curve is in its local space
        const center = anchors.reduce((c, a) => c.add(a.p), new Vector3()).divideScalar(anchors.length)
        const loc = (v: Vector3) => v.clone().sub(center)
        const pts = anchors.map(a => ({p: loc(a.p), hIn: loc(a.hIn), hOut: loc(a.hOut)}))
        const path = new CurvePath3()
        const n = closed ? pts.length : pts.length - 1
        for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length]
            // neighbouring segments share their end point, so dragging it in geometry edit keeps them joined
            path.add(new CubicBezierCurve3(a.p, a.hOut, b.hIn, b.p))
        }
        const segments = Math.min(400, Math.max(48, n * 32))
        const obj = gen.generateObject('line', {curve: path, segments, material: new LineMaterial2({color: this.color, linewidth: this.linewidth})}) as IObject3D
        obj.name = `Path ${++this._count}`
        obj.position.copy(center)
        const root = viewer.scene.modelRoot
        const add = () => {
            root.add(obj)
            viewer.scene.setDirty({refreshScene: true})
        }
        const remove = () => {
            obj.removeFromParent()
            viewer.scene.setDirty({refreshScene: true})
        }
        add()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: remove, redo: add})
        // selected without an undo step of its own: one undo removes the new path
        viewer.getPlugin(PickingPlugin)?.setSelectedObject(obj, false, false)
        this.dispatchEvent({type: 'created', object: obj})
    }

    // endregion

    private _draw = () => {
        const svg = this._svg
        if (!svg || !this._viewer) return
        if (!this._active || !this._anchors.length && !this._hover) {
            if (svg.childNodes.length) svg.innerHTML = ''
            return
        }
        const S = (p: Vector3) => this._toScreen(p)
        const f = (n: number) => n.toFixed(1)
        let d = ''
        const as = this._anchors
        for (let i = 0; i < as.length; i++) {
            const a = S(as[i].p)
            if (i === 0) {
                d += `M${f(a.x)} ${f(a.y)}`
                continue
            }
            const c1 = S(as[i - 1].hOut), c2 = S(as[i].hIn)
            d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(a.x)} ${f(a.y)}`
        }
        // the next segment, to the pointer
        let preview = ''
        if (as.length && this._hover && !this._drag) {
            const last = as[as.length - 1], a = S(last.p), c1 = S(last.hOut), h = S(this._hover)
            preview = `M${f(a.x)} ${f(a.y)}C${f(c1.x)} ${f(c1.y)} ${f(h.x)} ${f(h.y)} ${f(h.x)} ${f(h.y)}`
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
            const first = i === 0 && as.length > 2 && this._hover && this._near(a.p, new Vector2(S(this._hover).x, S(this._hover).y))
            dots += `<rect x="${f(p.x - 4)}" y="${f(p.y - 4)}" width="8" height="8" rx="1.5" class="pen-a${first ? ' pen-close' : ''}"/>`
        })
        const hov = this._hover && !this._drag ? S(this._hover) : null
        svg.innerHTML = `<path d="${d}" class="pen-path"/><path d="${preview}" class="pen-preview"/>${handles}${dots}` +
            (hov ? `<circle cx="${f(hov.x)}" cy="${f(hov.y)}" r="3.5" class="pen-cursor"/>` : '')
    }
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.pen-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 8; overflow: visible; }
.pen-path { fill: none; stroke: #0d99ff; stroke-width: 2; }
.pen-preview { fill: none; stroke: #0d99ff; stroke-width: 1.5; stroke-dasharray: 4 3; opacity: .7; }
.pen-hl { stroke: #0d99ff; stroke-width: 1; opacity: .7; }
.pen-h { fill: #fff; stroke: #0d99ff; stroke-width: 1.2; }
.pen-a { fill: #fff; stroke: #0d99ff; stroke-width: 1.5; }
.pen-a.pen-close { fill: #0d99ff; }
.pen-cursor { fill: #0d99ff; opacity: .6; }
.pen-hint {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 13; display: none; white-space: nowrap;
  background: rgba(30,30,30,.92); color: #fff; border-radius: 6px; padding: 7px 12px; pointer-events: none;
  font: 11px/1.3 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
}
.pen-hint.show { display: block; }
.pen-hint kbd { font: inherit; background: #3a3a3a; border-radius: 3px; padding: 0 4px; }
/* while drawing: the pen's hint in place of the selection hints, and a crosshair over the selection UX's cursor */
body.pen-drawing .sux-hint { display: none !important; }
body.pen-drawing canvas { cursor: crosshair !important; }
`
    document.head.appendChild(st)
}
