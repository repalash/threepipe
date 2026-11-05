import {describe, expect, it, vi} from 'vitest'
import {PickingPlugin} from './PickingPlugin'

/** A keydown the plugin's handler sees: no form control focused, no modifiers. */
function key(code: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, preventDefault() {}, ...extra} as KeyboardEvent
}

/**
 * `keyboardShortcuts` is the fallback flag an app that owns the viewport keymap (the modelling editor's
 * engine) turns off, so one key means one thing. On by default, so the plugin works on its own.
 */
describe('PickingPlugin.keyboardShortcuts', () => {
    it('handles its keys by default', () => {
        const plugin = new PickingPlugin(undefined, false)
        const clear = vi.spyOn(plugin, 'clearSelection').mockImplementation(() => {})
        const del = vi.spyOn(plugin, 'deleteSelected').mockImplementation(async() => {})
        expect(plugin.keyboardShortcuts).toBe(true)
        ;(plugin as any)._onKeyDown(key('Escape'))
        ;(plugin as any)._onKeyDown(key('Delete'))
        expect(clear).toHaveBeenCalledTimes(1)
        expect(del).toHaveBeenCalledTimes(1)
    })

    it('ignores every key when the flag is off', () => {
        const plugin = new PickingPlugin(undefined, false)
        const clear = vi.spyOn(plugin, 'clearSelection').mockImplementation(() => {})
        const del = vi.spyOn(plugin, 'deleteSelected').mockImplementation(async() => {})
        const hide = vi.spyOn(plugin, 'toggleVisibilitySelected').mockImplementation(() => {})
        plugin.keyboardShortcuts = false
        ;(plugin as any)._onKeyDown(key('Escape'))
        ;(plugin as any)._onKeyDown(key('Delete'))
        ;(plugin as any)._onKeyDown(key('KeyH'))
        expect(clear).not.toHaveBeenCalled()
        expect(del).not.toHaveBeenCalled()
        expect(hide).not.toHaveBeenCalled()
        // and back on
        plugin.keyboardShortcuts = true
        ;(plugin as any)._onKeyDown(key('KeyH'))
        expect(hide).toHaveBeenCalledTimes(1)
    })

    it('still leaves keys typed into a text field alone', () => {
        const plugin = new PickingPlugin(undefined, false)
        const clear = vi.spyOn(plugin, 'clearSelection').mockImplementation(() => {})
        ;(plugin as any)._onKeyDown(key('Escape', {target: {tagName: 'INPUT'} as never}))
        expect(clear).not.toHaveBeenCalled()
    })
})
