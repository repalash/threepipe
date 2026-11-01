import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {BoxGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Quaternion, Vector3} from 'three'
import {PopmotionPlugin, UndoManagerPlugin} from 'threepipe'
import {AnnotationsPlugin} from '../../plugins/annotations/src/AnnotationsPlugin'
import {renderAnnotationText} from '../../plugins/annotations/src/render-text'

type Listener = (e: any) => void
const noop = () => undefined

// the node setup has no DOM: a small element with what the markers and the card use
class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    textContent = ''
    innerHTML = ''
    title = ''
    value = ''
    disabled = false
    style: Record<string, string> = {}
    dataset: Record<string, string> = {}
    offsetWidth = 260
    offsetHeight = 120
    clientWidth = 800
    clientHeight = 600
    scrollHeight = 40
    rect = {left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600}
    private _listeners = new Map<string, Listener[]>()
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        add: (c: string) => this.classList.toggle(c, true),
        remove: (c: string) => this.classList.toggle(c, false),
        toggle: (c: string, on: boolean) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    constructor(readonly tagName: string) {}
    getBoundingClientRect() {
        return this.rect
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    insertBefore(c: FakeElement, before: FakeElement) {
        c.remove()
        c.parent = this
        const i = this.children.indexOf(before)
        this.children.splice(i < 0 ? this.children.length : i, 0, c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    contains(e: FakeElement) {
        return e === this || this.all().includes(e)
    }
    /** tags, comma separated */
    closest(selector: string): FakeElement | null {
        const tags = selector.split(',').map(s => s.trim())
        if (tags.includes(this.tagName)) return this
        return this.parent?.closest(selector) ?? null
    }
    focus() {
        doc.activeElement = this
        this.fire('focus')
    }
    blur() {
        if (doc.activeElement !== this) return
        doc.activeElement = null
        // a browser fires change on the blur of a changed field; the plugin ignores a change with the same value
        if (this.tagName === 'input' || this.tagName === 'textarea') this.fire('change')
        this.fire('blur')
    }
    setPointerCapture = noop
    attributes: Record<string, string> = {}
    setAttribute(name: string, value: string) {
        this.attributes[name] = value
    }
    addEventListener(type: string, f: Listener) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: Listener) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f({target: this, currentTarget: this, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault: noop, stopPropagation: noop, ...e})
    }
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
    find(cls: string) {
        return this.all().filter(e => e.classList.contains(cls))
    }
}

const doc = globalThis.document as any
const saved = {createElement: doc.createElement, activeElement: doc.activeElement}
/** The listeners on the window (keys and clicks) */
let windowListeners: Map<string, (e: any) => void>
/** The ResizeObservers the plugins made: `resized(el)` calls the ones that watch `el` */
let observers: {targets: Set<any>, cb: (entries: any[]) => void}[]
const resized = (el: FakeElement) => observers.filter(o => o.targets.has(el)).forEach(o => o.cb([{target: el}]))
beforeAll(() => {
    AnnotationsPlugin.InjectStyles = false
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    Object.assign(doc, saved)
    AnnotationsPlugin.InjectStyles = true
})
beforeEach(() => {
    doc.activeElement = null
    windowListeners = new Map()
    vi.stubGlobal('addEventListener', (type: string, f: any) => windowListeners.set(type, f))
    vi.stubGlobal('removeEventListener', (type: string) => windowListeners.delete(type))
    // no frame loop: the tests call the screen update themselves
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', noop)
    observers = []
    vi.stubGlobal('ResizeObserver', class {
        targets = new Set<any>()
        constructor(readonly cb: (entries: any[]) => void) {
            observers.push(this)
        }
        observe(t: any) {
            this.targets.add(t)
        }
        unobserve(t: any) {
            this.targets.delete(t)
        }
        disconnect() {
            this.targets.clear()
        }
    })
})
afterEach(() => {
    vi.unstubAllGlobals()
})

/**
 * A box of size 1 at the origin in a fake viewer, the camera at z = 5 looking at it; the canvas is 800x600.
 * `popmotion`: the PopmotionPlugin of the viewer (none: camera moves end at once)
 */
