import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {DirectionalLight, EventDispatcher, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera} from 'three'
import {isPickable, widgetKinds} from 'threepipe'
import {LayersPanelPlugin} from '../../plugins/tweakpane-editor/src/LayersPanelPlugin'
import {SelectionOutlinePlugin} from '../../plugins/tweakpane-editor/src/SelectionOutlinePlugin'

// The layers panel of the tweakpane editor (plugins/tweakpane-editor/src/LayersPanelPlugin.ts). The node setup has no
// DOM: a small element with what the panel uses (events go up to the parents, as in a page, for the listeners on the
// list), a fake PickingPlugin with the selection and the hover, and the animation frames run by flush().

class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    textContent = ''
    innerHTML = ''
    title = ''
    tabIndex = -1
    type = ''
    disabled = false
    value = ''
    placeholder = ''
    scrollTop = 0
    clientHeight = 0
    dataset: Record<string, string> = {}
    attributes: Record<string, string> = {}
    style: Record<string, any> = {
        setProperty(k: string, v: string) {
            this[k] = v
        },
    }
    private _listeners = new Map<string, ((e: any) => void)[]>()
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        toggle: (c: string, on = !this.classList.contains(c)) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    constructor(readonly tagName: string) {}
    get parentElement() {
        return this.parent ?? null
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    insertBefore(c: FakeElement, before: FakeElement | null) {
        c.remove()
        c.parent = this
        const i = before ? this.children.indexOf(before) : -1
        this.children.splice(i < 0 ? this.children.length : i, 0, c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
        // as in a page: an element with the focus that leaves the page loses it
        if (doc.activeElement === this) this.blur()
    }
    setAttribute(k: string, v: string) {
        this.attributes[k] = v
    }
    removeAttribute(k: string) {
        delete this.attributes[k]
    }
    getAttribute(k: string) {
        return this.attributes[k] ?? null
    }
    /** `.class`, or classes like `.a, .b` */
    closest(sel: string): FakeElement | null {
        const classes = sel.split(',').map(s => s.trim().slice(1))
        if (classes.some(c => this.classList.contains(c))) return this
        return this.parent?.closest(sel) ?? null
    }
    /** The parents, from the nearest */
    ancestors(): FakeElement[] {
        return this.parent ? [this.parent, ...this.parent.ancestors()] : []
    }
    focus() {
        doc.activeElement = this
    }
    blur() {
        if (doc.activeElement === this) doc.activeElement = null
        this.fire('blur')
    }
    select() {}
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    /** Sends an event to this element and then to its parents (not `blur` and `pointerleave`, as in a page) */
    fire(type: string, e: any = {}) {
        let stopped = false
        const event = {
            target: this, defaultPrevented: false, key: '', altKey: false, shiftKey: false, ctrlKey: false, metaKey: false,
            preventDefault: () => event.defaultPrevented = true, stopPropagation: () => stopped = true, ...e,
        }
        const bubbles = type !== 'blur' && type !== 'pointerleave'
        for (const el of bubbles ? [this, ...this.ancestors()] : [this]) {
            if (stopped) break
            for (const f of el._listeners.get(type) ?? []) f(event)
        }
        return event
    }
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
    find(cls: string) {
        return this.all().filter(e => e.classList.contains(cls))
    }
}

/** The PickingPlugin as the panel uses it: the selection and the hover of its picker, and its events */
class FakePicking extends EventDispatcher<any> {
    selected: Object3D[] = []
    hover: Object3D | null = null
    multiSelectEnabled = true
    picker = ((self: FakePicking) => ({
        setSelected: (o: any, _record: boolean) => self.select(o ? Array.isArray(o) ? o : [o] : []),
        hoverObject: null as Object3D | null,
        // the first selected thing: an object, or a material, a texture or a geometry
        get selectedObject() {
            return self.selected[0] ?? null
        },
    }))(this)
    select(objects: Object3D[]) {
        this.selected = [...objects]
        this.dispatchEvent({type: 'selectedObjectChanged'})
    }
    setHover(o: Object3D | null) {
        this.picker.hoverObject = o
        this.dispatchEvent({type: 'hoverObjectChanged', object: o})
    }
    getSelectedObjects() {
        return [...this.selected]
    }
    toggleSelectedObject(o: Object3D) {
        // as the PickingPlugin: nothing without multi-select
        if (!this.multiSelectEnabled) return
        const i = this.selected.indexOf(o)
        this.select(i >= 0 ? this.selected.filter(x => x !== o) : [o, ...this.selected])
    }
    isDisabled() {
        return false
    }
    focusObject = vi.fn()
}

const doc = globalThis.document as any
const saved = {createElement: doc.createElement, activeElement: doc.activeElement}
let frames: (() => void)[] = []
beforeAll(() => {
    LayersPanelPlugin.InjectStyles = false
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    Object.assign(doc, saved)
    LayersPanelPlugin.InjectStyles = true
})
beforeEach(() => {
    doc.activeElement = null
    frames = []
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        frames[id - 1] = () => {}
    })
    // a row outlines at once in the tests; the test of the delay sets it
    LayersPanelPlugin.HoverDelay = 0
})
afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    LayersPanelPlugin.HoverDelay = 80
})

/** Runs the animation frames that the panel asked for */
function flush() {
    const fs = frames
    frames = []
    fs.forEach(f => f())
}

const mesh = (name: string) => Object.assign(new Mesh(undefined, new MeshBasicMaterial()), {name})
const group = (name: string, ...kids: Object3D[]) => Object.assign(new Group(), {name}).add(...kids)

/** A watch (a group of groups and meshes), a light with its target as a child, a camera, and a widget */
function scene() {
    const caseA = mesh('case-a')
    const caseB = mesh('case-b')
    const caseGroup = group('case', caseA, caseB)
    const hands = mesh('hands')
    const watch = group('watch', caseGroup, hands)
    ;(watch as any).assetType = 'model'
    const sun = Object.assign(new DirectionalLight(), {name: 'Sun'})
    sun.add(sun.target)
    const camera = Object.assign(new PerspectiveCamera(), {name: 'Camera'})
    const widget = Object.assign(new Object3D(), {name: 'widget', assetType: 'widget'})
    const modelRoot = new Object3D()
    modelRoot.add(watch, sun, camera, widget)
    return {modelRoot, watch, caseGroup, caseA, caseB, hands, sun, camera, widget}
}

interface SetupOptions {
    editor?: boolean
    container?: FakeElement
    picking?: boolean
    /** The rows of the scene and of the default camera (LayersPanelPlugin.sceneRows): off, so the rows are the model's */
    sceneRows?: boolean
}

