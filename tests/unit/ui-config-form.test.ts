import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'
import {Color, Vector3} from 'three'
import {JSUndoManager, UiConfigMethods, UiObjectConfig} from 'threepipe'
import {isIntegerName, UiConfigForm} from '../../plugins/tweakpane-editor/src/ui/UiConfigForm'

// the node setup has no DOM: a small element with what the form uses
class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    style: Record<string, any> = {setProperty: (k: string, v: string) => this.style[k] = v}
    textContent = ''
    value = ''
    checked = false
    disabled = false
    type = ''
    title = ''
    min = ''
    max = ''
    step = ''
    private _listeners = new Map<string, ((e: any) => void)[]>()
    innerHTML = ''
    attributes: Record<string, string> = {}
    classList = {
        add: (...c: string[]) => this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...c])].join(' '),
        remove: (...c: string[]) => this.className = this.className.split(' ').filter(x => x && !c.includes(x)).join(' '),
        contains: (c: string) => this.className.split(' ').includes(c),
    }
    constructor(readonly tagName: string) {}
    setAttribute(name: string, value: string) {
        this.attributes[name] = String(value)
    }
    removeAttribute(name: string) {
        delete this.attributes[name]
    }
    getAttribute(name: string) {
        return this.attributes[name] ?? null
    }
    insertBefore(c: FakeElement, ref: FakeElement) {
        c.parent = this
        this.children.splice(this.children.indexOf(ref), 0, c)
        return c
    }
    get lastChild() {
        return this.children[this.children.length - 1] ?? null
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
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    setPointerCapture() {}
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f({preventDefault: () => {}, pointerId: 1, clientX: 0, button: 0, ...e})
    }
    /** The elements below this one with one of the tag names of a selector like 'input, select' */
    querySelectorAll(selector: string) {
        const tags = selector.split(',').map(t => t.trim())
        return this.all().filter(e => tags.includes(e.tagName))
    }
    /** All elements below this one, depth first */
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
}

const doc = globalThis.document as any
const createElement = doc.createElement
beforeAll(() => {
    UiConfigForm.InjectStyles = false
    UiConfigForm.Tooltips = false
    doc.createElement = (tag: string) => new FakeElement(tag)
    doc.activeElement = null
})
afterAll(() => {
    doc.createElement = createElement
    UiConfigForm.InjectStyles = true
    UiConfigForm.Tooltips = true
})

/** The row of a label, and its inputs */
function row(form: UiConfigForm, label: string) {
    const root = form.element as any as FakeElement
    const r = root.all().find(e => e.className.includes('ucf-row') && e.children[0]?.textContent === label)
    if (!r) throw new Error('no row ' + label)
    return {row: r, inputs: r.all().filter(e => e.tagName === 'input' || e.tagName === 'select')}
}

