import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {JSUndoManager} from 'ts-browser-helpers'
import {UndoManagerPlugin} from './UndoManagerPlugin'
import {ViewerActions} from '../../viewer/ViewerActions'

/** A key press on the window of the node setup (globalThis, with a new event target for each test) */
function press(code: string, target: unknown = null, fields: Partial<KeyboardEvent> = {}) {
    const e = Object.assign(new Event('keydown', {cancelable: true}), {key: code.replace('Key', '').toLowerCase(), code, repeat: false, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...fields})
    if (target) Object.defineProperty(e, 'target', {value: target})
    window.dispatchEvent(e)
    return e
}
/** An element of the page: `closest('input')` finds an input (the text field check) */
const element = (tagName: string, fields: Record<string, unknown> = {}) => {
    const el: any = {tagName, ...fields}
    el.closest = (s: string) => s.split(', ').includes(tagName.toLowerCase()) ? el : null
    return el
}

let unbind: (() => void) | undefined
beforeEach(() => {
    const win = new EventTarget()
    Object.assign(globalThis, {addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win)})
})
afterEach(() => {
    unbind?.()
    unbind = undefined
})

/** The plugin with an undo manager, its actions bound without a viewer (a ViewerActions without a viewer: the same rules as in a viewer) */
function setup() {
    const plugin = new UndoManagerPlugin()
    plugin.undoManager = new JSUndoManager({bindHotKeys: false, limit: 10, debug: false})
    const undo = vi.spyOn(plugin, 'undo').mockImplementation(() => undefined)
    const redo = vi.spyOn(plugin, 'redo').mockImplementation(() => undefined)
    unbind = new ViewerActions().register(plugin.actions)
    return {plugin, undo, redo}
}

describe('UndoManagerPlugin actions', () => {
    it('Mod+Z undoes; Mod+Shift+Z and Mod+Y redo; a held key repeats', () => {
        const {undo, redo} = setup()
        press('KeyZ')
        press('KeyZ', null, {repeat: true})
        expect(undo).toHaveBeenCalledTimes(2)
        press('KeyZ', null, {shiftKey: true})
        press('KeyY')
        expect(redo).toHaveBeenCalledTimes(2)
    })

    it('leaves a key typed in a text field to the field; a checkbox or a button has no text, so the key undoes', () => {
        const {undo, redo} = setup()
        press('KeyZ', element('INPUT', {type: 'text'}))
        press('KeyZ', element('INPUT', {type: 'number'}))
        press('KeyZ', element('TEXTAREA'))
        press('KeyY', element('DIV', {isContentEditable: true}))
        expect(undo).not.toHaveBeenCalled()
        expect(redo).not.toHaveBeenCalled()
        press('KeyZ', element('INPUT', {type: 'checkbox'}))
        press('KeyZ', element('BUTTON'))
        expect(undo).toHaveBeenCalledTimes(2)
    })

    it('does nothing while the plugin is off', () => {
        const {plugin, undo} = setup()
        plugin.enabled = false
        expect(press('KeyZ').defaultPrevented).toBe(false)
        plugin.enabled = true
        press('KeyZ')
        expect(undo).toHaveBeenCalledTimes(1)
    })
})