/** The panel in a fake viewer, with the scene above, the picking, an outline, an undo manager and maybe an editor */
function setup({editor = false, container, picking: withPicking = true, sceneRows = false}: SetupOptions = {}) {
    const objects = scene()
    const picking = new FakePicking()
    const sceneEvents = new EventDispatcher<any>()
    const pluginListeners: {type: string, listener: any, names: string[]}[] = []
    const undo: {undo: () => void, redo: () => void}[] = []
    const outlineViewer = {renderManager: {setDirty: vi.fn()}, getPlugin: () => undefined}
    // the assets of the Object3DManager, for the tabs: a test fills them
    const assets = {materials: [] as any[], textures: [] as any[], geometries: [] as any[]}
    const object3dManager = Object.assign(new EventDispatcher<any>(), {
        getMaterials: () => assets.materials, getTextures: () => assets.textures, getGeometries: () => assets.geometries,
    })
    const outline = new SelectionOutlinePlugin()
    ;(outline as any)._viewer = outlineViewer
    const editorPlugin = {addPanel: vi.fn(), removePanel: vi.fn()}
    const plugins: Record<string, any> = {
        PickingPlugin: withPicking ? picking : undefined,
        SelectionOutlinePlugin: outline,
        UndoManagerPlugin: {undoManager: {record: (c: any) => undo.push(c)}},
        TweakpaneEditorPlugin: editor ? editorPlugin : undefined,
    }
    const viewer = Object.assign(new EventDispatcher<any>(), {
        // the scene is an object too (RootScene), at the top of the tree
        scene: Object.assign(sceneEvents, {modelRoot: objects.modelRoot, defaultCamera: Object.assign(new PerspectiveCamera(), {name: 'Default Camera'}),
            isObject3D: true, parent: null, traverseAncestors: () => undefined}),
        object3dManager,
        getPlugin: (type: string) => plugins[type],
        addPluginListener: (type: string, listener: any, ...names: string[]) => pluginListeners.push({type, listener, names}),
        removePluginListener: (type: string, listener: any) => {
            const i = pluginListeners.findIndex(l => l.type === type && l.listener === listener)
            if (i >= 0) pluginListeners.splice(i, 1)
        },
        setDirty: vi.fn(),
        console,
    }) as any
    const layers = new LayersPanelPlugin(container as any)
    layers.sceneRows = sceneRows
    const list = (layers.element as any as FakeElement).find('lyp-list')[0]
    list.clientHeight = 280 // 10 rows
    layers.onAdded(viewer)
    flush()
    return {...objects, layers, list, picking, viewer, sceneEvents, pluginListeners, undo, outline, outlineViewer, editorPlugin, plugins, assets, object3dManager}
}

/** The rows in the DOM that show, from the top */
const rows = (list: FakeElement) => list.find('lyp-row').filter(r => r.style.display !== 'none')
    .sort((a, b) => +a.dataset.index - +b.dataset.index)
const names = (list: FakeElement) => rows(list).map(r => r.find('lyp-name')[0].textContent)
const row = (list: FakeElement, name: string) => rows(list).find(r => r.find('lyp-name')[0].textContent === name)!
const part = (r: FakeElement, cls: string) => r.find(cls)[0]
const has = (r: FakeElement, cls: string) => r.classList.contains(cls)
const key = (list: FakeElement, k: string, mods: Record<string, boolean> = {}) => {
    list.fire('keydown', {key: k, ...mods})
    flush()
}

