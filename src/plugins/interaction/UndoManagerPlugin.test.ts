import {describe, expect, it, vi} from 'vitest'
import {JSUndoManager} from 'ts-browser-helpers'
import {UndoManagerPlugin} from './UndoManagerPlugin'

/** A keydown as the plugin's document listener sees it. */
function key(code: string, target: unknown = null, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {code, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, target, ...extra} as KeyboardEvent
}

function setup() {
    const plugin = new UndoManagerPlugin()
    plugin.undoManager = new JSUndoManager({bindHotKeys: false, limit: 10, debug: false})
    const undo = vi.spyOn(plugin, 'undo').mockImplementation(() => undefined)
    const redo = vi.spyOn(plugin, 'redo').mockImplementation(() => undefined)
    const press = (e: KeyboardEvent) => (plugin as any)._onKeyDown(e)
    return {plugin, undo, redo, press}
}

describe('UndoManagerPlugin hot keys', () => {
    it('Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo', () => {
        const {undo, redo, press} = setup()
        press(key('KeyZ'))
        press(key('KeyZ', null, {ctrlKey: false, metaKey: true}))
        expect(undo).toHaveBeenCalledTimes(2)
        press(key('KeyZ', null, {shiftKey: true}))
        press(key('KeyY'))
        expect(redo).toHaveBeenCalledTimes(2)
    })

    it('leaves keys typed into a text field to the field', () => {
        const {undo, redo, press} = setup()
        press(key('KeyZ', {tagName: 'INPUT', type: 'text'}))
        press(key('KeyZ', {tagName: 'INPUT', type: 'number'}))
        press(key('KeyZ', {tagName: 'TEXTAREA'}))
        press(key('KeyY', {tagName: 'DIV', isContentEditable: true}))
        expect(undo).not.toHaveBeenCalled()
        expect(redo).not.toHaveBeenCalled()
        // a checkbox or a button has no text to undo: the shortcut is the scene's
        press(key('KeyZ', {tagName: 'INPUT', type: 'checkbox'}))
        press(key('KeyZ', {tagName: 'BUTTON'}))
        expect(undo).toHaveBeenCalledTimes(2)
    })

    it('does nothing when hotKeys or the plugin is off', () => {
        const {plugin, undo, press} = setup()
        plugin.hotKeys = false
        press(key('KeyZ'))
        plugin.hotKeys = true
        plugin.enabled = false
        press(key('KeyZ'))
        expect(undo).not.toHaveBeenCalled()
        plugin.enabled = true
        press(key('KeyZ'))
        expect(undo).toHaveBeenCalledTimes(1)
    })
})