describe('UiConfigForm', () => {
    test('a slider shows its value in the range and in the number field', () => {
        const target = {size: 2.5}
        const form = new UiConfigForm([{type: 'slider', label: 'Size', property: [target, 'size'], bounds: [0, 4], stepSize: 0.1}])
        const [range, input] = row(form, 'Size').inputs
        expect(range.type).toBe('range')
        expect(range.value).toBe('2.5')
        expect(input.value).toBe('2.5')
    })

    test('a number change sets the binding, clamps it and calls onChange of the config, its folders and the form', () => {
        const target = {radius: 1}
        const own = vi.fn()
        const parent = vi.fn()
        const onChange = vi.fn()
        const field: UiObjectConfig = {type: 'number', label: 'Radius', property: [target, 'radius'], bounds: [0, 10], onChange: own}
        const form = new UiConfigForm([{type: 'folder', label: 'Shape', children: [field], onChange: parent}], {onChange})
        const [input] = row(form, 'Radius').inputs
        input.value = '25'
        input.fire('change')
        expect(target.radius).toBe(10)
        expect(own).toHaveBeenCalledTimes(1)
        expect(parent).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith(field)
        expect(input.value).toBe('10')
    })

    test('a folder\'s onChange can be a list of functions', () => {
        const target = {radius: 1}
        const parent = vi.fn()
        const form = new UiConfigForm([{type: 'folder', label: 'Shape', onChange: [parent], children: [
            {type: 'number', label: 'Radius', property: [target, 'radius']},
        ]}])
        const [input] = row(form, 'Radius').inputs
        input.value = '2'
        input.fire('change')
        expect(parent).toHaveBeenCalledTimes(1)
    })

    test('configs that a Tweakpane panel also draws: each onChange is called once, with the path of the change', () => {
        const target = {radius: 1}
        const outer = vi.fn()
        const parent = vi.fn()
        const field: UiObjectConfig = {type: 'number', label: 'Radius', property: [target, 'radius']}
        const folder: UiObjectConfig = {type: 'folder', label: 'Shape', children: [field], onChange: parent}
        const object: UiObjectConfig = {type: 'folder', label: 'Object', children: [folder], onChange: outer}
        // what the Tweakpane renderer sets on the children of a folder that it draws (tpFolderGenerator)
        for (const [p, ch] of [[object, folder], [folder, field]]) {
            ch.parentOnChange = (ev, ...args) => UiConfigMethods.DispatchOnChangeSync(p, {...ev}, ...args)
        }
        const form = new UiConfigForm([folder]) // the form draws the children of the object
        const [input] = row(form, 'Radius').inputs
        input.value = '2'
        input.fire('change')
        expect(parent).toHaveBeenCalledTimes(1)
        expect(parent.mock.calls[0][0]).toMatchObject({config: field, target: folder, configPath: [folder, field], last: true})
        expect(outer).toHaveBeenCalledTimes(1)
        expect(outer.mock.calls[0][0]).toMatchObject({config: field, target: object, configPath: [object, folder, field]})
    })

    test('a count takes whole numbers', () => {
        const target = {radialSegments: 8, width: 1, n: 1}
        const form = new UiConfigForm([
            {type: 'number', label: 'Radial Segments', property: [target, 'radialSegments']},
            {type: 'number', label: 'Width', property: [target, 'width']},
            {type: 'number', label: 'N', property: [target, 'n'], stepSize: 1},
        ])
        for (const [label, key] of [['Radial Segments', 'radialSegments'], ['Width', 'width'], ['N', 'n']] as const) {
            const [input] = row(form, label).inputs
            input.value = '3.4'
            input.fire('change')
            expect(target[key]).toBe(key === 'width' ? 3.4 : 3)
        }
        expect(isIntegerName('heightSegments')).toBe(true)
        expect(isIntegerName('radius')).toBe(false)
    })

    test('quick edits of one field are one undo step; another field is a new step', () => {
        const target = {a: 1, b: 1}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([
            {type: 'number', label: 'A', property: [target, 'a']},
            {type: 'number', label: 'B', property: [target, 'b']},
        ], {undoManager})
        const [a] = row(form, 'A').inputs
        const [b] = row(form, 'B').inputs
        for (const v of ['2', '3', '4']) {
            a.value = v
            a.fire('change')
        }
        b.value = '5'
        b.fire('change')
        undoManager.undo()
        expect(target).toEqual({a: 4, b: 1})
        undoManager.undo()
        expect(target).toEqual({a: 1, b: 1})
        expect(a.value).toBe('1') // the form reads the value again after the undo
        undoManager.redo()
        expect(target.a).toBe(4)
    })

    test('checkbox, dropdown, vector, color and text', () => {
        const target = {visible: true, side: 0, position: new Vector3(1, 2, 3), color: new Color('#ff0000'), name: 'Box'}
        const onStructureChange = vi.fn()
        const form = new UiConfigForm([
            {type: 'checkbox', label: 'Visible', property: [target, 'visible']},
            {type: 'dropdown', label: 'Side', property: [target, 'side'], children: [{label: 'Front', value: 0}, {label: 'Back', value: 1}]},
            {type: 'vec3', label: 'Position', property: [target, 'position']},
            {type: 'color', label: 'Color', property: [target, 'color']},
            {type: 'input', label: 'Name', property: [target, 'name']},
        ], {onStructureChange})

        const [check] = row(form, 'Visible').inputs
        expect(check.checked).toBe(true)
        check.checked = false
        check.fire('change')
        expect(target.visible).toBe(false)

        const [select] = row(form, 'Side').inputs
        expect(select.value).toBe('0')
        select.value = '1'
        select.fire('change')
        expect(target.side).toBe(1)
        expect(onStructureChange).toHaveBeenCalledTimes(1)

        const vec = row(form, 'Position').inputs
        expect(vec.map(i => i.value)).toEqual(['1', '2', '3'])
        const position = target.position
        vec[1].value = '7'
        vec[1].fire('change')
        expect(target.position).toBe(position) // set in place
        expect(position.toArray()).toEqual([1, 7, 3])

        const [color] = row(form, 'Color').inputs
        expect(color.value).toBe('#ff0000')
        color.value = '#00ff00'
        color.fire('input')
        expect(target.color.getHexString()).toBe('00ff00')

        const [text] = row(form, 'Name').inputs
        expect(text.value).toBe('Box')
        text.value = 'Ring'
        text.fire('change')
        expect(target.name).toBe('Ring')
    })

    test('a hidden config is not drawn; a config in the list twice is drawn once', () => {
        const target = {a: 1, b: 2}
        const a: UiObjectConfig = {type: 'number', label: 'A', property: [target, 'a']}
        const form = new UiConfigForm([a, a, {type: 'number', label: 'B', property: [target, 'b'], hidden: () => true}])
        const rows = (form.element as any as FakeElement).all().filter(e => e.className === 'ucf-row')
        expect(rows.map(r => r.children[0].textContent)).toEqual(['A'])
    })

    test('a button calls its function, then onChange and onStructureChange', async() => {
        const target = {reset: vi.fn()}
        const onChange = vi.fn()
        const onStructureChange = vi.fn()
        const form = new UiConfigForm([{type: 'button', label: 'Reset', property: [target, 'reset']}], {onChange, onStructureChange})
        const button = (form.element as any as FakeElement).all().find(e => e.tagName === 'button')!
        button.fire('click')
        await new Promise(r => setTimeout(r, 0))
        expect(target.reset).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onStructureChange).toHaveBeenCalledTimes(1)
    })

    test('scrub: a drag of the name changes the number; the next drag is a new undo step', () => {
        const target = {width: 1}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([{type: 'number', label: 'Width', property: [target, 'width']}], {undoManager})
        const name = row(form, 'Width').row.children[0]
        const drag = (dx: number) => {
            name.fire('pointerdown', {clientX: 0})
            name.fire('pointermove', {clientX: dx})
            name.fire('pointerup')
        }
        drag(100) // 0.01 per px from 1
        expect(target.width).toBeCloseTo(2)
        drag(100)
        expect(target.width).toBeCloseTo(2 + 0.02 * 100)
        undoManager.undo()
        expect(target.width).toBeCloseTo(2)
    })

    test('a slider, a colour and a scrub end with a final change (last: true)', () => {
        const target = {size: 1, color: new Color('#ff0000'), width: 1}
        const lasts: Record<string, boolean[]> = {size: [], color: [], width: []}
        const on = (k: string) => (e: any) => lasts[k].push(e.last)
        const form = new UiConfigForm([
            {type: 'slider', label: 'Size', property: [target, 'size'], bounds: [0, 4], onChange: on('size')},
            {type: 'color', label: 'Color', property: [target, 'color'], onChange: on('color')},
            {type: 'number', label: 'Width', property: [target, 'width'], onChange: on('width')},
        ])
        const [range] = row(form, 'Size').inputs
        range.value = '2'
        range.fire('input')
        range.value = '3'
        range.fire('input')
        range.fire('change') // released on the last value
        expect(lasts.size).toEqual([false, false, true])

        const [color] = row(form, 'Color').inputs
        color.value = '#00ff00'
        color.fire('input')
        color.fire('change') // the picker closes
        expect(lasts.color).toEqual([false, true])

        const name = row(form, 'Width').row.children[0]
        name.fire('pointerdown', {clientX: 0})
        name.fire('pointermove', {clientX: 50})
        name.fire('pointerup')
        expect(lasts.width).toEqual([false, true])
        name.fire('pointerdown', {clientX: 0}) // a click without a move: no change
        name.fire('pointerup')
        expect(lasts.width).toEqual([false, true])
    })

    test('the undo and redo of a dropdown call onStructureChange', () => {
        const target = {type: 'a'}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const onStructureChange = vi.fn()
        const form = new UiConfigForm([{type: 'dropdown', label: 'Type', property: [target, 'type'], children: [{label: 'A', value: 'a'}, {label: 'B', value: 'b'}]}], {undoManager, onStructureChange})
        const [select] = row(form, 'Type').inputs
        select.value = '1'
        select.fire('change')
        expect(onStructureChange).toHaveBeenCalledTimes(1)
        undoManager.undo()
        expect(target.type).toBe('a')
        expect(onStructureChange).toHaveBeenCalledTimes(2)
        undoManager.redo()
        expect(onStructureChange).toHaveBeenCalledTimes(3)
    })

    test('a committed number shows the clamped value, also while the field has the focus', () => {
        const target = {radius: 1}
        const form = new UiConfigForm([{type: 'number', label: 'Radius', property: [target, 'radius'], bounds: [0, 10]}])
        const [input] = row(form, 'Radius').inputs
        doc.activeElement = input
        try {
            input.value = '25'
            input.fire('change') // Enter or the spinner, the focus stays
            expect(target.radius).toBe(10)
            expect(input.value).toBe('10')
        } finally {
            doc.activeElement = null
        }
    })

    test('an input field takes the type of its value: boolean, number or text', () => {
        const target = {autoNearFar: true, near: 0.5, name: 'Box'}
        const form = new UiConfigForm([
            {type: 'input', label: 'Auto Near Far', property: [target, 'autoNearFar']},
            {type: 'input', label: 'Near', property: [target, 'near']},
            {type: 'input', label: 'Name', property: [target, 'name']},
        ])
        const [check] = row(form, 'Auto Near Far').inputs
        expect(check.type).toBe('checkbox')
        check.checked = false
        check.fire('change')
        expect(target.autoNearFar).toBe(false)
        const [near] = row(form, 'Near').inputs
        expect(near.type).toBe('number')
        near.value = '0.25'
        near.fire('change')
        expect(target.near).toBe(0.25)
        expect(row(form, 'Name').inputs[0].type).toBe('text')
    })

    test('a button runs the action it returns, as one undo step', async() => {
        const target = {x: 0}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([
            {type: 'button', label: 'Center', value: () => ({action: () => target.x = 5, undo: () => target.x = 0})},
            {type: 'button', label: 'Add', value: () => {
                target.x += 1
                return () => target.x -= 1 // an undo function: redo runs the button again
            }},
        ], {undoManager})
        const buttons = (form.element as any as FakeElement).all().filter(e => e.tagName === 'button')
        const click = async(b: FakeElement) => {
            b.fire('click')
            await new Promise(r => setTimeout(r, 0))
        }
        await click(buttons[0])
        expect(target.x).toBe(5)
        await click(buttons[1])
        expect(target.x).toBe(6)
        undoManager.undo()
        await new Promise(r => setTimeout(r, 0))
        expect(target.x).toBe(5)
        undoManager.undo()
        await new Promise(r => setTimeout(r, 0))
        expect(target.x).toBe(0)
        undoManager.redo()
        await new Promise(r => setTimeout(r, 0))
        expect(target.x).toBe(5)
    })

    test('disabled and readOnly callbacks apply again on refresh, also to the scrub', () => {
        const camera = {autoNearFar: true, near: 0.5}
        const form = new UiConfigForm([
            {type: 'checkbox', label: 'Auto Near Far', property: [camera, 'autoNearFar']},
            {type: 'number', label: 'Near', property: [camera, 'near'], readOnly: () => camera.autoNearFar},
        ])
        const [near] = row(form, 'Near').inputs
        const name = row(form, 'Near').row.children[0]
        expect(near.disabled).toBe(true)
        name.fire('pointerdown', {clientX: 0})
        name.fire('pointermove', {clientX: 50})
        name.fire('pointerup')
        expect(camera.near).toBe(0.5) // no scrub while read only
        const [check] = row(form, 'Auto Near Far').inputs
        check.checked = false
        check.fire('change') // the change refreshes the form
        expect(near.disabled).toBe(false)
        name.fire('pointerdown', {clientX: 0})
        name.fire('pointermove', {clientX: 50})
        name.fire('pointerup')
        expect(camera.near).not.toBe(0.5)
    })

    test('a refresh with no change writes nothing to the DOM', () => {
        const target = {n: 1, on: true, side: 0, color: new Color('#ff0000'), name: 'Box', size: 0.5, p: new Vector3(), tris: 12}
        const form = new UiConfigForm([
            {type: 'number', label: 'N', property: [target, 'n'], disabled: () => false},
            {type: 'checkbox', label: 'On', property: [target, 'on']},
            {type: 'dropdown', label: 'Side', property: [target, 'side'], children: [{label: 'Front', value: 0}, {label: 'Back', value: 1}]},
            {type: 'color', label: 'Color', property: [target, 'color']},
            {type: 'input', label: 'Name', property: [target, 'name']},
            {type: 'slider', label: 'Size', property: [target, 'size']},
            {type: 'vec3', label: 'P', property: [target, 'p']},
            {type: 'monitor', label: 'Tris', property: [target, 'tris']},
            {type: 'button', label: 'Go', onClick: () => {}},
        ])
        const writes: string[] = []
        for (const el of (form.element as any as FakeElement).all()) {
            for (const key of ['value', 'checked', 'disabled', 'textContent'] as const) {
                let v = el[key]
                Object.defineProperty(el, key, {get: () => v, set: (x) => {
                    writes.push(key)
                    v = x
                }})
            }
        }
        form.refresh()
        form.refresh(true)
        expect(writes).toEqual([])
        target.tris = 14
        form.refresh()
        expect(writes).toEqual(['textContent'])
    })

    test('the undo result of an onClick is one undo step', async() => {
        const target = {count: 0}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([{type: 'button', label: 'Add', onClick: () => {
            target.count++
            return {undo: () => target.count--, redo: () => target.count++}
        }}], {undoManager})
        const button = (form.element as any as FakeElement).all().find(e => e.tagName === 'button')!
        button.fire('click')
        await new Promise(r => setTimeout(r, 0))
        expect(target.count).toBe(1)
        undoManager.undo()
        await new Promise(r => setTimeout(r, 0))
        expect(target.count).toBe(0)
    })

    test('a button action: undo and redo read its current callbacks and call onStructureChange', async() => {
        const ids: number[] = []
        let next = 1
        const onStructureChange = vi.fn()
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        // like EntityComponentPlugin.addComponent: its undo replaces its redo, so a redo brings back the same id
        const add = () => {
            const id = next++
            ids.push(id)
            const action: any = {
                undo: () => {
                    ids.splice(ids.indexOf(id), 1)
                    action.redo = () => ids.push(id)
                },
                redo: () => ids.push(next++),
            }
            return action
        }
        const form = new UiConfigForm([{type: 'button', label: 'Add', onClick: add}], {undoManager, onStructureChange})
        const button = (form.element as any as FakeElement).all().find(e => e.tagName === 'button')!
        const wait = () => new Promise(r => setTimeout(r, 0))
        button.fire('click')
        await wait()
        expect(ids).toEqual([1])
        expect(onStructureChange).toHaveBeenCalledTimes(1)
        undoManager.undo()
        await wait()
        expect(ids).toEqual([])
        undoManager.redo()
        await wait()
        expect(ids).toEqual([1]) // the same id, from the redo that the undo set
        expect(onStructureChange).toHaveBeenCalledTimes(3)
    })

    test('a returned undo function: undo after a redo undoes the run of the redo', async() => {
        const objects: number[] = []
        let next = 1
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([{type: 'button', label: 'Add', value: () => {
            const id = next++
            objects.push(id)
            return () => {
                const i = objects.indexOf(id)
                if (i >= 0) objects.splice(i, 1)
            }
        }}], {undoManager})
        const button = (form.element as any as FakeElement).all().find(e => e.tagName === 'button')!
        const wait = () => new Promise(r => setTimeout(r, 0))
        button.fire('click')
        await wait()
        undoManager.undo()
        await wait()
        undoManager.redo() // adds object 2
        await wait()
        expect(objects).toEqual([2])
        undoManager.undo()
        await wait()
        expect(objects).toEqual([])
    })

    test('small numbers keep their digits; float noise is not shown', () => {
        const target = {bias: 0.00001, sum: 0.1 + 0.2}
        const form = new UiConfigForm([
            {type: 'number', label: 'Bias', property: [target, 'bias'], stepSize: 0.00001},
            {type: 'number', label: 'Sum', property: [target, 'sum']},
        ])
        expect(row(form, 'Bias').inputs[0].value).toBe('0.00001')
        expect(row(form, 'Sum').inputs[0].value).toBe('0.3')
    })

    test('a vector bound to a tuple of numbers; vector bounds apply to each component', () => {
        const target = {clip: [1, 2, 3, 4], noise: new Vector3(0.5, 0.5, 0.5)}
        const form = new UiConfigForm([
            {type: 'vec4', label: 'Clip', property: [target, 'clip']},
            {type: 'vec3', label: 'Noise', property: [target, 'noise'], bounds: [0, 1]},
        ])
        const clip = row(form, 'Clip').inputs
        expect(clip.map(i => i.value)).toEqual(['1', '2', '3', '4'])
        clip[2].value = '7'
        clip[2].fire('change')
        expect(target.clip).toEqual([1, 2, 7, 4])
        const noise = row(form, 'Noise').inputs
        noise[0].value = '5'
        noise[0].fire('change')
        noise[1].value = '-1'
        noise[1].fire('change')
        expect(target.noise.toArray()).toEqual([1, 0, 0.5])
    })

    test('undo and redo show the value also in the field that has the focus', () => {
        const target = {radius: 1}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([{type: 'number', label: 'Radius', property: [target, 'radius']}], {undoManager})
        const [input] = row(form, 'Radius').inputs
        doc.activeElement = input
        try {
            input.value = '3'
            input.fire('change') // the spinner: the focus stays
            undoManager.undo()
            expect(target.radius).toBe(1)
            expect(input.value).toBe('1')
            undoManager.redo()
            expect(input.value).toBe('3')
            input.value = '3.5' // typing, not committed: a refresh from elsewhere keeps it
            form.refresh()
            expect(input.value).toBe('3.5')
        } finally {
            doc.activeElement = null
        }
    })

    test('after a rebuild, undo and redo of an older edit show in the form made in its place', () => {
        const target = {type: 'a', radius: 1}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const configs: UiObjectConfig[] = [
            {type: 'dropdown', label: 'Type', property: [target, 'type'], children: [{label: 'A', value: 'a'}, {label: 'B', value: 'b'}]},
            {type: 'number', label: 'Radius', property: [target, 'radius']},
        ]
        // the page makes the form again on a structure change
        let form: UiConfigForm | undefined
        const make = () => {
            form?.dispose()
            form = new UiConfigForm(configs, {undoManager, onStructureChange: make})
        }
        make()
        const radius = () => row(form!, 'Radius').inputs[0]
        radius().value = '2'
        radius().fire('change')
        const select = row(form!, 'Type').inputs[0]
        select.value = '1'
        select.fire('change') // the form is made again
        undoManager.undo() // the dropdown: made again
        expect(target.type).toBe('a')
        undoManager.undo() // the radius, an edit of the first form
        expect(target.radius).toBe(1)
        expect(radius().value).toBe('1')
        undoManager.redo()
        expect(radius().value).toBe('2')
    })

    test('a slider drag with a pause is one undo step; a later drag is another', () => {
        const target = {size: 1}
        const undoManager = new JSUndoManager({limit: 100, debug: false, bindHotKeys: false})
        const form = new UiConfigForm([{type: 'slider', label: 'Size', property: [target, 'size'], bounds: [0, 4]}], {undoManager})
        const [range] = row(form, 'Size').inputs
        let time = 1000
        const now = vi.spyOn(performance, 'now').mockImplementation(() => time)
        try {
            const move = (v: string) => {
                range.value = v
                range.fire('input')
            }
            move('2')
            time += 1500 // a pause in the drag
            move('3')
            range.fire('change') // released
            time += 1500
            move('4') // a new drag
            range.fire('change')
            undoManager.undo()
            expect(target.size).toBe(3)
            undoManager.undo()
            expect(target.size).toBe(1)
        } finally {
            now.mockRestore()
        }
    })

    test('a scrub shows the value in the number field also when the field has the focus', () => {
        const target = {width: 1}
        const form = new UiConfigForm([{type: 'number', label: 'Width', property: [target, 'width']}])
        const {row: r, inputs: [input]} = row(form, 'Width')
        const name = r.children[0]
        doc.activeElement = input // the scrub prevents the default of the pointer down: the focus stays
        try {
            name.fire('pointerdown', {clientX: 0})
            name.fire('pointermove', {clientX: 50})
            expect(input.value).toBe(String(target.width))
            name.fire('pointermove', {clientX: 100})
            name.fire('pointerup')
            expect(target.width).toBeCloseTo(2)
            expect(input.value).toBe(String(target.width))
        } finally {
            doc.activeElement = null
        }
    })

    test('a drag with another button than the main one is not a scrub', () => {
        const target = {width: 1}
        const form = new UiConfigForm([{type: 'number', label: 'Width', property: [target, 'width']}])
        const name = row(form, 'Width').row.children[0]
        name.fire('pointerdown', {clientX: 0, button: 2}) // the right button: the page can show its menu
        name.fire('pointermove', {clientX: 50})
        name.fire('pointerup')
        expect(target.width).toBe(1)
    })

    test('a scrub moves by the stepSize per pixel, else by at most 1% of the bounds', () => {
        const target = {bias: 0, small: 0}
        const form = new UiConfigForm([
            {type: 'number', label: 'Bias', property: [target, 'bias'], bounds: [-0.001, 0.001], stepSize: 0.00001},
            {type: 'number', label: 'Small', property: [target, 'small'], bounds: [0, 0.1]},
        ])
        const scrub = (label: string, dx: number) => {
            const name = row(form, label).row.children[0]
            name.fire('pointerdown', {clientX: 0})
            name.fire('pointermove', {clientX: dx})
            name.fire('pointerup')
        }
        scrub('Bias', 3)
        expect(target.bias).toBeCloseTo(0.00003, 10)
        scrub('Small', 5)
        expect(target.small).toBeCloseTo(0.005, 10)
    })

    test('the arrow keys and the spinner of a number field step by the stepSize; without one, any value', () => {
        const target = {bias: 0, size: 0.5, n: 0, offset: new Vector3()}
        const form = new UiConfigForm([
            {type: 'number', label: 'Bias', property: [target, 'bias'], bounds: [-0.001, 0.001], stepSize: 0.00001},
            {type: 'slider', label: 'Size', property: [target, 'size'], bounds: [0, 1], stepSize: () => 0.05},
            {type: 'number', label: 'N', property: [target, 'n']},
            {type: 'vec3', label: 'Offset', property: [target, 'offset'], stepSize: 0.1},
        ])
        expect(row(form, 'Bias').inputs[0].step).toBe('0.00001')
        expect(row(form, 'Size').inputs.map(i => i.step)).toEqual(['0.05', '0.05'])
        expect(row(form, 'N').inputs[0].step).toBe('any')
        expect(row(form, 'Offset').inputs.map(i => i.step)).toEqual(['0.1', '0.1', '0.1'])
        // a typed value off the step is kept
        const bias = row(form, 'Bias').inputs[0]
        bias.value = '0.000015'
        bias.fire('change')
        expect(target.bias).toBe(0.000015)
    })

    test('dispose removes the form', () => {
        const host = new FakeElement('div')
        const form = new UiConfigForm([])
        host.appendChild(form.element as any)
        form.dispose()
        expect(host.children).toEqual([])
    })
})

