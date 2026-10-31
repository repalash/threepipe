/**
 * PenToolPlugin: the points from clicks and drags on the canvas, the path it makes (a GeometryGeneratorPlugin line
 * with a CurvePath3 of cubic Beziers), undo and redo, the keys, and the cleanup of listeners and elements.
 * No DOM and no WebGL: small fakes for the elements, the window and the viewer.
 */
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, PlaneGeometry} from 'three'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000
beforeAll(async() => {
    tp = await import('threepipe')
}, timeout)

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
    style: Record<string, string> = {}
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
})
afterEach(() => vi.unstubAllGlobals())

interface Rect {left: number, top: number, width: number, height: number}

/**
 * A viewer with what the pen uses: a canvas in a container, a camera above the ground looking at it, a model root.
 * `canvasRect`: the canvas smaller than the container (`setRenderSize(..., 'contain')`), default the container rect.
 */
function setup({canvasRect}: {canvasRect?: Rect} = {}) {
    const containerRect: Rect = {left: 20, top: 10, width: W, height: H}
    const cr = canvasRect ?? containerRect
    const container = Object.assign(new FakeElement('div'), {
        clientHeight: H,
        getBoundingClientRect: () => containerRect,
    })
    const canvas = Object.assign(new FakeElement('canvas'), {
        clientHeight: cr.height,
        getBoundingClientRect: () => cr,
    })
    container.appendChild(canvas)
    const camera = new PerspectiveCamera(45, cr.width / cr.height, 0.1, 100)
    camera.position.set(0, 10, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    const modelRoot = new Object3D()
    const gen = new tp.GeometryGeneratorPlugin()
    const undoManager = new tp.JSUndoManager({bindHotKeys: false, limit: 100})
    const picking = {setSelectedObject: vi.fn()}

    const viewer = new EventDispatcher() as any
    Object.assign(viewer, {
        container, canvas,
        scene: {mainCamera: camera, modelRoot, setDirty: vi.fn()},
        getPlugin: (p: any) => p === tp.GeometryGeneratorPlugin ? gen : p === 'UndoManagerPlugin' ? {undoManager} : p === 'PickingPlugin' ? picking : undefined,
    })
    const pen = new tp.PenToolPlugin()
    pen.onAdded(viewer)

    /** Client (page) position of a world point, in the canvas */
    const screen = (x: number, y: number, z: number) => {
        const v = new tp.Vector3(x, y, z).project(camera)
        return {clientX: cr.left + (v.x + 1) / 2 * cr.width, clientY: cr.top + (1 - v.y) / 2 * cr.height}
    }
    const ev = (pos: {clientX: number, clientY: number}, extra: any = {}) => ({
        target: canvas, button: 0, shiftKey: false, stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(), preventDefault: vi.fn(), ...pos, ...extra,
    })
    /** A click at a world point */
    const click = (x: number, y: number, z: number, extra?: any) => {
        const e = ev(screen(x, y, z), extra)
        win.fire('pointerdown', e)
        win.fire('pointerup', e)
        return e
    }
    /** A press at a world point and a drag to another one */
    const drag = (from: number[], to: number[]) => {
        win.fire('pointerdown', ev(screen(from[0], from[1], from[2])))
        win.fire('pointermove', ev(screen(to[0], to[1], to[2])))
        win.fire('pointerup', ev(screen(to[0], to[1], to[2])))
    }
    const key = (k: string, target: any = {tagName: 'CANVAS'}) => {
        const e = {key: k, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn()}
        win.fire('keydown', e)
        return e
    }
    return {pen, viewer, container, containerRect, canvas, camera, modelRoot, undoManager, picking, click, drag, key, screen, ev}
}

const close = (a: {x: number, y: number, z: number}, b: number[], d = 1e-3) =>
    Math.abs(a.x - b[0]) < d && Math.abs(a.y - b[1]) < d && Math.abs(a.z - b[2]) < d

describe('PenToolPlugin', {timeout}, () => {
    test('start and cancel: listeners, the drawing class and change events', () => {
        const {pen, container} = setup()
        const changes: boolean[] = []
        pen.addEventListener('change', () => changes.push(pen.active))
        expect(win.count()).toBe(0)
        pen.start()
        expect(pen.active).toBe(true)
        expect(win.count()).toBe(5)
        expect(container.classList.contains('pen-drawing')).toBe(true)
        pen.start() // no second set of listeners
        expect(win.count()).toBe(5)
        pen.cancel()
        expect(pen.active).toBe(false)
        expect(win.count()).toBe(0)
        expect(container.classList.contains('pen-drawing')).toBe(false)
        expect(changes).toEqual([true, false])
    })

    test('clicks place corner points on the ground and Enter makes an open path of cubic Beziers', () => {
        const {pen, modelRoot, picking, click, key} = setup()
        const created = vi.fn()
        pen.addEventListener('created', created)
        pen.start()
        const e = click(-2, 0, 0)
        expect(e.stopPropagation).toHaveBeenCalled() // no selection, no orbit
        click(0, 0, 2)
        click(2, 0, 0)
        expect(pen.points.length).toBe(3)
        expect(close(pen.points[1], [0, 0, 2])).toBe(true)
        key('Enter')
        expect(pen.active).toBe(false)

        const obj = modelRoot.children[0] as any
        expect(obj.name).toBe('Path 1')
        expect(obj.isLine2).toBe(true)
        // at the centre of its points, the curve in local space
        expect(close(obj.position, [0, 0, 2 / 3])).toBe(true)
        const params = obj.geometry.userData.generationParams
        expect(params.type).toBe('line')
        expect(params.curve).toBeInstanceOf(tp.CurvePath3)
        const curves = params.curve.curves
        expect(curves.length).toBe(2)
        expect(curves.every((c: any) => c.isCubicBezierCurve3)).toBe(true)
        // corners: the handles are on their points; neighbouring segments share the point
        expect(curves[0].v1.equals(curves[0].v0)).toBe(true)
        expect(curves[0].v3).toBe(curves[1].v0)
        expect(obj.material.color.getHexString()).toBe('ff6b3d')
        expect(obj.material.linewidth).toBe(3)
        expect(picking.setSelectedObject).toHaveBeenCalledWith(obj, false, false)
        expect(created).toHaveBeenCalledWith(expect.objectContaining({object: obj}))
    })

    test('a drag pulls out symmetric handles on the ground', () => {
        const {pen, modelRoot, click, drag} = setup()
        pen.start()
        click(-2, 0, 0)
        drag([0, 0, 0], [1, 0, 0])
        const obj = pen.finish()!
        expect(obj).toBe(modelRoot.children[0])
        const [c0] = (obj.geometry as any).userData.generationParams.curve.curves
        const center = obj.position
        // the second point at (0, 0, 0): its in handle at (-1, 0, 0), its out handle at (1, 0, 0)
        expect(close(c0.v2.clone().add(center), [-1, 0, 0])).toBe(true)
        expect(close(c0.v3.clone().add(center), [0, 0, 0])).toBe(true)
    })

    test('a click on the first point closes the path', () => {
        const {pen, modelRoot, click} = setup()
        pen.start()
        click(-2, 0, 0)
        click(0, 0, 2)
        click(2, 0, 0)
        click(-2, 0, 0) // the first point again
        expect(pen.active).toBe(false)
        const curves = (modelRoot.children[0] as any).geometry.userData.generationParams.curve.curves
        expect(curves.length).toBe(3)
        expect(curves[2].v3).toBe(curves[0].v0)
    })

    test('points go on the model under the pointer; Shift keeps the height of the previous point', () => {
        const {pen, modelRoot, click} = setup()
        const box = new Mesh(new PlaneGeometry(4, 4).rotateX(-Math.PI / 2).translate(0, 1, 0), new MeshBasicMaterial())
        modelRoot.add(box)
        modelRoot.updateMatrixWorld(true)
        pen.start()
        click(0, 1, 0)
        expect(close(pen.points[0], [0, 1, 0])).toBe(true)
        click(0, 1, 4, {shiftKey: true}) // off the model: on the level plane at y = 1
        expect(close(pen.points[1], [0, 1, 4])).toBe(true)
        click(-3, 0, -3) // off the model, no Shift: the ground
        expect(close(pen.points[2], [-3, 0, -3])).toBe(true)
        pen.cancel()
    })

    test('the path is one undo step: undo removes it, redo adds it again', () => {
        const {pen, modelRoot, undoManager, click} = setup()
        pen.start()
        click(-2, 0, 0)
        click(2, 0, 0)
        const obj = pen.finish()!
        expect(modelRoot.children).toEqual([obj])
        undoManager.undo()
        expect(modelRoot.children).toEqual([])
        undoManager.redo()
        expect(modelRoot.children).toEqual([obj])
    })

    test('keys: Backspace removes the last point, Esc cancels, keys in a text field are ignored', () => {
        const {pen, modelRoot, click, key} = setup()
        pen.start()
        click(-2, 0, 0)
        click(2, 0, 0)
        const e = key('Backspace')
        expect(e.preventDefault).toHaveBeenCalled()
        expect(pen.points.length).toBe(1)
        key('Backspace', {tagName: 'INPUT'})
        expect(pen.points.length).toBe(1)
        key('Escape')
        expect(pen.active).toBe(false)
        expect(modelRoot.children.length).toBe(0)
    })

    test('finish with fewer than 2 points makes no path; other buttons and targets are ignored', () => {
        const {pen, modelRoot, click, ev, screen} = setup()
        pen.start()
        click(0, 0, 0, {button: 2})
        win.fire('pointerdown', ev(screen(0, 0, 0), {target: new FakeElement('div')}))
        expect(pen.points.length).toBe(0)
        click(0, 0, 0)
        expect(pen.finish()).toBeUndefined()
        expect(modelRoot.children.length).toBe(0)
    })

    test('a double-click finishes without the extra point of its second click', () => {
        const {pen, modelRoot, click, ev, screen} = setup()
        pen.start()
        click(-2, 0, 0)
        click(2, 0, 0)
        click(2, 0, 0) // the second click of the double-click
        win.fire('dblclick', ev(screen(2, 0, 0)))
        expect(pen.active).toBe(false)
        expect((modelRoot.children[0] as any).geometry.userData.generationParams.curve.curves.length).toBe(1)
    })

    test('the overlay draws the points and handles while drawing, and clears after', () => {
        const {pen, container, viewer, click, drag} = setup()
        const svg = container.children.find(c => c.tagName === 'svg')!
        pen.start()
        click(-2, 0, 0)
        drag([0, 0, 0], [1, 0, 0])
        viewer.dispatchEvent({type: 'postFrame'})
        expect(svg.innerHTML.match(/class="pen-a/g)?.length).toBe(2)
        expect(svg.innerHTML.match(/class="pen-h"/g)?.length).toBe(2)
        pen.cancel()
        expect(svg.innerHTML).toBe('')
    })

    test('enabled false cancels and blocks start', () => {
        const {pen, click} = setup()
        pen.start()
        click(0, 0, 0)
        pen.enabled = false
        expect(pen.active).toBe(false)
        pen.start()
        expect(pen.active).toBe(false)
        pen.enabled = true
        pen.toggle()
        expect(pen.active).toBe(true)
    })

    test('removing the plugin cancels and removes its listeners and elements', () => {
        const {pen, viewer, container} = setup()
        expect(container.children.length).toBe(4) // canvas, style, svg, hint
        pen.start()
        pen.onRemove(viewer)
        expect(pen.active).toBe(false)
        expect(win.count()).toBe(0)
        expect(container.children.map(c => c.tagName)).toEqual(['canvas'])
        expect(container.classList.contains('pen-drawing')).toBe(false)
        expect(pen.serializeWithViewer).toBe(false)
    })

    test('the path is in the model root space: a scaled and moved model root keeps it on the drawn points', () => {
        const {pen, modelRoot, click} = setup()
        modelRoot.scale.setScalar(2) // ThreeViewer modelRootScale
        modelRoot.position.set(1, 0, 0)
        modelRoot.updateMatrixWorld(true)
        pen.start()
        click(-2, 0, 0)
        click(0, 0, 2)
        click(2, 0, 0)
        const obj = pen.finish()!
        obj.updateMatrixWorld(true)
        const curves = (obj.geometry as any).userData.generationParams.curve.curves
        const world = (v: any) => v.clone().applyMatrix4(obj.matrixWorld)
        expect(close(world(curves[0].v0), [-2, 0, 0])).toBe(true)
        expect(close(world(curves[0].v3), [0, 0, 2])).toBe(true)
        expect(close(world(curves[1].v3), [2, 0, 0])).toBe(true)
    })

    test('a canvas smaller than the container (render size contain): points under the pointer, overlay on them', () => {
        const canvasRect = {left: 120, top: 160, width: 600, height: 300}
        const {pen, viewer, container, containerRect, click, camera} = setup({canvasRect})
        pen.start()
        click(-2, 0, 0)
        click(2, 0, 1)
        expect(close(pen.points[0], [-2, 0, 0])).toBe(true)
        expect(close(pen.points[1], [2, 0, 1])).toBe(true)
        viewer.dispatchEvent({type: 'postFrame'})
        const svg = container.children.find(c => c.tagName === 'svg')!
        const rect = svg.innerHTML.match(/<rect x="([-\d.]+)" y="([-\d.]+)"/)!
        // the overlay fills the container: the point at the canvas offset plus its canvas position (rect is 8 px, centred)
        const v = new tp.Vector3(-2, 0, 0).project(camera)
        const x = canvasRect.left - containerRect.left + (v.x + 1) / 2 * canvasRect.width
        const y = canvasRect.top - containerRect.top + (1 - v.y) / 2 * canvasRect.height
        expect(Math.abs(+rect[1] + 4 - x)).toBeLessThan(0.1)
        expect(Math.abs(+rect[2] + 4 - y)).toBeLessThan(0.1)
        pen.cancel()
    })

    test('surfaces under a hidden parent take no points', () => {
        const {pen, modelRoot, click} = setup()
        const group = new Object3D()
        group.visible = false
        group.add(new Mesh(new PlaneGeometry(4, 4).rotateX(-Math.PI / 2).translate(0, 1, 0), new MeshBasicMaterial()))
        modelRoot.add(group)
        modelRoot.updateMatrixWorld(true)
        pen.start()
        click(0, 0, 0) // over the hidden plane at y = 1: the ground
        expect(close(pen.points[0], [0, 0, 0])).toBe(true)
        group.visible = true
        click(0, 1, 0)
        expect(close(pen.points[1], [0, 1, 0])).toBe(true)
        pen.cancel()
    })

    test('the overlay draws the projected 3D curve, also between points at different depths', () => {
        const {pen, viewer, container, containerRect, canvas, camera, click, drag, ev, screen} = setup()
        const svg = container.children.find(c => c.tagName === 'svg')!
        pen.start()
        click(-3, 0, -3) // far, a corner
        drag([3, 0, 4], [5, 0, 4]) // near, its in handle at (1, 0, 4)
        win.fire('pointermove', ev(screen(-4, 0, 2))) // the preview to the pointer
        viewer.dispatchEvent({type: 'postFrame'})

        const cr = canvas.getBoundingClientRect()
        const toOverlay = (p: any) => {
            const v = p.clone().project(camera)
            return [cr.left - containerRect.left + (v.x + 1) / 2 * cr.width, cr.top - containerRect.top + (1 - v.y) / 2 * cr.height]
        }
        /** The polyline of an SVG path of M and L commands only */
        const polyline = (cls: string) => {
            const d = svg.innerHTML.match(new RegExp(`<path d="([^"]*)" class="${cls}"`))![1]
            expect(d).toMatch(/^M[-\d. L]+$/)
            return d.slice(1).split('L').map(pt => pt.trim().split(' ').map(Number))
        }
        const distance = (q: number[], line: number[][]) => Math.min(...line.slice(1).map((b, i) => {
            const a = line[i], dx = b[0] - a[0], dy = b[1] - a[1]
            const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
            return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])
        }))
        const V = (x: number, y: number, z: number) => new tp.Vector3(x, y, z)
        const segment = new tp.CubicBezierCurve3(V(-3, 0, -3), V(-3, 0, -3), V(1, 0, 4), V(3, 0, 4))
        const preview = new tp.CubicBezierCurve3(V(3, 0, 4), V(5, 0, 4), V(-4, 0, 2), V(-4, 0, 2))
        for (const [curve, cls] of [[segment, 'pen-path'], [preview, 'pen-preview']] as const) {
            const line = polyline(cls)
            for (let t = 0; t <= 1; t += 0.05) expect(distance(toOverlay(curve.getPoint(t)), line)).toBeLessThan(0.5)
        }
        pen.cancel()
    })
})
