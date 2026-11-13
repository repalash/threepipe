import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {PickingPlugin} from './PickingPlugin'
import {ViewerActions} from '../../viewer/ViewerActions'

/** A key press on the window of the node setup (globalThis, with a new event target for each test) */
function press(code: string, fields: Partial<KeyboardEvent> = {}, target: unknown = null) {
    const e = Object.assign(new Event('keydown', {cancelable: true}), {key: code, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...fields})
    if (target) Object.defineProperty(e, 'target', {value: target})
    window.dispatchEvent(e)
    return e
}

let unbind: (() => void) | undefined
beforeEach(() => {
    const win = new EventTarget()
    Object.assign(globalThis, {addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win)})
})
afterEach(() => {
    unbind?.()
    unbind = undefined
    vi.restoreAllMocks()
})

/** The plugin, its keys bound without a viewer (a ViewerActions without a viewer: the same rules as in a viewer), and a selection */
function setup(selected: unknown = {}) {
    const plugin = new PickingPlugin(undefined, false)
    vi.spyOn(plugin, 'getSelectedObject').mockImplementation(() => selected as any)
    unbind = new ViewerActions().register(plugin.actions)
    return plugin
}

describe('PickingPlugin actions', () => {
    it('the keys of the selection are actions: Escape, Delete or Backspace, H, Shift+H, Mod+D, Alt+G', () => {
        const plugin = setup()
        const clear = vi.spyOn(plugin, 'clearSelection').mockImplementation(() => {})
        const del = vi.spyOn(plugin, 'deleteSelected').mockImplementation(async() => {})
        const hide = vi.spyOn(plugin, 'toggleVisibilitySelected').mockImplementation(() => {})
        const unhide = vi.spyOn(plugin, 'unhideAll').mockImplementation(() => {})
        const dup = vi.spyOn(plugin, 'duplicateSelected').mockImplementation(() => {})
        const reset = vi.spyOn(plugin, 'resetTransform').mockImplementation(() => {})
        press('Escape')
        press('Delete')
        press('Backspace')
        press('KeyH')
        press('KeyH', {shiftKey: true})
        press('KeyD', {ctrlKey: true})
        press('KeyD', {ctrlKey: true, shiftKey: true})
        press('KeyG', {altKey: true})
        expect([clear, del, hide, unhide].map(f => f.mock.calls.length)).toEqual([1, 2, 1, 1])
        expect(dup.mock.calls).toEqual([[], ['compound']])
        expect(reset.mock.calls).toEqual([['position']])
        expect(plugin.actions.map(a => a.id)).toContain('picking.delete')
    })

    it('with no selection, a key of an action that needs one is left to other handlers; F frames everything', () => {
        const plugin = setup(null)
        const clear = vi.spyOn(plugin, 'clearSelection').mockImplementation(() => {})
        const all = vi.spyOn(plugin, 'selectAll').mockImplementation(() => {})
        expect(press('Escape').defaultPrevented).toBe(false)
        expect(press('KeyA', {ctrlKey: true}).defaultPrevented).toBe(true)
        expect([clear.mock.calls.length, all.mock.calls.length]).toEqual([0, 1])
    })

    it('a key typed in a text field, and a key of a disabled plugin, do nothing', () => {
        const plugin = setup()
        const clear = vi.spyOn(plugin, 'clearSelection').mockImplementation(() => {})
        press('Escape', {}, {tagName: 'INPUT', type: 'text', closest: (s: string) => s === 'input' ? {type: 'text'} : null})
        plugin.enabled = false
        press('Escape')
        expect(clear).not.toHaveBeenCalled()
    })

    it('keyboardShortcuts (deprecated) off: the actions have no keys, and still run from a UI', () => {
        const plugin = setup()
        const hide = vi.spyOn(plugin, 'toggleVisibilitySelected').mockImplementation(() => {})
        plugin.keyboardShortcuts = false
        expect(press('KeyH').defaultPrevented).toBe(false)
        expect(plugin.actions.find(a => a.id === 'picking.toggleVisibility')!.shortcut).toBeUndefined()
        plugin.actions.find(a => a.id === 'picking.toggleVisibility')!.run()
        plugin.keyboardShortcuts = true
        press('KeyH')
        expect(hide).toHaveBeenCalledTimes(2)
    })
})
