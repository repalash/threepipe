import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {
    formatShortcut,
    isTextTarget,
    matchShortcut,
    parseShortcut,
    ViewerAction,
    ViewerActions,
} from 'threepipe'

// a key press, with the fields that the shortcuts read
function keyEvent(key: string, code: string, fields: Record<string, any> = {}) {
    return Object.assign(new Event('keydown', {cancelable: true}), {key, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...fields}) as KeyboardEvent
}

// a key press on the window
function press(key: string, code: string, fields: Record<string, any> = {}) {
    const e = keyEvent(key, code, fields)
    window.dispatchEvent(e)
    return e
}

// a key press in an element: the event target
function pressIn(target: any, key: string, code: string, fields: Record<string, any> = {}) {
    const e = keyEvent(key, code, fields)
    Object.defineProperty(e, 'target', {value: target})
    window.dispatchEvent(e)
    return e
}

/** A viewer with what the actions read: the dialog (toasts), the container and the canvas (set by a test) */
function fakeViewer() {
    return {dialog: {toast: vi.fn()}} as any
}

function action(id: string, fields: Partial<ViewerAction> = {}): ViewerAction & {run: ReturnType<typeof vi.fn>} {
    return {id, label: id, run: vi.fn(), ...fields} as any
}

// the window of the node setup is globalThis, without events: a new event target for each test
beforeEach(() => {
    const win = new EventTarget()
    Object.assign(globalThis, {
        addEventListener: win.addEventListener.bind(win),
        removeEventListener: win.removeEventListener.bind(win),
        dispatchEvent: win.dispatchEvent.bind(win),
    })
})
afterEach(() => {
    vi.restoreAllMocks()
})

describe('parseShortcut', () => {
    test('modifiers and a key, joined with +', () => {
        expect(parseShortcut('Mod+Z')).toEqual({key: 'Z', mod: true, shift: false, alt: false})
        expect(parseShortcut('Shift+D')).toEqual({key: 'D', mod: false, shift: true, alt: false})
        expect(parseShortcut('Delete')).toEqual({key: 'Delete', mod: false, shift: false, alt: false})
        expect(parseShortcut('alt+shift+mod+KeyC')).toEqual({key: 'KeyC', mod: true, shift: true, alt: true})
    })

    test('the + key', () => {
        expect(parseShortcut('Mod++')).toEqual({key: '+', mod: true, shift: false, alt: false})
        expect(parseShortcut('+')).toEqual({key: '+', mod: false, shift: false, alt: false})
    })

    test('no key, or another modifier, is not a shortcut', () => {
        for (const s of ['', 'Mod+', 'Ctrl+Z', 'Cmd+Z', 'Meta+Z', 'Shift+Foo+Z']) expect(parseShortcut(s)).toBeUndefined()
    })
})

