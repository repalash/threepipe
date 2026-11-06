import {afterAll, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {BoxGeometry, Euler, EventDispatcher} from 'three'
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
    /** In the page: the app placed the inspector (a test sets false for an inspector out of the page) */
    isConnected = true
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
    /** `.class` only */
    closest(sel: string): FakeElement | null {
        return this.classList.contains(sel.slice(1)) ? this : this.parent?.closest(sel) ?? null
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
    /** setValue of uiconfig.js: sets the property of the config */
    methods = {setValue: vi.fn(async(c: any, v: any) => {
        const [o, k] = typeof c.property === 'function' ? c.property() : c.property
        o[k] = v
        return true
    })}
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
    objectSelectionUiConfig(o: any) {
        return [{type: 'button', label: 'Focus', object: o}]
    }
    objectMaterialManageUiConfig(o: any) {
        return [{type: 'button', label: 'Remove Material(s)', object: o}]
    }
}
const labels = (ui: FakeRenderer) => ui.shown.map(c => c.label)

let picking: FakePicking
let requests: {material: any, options: any}[]
let invalidated: any[]
const setup = () => {
    picking = new FakePicking()
    requests = []
    invalidated = []
    const previews = {request: (material: any, options: any) => {
        requests.push({material, options})
        return {cancel: () => {}}
    }, invalidate: (m: any) => invalidated.push(m)}
    const viewer = Object.assign(new EventDispatcher<any>(), {
        // what materialPreviewOptionsFromViewer reads: the environment of the scene and the screen pass
        scene: Object.assign(new EventDispatcher<any>(), {environment: null, environmentIntensity: 1, environmentRotation: new Euler()}),
        renderManager: {screenPass: {outputColorSpace: 'srgb'}},
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
        expect(ui.shown.at(-1)).toBe(a.uiConfig)
        el.find('isp-tab')[1].click()
        expect(ui.shown.at(-1)).toBe((a.material as any).uiConfig)
        const b = mesh(new PhysicalMaterial())
        picking.select(b)
        expect(tabs()).toEqual(['Object', 'Material*', 'Geometry'])
        expect(ui.shown.at(-1)).toBe((b.material as any).uiConfig)
        // a material alone: one tab, no tab bar; the open tab is kept for the next mesh
        picking.select(b.material)
        expect(tabs()).toEqual(['Material*'])
        expect(ui.shown).toEqual([(b.material as any).uiConfig])
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
        expect(ui.shown.at(-1)).toBe(m.uiConfig)
    })

    test('shows the actions of the PickingPlugin for the object: Focus on the Object tab, the material actions on the Material tab', () => {
        const {el, ui} = setup()
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        expect(labels(ui)).toEqual(['Focus', 'Box'])
        expect(ui.shown[0].object).toBe(a)
        el.find('isp-tab')[1].click()
        expect(labels(ui)).toEqual(['Remove Material(s)', (a.material as any).uiConfig.label])
        el.find('isp-tab')[2].click()
        expect(ui.shown).toEqual([a.geometry.uiConfig].filter(Boolean))
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
        expect(ui.shown.at(-1)).toBe(m2.uiConfig)
    })

    test('the Object tab has a card for each material, with a small preview and the name; a click opens the Material tab on it', () => {
        const {inspector, el, ui, tabs} = setup()
        const m1 = new PhysicalMaterial({name: 'Gold'})
        const m2 = new PhysicalMaterial()
        picking.select(mesh(m1, m2))
        const cards = () => el.find('isp-card')
        expect(cards().map(c => c.find('isp-card-name')[0].textContent)).toEqual(['Gold', m2.type + ' 2'])
        // a material with no name shows its type as the name, alone
        expect(cards().map(c => c.classList.contains('isp-card-plain'))).toEqual([false, true])
        expect(requests.map(r => [r.material, r.options.size, r.options.shape])).toEqual([[m1, 64, 'sphere'], [m2, 64, 'sphere']])
        cards()[1].click()
        expect(tabs()).toEqual(['Object', 'Material*', 'Geometry'])
        expect(ui.shown.at(-1)).toBe(m2.uiConfig)
        // the Material tab has no cards
        expect(el.find('isp-cards')[0].style.display).toBe('none')
        expect(cards()).toHaveLength(0)
        // turned off: no previews for the cards
        el.find('isp-tab')[0].click()
        const n = requests.length
        inspector.enabled = false
        expect(requests.length).toBe(n)
        inspector.enabled = true
        expect(requests.length).toBe(n + 2)
        // no material (a selected texture or geometry): no cards
        picking.select(undefined)
        expect(el.find('isp-cards')[0].style.display).toBe('none')
    })

    test('a right-click or a long press on a setting offers Reset to default when the value is not the default of its class', async() => {
        const {inspector, el, ui} = setup()
        const menus: Record<string, () => void>[] = []
        ;(inspector as any)._showMenu = (items: Record<string, () => void>) => menus.push(items)
        const mat = new PhysicalMaterial()
        // a row of the renderer for each setting: the element of its binding (uiRef), with a label inside
        const row = () => {
            const r = new FakeElement('div')
            r.className = 'tp-lblv'
            r.appendChild(new FakeElement('div')).className = 'tp-lblv_l'
            return r
        }
        const roughRow = row(), colorRow = row(), nestedRow = row(), otherRow = row()
        const rough = {type: 'slider', property: [mat, 'roughness'], uiRef: {controller_: {view: {element: roughRow}}}}
        const color = {type: 'color', property: () => [mat, 'color'], uiRef: {controller_: {view: {element: colorRow}}}}
        class NeedsArgs {
            size: number
            constructor(size: number) {
                if (size === undefined) throw new Error('size')
                this.size = size
            }
        }
        const odd = new NeedsArgs(3)
        const nested = {type: 'number', property: [odd, 'size'], uiRef: {controller_: {view: {element: nestedRow}}}}
        ;(mat as any).uiConfig = {type: 'folder', label: 'Material', children: [rough, color, () => ({type: 'folder', children: [nested]})]}
        picking.select(mesh(mat))
        el.find('isp-tab')[1].click()
        const body = el.find('isp-body')[0]
        const rightClick = (target: FakeElement) => {
            const preventDefault = vi.fn()
            body.fire('contextmenu', {target, clientX: 10, clientY: 20, preventDefault})
            return preventDefault.mock.calls.length > 0
        }
        // the default value: no menu, and the menu of the browser is not stopped
        expect(mat.roughness).toBe(1)
        expect(rightClick(roughRow.children[0])).toBe(false)
        expect(menus).toHaveLength(0)
        mat.roughness = 0.3
        expect(rightClick(roughRow.children[0])).toBe(true)
        expect(Object.keys(menus[0])).toEqual(['Reset to default'])
        menus[0]['Reset to default']()
        await Promise.resolve()
        // through the renderer: undo and onChange
        expect(ui.methods.setValue).toHaveBeenLastCalledWith(rough, 1, {last: true}, true, true)
        expect(mat.roughness).toBe(1)
        // an object value: a copy of the default, not the default object
        mat.color.set(0xff0000)
        expect(rightClick(colorRow)).toBe(true)
        menus[1]['Reset to default']()
        await Promise.resolve()
        expect(mat.color.getHex()).toBe(0xffffff)
        expect(ui.methods.setValue.mock.lastCall![1]).not.toBe((InspectorPlugin as any)._defaults.get(PhysicalMaterial).color)
        // a class that needs arguments has no default; a row that is not a setting has no menu
        expect(rightClick(nestedRow)).toBe(false)
        expect(rightClick(otherRow)).toBe(false)
        expect(menus).toHaveLength(2)
        // a long press on a touch screen, not a drag
        vi.useFakeTimers()
        try {
            mat.roughness = 0.5
            body.fire('pointerdown', {target: roughRow, pointerType: 'touch', clientX: 0, clientY: 0})
            body.fire('pointermove', {clientX: 20, clientY: 0})
            vi.advanceTimersByTime(InspectorPlugin.LongPressTime)
            expect(menus).toHaveLength(2)
            body.fire('pointerdown', {target: roughRow, pointerType: 'touch', clientX: 0, clientY: 0})
            vi.advanceTimersByTime(InspectorPlugin.LongPressTime)
            expect(menus).toHaveLength(3)
            // a mouse press is not a long press
            body.fire('pointerdown', {target: roughRow, pointerType: 'mouse', clientX: 0, clientY: 0})
            vi.advanceTimersByTime(InspectorPlugin.LongPressTime)
            expect(menus).toHaveLength(3)
        } finally {
            vi.useRealTimers()
        }
    })

    test('the material preview is asked for on the Material tab only, with the shape and the view', () => {
        const {inspector, el} = setup()
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        // the Object tab asks only for the small previews of its material cards
        expect(requests.map(r => r.options.size)).toEqual([InspectorPlugin.CardPreviewSize])
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
        // off: the head stays, the preview folds and is not asked for; a click on the head opens it again
        const head = el.find('isp-preview-head')[0]
        expect(head.getAttribute('aria-expanded')).toBe('true')
        const k = requests.length
        head.click()
        expect(inspector.preview).toBe(false)
        expect(el.find('isp-preview')[0].style.display).toBe('')
        expect(el.find('isp-preview-body')[0].style.display).toBe('none')
        expect(head.getAttribute('aria-expanded')).toBe('false')
        expect(requests.length).toBe(k)
        ;(a.material as any).setDirty() // no preview to refresh
        expect(requests.length).toBe(k)
        head.click()
        expect(inspector.preview).toBe(true)
        expect(el.find('isp-preview-body')[0].style.display).toBe('')
        expect(requests.length).toBe(k + 1)
        // the Object tab has no preview and no head
        el.find('isp-tab')[0].click()
        expect(el.find('isp-preview')[0].style.display).toBe('none')
    })

    test('asks for the preview again when the lighting of the viewer changes, not on other updates', () => {
        const {el, viewer} = setup()
        picking.select(mesh(new PhysicalMaterial()))
        el.find('isp-tab')[1].click()
        const n = requests.length
        viewer.dispatchEvent({type: 'update'}) // a camera move: the same settings
        expect(requests.length).toBe(n)
        viewer.scene.environmentIntensity = 2
        viewer.dispatchEvent({type: 'update'})
        expect(requests.length).toBe(n + 1)
        // not on the Object tab: no preview to refresh
        el.find('isp-tab')[0].click()
        const m = requests.length
        viewer.scene.environmentRotation.y = 1
        viewer.dispatchEvent({type: 'update'})
        expect(requests.length).toBe(m)
    })

    test('a change of the selected geometry in place drops the cached previews of its materials and asks again', () => {
        const {el, inspector, viewer} = setup()
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        // an edit on the Geometry tab: the cache is dropped, no preview is shown
        viewer.scene.dispatchEvent({type: 'geometryUpdate', geometry: a.geometry})
        expect(invalidated).toEqual([a.material])
        // the material card asks for a sphere, not the geometry
        expect(requests.map(r => r.options.size)).toEqual([InspectorPlugin.CardPreviewSize])
        inspector.previewShape = 'mesh'
        el.find('isp-tab')[1].click()
        const n = requests.length
        viewer.scene.dispatchEvent({type: 'geometryUpdate', geometry: a.geometry})
        expect(requests.length).toBe(n + 1)
        // another geometry: nothing
        viewer.scene.dispatchEvent({type: 'geometryUpdate', geometry: new BoxGeometry()})
        expect(invalidated).toHaveLength(2)
        expect(requests.length).toBe(n + 1)
    })

    test('turns off the selection UI of the PickingPlugin while it is added, and puts it back', () => {
        const {inspector, viewer, ui} = setup()
        expect(picking.selectionUi).toBe(false)
        expect(ui.added).toBe(true)
        inspector.onRemove(viewer as any)
        expect(picking.selectionUi).toBe(true)
        expect(ui.disposed).toBe(true)
    })

    test('out of the page (the classic layout), the PickingPlugin shows the settings of the selection; back in the page, the inspector does', () => {
        const {el, ui, viewer} = setup()
        el.isConnected = false
        const a = mesh(new PhysicalMaterial())
        picking.select(a)
        // the inspector lets go of the settings, the PickingPlugin shows them
        expect([ui.shown, picking.selectionUi]).toEqual([[], true])
        // the layout changes: the canvas resizes, the viewer sends update
        el.isConnected = true
        viewer.dispatchEvent({type: 'update'})
        expect(picking.selectionUi).toBe(false)
        expect(ui.shown.at(-1)).toBe(a.uiConfig)
        el.isConnected = false
        viewer.dispatchEvent({type: 'update'})
        expect([ui.shown, picking.selectionUi]).toEqual([[], true])
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

describe('InspectorPlugin.css', () => {
    test('the inspector scrolls as one column, so in a short area the settings under the preview stay reachable', async() => {
        const {readFileSync} = await import('node:fs')
        const css = readFileSync(new URL('../../plugins/tweakpane-editor/src/InspectorPlugin.css', import.meta.url), 'utf8')
        const rule = (sel: string) => css.match(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}'))?.[1] ?? ''
        expect(rule('.isp-root')).toMatch(/overflow-y:\s*auto/)
        // the settings do not scroll on their own (they would shrink to nothing under the head and the preview)
        expect(rule('.isp-body')).not.toMatch(/overflow-y:\s*auto/)
        expect(rule('.isp-body')).toMatch(/flex:\s*none/)
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