/** The element below the form with a class, and a text (the label) when given */
function find(form: UiConfigForm, cls: string, label?: string) {
    const root = form.element as any as FakeElement
    const el = root.all().find(e => e.className.split(' ').includes(cls) &&
        (label === undefined || e.textContent === label || e.children.some(c => c.className === 'ucf-label' && c.textContent === label)))
    if (!el) throw new Error(`no .${cls} ${label ?? ''}`)
    return el
}

describe('UiConfigForm bar and stack layouts', () => {
    test('a bar is a toolbar; a button with an icon has the icon and the label, one without an icon the label as text', () => {
        const form = new UiConfigForm([
            {type: 'button', label: 'Snapshot', icon: 'camera', value: () => {}},
            {type: 'button', label: 'Plain', value: () => {}},
        ], {layout: 'bar'})
        const root = form.element as any as FakeElement
        expect(root.className).toBe('ucf ucf-bar')
        expect(root.getAttribute('role')).toBe('toolbar')
        const snap = find(form, 'ucf-button', 'Snapshot')
        expect(snap.className).toContain('ucf-has-icon')
        expect(snap.children.map(c => c.className)).toEqual(['ucf-icon', 'ucf-label'])
        expect(snap.children[0].innerHTML).toMatch(/^<svg[^>]*viewBox="0 0 24 24".*aria-hidden="true"/)
        // the accessible name is the label also when only the icon shows
        expect(snap.getAttribute('aria-label')).toBe('Snapshot')
        expect(find(form, 'ucf-button', 'Plain').children).toEqual([])
    })

    test('an icon: SVG markup is drawn inline, a URL as an image, an unknown name draws nothing', () => {
        const form = new UiConfigForm([
            {type: 'button', label: 'A', icon: '<svg viewBox="0 0 1 1"></svg>', value: () => {}},
            {type: 'button', label: 'B', icon: 'https://example.com/i.png', value: () => {}},
            {type: 'button', label: 'C', icon: 'no-such-icon', value: () => {}},
        ], {layout: 'bar'})
        expect(find(form, 'ucf-button', 'A').children[0].innerHTML).toBe('<svg viewBox="0 0 1 1"></svg>')
        const img = find(form, 'ucf-button', 'B').children[0].children[0]
        expect(img.tagName).toBe('img')
        expect((img as any).src).toBe('https://example.com/i.png')
        // an unknown name is no icon: the label shows, without the icon layout (a phone bar would show a blank button)
        const c = find(form, 'ucf-button', 'C')
        expect(c.children).toEqual([])
        expect(c.className).not.toContain('ucf-has-icon')
    })

    test('markup that does not start with <svg (an XML prolog, a comment) is drawn inline, not as an image', () => {
        const form = new UiConfigForm([
            {type: 'button', label: 'X', icon: '<?xml version="1.0"?><svg viewBox="0 0 1 1"></svg>', value: () => {}},
            {type: 'button', label: 'Y', icon: '<!-- icon --><svg viewBox="0 0 1 1"></svg>', value: () => {}},
        ], {layout: 'bar'})
        for (const l of ['X', 'Y']) {
            const icon = find(form, 'ucf-button', l).children[0]
            expect(icon.innerHTML).toContain('<svg')
            expect(icon.children).toEqual([])
        }
    })

    test('a synchronous button is never disabled (it keeps the focus); a failed run sends no change events', async() => {
        const sets: boolean[] = []
        const onChange = vi.fn()
        const onStructureChange = vi.fn()
        const fail: UiObjectConfig = {type: 'button', label: 'Fail', onChange, value: async() => {
            throw new Error('nope')
        }}
        const form = new UiConfigForm([
            {type: 'button', label: 'Sync', value: () => {}},
            fail,
        ], {layout: 'bar', onStructureChange, onError: () => {}})
        const b = find(form, 'ucf-button', 'Sync')
        let disabled = false
        Object.defineProperty(b, 'disabled', {get: () => disabled, set: (v: boolean) => {
            sets.push(v)
            disabled = v
        }})
        b.fire('click')
        await new Promise(r => setTimeout(r, 0))
        expect(sets).not.toContain(true)
        expect(onStructureChange).toHaveBeenCalledTimes(1) // the sync button ran fine
        find(form, 'ucf-button', 'Fail').fire('click')
        await new Promise(r => setTimeout(r, 0))
        expect(onChange).not.toHaveBeenCalled()
        expect(onStructureChange).toHaveBeenCalledTimes(1)
    })

    test('a monitor shows whole numbers as they are, fractions short, and a three.js colour as its hex code', () => {
        const s = {big: 1234567, frac: 0.123456, mid: 1234.567, color: new Color('#ff8800')}
        const form = new UiConfigForm([
            {type: 'monitor', label: 'Big', property: [s, 'big']},
            {type: 'monitor', label: 'Frac', property: [s, 'frac']},
            {type: 'monitor', label: 'Mid', property: [s, 'mid']},
            {type: 'monitor', label: 'Color', property: [s, 'color']},
        ], {layout: 'stack'})
        const v = (l: string) => find(form, 'ucf-readout', l).children.find(c => c.className === 'ucf-value')!.textContent
        expect(v('Big')).toBe('1234567')
        expect(v('Frac')).toBe('0.1235')
        expect(v('Mid')).toBe('1235')
        expect(v('Color')).toBe('#ff8800')
    })

    test('an icon that is a function is drawn again on refresh when it changes', () => {
        const state = {playing: false}
        const form = new UiConfigForm([
            {type: 'button', label: 'Play', icon: () => state.playing ? 'pause' : 'play', value: () => {}},
        ], {layout: 'bar'})
        const icon = find(form, 'ucf-icon')
        const before = icon.innerHTML
        state.playing = true
        form.refresh()
        expect(icon.innerHTML).not.toBe(before)
        expect(icon.innerHTML).toContain('<svg')
    })

    test('a label that is a function is drawn again on refresh, also the accessible name', () => {
        const state = {running: false}
        const form = new UiConfigForm([
            {type: 'button', label: () => state.running ? 'Pause' : 'Play', icon: () => state.running ? 'pause' : 'play', value: () => {}},
            {type: 'button', label: () => state.running ? 'Stop' : 'Go', value: () => {}},
        ], {layout: 'bar'})
        const b = find(form, 'ucf-button', 'Play')
        const plain = find(form, 'ucf-button', 'Go')
        state.running = true
        form.refresh()
        expect(b.children[1].textContent).toBe('Pause')
        expect(b.getAttribute('aria-label')).toBe('Pause')
        expect(plain.textContent).toBe('Stop')
    })

    test('a field button without an icon keeps its value when its label changes', () => {
        const state = {r: 0.5, unit: 'm'}
        const form = new UiConfigForm([{type: 'number', label: () => 'Size ' + state.unit, property: [state, 'r']}], {layout: 'bar'})
        const b = find(form, 'ucf-more', 'Size m')
        state.unit = 'cm'
        form.refresh()
        expect(b.children.map(c => [c.className, c.textContent])).toEqual([['ucf-label', 'Size cm'], ['ucf-value', '0.5']])
        expect(b.getAttribute('aria-label')).toBe('Size cm')
    })

    test('an icon that is a function can come and go: the icon element and ucf-has-icon follow it', () => {
        const state = {icon: ''}
        const form = new UiConfigForm([{type: 'button', label: 'Go', icon: () => state.icon, value: () => {}}], {layout: 'bar'})
        const b = find(form, 'ucf-button', 'Go')
        expect(b.children.map(c => c.className)).toEqual(['ucf-label'])
        expect(b.className).not.toContain('ucf-has-icon')
        state.icon = 'play'
        form.refresh()
        expect(b.children.map(c => c.className)).toEqual(['ucf-icon', 'ucf-label'])
        expect(b.className).toContain('ucf-has-icon')
        expect(b.children[0].innerHTML).toContain('<svg')
        state.icon = ''
        form.refresh()
        expect(b.children.map(c => c.className)).toEqual(['ucf-label'])
        expect(b.className).not.toContain('ucf-has-icon')
        expect(b.getAttribute('aria-label')).toBe('Go')
    })

    test('a checkbox in a bar is a toggle button: a click flips the binding, aria-pressed follows, also after a change elsewhere', () => {
        const target = {autoRotate: false}
        const onChange = vi.fn()
        const form = new UiConfigForm([
            {type: 'checkbox', label: 'Auto rotate', icon: 'rotate-3d', property: [target, 'autoRotate'], onChange},
        ], {layout: 'bar'})
        const b = find(form, 'ucf-toggle', 'Auto rotate')
        expect(b.tagName).toBe('button')
        expect(b.getAttribute('aria-pressed')).toBe('false')
        b.fire('click')
        expect(target.autoRotate).toBe(true)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(b.getAttribute('aria-pressed')).toBe('true')
        target.autoRotate = false
        form.refresh()
        expect(b.getAttribute('aria-pressed')).toBe('false')
    })

    test('an async button is disabled and busy until its promise settles; a rejection goes to onError and enables it again', async() => {
        let resolve!: () => void
        const onError = vi.fn()
        const fail: UiObjectConfig = {type: 'button', label: 'Fail', value: async() => {
            throw new Error('nope')
        }}
        const form = new UiConfigForm([
            {type: 'button', label: 'Export', value: () => new Promise<void>(r => resolve = r)},
            fail,
        ], {layout: 'bar', onError})
        const b = find(form, 'ucf-button', 'Export')
        b.fire('click')
        await Promise.resolve()
        expect(b.disabled).toBe(true)
        expect(b.className).toContain('ucf-busy')
        // a refresh while it runs keeps it disabled
        form.refresh()
        expect(b.disabled).toBe(true)
        resolve()
        await new Promise(r => setTimeout(r, 0))
        expect(b.disabled).toBe(false)
        expect(b.className).not.toContain('ucf-busy')

        const f = find(form, 'ucf-button', 'Fail')
        f.fire('click')
        await new Promise(r => setTimeout(r, 0))
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
        expect(onError.mock.calls[0][1]).toBe(fail)
        expect(f.disabled).toBe(false)
    })

    test('the form layout: a button that throws also goes to onError (no unhandled rejection)', async() => {
        const onError = vi.fn()
        const form = new UiConfigForm([{type: 'button', label: 'Fail', value: () => {
            throw new Error('nope')
        }}], {onError})
        const b = find(form, 'ucf-button', 'Fail')
        b.fire('click')
        await new Promise(r => setTimeout(r, 0))
        expect(onError).toHaveBeenCalledTimes(1)
        expect(b.disabled).toBe(false)
    })

    test('a folder in a bar is a group with its label as the accessible name', () => {
        const form = new UiConfigForm([{type: 'folder', label: 'Views', children: [
            {type: 'button', label: 'Top', value: () => {}},
            {type: 'button', label: 'Left', value: () => {}},
        ]}], {layout: 'bar'})
        const g = find(form, 'ucf-group')
        expect(g.getAttribute('role')).toBe('group')
        expect(g.getAttribute('aria-label')).toBe('Views')
        expect(g.children.map(c => c.textContent)).toEqual(['Top', 'Left'])
    })

    test('a dropdown in a bar is a select with the label as its name; a change sets the binding', () => {
        const target = {side: 0}
        const form = new UiConfigForm([{type: 'dropdown', label: 'Side', icon: 'layers', property: [target, 'side'], children: [
            {label: 'Front', value: 0}, {label: 'Back', value: 1},
        ]}], {layout: 'bar'})
        const chip = find(form, 'ucf-chip', 'Side')
        const sel = chip.all().find(e => e.tagName === 'select')!
        expect(sel.getAttribute('aria-label')).toBe('Side')
        expect(sel.value).toBe('0')
        sel.value = '1'
        sel.fire('change')
        expect(target.side).toBe(1)
    })

    test('a dropdown without an icon keeps its select when its label changes', () => {
        const state = {side: 0, n: 1}
        const form = new UiConfigForm([{type: 'dropdown', label: () => 'Side ' + state.n, property: [state, 'side'], children: [
            {label: 'Front', value: 0}, {label: 'Back', value: 1},
        ]}], {layout: 'bar'})
        const chip = find(form, 'ucf-chip', 'Side 1')
        state.n = 2
        form.refresh()
        expect(chip.children.map(c => c.tagName)).toEqual(['span', 'select'])
        expect(chip.children[0].textContent).toBe('Side 2')
        const sel = chip.children[1]
        sel.value = '1'
        sel.fire('change')
        expect(state.side).toBe(1)
    })

    test('a slider in a bar is a button with its value; the field is drawn for the popover', () => {
        const target = {roughness: 0.25}
        const form = new UiConfigForm([{type: 'slider', label: 'Roughness', property: [target, 'roughness'], bounds: [0, 1]}], {layout: 'bar'})
        const b = find(form, 'ucf-more', 'Roughness')
        expect(b.getAttribute('aria-expanded')).toBe('false')
        const value = b.children.find(c => c.className === 'ucf-value')!
        expect(value.textContent).toBe('0.25')
        target.roughness = 0.5
        form.refresh()
        expect(value.textContent).toBe('0.5')
    })

    test('a given label stays as it is; a label from the key of the property gets spaces', () => {
        const target = {roughnessMap: 1}
        const form = new UiConfigForm([
            {type: 'button', label: 'camera.fitObject', value: () => {}},
            {type: 'number', property: [target, 'roughnessMap']},
        ], {layout: 'bar'})
        expect(find(form, 'ucf-button', 'camera.fitObject')).toBeTruthy()
        expect(find(form, 'ucf-more', 'roughness Map')).toBeTruthy()
    })

    test('a colour in a bar shows its hex code and a swatch: a three.js colour or a number', () => {
        const target = {c: new Color('#ff8800'), n: 0x00ff00}
        const form = new UiConfigForm([
            {type: 'color', label: 'C', property: [target, 'c']},
            {type: 'color', label: 'N', property: [target, 'n']},
        ], {layout: 'bar'})
        for (const [label, hex] of [['C', '#ff8800'], ['N', '#00ff00']]) {
            const value = find(form, 'ucf-more', label).children.find(c => c.className.includes('ucf-value'))!
            expect(value.textContent).toBe(hex)
            expect(value.className).toContain('ucf-swatch')
            expect(value.style['--ucf-swatch']).toBe(hex)
        }
    })

    test('a button shows the key of shortcutOf at the end of its row, and follows a change', () => {
        let key = 'S'
        const snap: UiObjectConfig = {type: 'button', label: 'Snapshot', icon: 'camera', value: () => {}}
        const form = new UiConfigForm([snap, {type: 'button', label: 'Other', value: () => {}}], {
            layout: 'stack', shortcutOf: c => c === snap ? key : undefined,
        })
        const b = find(form, 'ucf-button', 'Snapshot')
        expect(b.children.map(c => c.className)).toEqual(['ucf-icon', 'ucf-label', 'ucf-key'])
        expect(b.children[2].textContent).toBe('S')
        expect(b.children[2].getAttribute('aria-hidden')).toBe('true')
        expect(find(form, 'ucf-button', 'Other').children.map(c => c.className)).toEqual(['ucf-label'])
        key = 'Shift+S'
        form.refresh()
        expect(b.children[2].textContent).toBe('Shift+S')
        key = ''
        form.refresh()
        expect(b.children.map(c => c.className)).toEqual(['ucf-icon', 'ucf-label'])
    })

    test('a monitor in a stack is a read-only row with the value, updated on refresh', () => {
        const stats = {triangles: 1200}
        const form = new UiConfigForm([{type: 'monitor', label: 'Triangles', property: [stats, 'triangles']}], {layout: 'stack'})
        const r = find(form, 'ucf-readout', 'Triangles')
        expect(r.tagName).toBe('div')
        const value = r.children.find(c => c.className === 'ucf-value')!
        expect(value.textContent).toBe('1200')
        stats.triangles = 46000
        form.refresh()
        expect(value.textContent).toBe('46000')
    })

    test('in a stack, a hidden config is drawn and shown or hidden on refresh as hidden changes', () => {
        const state = {mode: 'normal', uv: 0}
        const form = new UiConfigForm([
            {type: 'button', label: 'Always', value: () => {}},
            {type: 'number', label: 'UV Set', property: [state, 'uv'], hidden: () => state.mode !== 'uv'},
            {type: 'folder', label: 'Extra', hidden: () => state.mode !== 'uv', children: [{type: 'button', label: 'In extra', value: () => {}}]},
        ], {layout: 'stack'})
        const uv = find(form, 'ucf-more', 'UV Set')
        const extra = find(form, 'ucf-group')
        expect(uv.style.display).toBe('none')
        expect(extra.style.display).toBe('none')
        expect(find(form, 'ucf-button', 'Always').style.display).toBe('')
        state.mode = 'uv'
        form.refresh()
        expect(uv.style.display).toBe('')
        expect(extra.style.display).toBe('')
        state.mode = 'normal'
        form.refresh()
        expect(uv.style.display).toBe('none')
    })

    test('layout: a class that the page added stays when the layout changes (also through form)', () => {
        const form = new UiConfigForm([{type: 'button', label: 'A', value: () => {}}], {layout: 'bar'})
        const el = form.element as any as FakeElement
        el.classList.add('my-toolbar')
        form.layout = 'stack'
        expect(el.className.split(' ').sort()).toEqual(['my-toolbar', 'ucf', 'ucf-stack'])
        form.layout = 'form'
        expect(el.className.split(' ').sort()).toEqual(['my-toolbar', 'ucf'])
        form.layout = 'bar'
        expect(el.className.split(' ').sort()).toEqual(['my-toolbar', 'ucf', 'ucf-bar'])
    })

    test('layout: bar to stack keeps the elements; to form draws rows', () => {
        const target = {on: true}
        const form = new UiConfigForm([{type: 'checkbox', label: 'On', property: [target, 'on']}], {layout: 'bar'})
        const b = find(form, 'ucf-toggle', 'On')
        form.layout = 'stack'
        expect((form.element as any).className).toBe('ucf ucf-stack')
        expect(find(form, 'ucf-toggle', 'On')).toBe(b)
        form.layout = 'form'
        expect((form.element as any).className).toBe('ucf')
        expect((form.element as any).getAttribute('role')).toBe(null)
        expect(row(form, 'On').inputs[0].type).toBe('checkbox')
        expect(() => find(form, 'ucf-toggle')).toThrow()
    })
})