describe('LayersPanelPlugin', () => {
    test('builds the tree from the model root: layers only, top level closed, kind icons and colours', () => {
        const {layers, list, watch, sun, camera} = setup()
        expect(layers.listedObjects).toEqual([watch, sun, camera]) // not the widget
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera'])
        // every layer, also in the closed rows; not the target of the light
        expect((layers.element as any as FakeElement).find('lyp-count')[0].textContent).toBe('7')
        const kinds = rows(list).map(r => part(r, 'lyp-kind'))
        expect(kinds.map(k => k.dataset.kind)).toEqual(['group', 'directionalLight', 'perspectiveCamera'])
        expect(kinds[1].style.color).toBe(widgetKinds.directionalLight.color)
        expect(kinds[2].style.color).toBe(widgetKinds.perspectiveCamera.color)
        expect(kinds[1].innerHTML).toContain(widgetKinds.directionalLight.icon)
        expect(row(list, 'watch').getAttribute('aria-expanded')).toBe('false')
        expect(row(list, 'Sun').getAttribute('aria-expanded')).toBe(null) // its target is not a layer
        expect(part(row(list, 'Camera'), 'lyp-caret').dataset.state).toBe('')
    })

    test('the arrow opens and closes a row, Alt + click all the levels; setExpanded and collapseAll', () => {
        const {layers, list, watch, caseGroup, picking} = setup()
        part(row(list, 'watch'), 'lyp-caret').fire('click')
        flush()
        expect(names(list)).toEqual(['watch', 'case', 'hands', 'Sun', 'Camera'])
        expect(row(list, 'watch').getAttribute('aria-expanded')).toBe('true')
        expect(row(list, 'case').attributes['aria-level']).toBe('2')
        expect(picking.selected).toEqual([]) // the arrow does not select
        part(row(list, 'watch'), 'lyp-caret').fire('click')
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera'])
        part(row(list, 'watch'), 'lyp-caret').fire('click', {altKey: true})
        flush()
        expect(names(list)).toEqual(['watch', 'case', 'case-a', 'case-b', 'hands', 'Sun', 'Camera'])
        expect(layers.isExpanded(caseGroup)).toBe(true)
        layers.setExpanded(caseGroup, false)
        flush()
        expect(names(list)).toEqual(['watch', 'case', 'hands', 'Sun', 'Camera'])
        layers.collapseAll()
        flush()
        expect(layers.isExpanded(watch)).toBe(false)
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera'])
        // the empty arrow place of a row without children selects, as the rest of the row
        part(row(list, 'Camera'), 'lyp-caret').fire('click')
        expect(picking.selected.map(o => o.name)).toEqual(['Camera'])
    })

    test('a click selects in the PickingPlugin, Ctrl, Cmd or Shift + click adds or takes out', () => {
        const {list, picking, watch, sun, camera} = setup()
        part(row(list, 'Sun'), 'lyp-name').fire('click')
        expect(picking.selected).toEqual([sun])
        row(list, 'Camera').fire('click', {ctrlKey: true})
        expect(picking.selected).toEqual([camera, sun])
        row(list, 'watch').fire('click', {metaKey: true})
        row(list, 'Sun').fire('click', {shiftKey: true})
        expect(picking.selected).toEqual([watch, camera])
        row(list, 'Sun').fire('click')
        expect(picking.selected).toEqual([sun])
        flush()
        expect(has(row(list, 'Sun'), 'lyp-sel')).toBe(true)
        // without multi-select, a click with a key selects the row, as in the viewport
        picking.multiSelectEnabled = false
        row(list, 'Camera').fire('click', {ctrlKey: true})
        expect(picking.selected).toEqual([camera])
        picking.multiSelectEnabled = true
        expect(row(list, 'Sun').getAttribute('aria-selected')).toBe('true')
        expect(has(row(list, 'Camera'), 'lyp-sel')).toBe(false)
    })

    test('a selection in the viewport marks its rows, opens its groups and scrolls to it', () => {
        const {layers, list, picking, caseA, watch, caseGroup} = setup()
        list.clientHeight = 56 // 2 rows
        picking.select([caseA])
        flush()
        expect(layers.isExpanded(watch) && layers.isExpanded(caseGroup)).toBe(true)
        expect(has(row(list, 'case-a'), 'lyp-sel')).toBe(true)
        expect(has(row(list, 'watch'), 'lyp-sel-parent')).toBe(true)
        expect(has(row(list, 'case'), 'lyp-sel-parent')).toBe(true)
        // case-a is the 3rd row: the list scrolls so that it is the last one in view
        expect(list.scrollTop).toBe(3 * 28 - 56)

        // off: the groups stay closed, the list does not scroll
        layers.collapseAll()
        layers.revealSelection = false
        list.scrollTop = 0
        picking.select([caseA])
        flush()
        expect(layers.isExpanded(watch)).toBe(false)
        expect(list.scrollTop).toBe(0)
        expect(has(row(list, 'watch'), 'lyp-sel-parent')).toBe(true)
    })

    test('the eye hides and shows, for the whole selection when the row is in it; a parent dims its children; undo; not cameras', () => {
        const {layers, list, picking, watch, sun, camera, hands, undo} = setup()
        layers.setExpanded(watch, true)
        flush()
        part(row(list, 'watch'), 'lyp-eye').fire('click')
        flush()
        expect(watch.visible).toBe(false)
        expect(picking.selected).toEqual([]) // the button does not select
        expect(has(row(list, 'watch'), 'lyp-hidden')).toBe(true)
        expect(has(part(row(list, 'watch'), 'lyp-eye'), 'lyp-on')).toBe(true)
        expect(part(row(list, 'watch'), 'lyp-eye').getAttribute('aria-pressed')).toBe('true')
        // hidden by the parent: dimmed, the eye shows the parent's state
        expect(has(row(list, 'hands'), 'lyp-hidden')).toBe(true)
        expect(has(part(row(list, 'hands'), 'lyp-eye'), 'lyp-inherited')).toBe(true)
        undo.pop()!.undo()
        flush()
        expect(watch.visible).toBe(true)
        expect(has(row(list, 'hands'), 'lyp-hidden')).toBe(false)

        picking.select([sun, hands])
        part(row(list, 'Sun'), 'lyp-eye').fire('click')
        expect([sun.visible, hands.visible]).toEqual([false, false])
        expect(undo).toHaveLength(1) // one undo step for both
        undo.pop()!.undo()
        expect([sun.visible, hands.visible]).toEqual([true, true])

        // threepipe does not hide cameras: no eye on their rows, and setVisible leaves them out
        expect(part(row(list, 'Camera'), 'lyp-eye').disabled).toBe(true)
        expect(part(row(list, 'Sun'), 'lyp-eye').disabled).toBe(false)
        layers.setVisible([camera as any], false)
        expect(camera.visible).toBe(true)
        expect(undo).toHaveLength(0)
    })

    test('the lock sets userData.userSelectable false (the PickingPlugin does not pick it or its parts), unlock gives back the value', () => {
        const {layers, list, watch, caseA, sun, undo} = setup()
        layers.setExpanded(watch, true)
        flush()
        expect(isPickable(caseA as any)).toBe(true)
        part(row(list, 'watch'), 'lyp-lock').fire('click')
        flush()
        expect(watch.userData.userSelectable).toBe(false)
        expect(layers.isLocked(watch as any)).toBe(true)
        expect(isPickable(caseA as any)).toBe(false) // a part of the locked group
        expect(has(row(list, 'watch'), 'lyp-locked')).toBe(true)
        expect(has(row(list, 'case'), 'lyp-locked')).toBe(true)
        expect(has(part(row(list, 'case'), 'lyp-lock'), 'lyp-inherited')).toBe(true)
        part(row(list, 'watch'), 'lyp-lock').fire('click')
        expect('userSelectable' in watch.userData).toBe(false)
        expect(isPickable(caseA as any)).toBe(true)
        undo.pop()!.undo()
        expect(watch.userData.userSelectable).toBe(false)
        undo.pop()!.undo()
        expect('userSelectable' in watch.userData).toBe(false)

        // an object picked without a material (as a text) keeps its true after a lock and an unlock
        sun.userData.userSelectable = true
        layers.setLocked([sun as any], true)
        expect(sun.userData.userSelectable).toBe(false)
        layers.setLocked([sun as any], false)
        expect(sun.userData.userSelectable).toBe(true)
    })

    test('a double-click on a name renames: Enter keeps, Escape goes back, a click outside keeps, not during an IME composition', () => {
        const {layers, list, sun, camera, undo, picking} = setup()
        const rename = () => {
            part(row(list, 'Sun'), 'lyp-name').fire('dblclick')
            return part(row(list, 'Sun'), 'lyp-rename')
        }
        let input = rename()
        expect(input.value).toBe('Sun')
        expect(doc.activeElement).toBe(input)
        expect(part(row(list, 'Sun'), 'lyp-name').style.display).toBe('none')
        input.value = '  Key light '
        // the Enter that ends a composition is for the text
        input.fire('keydown', {key: 'Enter', isComposing: true})
        expect(sun.name).toBe('Sun')
        // a key in the field is not for the list or the page
        let page = 0
        ;(layers.element as any as FakeElement).addEventListener('keydown', () => page++)
        input.fire('keydown', {key: 'Enter'})
        expect(page).toBe(0)
        expect(sun.name).toBe('Key light')
        expect(list.find('lyp-rename')).toHaveLength(0)
        expect(doc.activeElement).toBe(list)
        flush()
        expect(names(list)).toContain('Key light')
        undo.pop()!.undo()
        expect(sun.name).toBe('Sun')
        flush()

        input = rename()
        input.value = 'Other'
        input.fire('keydown', {key: 'Escape'})
        expect(sun.name).toBe('Sun')
        expect(undo).toHaveLength(0)

        input = rename()
        input.value = 'Blurred'
        input.blur()
        expect(sun.name).toBe('Blurred')

        // a click in the field does not select the row; an empty name is not kept
        flush()
        part(row(list, 'Blurred'), 'lyp-name').fire('dblclick')
        input = part(row(list, 'Blurred'), 'lyp-rename')
        input.fire('click')
        expect(picking.selected).toEqual([])
        input.value = '   '
        input.fire('keydown', {key: 'Enter'})
        expect(sun.name).toBe('Blurred')

        // F2 renames the selected object; startRename is false for an object not in the list
        flush()
        picking.select([camera])
        flush()
        key(list, 'F2')
        expect(part(row(list, 'Camera'), 'lyp-rename')).toBeTruthy()
        expect(layers.startRename(new Object3D() as any)).toBe(false)
    })

    test('arrow keys in the focused list: Up and Down select, Shift adds, Right opens or goes in, Left closes or goes up', () => {
        const {layers, list, picking, watch, caseGroup, sun, camera, hands} = setup()
        const sel = () => picking.selected.map(o => o.name)
        key(list, 'ArrowDown') // nothing selected: the first row
        expect(sel()).toEqual(['watch'])
        key(list, 'ArrowRight') // opens
        expect(layers.isExpanded(watch)).toBe(true)
        key(list, 'ArrowRight') // goes in
        expect(sel()).toEqual(['case'])
        key(list, 'ArrowDown')
        expect(picking.selected).toEqual([hands])
        key(list, 'ArrowLeft') // a leaf: the parent
        expect(picking.selected).toEqual([watch])
        key(list, 'ArrowLeft') // open: closes
        expect(layers.isExpanded(watch)).toBe(false)
        key(list, 'ArrowDown')
        expect(picking.selected).toEqual([sun])
        key(list, 'ArrowDown', {shiftKey: true})
        expect(picking.selected).toEqual([camera, sun])
        key(list, 'ArrowDown') // the last row stays
        expect(picking.selected).toEqual([camera])
        key(list, 'ArrowUp')
        expect(picking.selected).toEqual([sun])
        // Alt + Right opens all the levels
        picking.select([watch])
        key(list, 'ArrowRight', {altKey: true})
        expect(layers.isExpanded(caseGroup)).toBe(true)
        // the keys are for the list, not for the camera: no default, not sent further
        const e = list.fire('keydown', {key: 'ArrowUp'})
        expect(e.defaultPrevented).toBe(true)
        // other keys go on to the page (H, Delete: the PickingPlugin)
        expect(list.fire('keydown', {key: 'h'}).defaultPrevented).toBe(false)
    })

    test('virtual list: only the rows in view and 8 more each side are in the DOM, the rows are made again only as needed', () => {
        const {layers, list, modelRoot} = setup()
        for (let i = 0; i < 500; i++) modelRoot.add(mesh('m' + i))
        layers.refresh(true)
        flush()
        const spacer = list.find('lyp-spacer')[0]
        expect(spacer.style.height).toBe(503 * 28 + 'px')
        // 10 rows in view and 8 below
        expect(rows(list).map(r => +r.dataset.index)).toEqual([...Array(18).keys()])
        list.scrollTop = 100 * 28
        list.fire('scroll')
        flush()
        // rows 100 to 109 in view, 8 above and 8 below
        expect(rows(list).map(r => +r.dataset.index)).toEqual([...Array(26).keys()].map(i => 92 + i))
        expect(names(list)[0]).toBe('m89') // 3 rows before the meshes
        expect(rows(list)[0].style.top).toBe(92 * 28 + 'px')
        expect(list.find('lyp-row')).toHaveLength(26) // the pool: no more than the most rows shown at once
        list.scrollTop = 0
        list.fire('scroll')
        flush()
        expect(rows(list)).toHaveLength(18)
        expect(list.find('lyp-row')).toHaveLength(26)
    })

    test('a hovered row outlines its object (one frame, no restart of the render); the viewport hover marks its row', () => {
        const {layers, list, picking, sun, camera, outline, outlineViewer, viewer} = setup()
        const redraws = outlineViewer.renderManager.setDirty
        row(list, 'Sun').fire('pointerover')
        expect(outline.hovered).toEqual([sun])
        expect(redraws).toHaveBeenCalledTimes(1)
        part(row(list, 'Sun'), 'lyp-eye').fire('pointerover') // a part of the same row: no change
        expect(redraws).toHaveBeenCalledTimes(1)
        list.fire('pointerleave')
        expect(outline.hovered).toEqual([])
        expect(redraws).toHaveBeenCalledTimes(2)
        expect(viewer.setDirty).not.toHaveBeenCalled()
        expect(frames).toHaveLength(0) // the list is not drawn again for a hover

        // the hover of the viewport: its row is marked; the pointer that leaves the list gives the outline back to it
        picking.setHover(camera)
        expect(has(row(list, 'Camera'), 'lyp-hover')).toBe(true)
        expect(has(row(list, 'Sun'), 'lyp-hover')).toBe(false)
        row(list, 'Sun').fire('pointerover')
        list.fire('pointerleave')
        expect(outline.hovered).toEqual([camera])

        // off: a row does not outline; followPicking off: the panel leaves the outline alone
        layers.viewportHover = false
        row(list, 'Sun').fire('pointerover')
        expect(outline.hovered).toEqual([camera])
        list.fire('pointerleave')
        layers.viewportHover = true
        outline.followPicking = false
        outline.hovered = []
        row(list, 'Sun').fire('pointerover')
        expect(outline.hovered).toEqual([])
    })

    test('a row outlines its object after the pointer rests on it; a move across rows renders no frame', () => {
        // only the timers: the list draws in the animation frames of the test
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
        LayersPanelPlugin.HoverDelay = 80
        const {layers, list, sun, camera, outline, outlineViewer} = setup()
        const redraws = outlineViewer.renderManager.setDirty
        // across the rows, faster than the delay: no outline, no frame
        row(list, 'Sun').fire('pointerover')
        vi.advanceTimersByTime(40)
        row(list, 'Camera').fire('pointerover')
        vi.advanceTimersByTime(40)
        expect([outline.hovered, redraws.mock.calls.length]).toEqual([[], 0])
        // the pointer rests: one frame
        vi.advanceTimersByTime(40)
        expect([outline.hovered, redraws.mock.calls.length]).toEqual([[camera], 1])
        // back to the row of the outline before the delay: nothing changes, nothing is left to run
        row(list, 'Sun').fire('pointerover')
        row(list, 'Camera').fire('pointerover')
        vi.advanceTimersByTime(200)
        expect([outline.hovered, redraws.mock.calls.length]).toEqual([[camera], 1])
        // a row that waits, then the pointer leaves: the outline clears at once and the row never outlines
        row(list, 'Sun').fire('pointerover')
        list.fire('pointerleave')
        expect(outline.hovered).toEqual([])
        vi.advanceTimersByTime(200)
        expect([outline.hovered, redraws.mock.calls.length]).toEqual([[], 2])
        expect(outline.hovered).not.toContain(sun)
        // the list drawn again in each frame (an animated material) while the pointer rests: the row keeps its time
        row(list, 'Sun').fire('pointerover')
        for (let k = 0; k < 4; k++) {
            layers.refresh()
            flush()
            vi.advanceTimersByTime(30)
        }
        expect(outline.hovered).toEqual([sun])
    })

    test('an open row shows its first children and a "… N more" row; a click, the search or the selection shows all', () => {
        const {layers, list, picking, modelRoot} = setup()
        const parts = Object.assign(new Group(), {name: 'Parts'})
        for (let i = 0; i < 12; i++) parts.add(mesh('p' + i))
        modelRoot.add(parts)
        modelRoot.add(mesh('after'))
        layers.refresh(true)
        layers.setExpanded(parts as any, true)
        flush()
        const shown = () => names(list).filter(n => /^p\d+$/.test(n))
        expect(shown()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
        expect(names(list)).toContain('… 7 more')
        // not an object: no selection, no outline, not in the listed objects
        expect(layers.listedObjects.map(o => o.name)).not.toContain('… 7 more')
        // a click shows all of them, until the row is closed
        row(list, '… 7 more').fire('click')
        flush()
        expect(shown()).toHaveLength(12)
        expect(names(list)).not.toContain('… 7 more')
        layers.setExpanded(parts as any, false)
        layers.setExpanded(parts as any, true)
        flush()
        expect(shown()).toHaveLength(5)
        // the search shows all the matches
        const search = (layers.element as any as FakeElement).find('lyp-search-input')[0]
        search.value = 'p'
        search.fire('input')
        flush()
        expect(shown()).toHaveLength(12)
        // the clear button empties the field, shows all again and keeps the focus in the field
        const clear = (layers.element as any as FakeElement).find('lyp-search-clear')[0]
        expect([clear.getAttribute('aria-label'), clear.type]).toEqual(['Clear the search', 'button'])
        clear.fire('click', {preventDefault: () => {}})
        flush()
        expect([search.value, shown().length, doc.activeElement === search]).toEqual(['', 5, true])
        // a selected child in the place of the "… N more" row shows all of them
        picking.select([parts.children[9]])
        flush()
        expect(shown()).toHaveLength(12)
        picking.select([])
        // deeper: a mesh in a child group behind the "… N more" row, with all the groups open (Alt)
        const deep = Object.assign(new Group(), {name: 'Deep'})
        for (let i = 0; i < 8; i++) deep.add(group('g' + i, mesh('in-g' + i)))
        modelRoot.add(deep)
        layers.refresh(true)
        layers.setExpanded(deep as any, true, true)
        flush()
        expect(names(list)).not.toContain('in-g7')
        picking.select([deep.children[7].children[0]])
        flush()
        expect(names(list)).toContain('in-g7')
        deep.removeFromParent()
        picking.select([])
        layers.refresh(true)
        // the Up and Down keys pass over the "… N more" row
        layers.setExpanded(parts as any, false)
        layers.setExpanded(parts as any, true)
        flush()
        picking.select([parts.children[4]])
        flush()
        key(list, 'ArrowDown')
        expect(picking.selected.map(o => o.name)).toEqual(['after'])
        key(list, 'ArrowUp')
        expect(picking.selected.map(o => o.name)).toEqual(['p4'])
        // 0: all; one child more than the limit: all (no "… 1 more" row)
        picking.select([])
        layers.maxChildren = 0
        flush()
        expect(shown()).toHaveLength(12)
        layers.maxChildren = 11
        flush()
        expect([shown().length, names(list).some(n => n.startsWith('…'))]).toEqual([12, false])
    })

    /** The scene of setup with a gold material on the case, its texture, a texture of the scene and a geometry of the hands */
    const withAssets = () => {
        const s = setup()
        const gold = {isMaterial: true, type: 'MeshStandardMaterial2', name: 'Gold', uuid: 'm1aa', color: {getHexString: () => 'ffcc00'},
            appliedMeshes: new Set([s.caseA, s.caseB]), setDirty: vi.fn()}
        const unused = {isMaterial: true, type: 'MeshBasicMaterial', name: '', uuid: 'm2bb', appliedMeshes: new Set([mesh('elsewhere')])}
        const albedo = {isTexture: true, name: 'Albedo', uuid: 't1cc', image: {width: 512, height: 256}, appliedObjects: new Set([gold])}
        const sky = {isTexture: true, name: '', uuid: 't2dd', appliedObjects: new Set([{isScene: true, isObject3D: true, parent: null}])}
        const hands = {isBufferGeometry: true, name: '', uuid: 'g1ee', attributes: {position: {count: 1500}}, userData: {}, appliedMeshes: new Set([s.hands])}
        s.assets.materials.push(gold, unused)
        s.assets.textures.push(albedo, sky)
        s.assets.geometries.push(hands)
        s.layers.refresh(true)
        flush()
        return {...s, gold, albedo, sky, handsGeometry: hands}
    }
    const tabs = (layers: LayersPanelPlugin) => (layers.element as any as FakeElement).find('lyp-tabs')[0]
    const tab = (layers: LayersPanelPlugin, name: string) => tabs(layers).find('lyp-tab').find(b => b.textContent === name)!
    const metas = (list: FakeElement) => rows(list).map(r => r.find('lyp-meta')[0].textContent)

    test('the tab bar shows the tabs that are on; with one tab, no tab bar; a tab turned off gives its place to the first', () => {
        const {layers, list, gold} = withAssets()
        expect(layers.tabs).toEqual(['objects', 'materials', 'textures', 'geometries'])
        expect(tabs(layers).style.display).toBe('')
        expect(has(tab(layers, 'Objects'), 'lyp-on')).toBe(true)
        // the counts are in the tooltips: the materials used in the scene (not the one of an object elsewhere)
        expect(tab(layers, 'Materials').title).toBe('Materials: 1')
        tab(layers, 'Materials').fire('click')
        flush()
        expect([layers.tab, names(list), has(tab(layers, 'Materials'), 'lyp-on')]).toEqual(['materials', ['Gold'], true])
        expect(gold).toBeDefined()
        // the open tab turned off: the first tab that is on
        layers.materialsTab = false
        flush()
        expect([layers.tab, tab(layers, 'Materials').style.display]).toEqual(['objects', 'none'])
        // one tab on: no tab bar
        layers.texturesTab = false
        layers.geometryTab = false
        expect(tabs(layers).style.display).toBe('none')
        // none on: the Objects tab
        layers.objectsTab = false
        expect(layers.tabs).toEqual(['objects'])
        layers.setTab('materials') // off: no change
        expect(layers.tab).toBe('objects')
    })

    test('the Materials tab: a swatch, the users; open lists them; a click selects the asset; hover outlines its users', () => {
        const {layers, list, picking, outline, gold, caseA, caseB, undo} = withAssets()
        layers.setTab('materials')
        flush()
        const r = row(list, 'Gold')
        expect(part(r, 'lyp-kind').innerHTML).toContain('background:#ffcc00')
        expect([metas(list), part(r, 'lyp-lock').style.visibility]).toEqual([['2 obj'], 'hidden'])
        // a click selects the material: the UI of the editor shows it
        r.fire('click')
        flush()
        expect(picking.selected).toEqual([gold])
        expect(has(row(list, 'Gold'), 'lyp-sel')).toBe(true)
        // its arrow lists the objects that use it; a click on one selects it, and marks its asset
        part(row(list, 'Gold'), 'lyp-caret').fire('click')
        flush()
        expect(names(list)).toEqual(['Gold', 'case-a', 'case-b'])
        row(list, 'case-b').fire('click')
        flush()
        expect(picking.selected).toEqual([caseB])
        expect(has(row(list, 'Gold'), 'lyp-sel-parent')).toBe(true)
        // a hover outlines the users of the asset
        row(list, 'Gold').fire('pointerover')
        expect(outline.hovered).toEqual([caseA, caseB])
        list.fire('pointerleave')
        // a double-click selects its users; a double-click on the name renames it, as one undo step
        row(list, 'Gold').fire('dblclick')
        expect(picking.selected).toEqual([caseA, caseB])
        part(row(list, 'Gold'), 'lyp-name').fire('dblclick')
        const input = list.find('lyp-rename')[0]
        input.value = 'Brushed gold'
        input.fire('keydown', {key: 'Enter'})
        flush()
        expect([gold.name, names(list)[0]]).toEqual(['Brushed gold', 'Brushed gold'])
        undo[undo.length - 1].undo()
        expect(gold.name).toBe('Gold')
    })

    test('the Textures and Geometry tabs: size, vertices and users; the search; the arrow keys', () => {
        const {layers, list, picking, albedo, sky, handsGeometry, hands} = withAssets()
        layers.setTab('textures')
        flush()
        // the texture of the material counts its users; a texture of the scene says so
        expect(names(list)).toEqual(['Albedo', 'Texture t2dd'])
        expect(metas(list)).toEqual(['512×256 · 2 obj', 'scene'])
        const search = (layers.element as any as FakeElement).find('lyp-search-input')[0]
        search.value = 'alb'
        search.fire('input')
        flush()
        expect(names(list)).toEqual(['Albedo'])
        search.value = ''
        search.fire('input')
        flush()
        // the arrow keys select the next asset
        key(list, 'ArrowDown')
        expect(picking.selected).toEqual([albedo])
        key(list, 'ArrowDown')
        expect(picking.selected).toEqual([sky])
        key(list, 'ArrowUp')
        expect(picking.selected).toEqual([albedo])
        // Right opens the asset and Down goes to its first user; Left goes back to the asset
        key(list, 'ArrowRight')
        key(list, 'ArrowDown')
        expect(picking.selected.map(o => o.name)).toEqual(['case-a'])
        key(list, 'ArrowLeft')
        expect(picking.selected).toEqual([albedo])
        // the geometry: no name, so its kind and uuid; its vertices; a double-click on the name selects its users
        layers.setTab('geometries')
        flush()
        expect([names(list), metas(list)]).toEqual([['Geometry g1ee'], ['1.5k v · 1 obj']])
        part(row(list, 'Geometry g1ee'), 'lyp-name').fire('dblclick')
        expect(list.find('lyp-rename')).toHaveLength(0)
        expect(picking.selected).toEqual([hands])
        expect(handsGeometry).toBeDefined()
    })

    test('the arrow keys in a tab of assets: an object under two open assets is two rows; the list scrolls to the row', () => {
        const {layers, list, picking, assets, gold, albedo} = withAssets()
        const normal = {isTexture: true, name: 'Normal', uuid: 't3ff', appliedObjects: new Set([gold])}
        assets.textures.push(normal)
        layers.setTab('textures')
        layers.refresh(true)
        flush()
        part(row(list, 'Albedo'), 'lyp-caret').fire('click')
        flush()
        part(row(list, 'Normal'), 'lyp-caret').fire('click')
        flush()
        expect(names(list)).toEqual(['Albedo', 'case-a', 'case-b', 'Texture t2dd', 'Normal', 'case-a', 'case-b'])
        list.clientHeight = 56 // 2 rows
        const path: string[] = []
        for (let k = 0; k < 7; k++) {
            key(list, 'ArrowDown')
            flush()
            path.push(picking.selected[0].name || picking.selected[0].uuid)
        }
        // the second case-a and case-b are rows of their own: Down goes on to the end
        expect(path).toEqual(['Albedo', 'case-a', 'case-b', 't2dd', 'Normal', 'case-a', 'case-b'])
        expect(list.scrollTop).toBe(7 * 28 - 56)
        // Left goes to the asset of that row, not to the first asset of the object
        key(list, 'ArrowLeft')
        expect(picking.selected).toEqual([normal])
        expect(albedo).toBeDefined()
    })

    test('a tab of assets: a mesh that takes another material or geometry builds it again; a reused row shows its own picture', () => {
        const {layers, list, sceneEvents, outline, gold, caseB, handsGeometry, hands, albedo, sky} = withAssets()
        layers.setTab('materials')
        flush()
        expect(metas(list)).toEqual(['2 obj'])
        // case-b takes another material that is already in use: no add or remove event, only the change of the mesh
        // with the pointer on the row of the material, its outline follows its users
        row(list, 'Gold').fire('pointerover')
        expect(outline.hovered).toHaveLength(2)
        gold.appliedMeshes.delete(caseB)
        sceneEvents.dispatchEvent({type: 'materialChanged', object: caseB})
        flush()
        expect(metas(list)).toEqual(['1 obj'])
        expect(outline.hovered).not.toContain(caseB)
        list.fire('pointerleave')
        // the same for a geometry
        layers.setTab('geometries')
        flush()
        handsGeometry.appliedMeshes.add(caseB)
        sceneEvents.dispatchEvent({type: 'geometryChanged', object: caseB})
        flush()
        expect(metas(list)).toEqual(['1.5k v · 2 obj'])
        expect(hands).toBeDefined()
        // pictures (the fake DOM cannot draw them): a search gives the row of Albedo to the other texture
        ;(layers as any)._thumbs.set(albedo, {image: albedo.image, url: 'data:albedo', n: -1}).set(sky, {image: sky.image, url: 'data:sky', n: -2})
        layers.setTab('textures')
        flush()
        expect(part(rows(list)[0], 'lyp-kind').innerHTML).toContain('data:albedo')
        const search = (layers.element as any as FakeElement).find('lyp-search-input')[0]
        search.value = 't2dd'
        search.fire('input')
        flush()
        expect(names(list)).toEqual(['Texture t2dd'])
        expect(part(rows(list)[0], 'lyp-kind').innerHTML).toContain('data:sky')
    })

    test('the picture of a texture whose image loads later shows after the load, and a new image gives a new picture', () => {
        const {layers, list, assets, gold, sceneEvents} = withAssets()
        class FakeImage {
            width = 0
        }
        vi.stubGlobal('HTMLImageElement', FakeImage)
        let drawn = 0
        const createElement = doc.createElement
        doc.createElement = (tag: string) => tag === 'canvas' ?
            {getContext: () => ({drawImage: () => undefined}), toDataURL: () => 'data:drawn' + ++drawn} : createElement(tag)
        try {
            const image = new FakeImage()
            assets.textures.push({isTexture: true, name: 'Late', uuid: 't4gg', image, appliedObjects: new Set([gold])})
            layers.setTab('textures')
            const search = (layers.element as any as FakeElement).find('lyp-search-input')[0]
            search.value = 'late'
            search.fire('input')
            flush()
            expect(names(list)).toEqual(['Late'])
            // not loaded: the icon of a texture
            expect(part(rows(list)[0], 'lyp-kind').innerHTML).not.toContain('data:drawn')
            image.width = 64
            layers.refresh(true)
            flush()
            expect(part(rows(list)[0], 'lyp-kind').innerHTML).toContain('data:drawn1')
            // another image in the same texture (the Flip Y of the image UI): a new picture
            const flipped = Object.assign(new FakeImage(), {width: 64})
            ;(assets.textures[assets.textures.length - 1] as any).image = flipped
            layers.refresh(true)
            flush()
            expect(part(rows(list)[0], 'lyp-kind').innerHTML).toContain('data:drawn2')
            // the same image: no new picture
            layers.refresh(true)
            flush()
            expect([drawn, part(rows(list)[0], 'lyp-kind').innerHTML.includes('data:drawn2')]).toEqual([2, true])
            // a new image with only a texture update (no material change): the update reaches the scene, the row draws again
            const another = Object.assign(new FakeImage(), {width: 128, height: 64})
            ;(assets.textures[assets.textures.length - 1] as any).image = another
            sceneEvents.dispatchEvent({type: 'textureUpdate'})
            flush()
            expect([part(rows(list)[0], 'lyp-kind').innerHTML.includes('data:drawn3'), metas(list)[0]]).toEqual([true, '128×64 · 2 obj'])
            // in another tab: nothing to draw
            layers.setTab('objects')
            flush()
            sceneEvents.dispatchEvent({type: 'textureUpdate'})
            expect(frames).toHaveLength(0)
        } finally {
            doc.createElement = createElement // the stub of HTMLImageElement goes in afterEach
        }
    })

    test('a material changed elsewhere shows its new name and colour in the Materials tab', () => {
        const {layers, list, sceneEvents, gold} = withAssets()
        layers.setTab('materials')
        flush()
        gold.name = 'Rose gold'
        gold.color.getHexString = () => 'e0a090'
        sceneEvents.dispatchEvent({type: 'materialUpdate', material: gold})
        flush()
        expect(names(list)).toEqual(['Rose gold'])
        expect(part(rows(list)[0], 'lyp-kind').innerHTML).toContain('#e0a090')
        // the Objects tab does not build again for it
        layers.setTab('objects')
        flush()
        sceneEvents.dispatchEvent({type: 'materialUpdate', material: gold})
        expect(frames).toHaveLength(0)
    })

    test('the scene and the default camera are the first rows: dimmer, no buttons, a line below; a click selects them', () => {
        const {layers, list, picking, viewer, modelRoot, outline} = setup({sceneRows: true})
        const theScene = viewer.scene
        const camera = theScene.defaultCamera
        expect(names(list).slice(0, 3)).toEqual(['Scene', 'Default Camera', 'watch'])
        expect([has(rows(list)[0], 'lyp-pinned'), has(rows(list)[0], 'lyp-pinned-end'), has(rows(list)[1], 'lyp-pinned-end')]).toEqual([true, false, true])
        expect([part(rows(list)[0], 'lyp-eye').style.visibility, part(rows(list)[1], 'lyp-lock').style.visibility]).toEqual(['hidden', 'hidden'])
        // not in the model: not in the listed objects
        expect(layers.listedObjects.map(o => o.name)).not.toContain('Default Camera')
        row(list, 'Scene').fire('click')
        flush()
        expect(picking.selected).toEqual([theScene])
        expect(has(row(list, 'Scene'), 'lyp-sel')).toBe(true)
        // the scene row outlines nothing (not the whole model); a double-click frames the model, not a rename
        row(list, 'Scene').fire('pointerover')
        expect(outline.hovered).toEqual([])
        part(row(list, 'Scene'), 'lyp-name').fire('dblclick')
        expect(list.find('lyp-rename')).toHaveLength(0)
        expect(picking.focusObject).toHaveBeenLastCalledWith(modelRoot)
        row(list, 'Default Camera').fire('click')
        expect(picking.selected).toEqual([camera])
        // a search hides them; the setting turns them off
        const search = (layers.element as any as FakeElement).find('lyp-search-input')[0]
        search.value = 'watch'
        search.fire('input')
        flush()
        expect(names(list)).not.toContain('Scene')
        search.value = ''
        search.fire('input')
        layers.sceneRows = false
        flush()
        expect(names(list)[0]).toBe('watch')
    })

    test('leaf types: meshes, lines, points, cameras and lights show no children, unless showLeafChildren', () => {
        const {layers, list, modelRoot} = setup()
        const body = mesh('body')
        body.add(mesh('part'))
        modelRoot.add(body)
        layers.refresh(true)
        flush()
        expect([names(list), part(row(list, 'body'), 'lyp-caret').dataset.state]).toEqual([['watch', 'Sun', 'Camera', 'body'], ''])
        layers.showLeafChildren = true
        layers.setExpanded(body as any, true)
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera', 'body', 'part'])
        // another list: only the lights
        layers.showLeafChildren = false
        layers.leafTypes = ['light']
        flush()
        expect(names(list)).toContain('part')
    })

    test('clicks: a click on a selected row unselects it with clickToUnselect; a double-click focuses, the name renames', () => {
        const {layers, list, picking, sun, watch} = setup()
        row(list, 'Sun').fire('click')
        row(list, 'Sun').fire('click')
        expect(picking.selected).toEqual([sun]) // off by default
        layers.clickToUnselect = true
        row(list, 'Sun').fire('click')
        expect(picking.selected).toEqual([])
        // a double-click on the row selects and focuses; on the name it renames
        row(list, 'watch').fire('dblclick')
        expect([picking.selected, picking.focusObject.mock.calls.at(-1)?.[0]]).toEqual([[watch], watch])
        part(row(list, 'watch'), 'lyp-name').fire('dblclick')
        expect(list.find('lyp-rename')).toHaveLength(1)
        list.find('lyp-rename')[0].fire('keydown', {key: 'Escape'})
        layers.doubleClickFocus = false
        picking.focusObject.mockClear()
        row(list, 'Sun').fire('dblclick')
        expect(picking.focusObject).not.toHaveBeenCalled()
    })

    test('the search shows the matches and the groups that hold them; Escape clears it', () => {
        const {list, layers} = setup()
        const search = (layers.element as any as FakeElement).find('lyp-search-input')[0]
        search.value = 'CASE-'
        search.fire('input')
        flush()
        expect(names(list)).toEqual(['watch', 'case', 'case-a', 'case-b'])
        search.value = 'nothing'
        search.fire('input')
        flush()
        expect(names(list)).toEqual([])
        const empty = list.find('lyp-empty')[0]
        expect([empty.style.display, empty.textContent]).toEqual(['', 'No layers match'])
        // the keys typed in the field are not for the page
        let page = 0
        ;(layers.element as any as FakeElement).addEventListener('keydown', () => page++)
        search.fire('keydown', {key: 'Escape'})
        expect(search.value).toBe('')
        expect(page).toBe(0)
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera'])
        expect(empty.style.display).toBe('none')
    })

    test('scene updates: a new child builds the list again, a widget does not draw it again', () => {
        const {list, sceneEvents, modelRoot, widget} = setup()
        modelRoot.add(mesh('new'))
        sceneEvents.dispatchEvent({type: 'sceneUpdate', hierarchyChanged: true})
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera', 'new'])
        sceneEvents.dispatchEvent({type: 'sceneUpdate', object: widget, hierarchyChanged: true})
        expect(frames).toHaveLength(0)
        // a name changed from elsewhere
        modelRoot.children[1].name = 'Key'
        sceneEvents.dispatchEvent({type: 'sceneUpdate', change: 'name'})
        flush()
        expect(names(list)).toContain('Key')
    })

    test('a camera added or removed builds the list again (the scene sends no sceneUpdate for a camera)', () => {
        const {list, sceneEvents, modelRoot, camera} = setup()
        const side = Object.assign(new PerspectiveCamera(), {name: 'Side'})
        modelRoot.add(side)
        sceneEvents.dispatchEvent({type: 'objectUpdate', object: side, change: 'addedToParent'})
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera', 'Side'])
        camera.removeFromParent()
        sceneEvents.dispatchEvent({type: 'objectUpdate', object: camera, change: 'removedFromParent'})
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Side'])
        // a camera renamed from elsewhere
        side.name = 'Top'
        sceneEvents.dispatchEvent({type: 'objectUpdate', object: side, change: 'name'})
        flush()
        expect(names(list)).toEqual(['watch', 'Sun', 'Top'])
        // other changes of an object only draw the rows (sceneUpdate)
        sceneEvents.dispatchEvent({type: 'objectUpdate', object: side, change: 'position'})
        expect(frames).toHaveLength(0)
    })

    test('the hovered row follows its object when the rows are reused: a scroll, a change of the tree', () => {
        const {layers, list, modelRoot, outline} = setup()
        for (let i = 0; i < 100; i++) modelRoot.add(mesh('m' + i))
        layers.refresh(true)
        flush()
        const under = row(list, 'm2') // the element under the pointer
        under.fire('pointerover')
        expect(outline.hovered.map(o => o.name)).toEqual(['m2'])
        list.scrollTop = 50 * 28
        list.fire('scroll')
        flush()
        // the same element shows another object now, or none
        const now = under.style.display === 'none' ? [] : [under.find('lyp-name')[0].textContent]
        expect(outline.hovered.map(o => o.name)).toEqual(now)
        expect(now).not.toEqual(['m2'])
        // a change of the tree under a still pointer
        list.scrollTop = 0
        list.fire('scroll')
        flush()
        under.fire('pointerover')
        const before = under.find('lyp-name')[0].textContent
        modelRoot.children[0].removeFromParent()
        layers.refresh(true)
        flush()
        expect(outline.hovered.map(o => o.name)).toEqual([under.find('lyp-name')[0].textContent])
        expect(under.find('lyp-name')[0].textContent).not.toBe(before)
    })

    test('does not touch the editor frame; enabledChange when it is turned on or off; a container', () => {
        const {layers, editorPlugin, pluginListeners} = setup({editor: true})
        // the app places the panel: the plugin does not call the editor, or listen for it
        expect([editorPlugin.addPanel, editorPlugin.removePanel].flatMap(f => f.mock.calls)).toHaveLength(0)
        expect(pluginListeners.map(l => l.names)).toEqual([['PickingPlugin'], ['PickingPlugin']])
        expect(LayersPanelPlugin.AreaEntry.name).toBe('Layers')
        const changes: boolean[] = []
        layers.addEventListener('enabledChange', e => changes.push(e.enabled))
        layers.enabled = false
        expect(layers.element.style.display).toBe('none')
        layers.enabled = true
        expect(layers.element.style.display).toBe('')
        // enable and disable with a key send it too; no change, no event
        layers.disable('test')
        layers.disable('other')
        layers.enable('test')
        layers.enable('other')
        layers.enabled = true
        expect(changes).toEqual([false, true, false, true])
        expect([editorPlugin.addPanel, editorPlugin.removePanel].flatMap(f => f.mock.calls)).toHaveLength(0)

        // with a container: the panel goes there
        const container = new FakeElement('div')
        const s = setup({container})
        expect(s.layers.element as any).toBe(container.children[0])
    })

    test('works without a PickingPlugin, and takes one added later', () => {
        const {layers, list, picking, plugins, pluginListeners, sun} = setup({picking: false})
        row(list, 'Sun').fire('click') // nothing to select with
        key(list, 'ArrowDown')
        expect(names(list)).toEqual(['watch', 'Sun', 'Camera'])
        plugins.PickingPlugin = picking
        pluginListeners.find(l => l.type === 'add')!.listener({plugin: picking})
        row(list, 'Sun').fire('click')
        expect(picking.selected).toEqual([sun])
        expect(layers.listedObjects).toHaveLength(3)
    })

    test('remove takes out the listeners, the element, the open rename and the hover', () => {
        const container = new FakeElement('div')
        const s = setup({editor: true})
        const {layers, list, picking, viewer, sceneEvents, pluginListeners, outline, sun} = s
        row(list, 'Sun').fire('pointerover')
        part(row(list, 'Sun'), 'lyp-name').fire('dblclick')
        const input = part(row(list, 'Sun'), 'lyp-rename')
        input.value = 'Not kept'
        layers.refresh(true) // a frame that waits
        layers.onRemove(viewer)
        expect(sun.name).toBe('Sun') // the rename is cancelled
        expect(outline.hovered).toEqual([])
        expect(sceneEvents.hasEventListener('sceneUpdate', (layers as any)._onSceneUpdate)).toBe(false)
        expect(picking.hasEventListener('selectedObjectChanged', (layers as any)._onSelection)).toBe(false)
        expect(picking.hasEventListener('hoverObjectChanged', (layers as any)._onPickingHover)).toBe(false)
        expect(pluginListeners).toHaveLength(0)
        expect([s.editorPlugin.addPanel, s.editorPlugin.removePanel].flatMap(f => f.mock.calls)).toHaveLength(0)
        flush() // the frame was cancelled: nothing drawn, no error
        // nothing reacts after the remove
        picking.select([sun])
        sceneEvents.dispatchEvent({type: 'sceneUpdate', hierarchyChanged: true})
        layers.refresh()
        expect(frames).toHaveLength(0)

        const c = setup({container})
        expect(c.layers.element as any).toBe(container.children[0])
        c.layers.onRemove(c.viewer)
        expect(container.children).toHaveLength(0)
    })
})
