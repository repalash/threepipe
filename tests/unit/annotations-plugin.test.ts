import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {BoxGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Quaternion, Vector3} from 'three'
import {PopmotionPlugin, UndoManagerPlugin} from 'threepipe'
import {AnnotationsPlugin} from '../../plugins/annotations/src/AnnotationsPlugin'
import {escapeHtml, renderAnnotationText} from '../../plugins/annotations/src/render-text'

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
    replaceChildren(...nodes: FakeElement[]) {
        for (const c of [...this.children]) c.remove()
        this.innerHTML = ''
        for (const c of nodes) this.appendChild(c)
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
    // every plugin adds its own listeners: windowListeners.get(type) calls them in order, until one calls stopImmediatePropagation
    const lists = new Map<string, ((e: any) => void)[]>()
    const dispatch = (type: string) => (e: any) => {
        let stopped = false
        const ev = {...e, stopImmediatePropagation: () => {
            stopped = true
            e.stopImmediatePropagation?.()
        }}
        for (const f of [...lists.get(type) ?? []]) {
            if (stopped) break
            f(ev)
        }
    }
    vi.stubGlobal('addEventListener', (type: string, f: any) => {
        lists.set(type, [...lists.get(type) ?? [], f])
        windowListeners.set(type, dispatch(type))
    })
    vi.stubGlobal('removeEventListener', (type: string, f: any) => {
        const rest = (lists.get(type) ?? []).filter(x => x !== f)
        lists.set(type, rest)
        if (!rest.length) windowListeners.delete(type)
    })
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

    test('the card has no number (the markers keep theirs)', () => {
        const {plugin, layer, box} = setup(false)
        plugin.add(box as any, front, normal, null, {title: 'One'})
        plugin.goTo(0)
        expect(card(layer).find('anp-num')).toHaveLength(0)
        expect(card(layer).find('anp-title')[0].textContent).toBe('One')
        expect(markers(layer)[0].textContent).toBe('1')
    })

    test('showCloseButton: off hides the ✕; Esc and a click on the canvas still close the card', () => {
        const {plugin, layer, box, canvas} = setup(false)
        plugin.add(box as any, front, normal, null)
        plugin.goTo(0)
        const x = card(layer).find('anp-x')[0]
        expect(plugin.showCloseButton).toBe(true)
        expect(x.style.display).toBe('')
        plugin.showCloseButton = false
        expect(x.style.display).toBe('none')
        windowListeners.get('keydown')!({key: 'Escape', target: card(layer), preventDefault: noop, stopImmediatePropagation: noop})
        expect(plugin.openId).toBe(null)
        plugin.goTo(0)
        expect(x.style.display).toBe('none')
        windowListeners.get('pointerdown')!({target: canvas, clientX: 10, clientY: 10})
        windowListeners.get('pointerup')!({target: canvas, clientX: 10, clientY: 10})
        expect(plugin.openId).toBe(null)
        plugin.showCloseButton = true
        expect(x.style.display).toBe('')
        expect((plugin.uiConfig.children as any[]).find(c => c.property?.[1] === 'showCloseButton')?.type).toBe('checkbox')
    })

    describe('renderCardContent: the app renders the card content', () => {
        const custom = (layer: FakeElement) => card(layer).find('anp-custom')[0]
        /** Two annotations; the first has data.price */
        const twoWithData = (editable = false) => {
            const s = setup(editable)
            s.plugin.add(s.box as any, front, normal, null, {title: 'Ring', text: 'Gold', data: {price: 1200}})
            s.plugin.add(s.box as any, front, normal, null, {title: 'Plain'})
            return s
        }

        test('a string is the HTML of the content (in place of the title and the text); the ✕ and the tour bar stay; undefined: the default card', () => {
            const {plugin, layer, canvas} = twoWithData()
            plugin.compactCard = true
            plugin.renderCardContent = (a, ctx) => a.data ? `<b>${a.data.price}</b> ${ctx.index + 1}/${ctx.count}` : undefined
            plugin.goTo(0)
            const c = card(layer)
            expect(custom(layer).innerHTML).toBe('<b>1200</b> 1/2')
            expect(custom(layer).style.display).toBe('')
            expect(c.classList.contains('anp-has-custom')).toBe(true)
            expect(c.find('anp-title')[0].style.display).toBe('none')
            expect(c.find('anp-text')[0].style.display).toBe('none')
            expect(c.find('anp-x')[0].style.display).toBe('')
            expect(layer.find('anp-bar')[0].find('anp-bar-title')[0].textContent).toBe('Ring')
            // a click in the content keeps the card open (it is not the canvas)
            windowListeners.get('pointerdown')!({target: custom(layer), clientX: 10, clientY: 10})
            windowListeners.get('pointerup')!({target: custom(layer), clientX: 10, clientY: 10})
            expect(plugin.openId).toBe(plugin.get(0)!.id)
            // the hook returns undefined for the second: the default card
            plugin.next()
            expect(custom(layer).style.display).toBe('none')
            expect(custom(layer).innerHTML).toBe('')
            expect(c.classList.contains('anp-has-custom')).toBe(false)
            expect(c.find('anp-title')[0].style.display).toBe('')
            expect(c.find('anp-title')[0].textContent).toBe('Plain')
            expect(canvas).toBeTruthy()
        })

        test('an element is put in the content; the hook runs again when another annotation opens, on a change, and when it is set', () => {
            const {plugin, layer} = twoWithData()
            plugin.goTo(0)
            expect(custom(layer).style.display).toBe('none')
            const calls: string[] = []
            plugin.renderCardContent = a => {
                calls.push(a.title)
                const e = document.createElement('div')
                e.textContent = a.title
                return e
            }
            // set while a card is open: it renders at once
            expect(calls).toEqual(['Ring'])
            expect(custom(layer).children.map(e => e.textContent)).toEqual(['Ring'])
            plugin.next()
            expect(custom(layer).children.map(e => e.textContent)).toEqual(['Plain'])
            plugin.update(plugin.get(1)!.id, {title: 'Plain 2'})
            expect(custom(layer).children.map(e => e.textContent)).toEqual(['Plain 2'])
            expect(calls.slice(-2)).toEqual(['Plain', 'Plain 2'])
            plugin.renderCardContent = undefined
            expect(custom(layer).children).toHaveLength(0)
            expect(card(layer).find('anp-title')[0].textContent).toBe('Plain 2')
        })

        test('editable: the default editor card shows, the hook is not called; not editable again: the hook renders', () => {
            const {plugin, layer} = twoWithData(true)
            const hook = vi.fn(() => '<i>custom</i>')
            plugin.renderCardContent = hook
            plugin.goTo(0)
            expect(hook).not.toHaveBeenCalled()
            expect(card(layer).classList.contains('anp-edit')).toBe(true)
            expect(custom(layer).style.display).toBe('none')
            plugin.editable = false
            expect(custom(layer).innerHTML).toBe('<i>custom</i>')
        })

        test('a hook that throws: the default card, and the error in the console', () => {
            const {plugin, layer} = twoWithData()
            const err = vi.spyOn(console, 'error').mockImplementation(noop)
            try {
                plugin.renderCardContent = () => {
                    throw new Error('app bug')
                }
                plugin.goTo(0)
                expect(custom(layer).style.display).toBe('none')
                expect(card(layer).find('anp-title')[0].textContent).toBe('Ring')
                expect(err).toHaveBeenCalled()
            } finally {
                err.mockRestore()
            }
        })

        test('data: saved and loaded as plain JSON (also keys the serializer reads as its own), undoable with update(); the default card does not show it', () => {
            const {plugin, layer, box, undo} = setup(false)
            const data = {price: 1200, type: 'ring', html: '<img src=x onerror=alert(1)>', nested: {uuid: 'u', resource: 'textures', list: [1, {isColor: true, r: 1}]}}
            const a = plugin.add(box as any, front, normal, null, {title: '<img src=x onerror=alert(1)>', text: '<script>x</script>', data})
            plugin.add(box as any, front, normal, null)
            const json = JSON.parse(JSON.stringify(plugin.toJSON()))
            expect(json.annotations[0].data).toEqual(data)
            expect('data' in json.annotations[1]).toBe(false)
            const other = new AnnotationsPlugin()
            other.fromJSON(json)
            expect(other.get(0)!.data).toEqual(data)
            expect(other.get(0)!.data).not.toBe(json.annotations[0].data) // a copy
            expect('data' in other.get(1)!).toBe(false)
            // not an object: dropped
            other.fromJSON({...json, annotations: [{...json.annotations[0], data: 'x'}]})
            expect('data' in other.get(0)!).toBe(false)
            // update: one undo step
            undo.length = 0
            plugin.update(a.id, {data: {price: 900}})
            expect(plugin.get(a.id)!.data).toEqual({price: 900})
            undo[0].undo()
            expect(plugin.get(a.id)!.data).toEqual(data)
            // the default card escapes the text and does not render the data
            plugin.goTo(a.id)
            const text = card(layer).find('anp-text')[0].innerHTML
            expect(text).toBe('&lt;script&gt;x&lt;/script&gt;')
            expect(card(layer).all().some(e => e.innerHTML.includes('onerror'))).toBe(false)
        })
    })

    describe('compactCard and the tour bar', () => {
        const bar = (layer: FakeElement) => layer.find('anp-bar')[0]
        /** Two annotations, One and Two; compact on */
        const compact = (editable = false) => {
            const s = setup(editable)
            s.plugin.add(s.box as any, front, normal, null, {title: 'One'})
            s.plugin.add(s.box as any, front, normal, null, {title: 'Two'})
            ;(s.plugin as any)._updateScreen()
            s.plugin.compactCard = true
            return s
        }
        const down = (target: any, x = 10) => windowListeners.get('pointerdown')!({target, clientX: x, clientY: 10, button: 0})
        const move = (target: any, x: number) => windowListeners.get('pointermove')!({target, clientX: x, clientY: 10, button: -1})
        const up = (target: any, x: number) => windowListeners.get('pointerup')!({target, clientX: x, clientY: 10, button: 0})

        test('off (the default): the bar is hidden and the card keeps ‹ 1 / 2 › and its tools in the bottom bar', () => {
            const {plugin, layer, box} = setup()
            plugin.add(box as any, front, normal, null)
            plugin.goTo(0)
            const c = card(layer)
            expect(plugin.compactCard).toBe(false)
            expect(plugin.tourBar).toBe('hidden')
            expect(bar(layer).dataset.state).toBe('hidden')
            expect(c.find('anp-nav')[0].style.display).toBe('')
            expect(c.find('anp-tools')[0].parent).toBe(c.find('anp-nav')[0])
            // the card is the last child of the layer, markers and the bar go before it
            expect(layer.children.at(-1)).toBe(c)
        })

        test('on: ‹ title › leave the card for the bar; Update view and Delete go to the top, before the ✕; off again puts them back', () => {
            const {plugin, layer} = compact(true)
            plugin.goTo(0)
            const c = card(layer)
            const head = c.find('anp-head')[0]
            const tools = c.find('anp-tools')[0]
            expect(c.find('anp-nav')[0].style.display).toBe('none')
            expect(tools.parent).toBe(head)
            expect(head.children.indexOf(tools)).toBe(head.children.indexOf(c.find('anp-x')[0]) - 1)
            expect(c.classList.contains('anp-compact')).toBe(true)
            expect(plugin.tourBar).toBe('shown')
            expect(bar(layer).dataset.state).toBe('shown')
            expect(bar(layer).find('anp-bar-title')[0].textContent).toBe('One')
            // the title edited in the card: the bar follows
            const input = c.find('anp-title-in')[0]
            input.focus()
            input.value = 'One!'
            input.fire('input')
            expect(bar(layer).find('anp-bar-title')[0].textContent).toBe('One!')
            plugin.compactCard = false
            expect(c.find('anp-nav')[0].style.display).toBe('')
            expect(tools.parent).toBe(c.find('anp-nav')[0])
            expect(c.classList.contains('anp-compact')).toBe(false)
            expect(plugin.tourBar).toBe('hidden')
            expect((plugin.uiConfig.children as any[]).find(i => i.property?.[1] === 'compactCard')?.type).toBe('checkbox')
        })

        test('the bar: ‹ › go to the previous and next annotation and stop the tour; a click on it keeps the card', () => {
            const {plugin, layer} = compact()
            plugin.playTour()
            const b = bar(layer)
            down(b.find('anp-bar-next')[0])
            b.fire('pointerdown')
            b.find('anp-bar-next')[0].fire('click')
            up(b.find('anp-bar-next')[0], 10)
            expect(plugin.touring).toBe(false)
            expect(plugin.openId).toBe(plugin.get(1)!.id)
            expect(b.find('anp-bar-title')[0].textContent).toBe('Two')
            b.find('anp-bar-prev')[0].fire('click')
            expect(plugin.openId).toBe(plugin.get(0)!.id)
            expect(b.find('anp-bar-title')[0].textContent).toBe('One')
        })

        test('the bar state: hidden with no open annotation or while placing, faded while the camera is moved (a drag past 4px, a wheel), shown 400 ms after', () => {
            vi.useFakeTimers()
            try {
                const {plugin, layer, canvas} = compact(true)
                const state = () => {
                    expect(bar(layer).dataset.state).toBe(plugin.tourBar)
                    return plugin.tourBar
                }
                expect(state()).toBe('hidden')
                plugin.goTo(0)
                expect(state()).toBe('shown')
                down(canvas)
                move(canvas, 12)
                expect(state()).toBe('shown') // a click so far
                move(canvas, 30)
                expect(state()).toBe('faded')
                up(canvas, 30)
                vi.advanceTimersByTime(399)
                expect(state()).toBe('faded')
                vi.advanceTimersByTime(1)
                expect(state()).toBe('shown')
                // a wheel zoom: shown 400 ms after the last wheel event
                windowListeners.get('wheel')!({target: canvas})
                expect(state()).toBe('faded')
                vi.advanceTimersByTime(300)
                windowListeners.get('wheel')!({target: canvas})
                vi.advanceTimersByTime(300)
                expect(state()).toBe('faded')
                vi.advanceTimersByTime(100)
                expect(state()).toBe('shown')
                // a drag of a marker does not fade it
                const m = markers(layer)[0]
                m.fire('pointerdown', {clientX: 400, clientY: 300})
                down(canvas)
                move(canvas, 40)
                expect(state()).toBe('shown')
                up(canvas, 40)
                m.fire('pointerup', {clientX: 400, clientY: 300})
                plugin.close()
                expect(state()).toBe('hidden')
                plugin.goTo(0)
                plugin.startAdding()
                expect(state()).toBe('hidden')
                plugin.cancelAdding()
                plugin.goTo(0)
                plugin.compactCard = false
                expect(state()).toBe('hidden')
            } finally {
                vi.useRealTimers()
            }
        })
    })

    describe('closeOnCanvasInteraction', () => {
        const down = (target: any, x = 10, button = 0) => windowListeners.get('pointerdown')!({target, clientX: x, clientY: 10, button})
        const move = (target: any, x: number) => windowListeners.get('pointermove')!({target, clientX: x, clientY: 10, button: -1})
        const up = (target: any, x: number, button = 0) => windowListeners.get('pointerup')!({target, clientX: x, clientY: 10, button})
        const wheel = (target: any) => windowListeners.get('wheel')!({target})
        /** One annotation, open */
        const opened = (editable = false) => {
            const s = setup(editable)
            s.plugin.add(s.box as any, front, normal, null)
            ;(s.plugin as any)._updateScreen()
            s.plugin.goTo(0)
            return s
        }

        test('off (the default): a drag (orbit) and a wheel zoom keep the card; a click closes it; not saved with the config', () => {
            const {plugin, canvas} = opened()
            expect(plugin.closeOnCanvasInteraction).toBe(false)
            down(canvas)
            move(canvas, 40)
            up(canvas, 40)
            wheel(canvas)
            expect(plugin.openId).not.toBe(null)
            down(canvas)
            up(canvas, 11)
            expect(plugin.openId).toBe(null)
            plugin.closeOnCanvasInteraction = true
            expect('closeOnCanvasInteraction' in plugin.toJSON()).toBe(false)
        })

        test('on: a drag on the canvas closes the card as soon as it moves 4px, before the pointer up', () => {
            const {plugin, layer, canvas} = opened()
            plugin.closeOnCanvasInteraction = true
            down(canvas)
            move(canvas, 12)
            expect(plugin.openId).not.toBe(null)
            move(canvas, 14)
            expect(plugin.openId).toBe(null)
            up(canvas, 40)
            // a drag from the canvas that ends over the card (no move reached the window) closes it at the pointer up
            plugin.goTo(0)
            down(canvas)
            up(card(layer), 40)
            expect(plugin.openId).toBe(null)
            // a mouse that moves with no button pressed does nothing
            plugin.goTo(0)
            move(canvas, 100)
            expect(plugin.openId).not.toBe(null)
        })

        test('on: a click on the canvas closes the card, as before; a click on a marker opens it, on the card keeps it', () => {
            const {plugin, layer, canvas} = opened()
            plugin.closeOnCanvasInteraction = true
            down(card(layer))
            move(card(layer), 40)
            up(card(layer), 40)
            expect(plugin.openId).not.toBe(null)
            down(canvas)
            up(canvas, 10)
            expect(plugin.openId).toBe(null)
            const m = markers(layer)[0]
            down(m, 400)
            m.fire('pointerdown', {clientX: 400, clientY: 300})
            m.fire('pointerup', {clientX: 400, clientY: 300})
            up(m, 400)
            expect(plugin.openId).toBe(plugin.get(0)!.id)
        })

        test('on: a wheel zoom on the canvas closes the card and stops the tour; a wheel on the card does not', () => {
            const {plugin, layer, canvas} = opened()
            plugin.closeOnCanvasInteraction = true
            wheel(card(layer))
            expect(plugin.openId).not.toBe(null)
            plugin.playTour()
            wheel(canvas)
            expect(plugin.openId).toBe(null)
            expect(plugin.touring).toBe(false)
        })

        test('on: not with another button than the primary one, while a marker is dragged, while placing, or when disabled', () => {
            const {plugin, layer, canvas} = opened(true)
            plugin.closeOnCanvasInteraction = true
            // a right drag (pan)
            down(canvas, 10, 2)
            move(canvas, 40)
            up(canvas, 40, 2)
            expect(plugin.openId).not.toBe(null)
            // a marker drag: the pointer moves over the canvas
            const m = markers(layer)[0]
            m.fire('pointerdown', {clientX: 400, clientY: 300})
            down(canvas)
            move(canvas, 40)
            wheel(canvas)
            expect(plugin.openId).not.toBe(null)
            // the window (capture) gets the up before the marker
            up(canvas, 40)
            m.fire('pointerup', {clientX: 400, clientY: 300})
            expect(plugin.openId).not.toBe(null)
            // disabled
            plugin.enabled = false
            down(canvas)
            move(canvas, 40)
            wheel(canvas)
            expect(plugin.openId).not.toBe(null)
            up(canvas, 40)
            plugin.enabled = true
            // placing (it closes the card itself): the wheel it passes to the canvas does nothing
            const selected: unknown[] = []
            plugin.addEventListener('annotationSelect', e => selected.push(e.annotation))
            plugin.startAdding()
            wheel(canvas)
            expect(selected).toEqual([null])
        })

        test('a checkbox in the UI folder', () => {
            const plugin = new AnnotationsPlugin()
            const item = (plugin.uiConfig.children as any[]).find(c => c.property?.[1] === 'closeOnCanvasInteraction')
            expect(item?.type).toBe('checkbox')
        })
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

    test('a camera with dollyFov: the saved pose wins over the dolly of the fov change, at the view already and after a flight', () => {
        // as RootScene.dollyActiveCameraFov for camera.userData.dollyFov: a fov change moves the camera along its view
        // axis to a fitting distance (10 here)
        const dollying = (camera: PerspectiveCamera & {target: Vector3}) => {
            let fov = camera.fov
            Object.defineProperty(camera, 'fov', {
                get: () => fov,
                set: (v: number) => {
                    fov = v
                    const dir = camera.position.clone().sub(camera.target).normalize()
                    camera.position.copy(camera.target).addScaledVector(dir, 10)
                },
            })
        }
        // at the pose of the view, with another fov: the camera move ends at once
        {
            const {plugin, box, camera} = setup(false)
            dollying(camera)
            plugin.add(box as any, front, normal, {position: [0, 0, 5], target: [0, 0, 0], quaternion: camera.quaternion.toArray(), zoom: 1, fov: 40})
            plugin.goTo(0)
            expect(camera.fov).toBe(40)
            expect(camera.position.toArray().map(v => +v.toFixed(5))).toEqual([0, 0, 5])
        }
        // a flight: each step and the end apply the fov before the pose
        {
            const popmotion = {animate: (o: any) => {
                o.onUpdate(0.5)
                o.onComplete()
                return {stop: noop}
            }}
            const {plugin, box, camera} = setup(false, popmotion)
            dollying(camera)
            plugin.add(box as any, front, normal, {position: [3, 0, 0], target: [0, 0, 0], quaternion: [0, 0, 0, 1], zoom: 1, fov: 40})
            plugin.goTo(0)
            expect(camera.fov).toBe(40)
            expect(camera.position.toArray().map(v => +v.toFixed(5))).toEqual([3, 0, 0])
        }
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

    test('loading a config (fromJSON) stops the flight, so it does not move the camera of the loaded config', () => {
        // a flight that runs until it is stopped
        const flights: {stop: ReturnType<typeof vi.fn>}[] = []
        const popmotion = {animate: (o: any) => {
            const f = {stop: vi.fn(() => o.onStop?.())}
            flights.push(f)
            return f
        }}
        const {plugin, box, camera} = setup(false, popmotion)
        plugin.add(box as any, front, normal, {position: [3, 0, 0], target: [0, 0, 0], quaternion: [0, 0, 0, 1], zoom: 1})
        const config = plugin.toJSON()
        plugin.goTo(0)
        expect(flights).toHaveLength(1)
        plugin.fromJSON(config)
        expect(flights[0].stop).toHaveBeenCalled()
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

    describe('keys with two viewers on the page', () => {
        const key = (k: string, target: any) => {
            const e = {key: k, target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn()}
            windowListeners.get('keydown')!(e)
            return e
        }
        /** Two viewers, each with two annotations; the first card of each is open (b opened last) */
        const two = () => {
            const a = setup()
            const b = setup()
            for (const s of [a, b]) {
                s.plugin.add(s.box as any, front, normal, null)
                s.plugin.add(s.box as any, front, normal, null)
            }
            a.plugin.goTo(0, {fly: false})
            b.plugin.goTo(0, {fly: false})
            return {a, b}
        }

        test('Esc and ← → act on the viewer that has the focus (its card or its canvas), not on the first one added', () => {
            const {a, b} = two()
            key('ArrowRight', card(b.layer))
            expect(b.plugin.openId).toBe(b.plugin.get(1)!.id)
            expect(a.plugin.openId).toBe(a.plugin.get(0)!.id)
            expect(key('Escape', card(b.layer)).stopImmediatePropagation).toHaveBeenCalled()
            expect(b.plugin.openId).toBe(null)
            expect(a.plugin.openId).not.toBe(null)
            b.plugin.goTo(0, {fly: false})
            key('Escape', a.canvas)
            expect(a.plugin.openId).toBe(null)
            expect(b.plugin.openId).not.toBe(null)
        })

        test('Esc cancels placing in the viewer that places, also while the other viewer has a card open', () => {
            // the second viewer places (the first one added has the first window listener)
            const {a, b} = two()
            b.plugin.startAdding()
            key('Escape', b.layer.find('anp-place')[0])
            expect(b.plugin.adding).toBe(false)
            expect(a.plugin.openId).not.toBe(null)
            // the focus on the page: placing was started last, Esc cancels it
            b.plugin.startAdding()
            key('Escape', doc.body)
            expect(b.plugin.adding).toBe(false)
            expect(a.plugin.openId).not.toBe(null)
        })

        test('the focus on the page: the viewer used last handles the key, the next Esc closes the other card', () => {
            const {a, b} = two()
            key('ArrowRight', doc.body)
            expect(b.plugin.openId).toBe(b.plugin.get(1)!.id)
            expect(a.plugin.openId).toBe(a.plugin.get(0)!.id)
            // a pointer down in the first viewer (an orbit) makes it the one used last
            windowListeners.get('pointerdown')!({target: a.canvas, clientX: 10, clientY: 10})
            windowListeners.get('pointerup')!({target: a.canvas, clientX: 40, clientY: 10})
            key('Escape', doc.body)
            expect(a.plugin.openId).toBe(null)
            expect(b.plugin.openId).not.toBe(null)
            key('Escape', doc.body)
            expect(b.plugin.openId).toBe(null)
        })
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

    test('escapeHtml escapes text and attribute values, for the HTML of renderCardContent', () => {
        expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;')
    })
})