describe('matchShortcut', () => {
    test('Mod is Cmd on a Mac and Ctrl on other platforms; the other one matches no shortcut; the modifiers are exact', () => {
        expect(matchShortcut(keyEvent('z', 'KeyZ', {ctrlKey: true}), 'Mod+Z', false)).toBe(true)
        expect(matchShortcut(keyEvent('z', 'KeyZ', {metaKey: true}), 'Mod+Z', false)).toBe(false)
        expect(matchShortcut(keyEvent('z', 'KeyZ', {metaKey: true}), 'Mod+Z', true)).toBe(true)
        expect(matchShortcut(keyEvent('z', 'KeyZ', {ctrlKey: true}), 'Mod+Z', true)).toBe(false)
        // Ctrl on a Mac (the Win key elsewhere) is not a modifier of a shortcut: no match without Mod either
        expect(matchShortcut(keyEvent('d', 'KeyD', {ctrlKey: true}), 'D', true)).toBe(false)
        expect(matchShortcut(keyEvent('d', 'KeyD', {metaKey: true}), 'D', false)).toBe(false)
        expect(matchShortcut(keyEvent('z', 'KeyZ'), 'Mod+Z', false)).toBe(false)
        expect(matchShortcut(keyEvent('Z', 'KeyZ', {ctrlKey: true, shiftKey: true}), 'Mod+Z', false)).toBe(false)
        expect(matchShortcut(keyEvent('Z', 'KeyZ', {metaKey: true, shiftKey: true}), 'Mod+Shift+Z', true)).toBe(true)
        expect(matchShortcut(keyEvent('z', 'KeyZ', {altKey: true, ctrlKey: true}), 'Mod+Z', false)).toBe(false)
    })

    test('Shift and Alt', () => {
        expect(matchShortcut(keyEvent('D', 'KeyD', {shiftKey: true}), 'Shift+D')).toBe(true)
        expect(matchShortcut(keyEvent('d', 'KeyD'), 'Shift+D')).toBe(false)
        expect(matchShortcut(keyEvent('D', 'KeyD', {shiftKey: true, ctrlKey: true}), 'Shift+D')).toBe(false)
        // a Mac: Alt changes the character, the place of the key stays
        expect(matchShortcut(keyEvent('†', 'KeyT', {altKey: true}), 'Alt+T')).toBe(true)
        expect(matchShortcut(keyEvent('t', 'KeyT'), 'Alt+T')).toBe(false)
        // a sign that needs Shift names Shift
        expect(matchShortcut(keyEvent('?', 'Slash', {shiftKey: true}), 'Shift+/')).toBe(true)
    })

    test('Delete, Escape and other named keys', () => {
        expect(matchShortcut(keyEvent('Delete', 'Delete'), 'Delete')).toBe(true)
        expect(matchShortcut(keyEvent('Backspace', 'Backspace'), 'Delete')).toBe(false)
        expect(matchShortcut(keyEvent('Escape', 'Escape'), 'Escape')).toBe(true)
        expect(matchShortcut(keyEvent('Escape', 'Escape', {shiftKey: true}), 'Escape')).toBe(false)
        expect(matchShortcut(keyEvent(' ', 'Space'), 'Space')).toBe(true)
    })

    test('a key name matches the character or its place on the keyboard; a code matches only the place', () => {
        // another alphabet: the character is not z, the place is
        expect(matchShortcut(keyEvent('я', 'KeyZ', {ctrlKey: true}), 'Mod+Z')).toBe(true)
        // another layout: the character is z at another place
        expect(matchShortcut(keyEvent('z', 'KeyY', {ctrlKey: true}), 'Mod+Z')).toBe(true)
        expect(matchShortcut(keyEvent('c', 'KeyV'), 'KeyC')).toBe(false)
        expect(matchShortcut(keyEvent('x', 'KeyC'), 'KeyC')).toBe(true)
        expect(matchShortcut(keyEvent('\\', 'IntlBackslash', {ctrlKey: true}), 'Mod+\\')).toBe(true)
        expect(matchShortcut(keyEvent('#', 'Backslash', {metaKey: true}), 'Mod+\\', true)).toBe(true)
        expect(matchShortcut(keyEvent('1', 'Digit1'), '1')).toBe(true)
        // a letter by its place only when the key types no Latin letter: on QWERTZ the Z key (code KeyY) is Z, not Y
        expect(matchShortcut(keyEvent('z', 'KeyY'), 'Y')).toBe(false)
        expect(matchShortcut(keyEvent('z', 'KeyY'), 'Z')).toBe(true)
        expect(matchShortcut(keyEvent('†', 'KeyT', {altKey: true}), 'Alt+T')).toBe(true)
        // an event without a code (made by a script) matches by its key only: Escape is not ArrowLeft
        expect(matchShortcut(keyEvent('Escape', undefined as any), 'ArrowLeft')).toBe(false)
        expect(matchShortcut(keyEvent('Escape', ''), 'ArrowLeft')).toBe(false)
        expect(matchShortcut(keyEvent('Escape', undefined as any), 'Escape')).toBe(true)
        expect(matchShortcut(keyEvent('!', 'Digit1', {shiftKey: true}), 'Shift+1')).toBe(true)
    })

    test('a shortcut that does not parse matches no key', () => {
        expect(matchShortcut(keyEvent('z', 'KeyZ', {ctrlKey: true}), 'Ctrl+Z')).toBe(false)
    })
})