function setup(editable = true, popmotion?: any) {
    const plugin = new AnnotationsPlugin({editable})
    const box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    box.name = 'Box'
    const group = new Object3D()
    group.name = 'Model'
    group.add(box)
    const modelRoot = new Object3D()
    modelRoot.add(group)
    const scene = Object.assign(new Object3D(), {modelRoot, mainCamera: null as any})
    scene.add(modelRoot)
    const camera = Object.assign(new PerspectiveCamera(50, 800 / 600, 0.1, 100), {
        target: new Vector3(),
        setDirty: noop,
        setInteractions: vi.fn(),
        getView: () => ({position: camera.position.clone(), target: camera.target.clone(), quaternion: camera.quaternion.clone(), zoom: camera.zoom}),
    })
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    scene.mainCamera = camera
    const undo: {undo: () => void, redo: () => void}[] = []
    const canvas = new FakeElement('canvas')
    const viewer = {
        container: new FakeElement('div'),
        canvas,
        scene,
        addEventListener: noop,
        removeEventListener: noop,
        getPlugin: (c: any) => c === UndoManagerPlugin ? {undoManager: {record: (cmd: any) => undo.push(cmd)}} : c === PopmotionPlugin ? popmotion : undefined,
        console,
    } as any
    plugin.onAdded(viewer)
    const layer = viewer.container.children[0] as FakeElement
    return {plugin, viewer, layer, box, group, camera, undo, canvas}
}

const markers = (layer: FakeElement) => layer.find('anp-marker')
const card = (layer: FakeElement) => layer.find('anp-card')[0]
const front = new Vector3(0, 0, 0.5)
const normal = new Vector3(0, 0, 1)

