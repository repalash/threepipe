import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {
    bindActions,
    CommandAction,
    CommandsPlugin,
    EventDispatcher,
    formatShortcut,
    isTextTarget,
    matchShortcut,
    parseShortcut,
    ThreeViewer,
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
function pressIn(target: any, key: string, code: string) {
    const e = keyEvent(key, code)
    Object.defineProperty(e, 'target', {value: target})
    window.dispatchEvent(e)
    return e
}

/** A viewer with the plugin list and the plugin listeners of ThreeViewer, in the order of addPluginSync and removePluginSync */
function fakeViewer() {
    const plugins: Record<string, any> = {}
    const listeners = (type: 'add' | 'remove', p: any) => viewer._pluginListeners[type]
        .filter((l: any) => !l.p.length || l.p.includes(p.constructor.PluginType)).forEach((l: any) => l.l({type, plugin: p}))
    const viewer: any = Object.assign(new EventDispatcher<any>(), {
        _pluginListeners: {add: [], remove: []},
        getPlugin: (t: any) => plugins[typeof t === 'string' ? t : t.PluginType],
        addPluginListener: ThreeViewer.prototype.addPluginListener,
        removePluginListener: ThreeViewer.prototype.removePluginListener,
        add<T>(p: T & any): T {
            plugins[p.constructor.PluginType] = p
            p.onAdded(viewer)
            listeners('add', p)
            return p
        },
        remove(p: any) {
            p.onRemove(viewer)
            listeners('remove', p)
            delete plugins[p.constructor.PluginType]
        },
    })
    return viewer
}

function action(id: string, fields: Partial<CommandAction> = {}): CommandAction & {run: ReturnType<typeof vi.fn>} {
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
    test('Mod is Ctrl or Cmd, on every platform, and the modifiers are exact', () => {
        expect(matchShortcut(keyEvent('z', 'KeyZ', {ctrlKey: true}), 'Mod+Z')).toBe(true)
        expect(matchShortcut(keyEvent('z', 'KeyZ', {metaKey: true}), 'Mod+Z')).toBe(true)
        expect(matchShortcut(keyEvent('z', 'KeyZ'), 'Mod+Z')).toBe(false)
        expect(matchShortcut(keyEvent('Z', 'KeyZ', {ctrlKey: true, shiftKey: true}), 'Mod+Z')).toBe(false)
        expect(matchShortcut(keyEvent('Z', 'KeyZ', {metaKey: true, shiftKey: true}), 'Mod+Shift+Z')).toBe(true)
        expect(matchShortcut(keyEvent('z', 'KeyZ', {altKey: true, ctrlKey: true}), 'Mod+Z')).toBe(false)
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
        expect(matchShortcut(keyEvent('#', 'Backslash', {metaKey: true}), 'Mod+\\')).toBe(true)
        expect(matchShortcut(keyEvent('1', 'Digit1'), '1')).toBe(true)
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
})

describe('CommandsPlugin', () => {
    function setup() {
        const viewer = fakeViewer()
        const commands = viewer.add(new CommandsPlugin()) as CommandsPlugin
        const changes = vi.fn()
        commands.addEventListener('actionsChange', changes)
        return {viewer, commands, changes}
    }

    test('register, get, list, unregister; actionsChange on each change', () => {
        const {commands, changes} = setup()
        const undo = action('undo', {group: 'Edit', shortcut: 'Mod+Z'})
        const focus = action('focus', {group: 'View', shortcut: 'F'})
        const unregister = commands.register([undo, focus])
        expect(changes).toHaveBeenCalledTimes(1)
        expect(commands.get('undo')).toBe(undo)
        expect(commands.list()).toEqual([undo, focus])
        expect(commands.list('View')).toEqual([focus])
        expect(commands.list('Other')).toEqual([])

        commands.unregister('undo')
        expect(commands.get('undo')).toBeUndefined()
        expect(changes).toHaveBeenCalledTimes(2)
        commands.unregister('undo') // not there: no change
        expect(changes).toHaveBeenCalledTimes(2)
        unregister()
        expect(commands.list()).toEqual([])
        expect(changes).toHaveBeenCalledTimes(3)
        unregister()
        expect(changes).toHaveBeenCalledTimes(3)
    })

    test('an action with the id of a registered one replaces it; the old unregister does not remove the new one', () => {
        const {commands} = setup()
        const a = action('a')
        const unregisterOld = commands.register(a)
        commands.register(action('b'))
        const b = action('a')
        commands.register(b)
        expect(commands.list().map(x => x.id)).toEqual(['b', 'a'])
        expect(commands.get('a')).toBe(b)
        unregisterOld()
        expect(commands.get('a')).toBe(b)
    })

    test('a shortcut that does not parse is a warning', () => {
        const {commands} = setup()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        commands.register(action('save', {shortcut: 'Ctrl+S'}))
        expect(warn).toHaveBeenCalledTimes(1)
        commands.register(action('open', {shortcut: 'Mod+O'}))
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('the key of an action runs it, with preventDefault; another key is left alone', () => {
        const {commands} = setup()
        const undo = action('undo', {shortcut: 'Mod+Z'})
        commands.register(undo)
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(true)
        expect(press('z', 'KeyZ', {metaKey: true}).defaultPrevented).toBe(true)
        expect(undo.run).toHaveBeenCalledTimes(2)
        expect(press('z', 'KeyZ').defaultPrevented).toBe(false)
        expect(press('y', 'KeyY', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(undo.run).toHaveBeenCalledTimes(2)
    })

    test('keys in a text field, keys that another handler used, and held keys are left alone', () => {
        const {commands} = setup()
        const del = action('delete', {shortcut: 'Delete'})
        commands.register(del)
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
        commands.register(zoom)
        press('=', 'Equal', {repeat: true})
        press('=', 'Equal', {repeat: true})
        expect(zoom.run).toHaveBeenCalledTimes(2)
    })

    test('a disabled action does not run; its key is left to other handlers', async() => {
        const {commands} = setup()
        let on = false
        const paste = action('paste', {shortcut: 'Mod+V', enabled: () => on})
        commands.register(paste)
        expect(press('v', 'KeyV', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(await commands.run('paste')).toBeUndefined()
        expect(paste.run).not.toHaveBeenCalled()
        on = true
        expect(press('v', 'KeyV', {ctrlKey: true}).defaultPrevented).toBe(true)
        expect(paste.run).toHaveBeenCalledTimes(1)
    })

    test('two actions with one key: the enabled one registered last runs', () => {
        const {commands} = setup()
        let lastOn = true
        const first = action('first', {shortcut: 'Escape'})
        const last = action('last', {shortcut: 'Escape', enabled: () => lastOn})
        commands.register([first, last])
        press('Escape', 'Escape')
        expect(last.run).toHaveBeenCalledTimes(1)
        expect(first.run).not.toHaveBeenCalled()
        lastOn = false
        press('Escape', 'Escape')
        expect(first.run).toHaveBeenCalledTimes(1)
    })

    test('the keys are off while the plugin is disabled, and after it is removed; run still runs', async() => {
        const {viewer, commands} = setup()
        const undo = action('undo', {shortcut: 'Mod+Z'})
        commands.register(undo)
        commands.enabled = false
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        await commands.run('undo')
        expect(undo.run).toHaveBeenCalledTimes(1)
        commands.enabled = true
        commands.disable('test')
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        commands.enable('test')
        viewer.remove(commands)
        expect(press('z', 'KeyZ', {ctrlKey: true}).defaultPrevented).toBe(false)
        expect(undo.run).toHaveBeenCalledTimes(1)
    })

    test('run returns the result and sends actionRun; an error that run throws is its result', async() => {
        const {commands} = setup()
        const events: any[] = []
        commands.addEventListener('actionRun', e => events.push({id: e.action.id, result: e.result}))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        commands.register([
            action('plain'),
            action('warn', {run: () => ({warn: 'Nothing selected'})}),
            action('async', {run: async() => ({error: 'Upload failed'})}),
            action('throws', {run: () => {
                throw new Error('Broken')
            }}),
        ])
        expect(await commands.run('plain')).toEqual({})
        expect(await commands.run('warn')).toEqual({warn: 'Nothing selected'})
        expect(await commands.run('async')).toEqual({error: 'Upload failed'})
        expect(await commands.run('throws')).toEqual({error: 'Broken'})
        expect(await commands.run('missing')).toBeUndefined()
        expect(events).toEqual([
            {id: 'plain', result: {}},
            {id: 'warn', result: {warn: 'Nothing selected'}},
            {id: 'async', result: {error: 'Upload failed'}},
            {id: 'throws', result: {error: 'Broken'}},
        ])
    })

    test('a key runs the action at once, and actionRun tells its result', async() => {
        const {commands} = setup()
        const runs = vi.fn()
        commands.addEventListener('actionRun', ({result}) => runs(result))
        const dup = action('duplicate', {shortcut: 'Shift+D', run: vi.fn(() => ({warn: 'Select an object first'}))})
        commands.register(dup)
        press('D', 'KeyD', {shiftKey: true})
        expect(dup.run).toHaveBeenCalledTimes(1)
        await Promise.resolve()
        await Promise.resolve()
        expect(runs).toHaveBeenCalledWith({warn: 'Select an object first'})
    })

    test('the UI lists the actions with their keys, and a click runs one', () => {
        const {commands} = setup()
        const undo = action('undo', {label: 'Undo', shortcut: 'Mod+Z'})
        commands.register([undo, action('reset', {label: 'Reset', enabled: () => false})])
        const children = commands.uiConfig.children as any[]
        expect(children[0].property).toEqual([commands, 'enabled'])
        const buttons = children[1]()
        expect(buttons.map((b: any) => b.label)).toEqual([`Undo (${formatShortcut('Mod+Z')})`, 'Reset'])
        expect(buttons.map((b: any) => b.disabled())).toEqual([false, true])
        buttons[0].value()
        expect(undo.run).toHaveBeenCalledTimes(1)
    })

    test('it is not saved with the viewer config', () => {
        expect(new CommandsPlugin().serializeWithViewer).toBe(false)
    })
})

describe('bindActions', () => {
    test('without a viewer: an own key listener runs the shortcuts, with the same rules, until unbind', () => {
        const toggle = action('toggle', {shortcut: 'KeyC'})
        const unbind = bindActions(undefined, [toggle])
        expect(press('c', 'KeyC').defaultPrevented).toBe(true)
        expect(press('c', 'KeyC', {shiftKey: true}).defaultPrevented).toBe(false)
        expect(press('c', 'KeyC', {repeat: true}).defaultPrevented).toBe(false)
        expect(pressIn({tagName: 'DIV', isContentEditable: true}, 'c', 'KeyC').defaultPrevented).toBe(false)
        expect(toggle.run).toHaveBeenCalledTimes(1)
        unbind()
        expect(press('c', 'KeyC').defaultPrevented).toBe(false)
        expect(toggle.run).toHaveBeenCalledTimes(1)
    })

    test('a disabled action of an own listener does not run, and its key is left alone', () => {
        const toggle = action('toggle', {shortcut: 'KeyC', enabled: () => false})
        bindActions(undefined, [toggle])
        expect(press('c', 'KeyC').defaultPrevented).toBe(false)
        expect(toggle.run).not.toHaveBeenCalled()
    })

    test('the actions go to the CommandsPlugin of the viewer while it has one, also one added or removed later', () => {
        const viewer = fakeViewer()
        const toggle = action('toggle', {shortcut: 'KeyC'})
        const unbind = bindActions(viewer, [toggle])
        press('c', 'KeyC')
        expect(toggle.run).toHaveBeenCalledTimes(1)

        // added later: registered there, and the key runs once (no own listener now)
        const commands = viewer.add(new CommandsPlugin()) as CommandsPlugin
        expect(commands.list()).toEqual([toggle])
        press('c', 'KeyC')
        expect(toggle.run).toHaveBeenCalledTimes(2)

        // removed: the own listener again
        viewer.remove(commands)
        expect(commands.list()).toEqual([])
        press('c', 'KeyC')
        expect(toggle.run).toHaveBeenCalledTimes(3)

        // added again, then unbind: nothing left
        const again = viewer.add(new CommandsPlugin()) as CommandsPlugin
        expect(again.list()).toEqual([toggle])
        unbind()
        expect(again.list()).toEqual([])
        press('c', 'KeyC')
        expect(toggle.run).toHaveBeenCalledTimes(3)
        expect(viewer._pluginListeners.add).toHaveLength(0)
        expect(viewer._pluginListeners.remove).toHaveLength(0)
    })

    test('with a CommandsPlugin from the start, the plugin runs the keys and sends actionRun', async() => {
        const viewer = fakeViewer()
        const commands = viewer.add(new CommandsPlugin()) as CommandsPlugin
        const runs = vi.fn()
        commands.addEventListener('actionRun', ({action: a}) => runs(a.id))
        bindActions(viewer, [action('toggle', {shortcut: 'KeyC'})])
        press('c', 'KeyC')
        await Promise.resolve()
        await Promise.resolve()
        expect(runs).toHaveBeenCalledWith('toggle')
    })
})