describe('formatShortcut', () => {
    test('Mac symbols, or names joined with + on other platforms', () => {
        expect(formatShortcut('Mod+Shift+Z', true)).toBe('⇧⌘Z')
        expect(formatShortcut('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z')
        expect(formatShortcut('Alt+Shift+t', true)).toBe('⌥⇧T')
        expect(formatShortcut('Mod+Alt+T', false)).toBe('Ctrl+Alt+T')
        expect(formatShortcut('Delete', false)).toBe('Delete')
        expect(formatShortcut('Escape', true)).toBe('Esc')
        expect(formatShortcut('Mod++', false)).toBe('Ctrl++')
    })

    test('a code shows as its key', () => {
        expect(formatShortcut('KeyC', false)).toBe('C')
        expect(formatShortcut('Shift+KeyT', true)).toBe('⇧T')
        expect(formatShortcut('Digit1', false)).toBe('1')
        expect(formatShortcut('Mod+Backslash', true)).toBe('⌘\\')
        expect(formatShortcut('F2', false)).toBe('F2')
        expect(formatShortcut('Space', false)).toBe('Space')
    })

    test('a string that does not parse stays as it is', () => {
        expect(formatShortcut('Ctrl+Z', false)).toBe('Ctrl+Z')
    })
})

describe('isTextTarget', () => {
    test('inputs, text areas, selects and editable elements (or inside one)', () => {
        const inField = (tag: string) => ({tagName: 'SPAN', closest: (s: string) => s.split(', ').includes(tag) ? {} : null})
        for (const tag of ['input', 'textarea', 'select']) expect(isTextTarget(inField(tag) as any)).toBe(true)
        expect(isTextTarget({tagName: 'DIV', isContentEditable: true} as any)).toBe(true)
        expect(isTextTarget({tagName: 'DIV', closest: () => null} as any)).toBe(false)
        expect(isTextTarget(new EventTarget())).toBe(false)
        expect(isTextTarget(null)).toBe(false)
    })

    test('an input that takes no text (a Tweakpane checkbox keeps the focus after a click) is not a text field', () => {
        const input = (type: string) => {
            const el = {tagName: 'INPUT', type, closest: (s: string) => s === 'input' ? el : null}
            return el as any
        }
        for (const type of ['text', 'search', 'number', 'email', 'password']) expect(isTextTarget(input(type))).toBe(true)
        for (const type of ['checkbox', 'radio', 'button', 'submit', 'color', 'file']) expect(isTextTarget(input(type))).toBe(false)
    })
})

describe('ViewerActions', () => {
    function setup() {
        const viewer = fakeViewer()
        const actions = new ViewerActions(viewer)
        const changes = vi.fn()
        actions.addEventListener('actionsChange', changes)
        return {viewer, actions, changes}
    }

    test('register, get, list, unregister; actionsChange on each change', () => {
        const {actions, changes} = setup()
        const undo = action('undo', {group: 'Edit', shortcut: 'Mod+Z'})
        const focus = action('focus', {group: 'View', shortcut: 'F'})
        const unregister = actions.register([undo, focus])
        expect(changes).toHaveBeenCalledTimes(1)
        expect(actions.get('undo')).toBe(undo)
        expect(actions.list()).toEqual([undo, focus])
        expect(actions.list('View')).toEqual([focus])
        expect(actions.list('Other')).toEqual([])

        actions.unregister('undo')
        expect(actions.get('undo')).toBeUndefined()
        expect(changes).toHaveBeenCalledTimes(2)
        actions.unregister('undo') // not there: no change
        expect(changes).toHaveBeenCalledTimes(2)
        unregister()
        expect(actions.list()).toEqual([])
        expect(changes).toHaveBeenCalledTimes(3)
        unregister()
        expect(changes).toHaveBeenCalledTimes(3)
    })

    test('an action with the id of a registered one replaces it; the old unregister does not remove the new one', () => {
        const {actions} = setup()
        const a = action('a')
        const unregisterOld = actions.register(a)
        actions.register(action('b'))
        const b = action('a')
        actions.register(b)
        expect(actions.list().map(x => x.id)).toEqual(['b', 'a'])
        expect(actions.get('a')).toBe(b)
        unregisterOld()
        expect(actions.get('a')).toBe(b)
    })

    test('a shortcut that does not parse is a warning', () => {
        const {actions} = setup()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        actions.register(action('save', {shortcut: 'Ctrl+S'}))
        expect(warn).toHaveBeenCalledTimes(1)
        actions.register(action('open', {shortcut: 'Mod+O'}))
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('the key of an action runs it, with preventDefault; another key is left alone', () => {
        const {actions} = setup()
        const undo = action('undo', {shortcut: 'Mod+Z'})
        actions.register(undo)
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(true)
        // the platform of the test is not a Mac: Cmd (the Win key) is not Mod
        expect(press('z', 'KeyZ', {metaKey: true}).defaultPrevented).toBe(false)
        vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'})
        try {
            expect(press('z', 'KeyZ', {metaKey: true}).defaultPrevented).toBe(true)
            expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        } finally {
            vi.unstubAllGlobals()
        }
        expect(undo.run).toHaveBeenCalledTimes(2)
        expect(press('z', 'KeyZ').defaultPrevented).toBe(false)
        expect(press('y', 'KeyY', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(undo.run).toHaveBeenCalledTimes(2)
    })

    test('keys in a text field, keys that another handler used, and held keys are left alone', () => {
        const {actions} = setup()
        const del = action('delete', {shortcut: 'Delete'})
        actions.register(del)
        const field = {tagName: 'INPUT', closest: (s: string) => s.includes('input') ? {} : null}
        expect(pressIn(field, 'Delete', 'Delete').defaultPrevented).toBe(false)
        expect(pressIn({tagName: 'DIV', isContentEditable: true}, 'Delete', 'Delete').defaultPrevented).toBe(false)
        const used = keyEvent('Delete', 'Delete')
        used.preventDefault()
        window.dispatchEvent(used)
        expect(press('Delete', 'Delete', {repeat: true}).defaultPrevented).toBe(false)
        expect(del.run).not.toHaveBeenCalled()

        // an action with repeat runs on each repeat of a held key
        const zoom = action('zoom', {shortcut: '=', repeat: true})
        actions.register(zoom)
        press('=', 'Equal', {repeat: true})
        press('=', 'Equal', {repeat: true})
        expect(zoom.run).toHaveBeenCalledTimes(2)
    })

    test('a disabled action does not run; its key is left to other handlers', async() => {
        const {actions} = setup()
        let on = false
        const paste = action('paste', {shortcut: 'Mod+V', enabled: () => on})
        actions.register(paste)
        expect(press('v', 'KeyV', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(await actions.run('paste')).toBeUndefined()
        expect(paste.run).not.toHaveBeenCalled()
        on = true
        expect(press('v', 'KeyV', {ctrlKey: true}).defaultPrevented).toBe(true)
        expect(paste.run).toHaveBeenCalledTimes(1)
    })

    test('two actions with one key: the enabled one registered last runs', () => {
        const {actions} = setup()
        let lastOn = true
        const first = action('first', {shortcut: 'Escape'})
        const last = action('last', {shortcut: 'Escape', enabled: () => lastOn})
        actions.register([first, last])
        press('Escape', 'Escape')
        expect(last.run).toHaveBeenCalledTimes(1)
        expect(first.run).not.toHaveBeenCalled()
        lastOn = false
        press('Escape', 'Escape')
        expect(first.run).toHaveBeenCalledTimes(1)
    })

    test('an action with more keys runs on each; a higher priority wins over the one registered last', () => {
        const {actions} = setup()
        const del = action('delete', {shortcut: ['Delete', 'Backspace']})
        const endMode = action('endMode', {shortcut: 'Escape', priority: 1})
        const clear = action('clear', {shortcut: 'Escape'})
        actions.register([del, endMode, clear])
        press('Delete', 'Delete')
        press('Backspace', 'Backspace')
        expect(del.run).toHaveBeenCalledTimes(2)
        press('Escape', 'Escape')
        expect([endMode.run.mock.calls.length, clear.run.mock.calls.length]).toEqual([1, 0])
    })

    test('setShortcut: the app sets another key, more keys or none, also for an action registered later', () => {
        const {actions} = setup()
        const undo = action('undo', {shortcut: 'Mod+Z'})
        actions.register(undo)
        actions.setShortcut('undo', ['Mod+U', 'Alt+Z'])
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(press('z', 'KeyZ', {altKey: true}).defaultPrevented).toBe(true)
        expect(actions.shortcutOf('undo')).toEqual(['Mod+U', 'Alt+Z'])
        actions.setShortcut('undo', null)
        expect(press('z', 'KeyZ', {altKey: true}).defaultPrevented).toBe(false)
        expect(actions.shortcutOf('undo')).toBeUndefined()
        actions.setShortcut('undo', undefined)
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(true)
        // set before the action is there
        actions.setShortcut('later', 'Shift+L')
        const later = action('later', {shortcut: 'L'})
        actions.register(later)
        press('L', 'KeyL', {shiftKey: true})
        press('l', 'KeyL')
        expect([undo.run.mock.calls.length, later.run.mock.calls.length]).toEqual([2, 1])
    })

    test('the error and the warning of a run show in a toast of the viewer dialog, in its container, unless toastResults is off', async() => {
        const {viewer, actions} = setup()
        actions.register(action('upload', {run: () => ({error: 'Upload failed', warn: 'The file is large'})}))
        await actions.run('upload')
        expect(viewer.dialog.toast.mock.calls).toEqual([
            ['Upload failed', {kind: 'error', container: viewer.container}],
            ['The file is large', {kind: 'warn', container: viewer.container}],
        ])
        actions.toastResults = false
        await actions.run('upload')
        expect(viewer.dialog.toast).toHaveBeenCalledTimes(2)
    })

    test('two viewers on the page: a key is for the viewer with the focus, else for the one used last', () => {
        const container = () => {
            const kids = new Set<any>()
            return {isConnected: true, contains: (t: any) => kids.has(t), kids}
        }
        const a = setup(), b = setup()
        a.viewer.container = container()
        b.viewer.container = container()
        const inA = {tagName: 'CANVAS'}, inB = {tagName: 'CANVAS'}
        a.viewer.container.kids.add(inA)
        b.viewer.container.kids.add(inB)
        const undoA = action('undo', {shortcut: 'Mod+Z'}), undoB = action('undo', {shortcut: 'Mod+Z'})
        a.actions.register(undoA)
        b.actions.register(undoB)
        const runs = () => [undoA.run.mock.calls.length, undoB.run.mock.calls.length]
        try {
            pressIn(Object.assign(inB, {nodeType: 1}), 'z', 'KeyZ', {ctrlKey: true})
            expect(runs()).toEqual([0, 1])
            pressIn(Object.assign(inA, {nodeType: 1}), 'z', 'KeyZ', {ctrlKey: true})
            expect(runs()).toEqual([1, 1])
            // the focus on the page: the first one, then the one with the last pointer press
            press('z', 'KeyZ', {ctrlKey: true})
            expect(runs()).toEqual([2, 1])
            const down = new Event('pointerdown')
            Object.defineProperty(down, 'target', {value: inB})
            dispatchEvent(down)
            press('z', 'KeyZ', {ctrlKey: true})
            expect(runs()).toEqual([2, 2])
            // a viewer that left the page takes no key: the other one takes all
            b.viewer.container.isConnected = false
            pressIn(inB, 'z', 'KeyZ', {ctrlKey: true})
            expect(runs()).toEqual([3, 2])
        } finally {
            a.actions.dispose()
            b.actions.dispose()
        }
    })

    test('two viewers in the body: a key with the focus on the page is for the viewer used last, not the first one', () => {
        const a = setup(), b = setup()
        const body = {tagName: 'BODY', nodeType: 1, isConnected: true, contains: (t: any) => t === body || t === canvasA || t === canvasB}
        const canvasA = {tagName: 'CANVAS', nodeType: 1}, canvasB = {tagName: 'CANVAS', nodeType: 1}
        Object.assign(a.viewer, {container: body, canvas: canvasA})
        Object.assign(b.viewer, {container: body, canvas: canvasB})
        const oldDocument = (globalThis as any).document
        ;(globalThis as any).document = {body, documentElement: {}}
        const undoA = action('undo', {shortcut: 'Mod+Z'}), undoB = action('undo', {shortcut: 'Mod+Z'})
        a.actions.register(undoA)
        b.actions.register(undoB)
        try {
            // a press on the canvas of b, then a key on the page (the body): for b
            const down = new Event('pointerdown')
            Object.defineProperty(down, 'target', {value: canvasB})
            dispatchEvent(down)
            pressIn(body, 'z', 'KeyZ', {ctrlKey: true})
            expect([undoA.run.mock.calls.length, undoB.run.mock.calls.length]).toEqual([0, 1])
            // a press on the body (not on a canvas) keeps b as the viewer used last
            const onBody = new Event('pointerdown')
            Object.defineProperty(onBody, 'target', {value: body})
            dispatchEvent(onBody)
            pressIn(body, 'z', 'KeyZ', {ctrlKey: true})
            expect([undoA.run.mock.calls.length, undoB.run.mock.calls.length]).toEqual([0, 2])
        } finally {
            ;(globalThis as any).document = oldDocument
            a.actions.dispose()
            b.actions.dispose()
        }
    })

    test('two viewers in one element: the canvas tells the viewer; nested containers: the innermost one', () => {
        const a = setup(), b = setup()
        const kids = new Set<any>()
        const shared = {isConnected: true, contains: (t: any) => t === shared || kids.has(t)}
        const canvasA = {tagName: 'CANVAS', nodeType: 1}, canvasB = {tagName: 'CANVAS', nodeType: 1}
        kids.add(canvasA)
        kids.add(canvasB)
        Object.assign(a.viewer, {container: shared, canvas: canvasA})
        Object.assign(b.viewer, {container: shared, canvas: canvasB})
        const undoA = action('undo', {shortcut: 'Mod+Z'}), undoB = action('undo', {shortcut: 'Mod+Z'})
        a.actions.register(undoA)
        b.actions.register(undoB)
        try {
            pressIn(canvasB, 'z', 'KeyZ', {ctrlKey: true})
            pressIn(canvasA, 'z', 'KeyZ', {ctrlKey: true})
            expect([undoA.run.mock.calls.length, undoB.run.mock.calls.length]).toEqual([1, 1])
            // b in a container inside the container of a: a card of b is for b
            const card = {tagName: 'DIV', nodeType: 1}
            const inner = {isConnected: true, contains: (t: any) => t === inner || t === card || t === canvasB}
            kids.add(inner)
            kids.add(card)
            b.viewer.container = inner
            pressIn(card, 'z', 'KeyZ', {ctrlKey: true})
            expect([undoA.run.mock.calls.length, undoB.run.mock.calls.length]).toEqual([1, 2])
        } finally {
            a.actions.dispose()
            b.actions.dispose()
        }
    })

    test('the keys are off while enabled is false, and after dispose; run still runs', async() => {
        const {actions} = setup()
        const undo = action('undo', {shortcut: 'Mod+Z'})
        actions.register(undo)
        actions.enabled = false
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        await actions.run('undo')
        expect(undo.run).toHaveBeenCalledTimes(1)
        actions.enabled = true
        actions.dispose()
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        // a register after dispose adds no listener
        actions.register(action('redo', {shortcut: 'Mod+Y'}))
        expect(press('y', 'KeyY', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(undo.run).toHaveBeenCalledTimes(1)
    })

    test('with no actions left, a viewer takes no key (two viewers: the other one gets the keys of the page)', () => {
        const a = setup(), b = setup()
        const inB = {tagName: 'CANVAS', nodeType: 1}
        a.viewer.container = {isConnected: true, contains: () => false}
        b.viewer.container = {isConnected: true, contains: (t: any) => t === inB}
        const undoA = action('undo', {shortcut: 'Mod+Z'})
        a.actions.register(undoA)
        const unregisterB = b.actions.register(action('undo', {shortcut: 'Mod+Z'}))
        try {
            // b had the last pointer press: the key of the page is for b
            const down = new Event('pointerdown')
            Object.defineProperty(down, 'target', {value: inB})
            dispatchEvent(down)
            press('z', 'KeyZ', {ctrlKey: true})
            expect(undoA.run).toHaveBeenCalledTimes(0)
            // b has no actions now: a takes the key
            unregisterB()
            press('z', 'KeyZ', {ctrlKey: true})
            expect(undoA.run).toHaveBeenCalledTimes(1)
            // a register again: b listens again, and takes the keys of the page after a press on it
            const other = action('other', {shortcut: 'KeyQ'})
            b.actions.register(other)
            dispatchEvent(down)
            press('q', 'KeyQ')
            expect(other.run).toHaveBeenCalledTimes(1)
        } finally {
            a.actions.dispose()
            b.actions.dispose()
        }
    })

    test('run returns the result and sends actionRun; an error that run throws is its result', async() => {
        const {actions} = setup()
        const events: any[] = []
        actions.addEventListener('actionRun', e => events.push({id: e.action.id, result: e.result}))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        actions.register([
            action('plain'),
            action('warn', {run: () => ({warn: 'Nothing selected'})}),
            action('async', {run: async() => ({error: 'Upload failed'})}),
            action('throws', {run: () => {
                throw new Error('Broken')
            }}),
        ])
        expect(await actions.run('plain')).toEqual({})
        expect(await actions.run('warn')).toEqual({warn: 'Nothing selected'})
        expect(await actions.run('async')).toEqual({error: 'Upload failed'})
        expect(await actions.run('throws')).toEqual({error: 'Broken'})
        expect(await actions.run('missing')).toBeUndefined()
        expect(events).toEqual([
            {id: 'plain', result: {}},
            {id: 'warn', result: {warn: 'Nothing selected'}},
            {id: 'async', result: {error: 'Upload failed'}},
            {id: 'throws', result: {error: 'Broken'}},
        ])
    })

    test('a key runs the action at once, and actionRun tells its result', async() => {
        const {actions} = setup()
        const runs = vi.fn()
        actions.addEventListener('actionRun', ({result}) => runs(result))
        const dup = action('duplicate', {shortcut: 'Shift+D', run: vi.fn(() => ({warn: 'Select an object first'}))})
        actions.register(dup)
        press('D', 'KeyD', {shiftKey: true})
        expect(dup.run).toHaveBeenCalledTimes(1)
        await Promise.resolve()
        await Promise.resolve()
        expect(runs).toHaveBeenCalledWith({warn: 'Select an object first'})
    })

    test('the UI lists the actions with their keys, and a click runs one', () => {
        const {actions} = setup()
        const undo = action('undo', {label: 'Undo', shortcut: 'Mod+Z'})
        actions.register([undo, action('reset', {label: 'Reset', enabled: () => false})])
        const children = actions.uiConfig.children as any[]
        expect(children[0].property).toEqual([actions, 'enabled'])
        expect(children[1].property).toEqual([actions, 'toastResults'])
        const buttons = children[2]()
        expect(buttons.map((b: any) => b.label)).toEqual([`Undo (${formatShortcut('Mod+Z')})`, 'Reset'])
        expect(buttons.map((b: any) => b.disabled())).toEqual([false, true])
        buttons[0].value()
        expect(undo.run).toHaveBeenCalledTimes(1)
    })
})

describe('ViewerActions without a viewer', () => {
    test('the priority works across registers: an action registered first with a higher priority wins', () => {
        // the PickingPlugin registers before the PivotEditPlugin: the Escape that ends the pivot edit still wins
        const clear = action('picking.clearSelection', {shortcut: 'Escape'})
        const end = action('pivotEdit.end', {shortcut: 'Escape', priority: 1})
        const actions = new ViewerActions()
        const unbindA = actions.register([clear])
        const unbindB = actions.register([end])
        press('Escape', 'Escape')
        expect([clear.run.mock.calls.length, end.run.mock.calls.length]).toEqual([0, 1])
        unbindB()
        press('Escape', 'Escape')
        expect([clear.run.mock.calls.length, end.run.mock.calls.length]).toEqual([1, 1])
        unbindA()
        expect(press('Escape', 'Escape').defaultPrevented).toBe(false)
    })

    test('a focused button or checkbox keeps Space and Enter; Delete there still runs; a capture action leaves a focused panel', () => {
        const toggle = action('toggle', {shortcut: 'Space'})
        const del = action('delete', {shortcut: 'Delete'})
        const next = action('next', {shortcut: 'ArrowRight', capture: true})
        const unbind = new ViewerActions().register([toggle, del, next])
        const control = (tag: string) => {
            const el: any = {tagName: tag.toUpperCase(), nodeType: 1, type: 'checkbox'}
            el.closest = (sel: string) => sel.split(', ').includes(tag) ? el : null
            return el
        }
        expect(pressIn(control('button'), ' ', 'Space').defaultPrevented).toBe(false)
        expect(pressIn(control('input'), 'Enter', 'Enter').defaultPrevented).toBe(false)
        expect(pressIn(control('input'), 'Delete', 'Delete').defaultPrevented).toBe(true)
        // the focus in a panel (an element of no viewer): the panel keeps its arrows; on the page the action runs
        expect(pressIn(control('div'), 'ArrowRight', 'ArrowRight').defaultPrevented).toBe(false)
        expect(press('ArrowRight', 'ArrowRight').defaultPrevented).toBe(true)
        expect([toggle.run.mock.calls.length, del.run.mock.calls.length, next.run.mock.calls.length]).toEqual([0, 1, 1])
        unbind()
    })

    test('a capture action runs in the capture phase and stops the key (before the arrow keys of the camera controls)', () => {
        const next = action('annotations.next', {shortcut: 'ArrowRight', capture: true})
        const other = action('other', {shortcut: 'KeyQ'})
        const unbind = new ViewerActions().register([next, other])
        const e = keyEvent('ArrowRight', 'ArrowRight')
        const stop = vi.spyOn(e, 'stopPropagation')
        window.dispatchEvent(e)
        const q = keyEvent('q', 'KeyQ')
        const stopQ = vi.spyOn(q, 'stopPropagation')
        window.dispatchEvent(q)
        expect([next.run.mock.calls.length, stop.mock.calls.length, other.run.mock.calls.length, stopQ.mock.calls.length]).toEqual([1, 1, 1, 0])
        unbind()
    })

    test('it takes every key, with the same rules, until the actions are removed', () => {
        const toggle = action('toggle', {shortcut: 'KeyC'})
        const unbind = new ViewerActions().register([toggle])
        expect(press('c', 'KeyC').defaultPrevented).toBe(true)
        expect(press('c', 'KeyC', {shiftKey: true}).defaultPrevented).toBe(false)
        expect(press('c', 'KeyC', {repeat: true}).defaultPrevented).toBe(false)
        expect(pressIn({tagName: 'DIV', isContentEditable: true}, 'c', 'KeyC').defaultPrevented).toBe(false)
        expect(toggle.run).toHaveBeenCalledTimes(1)
        unbind()
        expect(press('c', 'KeyC').defaultPrevented).toBe(false)
        expect(toggle.run).toHaveBeenCalledTimes(1)
    })

    test('a disabled action does not run, and its key is left alone', () => {
        const toggle = action('toggle', {shortcut: 'KeyC', enabled: () => false})
        new ViewerActions().register([toggle])
        expect(press('c', 'KeyC').defaultPrevented).toBe(false)
        expect(toggle.run).not.toHaveBeenCalled()
    })
})
