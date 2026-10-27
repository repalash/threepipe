import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest'
import {Color, Vector3} from 'three'
import {JSUndoManager, UiObjectConfig} from 'threepipe'
import {isIntegerName, UiConfigForm} from '../../plugins/tweakpane-editor/src/ui/UiConfigForm'

// the node setup has no DOM: a small element with what the form uses
class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    style: Record<string, string> = {}
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
    classList = {add: (...c: string[]) => this.className = [...this.className.split(' ').filter(Boolean), ...c].join(' ')}
    constructor(readonly tagName: string) {}
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
        for (const f of this._listeners.get(type) ?? []) f({preventDefault: () => {}, pointerId: 1, clientX: 0, ...e})
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
    doc.createElement = (tag: string) => new FakeElement(tag)
    doc.activeElement = null
})
afterAll(() => {
    doc.createElement = createElement
    UiConfigForm.InjectStyles = true
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

    test('dispose removes the form', () => {
        const host = new FakeElement('div')
        const form = new UiConfigForm([])
        host.appendChild(form.element as any)
        form.dispose()
        expect(host.children).toEqual([])
    })
})
