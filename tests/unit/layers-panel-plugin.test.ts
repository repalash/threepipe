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
    picker = {
        setSelected: (o: Object3D | Object3D[] | null, _record: boolean) => this.select(o ? Array.isArray(o) ? o : [o] : []),
        hoverObject: null as Object3D | null,
    }
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
}

/** The panel in a fake viewer, with the scene above, the picking, an outline, an undo manager and maybe an editor */
function setup({editor = false, container, picking: withPicking = true}: SetupOptions = {}) {
    const objects = scene()
    const picking = new FakePicking()
    const sceneEvents = new EventDispatcher<any>()
    const pluginListeners: {type: string, listener: any}[] = []
    const undo: {undo: () => void, redo: () => void}[] = []
    const outlineViewer = {renderManager: {setDirty: vi.fn()}, getPlugin: () => undefined}
    const outline = new SelectionOutlinePlugin()
    ;(outline as any)._viewer = outlineViewer
    const editorPlugin = {setArea: vi.fn()}
    const plugins: Record<string, any> = {
        PickingPlugin: withPicking ? picking : undefined,
        SelectionOutlinePlugin: outline,
        UndoManagerPlugin: {undoManager: {record: (c: any) => undo.push(c)}},
        TweakpaneEditorPlugin: editor ? editorPlugin : undefined,
    }
    const viewer = Object.assign(new EventDispatcher<any>(), {
        scene: Object.assign(sceneEvents, {modelRoot: objects.modelRoot}),
        getPlugin: (type: string) => plugins[type],
        addPluginListener: (type: string, listener: any) => pluginListeners.push({type, listener}),
        removePluginListener: (type: string, listener: any) => {
            const i = pluginListeners.findIndex(l => l.type === type && l.listener === listener)
            if (i >= 0) pluginListeners.splice(i, 1)
        },
        setDirty: vi.fn(),
        console,
    }) as any
    const layers = new LayersPanelPlugin(container as any)
    const list = (layers.element as any as FakeElement).find('lyp-list')[0]
    list.clientHeight = 280 // 10 rows
    layers.onAdded(viewer)
    flush()
    return {...objects, layers, list, picking, viewer, sceneEvents, pluginListeners, undo, outline, outlineViewer, editorPlugin, plugins}
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
        const {list, sun, camera, outline, outlineViewer} = setup()
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
        search.value = ''
        search.fire('input')
        flush()
        expect(shown()).toHaveLength(5)
        // a selected child in the place of the "… N more" row shows all of them
        picking.select([parts.children[9]])
        flush()
        expect(shown()).toHaveLength(12)
        picking.select([])
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

    test('goes in the left area of the editor frame with its mode bar entry; editorArea, enabled and a container', () => {
        const {layers, editorPlugin, pluginListeners, viewer, plugins} = setup({editor: true})
        expect(editorPlugin.setArea).toHaveBeenLastCalledWith('left', layers.element, LayersPanelPlugin.AreaEntry)
        expect(LayersPanelPlugin.AreaEntry.name).toBe('Layers')
        layers.editorArea = 'bottom'
        expect(editorPlugin.setArea.mock.calls.slice(-2)).toEqual([['left', null], ['bottom', layers.element, LayersPanelPlugin.AreaEntry]])
        layers.enabled = false
        expect(editorPlugin.setArea).toHaveBeenLastCalledWith('bottom', null)
        expect(layers.element.style.display).toBe('none')
        layers.enabled = true
        expect(editorPlugin.setArea).toHaveBeenLastCalledWith('bottom', layers.element, LayersPanelPlugin.AreaEntry)
        expect(layers.element.style.display).toBe('')
        layers.editorArea = null
        expect(editorPlugin.setArea).toHaveBeenLastCalledWith('bottom', null)

        // the editor removed, and added again
        layers.editorArea = 'left'
        const removed = pluginListeners.find(l => l.type === 'remove')!.listener
        removed({plugin: editorPlugin})
        expect(editorPlugin.setArea).toHaveBeenLastCalledWith('left', null)
        const again = {setArea: vi.fn()}
        plugins.TweakpaneEditorPlugin = again
        pluginListeners.find(l => l.type === 'add')!.listener({plugin: again})
        expect(again.setArea).toHaveBeenLastCalledWith('left', layers.element, LayersPanelPlugin.AreaEntry)
        expect(viewer.setDirty).not.toHaveBeenCalled()

        // with a container: the panel goes there, not in the frame
        const container = new FakeElement('div')
        const s = setup({editor: true, container})
        expect(s.editorPlugin.setArea).not.toHaveBeenCalled()
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

    test('remove takes out the listeners, the element, the frame area, the open rename and the hover', () => {
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
        expect(s.editorPlugin.setArea).toHaveBeenLastCalledWith('left', null)
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
