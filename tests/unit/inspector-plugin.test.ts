import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {BoxGeometry, EventDispatcher} from 'three'
import {Mesh, PhysicalMaterial, PickingPlugin, UnlitMaterial} from 'threepipe'

// The inspector of the tweakpane editor (plugins/tweakpane-editor/src/InspectorPlugin.ts), and the selectionUi option of
// the PickingPlugin that it uses. The node setup has no DOM: a small element with what the inspector uses, a fake
// Tweakpane renderer that records the uiConfigs it shows, a fake PickingPlugin and a fake MaterialPreviewPlugin.

class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    textContent = ''
    title = ''
    type = ''
    value = ''
    width = 0
    height = 0
    dataset: Record<string, string> = {}
    style: Record<string, any> = {}
    private _attrs = new Map<string, string>()
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        toggle: (c: string, on = !this.classList.contains(c)) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    private _listeners = new Map<string, ((e: any) => void)[]>()
    constructor(readonly tagName: string) {}
    get parentElement() {
        return this.parent ?? null
    }
    setAttribute(k: string, v: string) {
        this._attrs.set(k, v)
    }
    getAttribute(k: string) {
        return this._attrs.get(k) ?? null
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    replaceChildren(...cs: FakeElement[]) {
        for (const c of [...this.children]) c.remove()
        cs.forEach(c => this.appendChild(c))
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f({target: this, preventDefault: () => {}, ...e})
    }
    click() {
        this.fire('click')
    }
    getContext() {
        return {clearRect: () => {}, drawImage: () => {}}
    }
    setPointerCapture() {}
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
    find(cls: string) {
        return this.all().filter(e => e.classList.contains(cls))
    }
}

/** The Tweakpane renderer of the inspector: records the uiConfigs it shows */
const renderers: FakeRenderer[] = []
class FakeRenderer {
    shown: any[] = []
    added = false
    disposed = false
    constructor(..._args: any[]) {
        renderers.push(this)
    }
    protected _createUiContainer() {
        return new FakeElement('div')
    }
    appendChild(c: any) {
        this.shown.push(c)
    }
    removeChild(c: any) {
        this.shown = this.shown.filter(x => x !== c)
    }
    onAdded() {
        this.added = true
    }
    onRemove() {
        this.added = false
    }
    dispose() {
        this.disposed = true
    }
}
vi.mock('@threepipe/plugin-tweakpane', () => ({TweakpaneUiPlugin: FakeRenderer}))

const doc = globalThis.document as any
const saved = {...doc}
beforeAll(() => {
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    for (const k of Object.keys(doc)) if (!(k in saved)) delete doc[k]
    Object.assign(doc, saved)
})

const {InspectorPlugin} = await import('../../plugins/tweakpane-editor/src/InspectorPlugin')
InspectorPlugin.InjectStyles = false

/** A PickingPlugin with a selection, and its event */
class FakePicking extends EventDispatcher<any> {
    selectionUi = true
    selected: any
    getSelectedObject() {
        return this.selected
    }
    getSelectedObjects() {
        return this.selected ? [this.selected] : []
    }
    select(o: any) {
        this.selected = o
        this.dispatchEvent({type: 'selectedObjectChanged', object: o})
    }
}

let picking: FakePicking
let requests: {material: any, options: any}[]
const setup = () => {
    picking = new FakePicking()
    requests = []
    const previews = {request: (material: any, options: any) => {
        requests.push({material, options})
        return {cancel: () => {}}
    }}
    const viewer = Object.assign(new EventDispatcher<any>(), {
        scene: new EventDispatcher<any>(),
        getPlugin: (p: any) => p === PickingPlugin ? picking : p?.PluginType === 'MaterialPreviewPlugin' ? previews : undefined,
        addPluginListener: () => {},
        removePluginListener: () => {},
        console,
    })
    const inspector = new InspectorPlugin()
    inspector.onAdded(viewer as any)
    const el = inspector.element as unknown as FakeElement
    const tabs = () => el.find('isp-tab').map(t => t.textContent + (t.classList.contains('isp-on') ? '*' : ''))
    const ui = renderers[renderers.length - 1]
    return {inspector, viewer, el, tabs, ui}
}
const mesh = (...materials: any[]) => {
    const m = new Mesh(new BoxGeometry(), materials.length > 1 ? materials : materials[0])
    m.name = 'Box'
    // made when the object joins a scene; the mesh here is in none
    m.uiConfig = {type: 'folder', label: 'Box', children: []}
    return m
}

beforeEach(() => {
    renderers.length = 0
})