describe('AnnotationsPlugin', () => {
    test('adds a layer with the card to the viewer container; markers are numbered in tour order, with the title as tooltip', () => {
        const {plugin, layer, box, viewer} = setup()
        expect(viewer.container.children).toEqual([layer])
        expect(layer.classList.contains('anp-editable')).toBe(true)
        expect(card(layer).classList.contains('anp-open')).toBe(false)
        const a = plugin.add(box as any, front, normal, null, {title: 'Front'})
        plugin.add(box as any, new Vector3(0.5, 0, 0), new Vector3(1, 0, 0), null)
        expect(markers(layer).map(m => m.textContent)).toEqual(['1', '2'])
        expect(markers(layer).map(m => m.title)).toEqual(['Front', 'Annotation 2'])
        expect(a.anchor).toEqual({uuid: box.uuid, path: 'Model#0/Box#0', name: 'Box', point: [0, 0, 0.5], normal: [0, 0, 1]})
        // the card is the last child: markers go before it
        expect(layer.children.at(-1)).toBe(card(layer))
        plugin.move(a.id, 1)
        // the markers stay, their numbers change
        expect(markers(layer).map(m => [m.textContent, m.title])).toEqual([['2', 'Front'], ['1', 'Annotation 1']])
    })

    test('add, update, move, remove and clear are undoable; events tell the reason', () => {
        const {plugin, box, undo} = setup()
        const reasons: string[] = []
        plugin.addEventListener('annotationChange', e => reasons.push(e.reason))
        const a = plugin.add(box as any, front, normal, null, {title: 'A'})
        const b = plugin.add(box as any, front, normal, null, {title: 'B'})
        plugin.update(a.id, {title: 'A2', text: 'x'})
        plugin.move(b.id, 0)
        plugin.remove(a.id)
        plugin.clear()
        expect(reasons).toEqual(['add', 'add', 'update', 'reorder', 'remove', 'clear'])
        expect(undo).toHaveLength(6)
        const titles = () => plugin.getAnnotations().map(x => x.title)
        undo[5].undo()
        expect(titles()).toEqual(['B'])
        undo[4].undo()
        expect(titles()).toEqual(['B', 'A2'])
        undo[3].undo()
        expect(titles()).toEqual(['A2', 'B'])
        undo[2].undo()
        expect(plugin.get(a.id)).toMatchObject({title: 'A', text: ''})
        undo[2].redo()
        expect(plugin.get(a.id)).toMatchObject({title: 'A2', text: 'x'})
        undo[1].undo()
        undo[0].undo()
        expect(titles()).toEqual([])
    })

    test('the view defaults to the current camera view, with the fov of a perspective camera', () => {
        const {plugin, box, camera} = setup()
        const a = plugin.add(box as any, front, normal)
        expect(a.view).toEqual({position: [0, 0, 5], target: [0, 0, 0], quaternion: camera.quaternion.toArray(), zoom: 1, fov: 50})
    })

    test('the markers follow the object: projected to the canvas, hidden when the object is hidden or off screen', () => {
        const {plugin, layer, box, group} = setup()
        plugin.add(box as any, front, normal, null)
        const m = markers(layer)[0]
        const update = () => (plugin as any)._updateScreen()
        update()
        expect(m.style.display).toBe('')
        expect(m.style.transform).toBe('translate(400.0px, 300.0px)')
        group.position.x = 1
        group.updateMatrixWorld()
        update()
        const x = parseFloat(m.style.transform.slice('translate('.length))
        expect(x).toBeGreaterThan(450)
        expect(m.classList.contains('anp-dim')).toBe(false)
        // turned away from the camera: dimmed
        group.rotation.y = Math.PI
        group.updateMatrixWorld()
        update()
        expect(m.classList.contains('anp-dim')).toBe(true)
        group.visible = false
        update()
        expect(m.style.display).toBe('none')
        group.visible = true
        group.position.x = 50
        group.updateMatrixWorld()
        update()
        expect(m.style.display).toBe('none')
    })

    test('the occlusion test dims a marker behind another mesh', () => {
        const {plugin, layer, box, viewer} = setup()
        plugin.add(box as any, front, normal, null)
        const wall = new Mesh(new BoxGeometry(2, 2, 0.1), new MeshBasicMaterial())
        wall.position.z = 2
        viewer.scene.modelRoot.add(wall)
        viewer.scene.modelRoot.updateMatrixWorld(true)
        ;(plugin as any)._updateScreen()
        ;(plugin as any)._updateOcclusion()
        expect(markers(layer)[0].classList.contains('anp-dim')).toBe(true)
        wall.visible = false
        ;(plugin as any)._occlDirty = true
        ;(plugin as any)._updateScreen()
        ;(plugin as any)._updateOcclusion()
        expect(markers(layer)[0].classList.contains('anp-dim')).toBe(false)
    })

    test('a multi-material mesh: the material of the face that is hit decides, for placing and for the occlusion', () => {
        const {plugin, layer, box, viewer} = setup()
        // a box has a group per side: +x, -x, +y, -y, +z (the front, index 4), -z; the material of +x is hidden
        const sides = () => Array.from({length: 6}, (_, i) => new MeshBasicMaterial({visible: i !== 0}))
        box.material = sides()
        plugin.startAdding()
        const place = layer.find('anp-place')[0]
        place.fire('pointerdown', {clientX: 400, clientY: 300})
        place.fire('pointerup', {clientX: 400, clientY: 300})
        expect(plugin.getAnnotations()).toHaveLength(1)
        expect(plugin.get(0)!.anchor.normal).toEqual([0, 0, 1])
        // a wall in front with the same materials: its front face is visible and hides the marker
        const wall = new Mesh(new BoxGeometry(2, 2, 0.1), sides())
        wall.position.z = 2
        viewer.scene.modelRoot.add(wall)
        viewer.scene.modelRoot.updateMatrixWorld(true)
        const occlusion = () => {
            const p = plugin as any
            p._occlDirty = true
            p._updateScreen()
            p._updateOcclusion()
            return markers(layer)[0].classList.contains('anp-dim')
        }
        expect(occlusion()).toBe(true)
        // its front and back faces hidden: the marker shows
        ;(wall.material as MeshBasicMaterial[])[4].visible = false
        ;(wall.material as MeshBasicMaterial[])[5].visible = false
        expect(occlusion()).toBe(false)
    })

    test('the occlusion is tested again after rendered frames (an animation moves an occluder), at most every occlusionRecheckInterval ms', () => {
        const {plugin, layer, box, viewer} = setup()
        let now = 0
        vi.spyOn(performance, 'now').mockImplementation(() => now)
        try {
            plugin.add(box as any, front, normal, null)
            // behind the box: hides nothing
            const wall = new Mesh(new BoxGeometry(2, 2, 0.1), new MeshBasicMaterial())
            wall.position.z = -3
            viewer.scene.modelRoot.add(wall)
            viewer.scene.modelRoot.updateMatrixWorld(true)
            const tick = (t: number, rendered = false) => {
                now = t
                if (rendered) (plugin as any)._onViewerEvent({eType: 'postRender'})
                ;(plugin as any)._tick()
                return markers(layer)[0].classList.contains('anp-dim')
            }
            expect(tick(0)).toBe(false)
            // the wall moves in front, without a scene update
            wall.position.z = 2
            wall.updateMatrixWorld()
            expect(tick(100)).toBe(false) // no frame rendered
            expect(tick(150, true)).toBe(false) // a frame, but too soon after the last test
            expect(tick(250)).toBe(true)
            // no more frames: no more tests
            wall.position.z = -3
            wall.updateMatrixWorld()
            expect(tick(1000)).toBe(true)
            expect(tick(1300, true)).toBe(false)
        } finally {
            vi.restoreAllMocks()
        }
    })

    describe('an InstancedMesh', () => {
        /** Two boxes of size 1: instance 0 far away, instance 1 at x = 1 */
        const instanced = (viewer: any) => {
            const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2)
            mesh.setMatrixAt(0, new Matrix4().makeTranslation(-50, 0, 0))
            mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 0, 0))
            viewer.scene.modelRoot.add(mesh)
            viewer.scene.modelRoot.updateMatrixWorld(true)
            return mesh
        }
        /** The place of a world point on the 800x600 canvas */
        const screen = (camera: PerspectiveCamera, p: Vector3) => {
            const n = p.clone().project(camera)
            return {x: (n.x + 1) / 2 * 800, y: (1 - n.y) / 2 * 600}
        }
        const at = (m: FakeElement) => m.style.transform.match(/[-\d.]+/g)!.map(Number)

        test('a placed annotation keeps the instance, in its space; the marker follows when the instance moves', () => {
            const {plugin, layer, box, viewer, camera} = setup()
            box.visible = false
            const mesh = instanced(viewer)
            plugin.startAdding()
            const place = layer.find('anp-place')[0]
            const p = screen(camera, new Vector3(1, 0, 0.5))
            place.fire('pointerdown', {clientX: p.x, clientY: p.y})
            place.fire('pointerup', {clientX: p.x, clientY: p.y})
            const a = plugin.get(0)!
            expect(a.anchor.instanceId).toBe(1)
            expect(a.anchor.point.map(v => +v.toFixed(5) + 0)).toEqual([0, 0, 0.5])
            expect(a.anchor.normal.map(v => v + 0)).toEqual([0, 0, 1]) // + 0: -0 is 0
            // the instance moves up
            mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 1, 0))
            ;(plugin as any)._updateScreen()
            const q = screen(camera, new Vector3(1, 1, 0.5))
            expect(at(markers(layer)[0])).toEqual([+q.x.toFixed(1), +q.y.toFixed(1)])
        })

        test('the normal of a rotated instance: its front faces away when the instance is turned around', () => {
            const {plugin, layer, box, viewer} = setup()
            box.visible = false
            const mesh = instanced(viewer)
            mesh.setMatrixAt(0, new Matrix4())
            plugin.add(mesh as any, front, normal, null, {instanceId: 0})
            const dim = () => {
                (plugin as any)._updateScreen()
                return markers(layer)[0].classList.contains('anp-dim')
            }
            expect(dim()).toBe(false)
            mesh.setMatrixAt(0, new Matrix4().makeRotationY(Math.PI))
            expect(dim()).toBe(true)
        })

        test('an anchor without instanceId (an older file) uses the mesh transform, as before', () => {
            const {plugin, layer, box, viewer} = setup()
            box.visible = false
            const mesh = instanced(viewer)
            const a = plugin.add(mesh as any, front, normal, null)
            expect('instanceId' in a.anchor).toBe(false)
            ;(plugin as any)._updateScreen()
            expect(at(markers(layer)[0])).toEqual([400, 300])
            // saved and loaded: an anchor with an instance keeps it
            plugin.add(mesh as any, front, normal, null, {instanceId: 1})
            const other = new AnnotationsPlugin()
            other.fromJSON(JSON.parse(JSON.stringify(plugin.toJSON())))
            expect(other.getAnnotations().map(x => x.anchor.instanceId)).toEqual([undefined, 1])
        })
    })

    test('a click on a marker opens the card and flies the camera to the view; prev/next wrap; a click on the canvas closes', () => {
        const {plugin, layer, box, camera, canvas} = setup(false)
        const view = {position: [3, 0, 0], target: [0, 0, 0], quaternion: [0, 0, 0, 1], zoom: 1, fov: 40}
        plugin.add(box as any, front, normal, view, {title: 'One', text: '**bold**'})
        plugin.add(box as any, front, normal, null, {title: 'Two'})
        const selected: (string | undefined)[] = []
        plugin.addEventListener('annotationSelect', e => selected.push(e.annotation?.title))
        ;(plugin as any)._updateScreen()
        const m = markers(layer)[0]
        m.fire('pointerdown')
        m.fire('pointerup')
        const c = card(layer)
        expect(c.classList.contains('anp-open')).toBe(true)
        expect(c.classList.contains('anp-edit')).toBe(false)
        expect(c.find('anp-title')[0].textContent).toBe('One')
        expect(c.find('anp-text')[0].innerHTML).toBe('<b>bold</b>')
        expect(c.find('anp-pos')[0].textContent).toBe('1 / 2')
        expect(m.classList.contains('anp-on')).toBe(true)
        // no PopmotionPlugin: the camera is at the view at once
        expect(camera.position.toArray().map(v => +v.toFixed(5))).toEqual([3, 0, 0])
        expect(camera.fov).toBe(40)
        expect(doc.activeElement).toBe(c)
        // the card is next to the marker
        expect(c.style.transform).toBe('translate(422px, 279px)')

        c.find('anp-next')[0].fire('click')
        expect(plugin.openId).toBe(plugin.get(1)!.id)
        c.find('anp-next')[0].fire('click')
        expect(plugin.openId).toBe(plugin.get(0)!.id)
        c.find('anp-prev')[0].fire('click')
        expect(plugin.openId).toBe(plugin.get(1)!.id)

        // a drag on the canvas (orbit) keeps the card, a click closes it
        windowListeners.get('pointerdown')!({target: canvas, clientX: 10, clientY: 10})
        windowListeners.get('pointerup')!({target: canvas, clientX: 40, clientY: 10})
        expect(plugin.openId).not.toBe(null)
        windowListeners.get('pointerdown')!({target: canvas, clientX: 10, clientY: 10})
        windowListeners.get('pointerup')!({target: canvas, clientX: 11, clientY: 10})
        expect(plugin.openId).toBe(null)
        expect(c.classList.contains('anp-open')).toBe(false)
        expect(selected).toEqual(['One', 'Two', 'One', 'Two', undefined])
    })

    describe('the roll of a saved view', () => {
        // a view from x = 3 at the origin, turned 0.5 rad around the view axis
        const eye = new Vector3(3, 0, 0)
        const level = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, new Vector3(), new Vector3(0, 1, 0)))
        const rolled = level.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5))
        const view = {position: eye.toArray(), target: [0, 0, 0], quaternion: rolled.toArray(), zoom: 1}

        test('a camera without controls keeps the roll of the view, also when it is at the view already', () => {
            const {plugin, box, camera} = setup()
            plugin.add(box as any, front, normal, view)
            plugin.goTo(0)
            expect(camera.quaternion.angleTo(rolled)).toBeLessThan(1e-6)
            camera.quaternion.copy(level)
            plugin.close()
            plugin.goTo(0)
            expect(camera.quaternion.angleTo(rolled)).toBeLessThan(1e-6)
        })

        test('a camera with orbit controls looks at the target, as before (the controls own its rotation)', () => {
            const {plugin, box, camera} = setup()
            ;(camera as any).controls = {enabled: true}
            plugin.add(box as any, front, normal, view)
            plugin.goTo(0)
            expect(camera.quaternion.angleTo(level)).toBeLessThan(1e-6)
        })
    })

    test('opening an annotation without a camera move stops the flight of the one before', () => {
        // a flight that runs until it is stopped
        const flights: {stop: ReturnType<typeof vi.fn>}[] = []
        const popmotion = {animate: (o: any) => {
            const f = {stop: vi.fn(() => o.onStop?.())}
            flights.push(f)
            return f
        }}
        const {plugin, box, camera} = setup(false, popmotion)
        plugin.add(box as any, front, normal, {position: [3, 0, 0], target: [0, 0, 0], quaternion: [0, 0, 0, 1], zoom: 1})
        const b = plugin.add(box as any, front, normal, null)
        const c = plugin.add(box as any, front, normal, {position: [0, 3, 0.1], target: [0, 0, 0], quaternion: [0, 0, 0, 1], zoom: 1})
        plugin.goTo(0)
        expect(flights).toHaveLength(1)
        expect(camera.setInteractions).toHaveBeenLastCalledWith(false, 'AnnotationsPlugin')
        // no view: the camera stays, the flight ends and the camera is free
        plugin.goTo(b.id)
        expect(flights[0].stop).toHaveBeenCalled()
        expect(camera.setInteractions).toHaveBeenLastCalledWith(true, 'AnnotationsPlugin')
        // fly: false, the same
        plugin.goTo(0)
        plugin.goTo(c.id, {fly: false})
        expect(flights).toHaveLength(2)
        expect(flights[1].stop).toHaveBeenCalled()
        expect(camera.setInteractions).toHaveBeenLastCalledWith(true, 'AnnotationsPlugin')
    })

    test('editable: a click on another marker while a field is focused ends the edit first; typing then edits the new one', () => {
        const {plugin, layer, box, undo} = setup()
        const a = plugin.add(box as any, front, normal, null, {title: 'A'})
        const b = plugin.add(box as any, front, normal, null, {title: 'B'})
        plugin.goTo(a.id, {focusTitle: true})
        const input = card(layer).find('anp-title-in')[0]
        undo.length = 0
        input.value = 'A2'
        input.fire('input')
        // the marker keeps the focus where it is (preventDefault on pointerdown)
        const m = markers(layer)[1]
        m.fire('pointerdown')
        m.fire('pointerup')
        expect(plugin.openId).toBe(b.id)
        expect(doc.activeElement).not.toBe(input)
        expect(input.value).toBe('B')
        expect(plugin.get(a.id)!.title).toBe('A2')
        expect(undo).toHaveLength(1) // the edit of A, one step
        undo[0].undo()
        expect(plugin.get(a.id)!.title).toBe('A')
        undo[0].redo()
        input.focus()
        input.value = 'B2'
        input.fire('input')
        expect(plugin.get(b.id)!.title).toBe('B2')
        expect(plugin.get(a.id)!.title).toBe('A2')
    })

    test('keys: ← → go through the annotations while a card is open, Esc closes; typing in a field is left alone', () => {
        const {plugin, box} = setup()
        plugin.add(box as any, front, normal, null)
        plugin.add(box as any, front, normal, null)
        const key = (k: string, target: any = doc.body) => {
            const e = {key: k, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn()}
            windowListeners.get('keydown')!(e)
            return e
        }
        expect(key('ArrowRight').preventDefault).not.toHaveBeenCalled() // no card open
        plugin.goTo(0, {fly: false})
        key('ArrowRight')
        expect(plugin.openId).toBe(plugin.get(1)!.id)
        key('ArrowLeft', new FakeElement('input'))
        expect(plugin.openId).toBe(plugin.get(1)!.id)
        key('ArrowLeft')
        expect(plugin.openId).toBe(plugin.get(0)!.id)
        expect(key('Escape').stopImmediatePropagation).toHaveBeenCalled()
        expect(plugin.openId).toBe(null)
    })

    test('editable: the title field edits live and records one undo step per edit; Delete and Update view', () => {
        const {plugin, layer, box, undo, camera} = setup()
        const a = plugin.add(box as any, front, normal, null, {title: 'Old'})
        plugin.goTo(a.id, {focusTitle: true})
        const c = card(layer)
        expect(c.classList.contains('anp-edit')).toBe(true)
        const input = c.find('anp-title-in')[0]
        expect(doc.activeElement).toBe(input)
        expect(input.value).toBe('Old')
        // no view yet: Update view stands out
        expect(c.find('anp-view')[0].classList.contains('anp-noview')).toBe(true)
        undo.length = 0
        input.value = 'New'
        input.fire('input')
        expect(plugin.get(a.id)!.title).toBe('New')
        expect(markers(layer)[0].title).toBe('New')
        input.fire('change')
        expect(undo).toHaveLength(1)
        undo[0].undo()
        expect(plugin.get(a.id)!.title).toBe('Old')
        undo[0].redo()

        // the text: raw while typing, formatted after the edit
        expect(c.classList.contains('anp-text-empty')).toBe(true)
        const textIn = c.find('anp-text-in')[0]
        textIn.focus()
        textIn.value = '**b**'
        textIn.fire('input')
        textIn.fire('change')
        textIn.blur()
        expect(c.classList.contains('anp-text-empty')).toBe(false)
        expect(c.find('anp-text')[0].innerHTML).toBe('<b>b</b>')
        expect(plugin.get(a.id)!.text).toBe('**b**')

        c.find('anp-view')[0].fire('click')
        expect(plugin.get(a.id)!.view!.position).toEqual(camera.position.toArray())
        expect(c.find('anp-view')[0].classList.contains('anp-noview')).toBe(false)
        c.find('anp-del')[0].fire('click')
        expect(plugin.getAnnotations()).toHaveLength(0)
        expect(markers(layer)).toHaveLength(0)
        expect(plugin.openId).toBe(null)
    })

    test('editable: the card stays inside the viewer when the text field grows, near the bottom edge', () => {
        const {plugin, layer, box, group} = setup()
        // the marker near the bottom of the 600px canvas
        group.position.y = -1.8
        group.updateMatrixWorld()
        const a = plugin.add(box as any, front, normal, null, {text: 'Some text'})
        const update = () => (plugin as any)._updateScreen()
        update()
        plugin.goTo(a.id, {fly: false})
        const c = card(layer)
        const bottom = () => Number(c.style.transform.match(/[-\d.]+/g)![1]) + c.offsetHeight
        expect(bottom()).toBeLessThanOrEqual(592)
        // typing makes the field and the card taller
        const textIn = c.find('anp-text-in')[0]
        textIn.focus()
        c.offsetHeight = 300
        textIn.value = 'Some text\nand more lines'
        textIn.fire('input')
        resized(c)
        update()
        expect(bottom()).toBeLessThanOrEqual(592)
    })

    test('the card stays inside the viewer when it changes size for any reason: a narrower viewer wraps the text (read-only)', () => {
        const {plugin, layer, box, group, viewer} = setup(false)
        group.position.y = -1.8
        group.updateMatrixWorld()
        const a = plugin.add(box as any, front, normal, null, {text: 'A text that wraps in a narrow card'})
        const update = () => (plugin as any)._updateScreen()
        update()
        plugin.goTo(a.id, {fly: false})
        const c = card(layer)
        const bottom = () => Number(c.style.transform.match(/[-\d.]+/g)![1]) + c.offsetHeight
        expect(bottom()).toBeLessThanOrEqual(592)
        // the viewer gets narrower: the text wraps and the card gets taller
        layer.clientWidth = 300
        c.offsetHeight = 300
        resized(c)
        update()
        expect(bottom()).toBeLessThanOrEqual(592)
        // watched only while open, and not after the plugin is removed
        plugin.close()
        expect(observers.some(o => o.targets.has(c))).toBe(false)
        plugin.goTo(a.id, {fly: false})
        plugin.onRemove(viewer)
        expect(observers.some(o => o.targets.size)).toBe(false)
    })

    test('editable: startAdding, then a click on a surface places an annotation there and opens it; Esc cancels', () => {
        const {plugin, layer} = setup()
        const adding: boolean[] = []
        plugin.addEventListener('addingChange', e => adding.push(e.adding))
        expect(plugin.startAdding()).toBe(true)
        expect(plugin.adding).toBe(true)
        const place = layer.find('anp-place')[0]
        // a miss (the corner of the canvas): no annotation, the hint shakes
        place.fire('pointerdown', {clientX: 2, clientY: 2})
        place.fire('pointerup', {clientX: 2, clientY: 2})
        expect(plugin.getAnnotations()).toHaveLength(0)
        expect(place.classList.contains('anp-miss')).toBe(true)
        // the middle of the canvas is the front face of the box
        place.fire('pointerdown', {clientX: 400, clientY: 300})
        place.fire('pointerup', {clientX: 400, clientY: 300})
        expect(plugin.adding).toBe(false)
        expect(layer.find('anp-place')).toHaveLength(0)
        const a = plugin.get(0)!
        expect(a.anchor.point.map(v => +v.toFixed(5))).toEqual([0, 0, 0.5])
        expect(a.anchor.normal).toEqual([0, 0, 1])
        expect(a.view).not.toBe(null)
        expect(plugin.openId).toBe(a.id)

        plugin.startAdding()
        windowListeners.get('keydown')!({key: 'Escape', target: doc.body, preventDefault: noop, stopImmediatePropagation: noop})
        expect(plugin.adding).toBe(false)
        expect(adding).toEqual([true, false, true, false])
    })

    test('not editable: no placing, no dragging, no edit tools; turning editable off cancels placing', () => {
        const {plugin, layer, box} = setup(false)
        expect(plugin.startAdding()).toBe(false)
        plugin.add(box as any, front, normal, null)
        ;(plugin as any)._updateScreen()
        const m = markers(layer)[0]
        m.fire('pointerdown', {clientX: 400, clientY: 300})
        m.fire('pointermove', {clientX: 300, clientY: 300})
        m.fire('pointerup', {clientX: 300, clientY: 300})
        expect(plugin.get(0)!.anchor.point).toEqual([0, 0, 0.5]) // not moved, it opened instead
        expect(plugin.openId).toBe(plugin.get(0)!.id)
        plugin.editable = true
        expect(card(layer).classList.contains('anp-edit')).toBe(true)
        plugin.startAdding()
        plugin.editable = false
        expect(plugin.adding).toBe(false)
        expect(layer.classList.contains('anp-editable')).toBe(false)
    })

    test('editable: dragging a marker moves it to the surface under the pointer, as one undo step', () => {
        const {plugin, layer, box, undo} = setup()
        const a = plugin.add(box as any, front, normal, null)
        ;(plugin as any)._updateScreen()
        undo.length = 0
        const m = markers(layer)[0]
        m.fire('pointerdown', {clientX: 400, clientY: 300})
        m.fire('pointermove', {clientX: 420, clientY: 300})
        m.fire('pointermove', {clientX: 440, clientY: 300})
        m.fire('pointerup', {clientX: 440, clientY: 300})
        expect(plugin.openId).toBe(null) // a drag does not open it
        const x = plugin.get(a.id)!.anchor.point[0]
        expect(x).toBeGreaterThan(0.05)
        expect(undo).toHaveLength(1)
        undo[0].undo()
        expect(plugin.get(a.id)!.anchor.point).toEqual([0, 0, 0.5])
    })

    test('serialization: toJSON has the annotations; fromJSON replaces them, drops broken ones and fills defaults', () => {
        const {plugin, box} = setup()
        plugin.add(box as any, front, normal, {position: [1, 2, 3], target: [0, 0, 0], quaternion: new Quaternion().toArray(), zoom: 1}, {title: 'Saved', text: 'Text'})
        const json = JSON.parse(JSON.stringify(plugin.toJSON()))
        expect(json.type).toBe('AnnotationsPlugin')
        expect(json.annotations).toHaveLength(1)

        const other = new AnnotationsPlugin()
        const loads: string[] = []
        other.addEventListener('annotationChange', e => loads.push(e.reason))
        other.fromJSON(json)
        expect(other.getAnnotations()).toEqual(plugin.getAnnotations())
        expect(loads).toEqual(['load'])

        // a load replaces the list (no extra items kept); broken items are dropped, missing fields get defaults
        const broken = {...json, annotations: [
            {id: 'x', anchor: {uuid: 'u', path: '', name: '', point: [0, 0, 0]}},
            {id: 'y'},
            null,
        ]}
        other.fromJSON(broken)
        expect(other.getAnnotations()).toEqual([{id: 'x', title: '', text: '', view: null, anchor: {uuid: 'u', path: '', name: '', point: [0, 0, 0], normal: [0, 1, 0]}}])
        expect(other.fromJSON({...json, type: 'OtherPlugin'})).toBe(null)
        expect(other.getAnnotations()).toHaveLength(1)
    })

    test('finds the object by uuid, or after a load by its path of names (a model with new uuids)', () => {
        const {plugin, box, group, viewer} = setup()
        const a = plugin.add(box as any, front, normal, null)
        expect(plugin.getObject(a)).toBe(box)
        // the model is loaded again: same names, new uuids; then the annotations are loaded (a viewer config)
        group.removeFromParent()
        const box2 = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
        box2.name = 'Box'
        const group2 = new Object3D()
        group2.name = 'Model'
        group2.add(box2)
        viewer.scene.modelRoot.add(group2)
        ;(plugin as any)._onHierarchy()
        plugin.fromJSON(JSON.parse(JSON.stringify(plugin.toJSON())))
        const loaded = plugin.get(0)!
        expect(plugin.getObject(loaded)).toBe(box2)
        group2.removeFromParent()
        ;(plugin as any)._onHierarchy()
        expect(plugin.getObject(loaded)).toBe(null)
    })

    test('an annotation stays on its object: removed, it hides and does not move to a sibling with the same name; added back, it shows again', () => {
        const {plugin, layer, box, group, viewer} = setup()
        // two unnamed boxes: the path of both is "#0" among the unnamed ones, so the path cannot tell them apart
        box.name = ''
        const sibling = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
        sibling.position.x = 1.5
        group.add(sibling)
        viewer.scene.modelRoot.updateMatrixWorld(true)
        const a = plugin.add(box as any, front, normal, null)
        expect(a.anchor.path).toBe('Model#0/#0')
        const m = markers(layer)[0]
        const update = () => (plugin as any)._updateScreen()
        update()
        expect(m.style.transform).toBe('translate(400.0px, 300.0px)')
        box.removeFromParent()
        ;(plugin as any)._onHierarchy()
        expect(plugin.getObject(a)).toBe(null)
        update()
        expect(m.style.display).toBe('none')
        // back in the scene: on the same box again
        group.add(box)
        ;(plugin as any)._onHierarchy()
        expect(plugin.getObject(a)).toBe(box)
        update()
        expect(m.style.display).toBe('')
        expect(m.style.transform).toBe('translate(400.0px, 300.0px)')
    })

    test('the tour opens the next annotation on a timer; onRemove takes the layer and the listeners away', () => {
        vi.useFakeTimers()
        try {
            const {plugin, box, viewer} = setup()
            plugin.add(box as any, front, normal, null)
            plugin.add(box as any, front, normal, null)
            plugin.playTour(1000)
            expect(plugin.touring).toBe(true)
            expect(plugin.openId).toBe(plugin.get(0)!.id)
            vi.advanceTimersByTime(1000)
            expect(plugin.openId).toBe(plugin.get(1)!.id)
            plugin.onRemove(viewer)
            expect(plugin.touring).toBe(false)
            expect(viewer.container.children).toEqual([])
            expect([...windowListeners.keys()]).toEqual([])
            // the data stays
            expect(plugin.getAnnotations()).toHaveLength(2)
        } finally {
            vi.useRealTimers()
        }
    })

    test('the plugin depends on PopmotionPlugin for the camera animation', () => {
        expect(new AnnotationsPlugin().dependencies).toEqual([PopmotionPlugin])
    })
})

describe('renderAnnotationText', () => {
    test('escapes HTML and formats bold, italic, links, bullets and line breaks', () => {
        expect(renderAnnotationText('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
        expect(renderAnnotationText('**b** and *i*')).toBe('<b>b</b> and <i>i</i>')
        expect(renderAnnotationText('see [docs](https://threepipe.org/a?b=1&c=2).'))
            .toBe('see <a href="https://threepipe.org/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a>.')
        expect(renderAnnotationText('at https://threepipe.org, ok'))
            .toBe('at <a href="https://threepipe.org" target="_blank" rel="noopener noreferrer">https://threepipe.org</a>, ok')
        expect(renderAnnotationText('a\n- one\n- two')).toBe('a<br><span class="anp-li">one</span><br><span class="anp-li">two</span>')
        expect(renderAnnotationText('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))')
    })
})
