/**
 * PathEditPlugin (edit, stopEditing, drags, add and remove, undo, keys, the pointer it takes and the one it leaves)
 * and LineHelper (draws the points only). No DOM and no WebGL: small fakes for the elements, the window and the viewer.
 */
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {
    CatmullRomCurve3,
    CubicBezierCurve3,
    EventDispatcher,
    LineCurve3,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Vector3,
} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

type Listener = (e: any) => void

class Listeners {
    private _map = new Map<string, Listener[]>()
    addEventListener(type: string, f: Listener) {
        this._map.set(type, [...this._map.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: Listener) {
        this._map.set(type, (this._map.get(type) ?? []).filter(x => x !== f))
    }
    count(type?: string) {
        return type ? this._map.get(type)?.length ?? 0 : [...this._map.values()].reduce((n, l) => n + l.length, 0)
    }
    fire(type: string, e: any) {
        for (const f of this._map.get(type) ?? []) f({type, ...e})
    }
}

// the node setup has no DOM: an element with what the plugin uses
class FakeElement extends Listeners {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    innerHTML = ''
    style: Record<string, any> = {}
    attributes: Record<string, string> = {}
    classList = {
        add: (c: string) => this._classes.add(c),
        remove: (c: string) => this._classes.delete(c),
        contains: (c: string) => this._classes.has(c),
    }
    private _classes = new Set<string>()
    constructor(readonly tagName: string) {
        super()
    }
    get childNodes() {
        return this.innerHTML ? [this.innerHTML] : []
    }
    setAttribute(k: string, v: string) {
        this.attributes[k] = v
    }
    appendChild(c: FakeElement) {
        c.parent = this
        this.children.push(c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
}

const W = 800, H = 600
const doc = globalThis.document as any
const saved = {createElement: doc.createElement, createElementNS: doc.createElementNS}
let win: Listeners
beforeAll(() => {
    doc.createElement = (tag: string) => new FakeElement(tag)
    doc.createElementNS = (_: string, tag: string) => new FakeElement(tag)
})
afterAll(() => Object.assign(doc, saved))
beforeEach(() => {
    win = new Listeners()
    vi.stubGlobal('window', win)
    vi.stubGlobal('queueMicrotask', (f: () => void) => f())
})
afterEach(() => vi.unstubAllGlobals())

function setup({withUndo = true} = {}) {
    const rect = {left: 20, top: 10, width: W, height: H}
    const container = Object.assign(new FakeElement('div'), {getBoundingClientRect: () => rect})
    const canvas = Object.assign(new FakeElement('canvas'), {getBoundingClientRect: () => rect})
    container.appendChild(canvas)
    const camera = new PerspectiveCamera(45, W / H, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const scene = new Scene()
    const modelRoot = new Object3D()
    scene.add(modelRoot)
    const gen = new tp.GeometryGeneratorPlugin()
    const undoManager = new tp.JSUndoManager({bindHotKeys: false, limit: 100})
    const viewer = new EventDispatcher() as any
    Object.assign(viewer, {
        container, canvas,
        scene: {mainCamera: camera, modelRoot, setDirty: vi.fn()},
        getPlugin: (p: any) => p === tp.GeometryGeneratorPlugin ? gen : p === 'UndoManagerPlugin' && withUndo ? {undoManager} : undefined,
    })
    const plugin = new tp.PathEditPlugin()
    plugin.onAdded(viewer)

    const line = (curve: any, name = 'line') => {
        const o = gen.generateObject('line', {curve, segments: 20}) as any
        o.name = name
        o.geometry.setDirty = vi.fn()
        modelRoot.add(o)
        o.updateMatrixWorld(true)
        return o
    }
    /** Client position of a world point */
    const screen = (p: Vector3) => {
        const v = p.clone().project(camera)
        return {clientX: rect.left + (v.x + 1) / 2 * W, clientY: rect.top + (1 - v.y) / 2 * H}
    }
    const ev = (pos: {clientX: number, clientY: number}, extra: any = {}) => ({
        target: canvas, button: 0, buttons: 0, shiftKey: false, altKey: false,
        stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(), preventDefault: vi.fn(), ...pos, ...extra,
    })
    /** Draw the overlay (a frame) */
    const frame = () => viewer.dispatchEvent({type: 'postFrame'})
    const press = (p: Vector3, extra?: any) => {
        frame()
        const e = ev(screen(p), extra)
        win.fire('pointerdown', e)
        return e
    }
    const click = (p: Vector3, extra?: any) => {
        const down = press(p, extra)
        const up = ev(screen(p), extra)
        win.fire('pointerup', up)
        return {down, up}
    }
    const drag = (from: Vector3, to: Vector3, extra?: any) => {
        const down = press(from, extra)
        const move = ev(screen(to), {buttons: 1, ...extra})
        win.fire('pointermove', move)
        const up = ev(screen(to), extra)
        win.fire('pointerup', up)
        return {down, move, up}
    }
    const key = (k: string, target: any = {tagName: 'CANVAS'}) => {
        const e = {key: k, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn()}
        win.fire('keydown', e)
        return e
    }
    const svg = () => container.children.find(c => c.attributes.class?.includes('sh-overlay'))!
    return {plugin, viewer, container, canvas, camera, modelRoot, undoManager, line, screen, ev, frame, press, click, drag, key, svg}
}

const arr = (p: {x: number, y: number, z?: number}) => [p.x, p.y, p.z ?? 0].map(v => +v.toFixed(4))

function spline() {
    return new CatmullRomCurve3([new Vector3(-3, 0, 0), new Vector3(0, 2, 0), new Vector3(3, 0, 0)])
}

function bezierPath() {
    const a = new Vector3(-3, 0, 0), b = new Vector3(0, 0, 0), c = new Vector3(3, 0, 0)
    const path = new tp.CurvePath3()
    path.add(new CubicBezierCurve3(a, new Vector3(-3, 1.5, 0), new Vector3(-1, 1.5, 0), b))
    path.add(new CubicBezierCurve3(b, new Vector3(1, -1.5, 0), new Vector3(3, -1.5, 0), c))
    return path
}

describe('PathEditPlugin', () => {
    test('settings in its UI (uiconfig decorators): enabled, edit on double-click, and the edit button', () => {
        const {plugin, line} = setup()
        const children = (plugin.uiConfig.children ?? []).map((c: any) => typeof c === 'function' ? c() : c).flat()
        const label = (c: any) => typeof c.label === 'function' ? c.label() : c.label
        expect(plugin.uiConfig.label).toBe('Path Edit')
        expect(children.map(label)).toEqual(['Enabled', 'Edit on double-click', 'Edit selected line'])
        const button = children[2]
        plugin.edit(line(spline()))
        expect(label(button)).toBe('Done')
        const [target, key] = button.property
        target[key]() // ends editing
        expect(plugin.editing).toBe(null)
        expect(label(button)).toBe('Edit selected line')
        plugin.edit(line(spline()))
        plugin.enabled = false
        expect(plugin.editing).toBe(null)
    })

    test('edit and stopEditing: events, the overlay, the listeners', () => {
        const {plugin, line, frame, svg, container} = setup()
        const o = line(spline())
        const events: string[] = []
        plugin.addEventListener('editStart', ({object}) => events.push('start ' + object.name))
        plugin.addEventListener('editEnd', ({object}) => events.push('end ' + object.name))
        expect(plugin.canEdit(o)).toBe(true)
        expect(plugin.edit(o)).toBe(true)
        expect(plugin.editing).toBe(o)
        expect(win.count('pointerdown')).toBe(1)
        expect(win.count('keydown')).toBe(1)
        frame()
        // 3 points and 2 + markers
        expect(svg().innerHTML.match(/class="sh-dot/g)).toHaveLength(3)
        expect(svg().innerHTML.match(/class="sh-plus/g)).toHaveLength(2)
        const hint = container.children.find(c => c.className.includes('sh-hint'))!
        expect(hint.classList.contains('sh-shown')).toBe(true)
        plugin.stopEditing()
        expect(plugin.editing).toBe(null)
        expect(win.count()).toBe(0)
        expect(svg().innerHTML).toBe('')
        expect(hint.classList.contains('sh-shown')).toBe(false)
        expect(events).toEqual(['start line', 'end line'])
    })

    test('canEdit: only objects with a generated curve; disabled does not edit', () => {
        const {plugin, line} = setup()
        expect(plugin.canEdit(new Object3D() as any)).toBe(false)
        plugin.enabled = false
        expect(plugin.edit(line(spline()))).toBe(false)
        plugin.enabled = true
        const o = line(spline())
        plugin.edit(o)
        plugin.enabled = false
        expect(plugin.editing).toBe(null)
    })

    test('drag a point: it moves on the plane facing the camera, the press is taken, one undo step', () => {
        const {plugin, line, drag, undoManager} = setup()
        const curve = spline()
        const o = line(curve)
        plugin.edit(o)
        const changes: string[] = []
        plugin.addEventListener('pointChange', ({change}) => changes.push(change))
        const {down, move, up} = drag(new Vector3(0, 2, 0), new Vector3(1, 3, 0))
        expect(down.stopPropagation).toHaveBeenCalled()
        expect(down.preventDefault).toHaveBeenCalled()
        expect(move.stopPropagation).toHaveBeenCalled()
        expect(up.stopPropagation).toHaveBeenCalled()
        expect(arr(curve.points[1])).toEqual([1, 3, 0])
        expect(o.geometry.setDirty).toHaveBeenCalledWith({regenerate: true})
        expect(changes).toContain('move')
        expect(plugin.selectedPoint).toBe(1)
        undoManager.undo()
        expect(arr(curve.points[1])).toEqual([0, 2, 0])
        undoManager.redo()
        expect(arr(curve.points[1])).toEqual([1, 3, 0])
    })

    test('a second finger does not move or end the drag of the first one', () => {
        const {plugin, line, press, ev, screen, undoManager} = setup()
        const curve = spline()
        plugin.edit(line(curve))
        press(new Vector3(0, 2, 0), {pointerId: 1})
        // the second finger goes down away from the handles, moves and is released
        const other = ev(screen(new Vector3(-2, -2, 0)), {pointerId: 2, buttons: 1})
        win.fire('pointerdown', other)
        win.fire('pointermove', ev(screen(new Vector3(2, -2, 0)), {pointerId: 2, buttons: 1}))
        win.fire('pointerup', ev(screen(new Vector3(2, -2, 0)), {pointerId: 2}))
        win.fire('pointercancel', ev(screen(new Vector3(2, -2, 0)), {pointerId: 2}))
        expect(arr(curve.points[1])).toEqual([0, 2, 0])
        // the first finger still drags
        win.fire('pointermove', ev(screen(new Vector3(1, 3, 0)), {pointerId: 1, buttons: 1}))
        expect(arr(curve.points[1])).toEqual([1, 3, 0])
        win.fire('pointerup', ev(screen(new Vector3(1, 3, 0)), {pointerId: 1}))
        undoManager.undo()
        expect(arr(curve.points[1])).toEqual([0, 2, 0])
    })

    test('a point behind an orthographic camera is not drawn or pressable', () => {
        const {plugin, line, frame, svg, viewer} = setup()
        const camera = new OrthographicCamera(-8, 8, 6, -6, 0.1, 100)
        camera.position.set(0, 0, 10)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld()
        viewer.scene.mainCamera = camera
        // the middle point is behind the camera (z = 20)
        plugin.edit(line(new CatmullRomCurve3([new Vector3(-3, 0, 0), new Vector3(0, 2, 20), new Vector3(3, 0, 0)])))
        frame()
        expect(svg().innerHTML.match(/class="sh-dot/g)).toHaveLength(2)
    })

    test('a press away from the handles is not taken (orbit, picking)', () => {
        const {plugin, line, press} = setup()
        plugin.edit(line(spline()))
        const e = press(new Vector3(-2, -2, 0))
        expect(e.stopPropagation).not.toHaveBeenCalled()
        expect(e.preventDefault).not.toHaveBeenCalled()
        // not the left button
        const r = press(new Vector3(0, 2, 0), {button: 2})
        expect(r.stopPropagation).not.toHaveBeenCalled()
    })

    test('the object can be moved and scaled: the drag is in its local space', () => {
        const {plugin, line, drag} = setup()
        const curve = spline()
        const o = line(curve)
        o.position.set(1, 0, 0)
        o.scale.setScalar(2)
        o.updateMatrixWorld(true)
        plugin.edit(o)
        // local (0, 2, 0) is world (1, 4, 0)
        drag(new Vector3(1, 4, 0), new Vector3(3, 4, 0))
        expect(arr(curve.points[1])).toEqual([1, 2, 0])
    })

    test('a joint of a Bezier path moves both curves and its handles', () => {
        const {plugin, line, drag} = setup()
        const path = bezierPath()
        plugin.edit(line(path))
        drag(new Vector3(0, 0, 0), new Vector3(0, 1, 0))
        const [c0, c1] = path.curves as CubicBezierCurve3[]
        expect(arr(c0.v3)).toEqual([0, 1, 0])
        expect(c0.v3).toBe(c1.v0)
        expect(arr(c0.v2)).toEqual([-1, 2.5, 0])
        expect(arr(c1.v1)).toEqual([1, -0.5, 0])
    })

    test('Shift at the press keeps the height (a level plane)', () => {
        const {plugin, line, drag, camera} = setup()
        camera.position.set(0, 8, 8)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld()
        const curve = spline()
        plugin.edit(line(curve))
        drag(new Vector3(0, 2, 0), new Vector3(1, 3, 0), {shiftKey: true})
        expect(curve.points[1].y).toBeCloseTo(2)
        expect(curve.points[1].x).not.toBeCloseTo(0)
    })

    test('+ adds a point and drags it, one undo step for both', () => {
        const {plugin, line, drag, undoManager} = setup()
        const o = line(spline())
        plugin.edit(o)
        const old = o.geometry.userData.generationParams.curve
        const mid = old.getPoint(0.25)
        drag(mid, mid.clone().add(new Vector3(0, -1, 0)))
        const next = o.geometry.userData.generationParams.curve as CatmullRomCurve3
        expect(next).not.toBe(old)
        expect(next.points).toHaveLength(4)
        expect(next.points[1].y).toBeCloseTo(mid.y - 1)
        expect(plugin.selectedPoint).toBe(1)
        undoManager.undo()
        expect(o.geometry.userData.generationParams.curve).toBe(old)
        expect(old.points).toHaveLength(3)
        undoManager.redo()
        expect(o.geometry.userData.generationParams.curve).toBe(next)
        expect(next.points[1].y).toBeCloseTo(mid.y - 1)
    })

    test('a click on + adds a point (one undo step)', () => {
        const {plugin, line, click, undoManager} = setup()
        const o = line(new LineCurve3(new Vector3(-3, 0, 0), new Vector3(3, 0, 0)))
        plugin.edit(o)
        click(new Vector3(0, 0, 0))
        const path = o.geometry.userData.generationParams.curve
        expect(path.type).toBe('CurvePath3')
        expect(tp.getCurveEditPoints(path)).toHaveLength(3)
        undoManager.undo()
        expect(o.geometry.userData.generationParams.curve).toBeInstanceOf(LineCurve3)
    })

    test('Alt + click removes a point (one undo step), a curve keeps two', () => {
        const {plugin, line, click, undoManager} = setup()
        const o = line(spline())
        plugin.edit(o)
        const {down} = click(new Vector3(0, 2, 0), {altKey: true})
        expect(down.stopPropagation).toHaveBeenCalled()
        expect(o.geometry.userData.generationParams.curve.points.map(arr)).toEqual([[-3, 0, 0], [3, 0, 0]])
        click(new Vector3(3, 0, 0), {altKey: true})
        expect(o.geometry.userData.generationParams.curve.points).toHaveLength(2)
        undoManager.undo()
        expect(o.geometry.userData.generationParams.curve.points).toHaveLength(3)
    })

    test('Delete removes the selected point and is not left to the picking; Esc ends editing', () => {
        const {plugin, line, click, key} = setup()
        const o = line(spline())
        plugin.edit(o)
        const none = key('Delete')
        expect(none.preventDefault).toHaveBeenCalled()
        expect(o.geometry.userData.generationParams.curve.points).toHaveLength(3)
        click(new Vector3(-3, 0, 0))
        expect(plugin.selectedPoint).toBe(0)
        key('Delete')
        expect(o.geometry.userData.generationParams.curve.points.map(arr)).toEqual([[0, 2, 0], [3, 0, 0]])
        // a key in a text field is not taken
        const typed = key('Escape', {tagName: 'INPUT'})
        expect(typed.preventDefault).not.toHaveBeenCalled()
        expect(plugin.editing).toBe(o)
        const esc = key('Escape')
        expect(esc.preventDefault).toHaveBeenCalled()
        expect(plugin.editing).toBe(null)
    })

    test('Esc during a drag puts the point back, without an undo step', () => {
        const {plugin, line, press, ev, screen, key, undoManager} = setup()
        const curve = spline()
        plugin.edit(line(curve))
        press(new Vector3(0, 2, 0))
        win.fire('pointermove', ev(screen(new Vector3(2, 2, 0)), {buttons: 1}))
        expect(curve.points[1].x).toBeCloseTo(2)
        key('Escape')
        expect(arr(curve.points[1])).toEqual([0, 2, 0])
        expect(plugin.editing).not.toBe(null)
        const up = ev(screen(new Vector3(2, 2, 0)))
        win.fire('pointerup', up)
        expect(up.stopPropagation).toHaveBeenCalled()
        expect(undoManager.canUndo()).toBe(false)
    })

    test('a click away from the line ends editing, a click on it does not', () => {
        const {plugin, line, click} = setup()
        plugin.edit(line(spline()))
        const onLine = spline().getPoint(0.6)
        const {down} = click(onLine)
        expect(down.stopPropagation).not.toHaveBeenCalled()
        expect(plugin.editing).not.toBe(null)
        click(new Vector3(0, -3, 0))
        expect(plugin.editing).toBe(null)
    })

    test('double-click on a line edits it', () => {
        const {plugin, line, canvas, screen, ev} = setup()
        const a = line(spline(), 'a')
        const b = line(new LineCurve3(new Vector3(-3, -2, 0), new Vector3(3, -2, 0)), 'b')
        canvas.fire('dblclick', ev(screen(new Vector3(-1.5, -2, 0))))
        expect(plugin.editing).toBe(b)
        canvas.fire('dblclick', ev(screen(spline().getPoint(0.3))))
        expect(plugin.editing).toBe(a)
        plugin.stopEditing()
        plugin.editOnDoubleClick = false
        canvas.fire('dblclick', ev(screen(new Vector3(-1.5, -2, 0))))
        expect(plugin.editing).toBe(null)
    })

    test('an object removed from the scene ends editing', () => {
        const {plugin, line, frame} = setup()
        const o = line(spline())
        plugin.edit(o)
        o.removeFromParent()
        frame()
        expect(plugin.editing).toBe(null)
    })

    test('the API: movePoint, addPoint, removePoint, each one undo step', () => {
        const {plugin, line, undoManager} = setup()
        const o = line(bezierPath())
        plugin.edit(o)
        plugin.movePoint(0, new Vector3(-4, 0, 0))
        expect(arr(plugin.getPoints()[0].vec)).toEqual([-4, 0, 0])
        expect(arr(plugin.getPoints()[1].vec)).toEqual([-4, 1.5, 0])
        const i = plugin.addPoint(1)!
        expect(plugin.getPoints().filter(p => p.kind === 'anchor')).toHaveLength(4)
        expect(plugin.removePoint(i)).toBe(true)
        expect(plugin.getPoints().filter(p => p.kind === 'anchor')).toHaveLength(3)
        undoManager.undo()
        undoManager.undo()
        undoManager.undo()
        expect(arr(plugin.getPoints()[0].vec)).toEqual([-3, 0, 0])
        expect(arr(plugin.getPoints()[1].vec)).toEqual([-3, 1.5, 0])
    })

    /** Two lines through x = 0, 1, 2 with a shared middle joint */
    function twoLines() {
        const a = new Vector3(-3, 0, 0), b = new Vector3(0, 0, 0), c = new Vector3(3, 0, 0)
        const path = new tp.CurvePath3()
        path.add(new LineCurve3(a, b))
        path.add(new LineCurve3(b, c))
        return path
    }
    const xs = (o: any) => tp.getCurveEditPoints(o.geometry.userData.generationParams.curve).map((p: any) => p.vec.x)

    test('undo after the last point of an open path is moved onto the first: the points come back', () => {
        const {plugin, line, undoManager} = setup()
        const o = line(twoLines())
        plugin.edit(o)
        plugin.movePoint(2, new Vector3(-3, 0, 0))
        expect(xs(o)).toEqual([-3, 0, -3])
        undoManager.undo()
        expect(xs(o)).toEqual([-3, 0, 3])
        undoManager.redo()
        undoManager.undo()
        expect(xs(o)).toEqual([-3, 0, 3])
    })

    test('a drag of the last point onto the first and on: the same point moves; Esc puts it back', () => {
        const {plugin, line, press, ev, screen, key} = setup()
        const o = line(twoLines())
        plugin.edit(o)
        press(new Vector3(3, 0, 0))
        win.fire('pointermove', ev(screen(new Vector3(-3, 0, 0)), {buttons: 1}))
        win.fire('pointermove', ev(screen(new Vector3(-2, 1, 0)), {buttons: 1}))
        const pts = tp.getCurveEditPoints(o.geometry.userData.generationParams.curve)
        expect(arr(pts[0].vec)).toEqual([-3, 0, 0])
        expect(arr(pts[2].vec)).toEqual([-2, 1, 0])
        win.fire('pointermove', ev(screen(new Vector3(-3, 0, 0)), {buttons: 1}))
        key('Escape')
        expect(xs(o)).toEqual([-3, 0, 3])
    })

    test('works without UndoManagerPlugin', () => {
        const {plugin, line, drag} = setup({withUndo: false})
        const curve = spline()
        plugin.edit(line(curve))
        drag(new Vector3(0, 2, 0), new Vector3(0, 1, 0))
        expect(arr(curve.points[1])).toEqual([0, 1, 0])
    })

    test('onRemove ends editing and removes its listeners and elements', () => {
        const {plugin, line, viewer, container, canvas} = setup()
        plugin.edit(line(spline()))
        plugin.onRemove(viewer)
        expect(plugin.editing).toBe(null)
        expect(win.count()).toBe(0)
        expect(canvas.count('dblclick')).toBe(0)
        expect(container.children.filter(c => c !== canvas)).toHaveLength(0)
    })
})

describe('LineHelper', () => {
    test('draws the points of the curve, screen-constant, not pickable, no handles', () => {
        const gen = new tp.GeometryGeneratorPlugin()
        const curve = bezierPath()
        const o = gen.generateObject('line', {curve, segments: 20}) as any
        o.updateMatrixWorld(true)
        const helper = new tp.LineHelper(o)
        const points = helper.children.find((c: any) => c.isPoints) as any
        expect(points).toBeDefined()
        // the shared joint once: 7 points
        expect(points.geometry.getAttribute('position').count).toBe(7)
        expect(points.material.sizeAttenuation).toBe(false)
        expect(points.material.size).toBe(helper.curvePointSize)
        let handles = 0
        helper.traverse((c: any) => {
            if (c.userData.isWidgetHandle || c.userData.transformControls) handles++
        })
        expect(handles).toBe(0)
        const ray = new Raycaster(new Vector3(-3, 0, 5), new Vector3(0, 0, -1))
        ray.params.Points = {threshold: 10}
        expect(ray.intersectObject(points)).toHaveLength(0)
        helper.showPoints = false
        expect(points.visible).toBe(false)
        helper.dispose()
    })

    test('follows the curve after the geometry is regenerated (on the next preRender)', () => {
        const gen = new tp.GeometryGeneratorPlugin()
        const curve = spline()
        const o = gen.generateObject('line', {curve, segments: 20}) as any
        const helper = new tp.LineHelper(o)
        const points = helper.children.find((c: any) => c.isPoints) as any
        curve.points[1].set(0, 5, 0)
        gen.updateGeometry(o.geometry) // dispatches geometryUpdate to the object
        helper.preRender()
        expect(Array.from(points.geometry.getAttribute('position').array).slice(3, 6)).toEqual([0, 5, 0])
        curve.points.push(new Vector3(4, 1, 0))
        gen.updateGeometry(o.geometry)
        helper.preRender()
        expect(points.geometry.getAttribute('position').count).toBe(4)
    })

    test('a line without a curve: its vertices', () => {
        const gen = new tp.GeometryGeneratorPlugin()
        const o = gen.generateObject('line', {curve: new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 0, 0)), segments: 5}) as any
        delete o.geometry.userData.generationParams.curve
        const helper = new tp.LineHelper(o)
        const points = helper.children.find((c: any) => c.isPoints) as any
        expect(points.geometry.getAttribute('position').count).toBe(5)
        expect(points.material.size).toBe(helper.pointSize)
    })
})