describe('InspectorPlugin', () => {
    test('shows the tabs of the selection and the uiConfig of the open tab; a pick of another mesh keeps the open tab', () => {
        const {el, tabs, ui} = setup()
        expect(tabs()).toEqual([])
        expect(el.find('isp-title')[0].textContent).toBe('Inspector')
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        expect(tabs()).toEqual(['Object*', 'Material', 'Geometry'])
        expect(el.find('isp-title')[0].textContent).toBe('Box')
        expect(ui.shown).toEqual([a.uiConfig])
        el.find('isp-tab')[1].click()
        expect(ui.shown).toEqual([(a.material as any).uiConfig])
        const b = mesh(new PhysicalMaterial())
        picking.select(b)
        expect(tabs()).toEqual(['Object', 'Material*', 'Geometry'])
        expect(ui.shown).toEqual([(b.material as any).uiConfig])
        // a material alone: one tab, no tab bar; the open tab is kept for the next mesh
        picking.select(b.material)
        expect(tabs()).toEqual(['Material*'])
        expect(el.find('isp-tabs')[0].style.display).toBe('none')
        picking.select(undefined)
        expect(tabs()).toEqual([])
        expect(ui.shown).toEqual([])
    })

    test('sends selectionChange on a change of the selection, not on a new material of the selected mesh', () => {
        const {inspector, viewer} = setup()
        const events: boolean[] = []
        inspector.addEventListener('selectionChange', e => events.push(e.hasSelection))
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        picking.select(mesh(new PhysicalMaterial())) // another selection: again, so the app swaps the inspector in
        const b = picking.selected
        b.material = new UnlitMaterial()
        viewer.scene.dispatchEvent({type: 'materialChanged', object: b})
        expect(events).toEqual([true, true])
        picking.select(undefined)
        expect(events).toEqual([true, true, false])
        expect(inspector.hasSelection).toBe(false)
    })

    test('shows the new material of the selected mesh', () => {
        const {el, ui, viewer} = setup()
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        el.find('isp-tab')[1].click()
        const m = new UnlitMaterial()
        a.material = m
        viewer.scene.dispatchEvent({type: 'materialChanged', object: a})
        expect(ui.shown).toEqual([m.uiConfig])
    })

    test('a mesh with more materials has a list of them', () => {
        const {el, ui} = setup()
        const m1 = new PhysicalMaterial({name: 'Gold'})
        const m2 = new PhysicalMaterial({name: 'Stone'})
        picking.select(mesh(m1, m2))
        el.find('isp-tab')[1].click()
        const list = el.find('isp-materials')[0]
        expect(list.style.display).toBe('')
        expect(list.children.map(o => o.textContent)).toEqual(['Gold', 'Stone'])
        list.value = '1'
        list.fire('change')
        expect(ui.shown).toEqual([m2.uiConfig])
    })

    test('the material preview is asked for on the Material tab only, with the shape and the view', () => {
        const {inspector, el} = setup()
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        expect(requests).toHaveLength(0)
        expect(el.find('isp-preview')[0].style.display).toBe('none')
        el.find('isp-tab')[1].click()
        expect(el.find('isp-preview')[0].style.display).toBe('')
        expect(requests.at(-1)!.material).toBe(a.material)
        expect(requests.at(-1)!.options.shape).toBe('sphere')
        inspector.previewShape = 'mesh'
        expect(requests.at(-1)!.options).toMatchObject({shape: 'mesh', geometry: a.geometry})
        // a change of the material asks again
        const n = requests.length;
        (a.material as any).setDirty()
        expect(requests.length).toBe(n + 1)
        // a drag turns the view
        const canvas = el.find('isp-preview-canvas')[0]
        const before = requests.at(-1)!.options.cameraDirection.clone()
        canvas.fire('pointerdown', {button: 0, clientX: 0, clientY: 0, pointerId: 1})
        canvas.fire('pointermove', {clientX: 40, clientY: 0, pointerId: 1})
        expect(requests.at(-1)!.options.cameraDirection.equals(before)).toBe(false)
        inspector.preview = false
        expect(el.find('isp-preview')[0].style.display).toBe('none')
    })

    test('turns off the selection UI of the PickingPlugin while it is added, and puts it back', () => {
        const {inspector, viewer, ui} = setup()
        expect(picking.selectionUi).toBe(false)
        expect(ui.added).toBe(true)
        inspector.onRemove(viewer as any)
        expect(picking.selectionUi).toBe(true)
        expect(ui.disposed).toBe(true)
    })

    test('enabled sends enabledChange and hides the panel', () => {
        const {inspector, el} = setup()
        const events: boolean[] = []
        inspector.addEventListener('enabledChange', e => events.push(e.enabled))
        inspector.enabled = false
        expect(el.style.display).toBe('none')
        inspector.enabled = true
        expect(events).toEqual([false, true])
    })
})

describe('PickingPlugin.selectionUi', () => {
    test('off: the UI of the plugin shows only the picking settings, not the selection', () => {
        const p = new PickingPlugin()
        const a = mesh(new PhysicalMaterial())
        const settings = (p.uiConfig.children as any[]).length - 1 // without the prompt
        p.refreshUiChildren(a)
        expect(p.uiConfig.children).toContain(a.uiConfig)
        p.selectionUi = false
        p.refreshUiChildren(a)
        expect(p.uiConfig.children).not.toContain(a.uiConfig)
        expect((p.uiConfig.children as any[]).length).toBe(settings)
        p.refreshUiChildren(undefined) // no prompt to select an object either
        expect((p.uiConfig.children as any[]).length).toBe(settings)
    })
})
