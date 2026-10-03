/**
 * Keymap parsing, display strings and the two presets' internal consistency.
 */

import {describe, expect, it} from 'vitest'
import {comboFromEvent, comboKey, formatCombo, Keymap, keyNameFromCode, parseCombo} from '../src/keymap/Keymap'
import {blenderPreset} from '../src/keymap/presets/blender'
import {designPreset} from '../src/keymap/presets/design'

function keyEvent(code: string, mods: Partial<{ctrlKey: boolean, metaKey: boolean, shiftKey: boolean, altKey: boolean}> = {}): KeyboardEvent {
    return {code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods} as KeyboardEvent
}

describe('key combos', () => {
    it('names keys from KeyboardEvent.code', () => {
        expect(keyNameFromCode('KeyZ')).toBe('z')
        expect(keyNameFromCode('Digit1')).toBe('1')
        expect(keyNameFromCode('Numpad7')).toBe('numpad7')
        expect(keyNameFromCode('NumpadDecimal')).toBe('numpaddecimal')
        expect(keyNameFromCode('Delete')).toBe('delete')
        expect(keyNameFromCode('F9')).toBe('f9')
        expect(keyNameFromCode('Period')).toBe('.')
    })

    it('parses modifiers in any order and treats cmd as ctrl', () => {
        expect(parseCombo('shift+ctrl+z')).toEqual({key: 'z', ctrl: true, shift: true, alt: false})
        expect(parseCombo('Cmd+K')).toEqual({key: 'k', ctrl: true, shift: false, alt: false})
        expect(comboKey(parseCombo('alt+shift+a'))).toBe('shift+alt+a')
    })

    it('matches events including the Mac command key', () => {
        expect(comboKey(comboFromEvent(keyEvent('KeyZ', {metaKey: true, shiftKey: true})))).toBe('ctrl+shift+z')
        expect(comboKey(comboFromEvent(keyEvent('Tab')))).toBe('tab')
    })

    it('formats display strings from the binding, never by hand', () => {
        expect(formatCombo('ctrl+shift+z')).toBe('Ctrl+Shift+Z')
        expect(formatCombo('shift+d')).toBe('Shift+D')
        expect(formatCombo('numpaddecimal')).toBe('Numpad .')
        expect(formatCombo('numpad1')).toBe('Numpad 1')
        expect(formatCombo('escape')).toBe('Esc')
        expect(formatCombo('f3')).toBe('F3')
    })
})

describe('Keymap lookup', () => {
    const km = new Keymap(blenderPreset)

    it('prefers the binding for the current mode over a global one', () => {
        expect(km.lookup(keyEvent('Tab'), 'object')?.id).toBe('object.enter_edit')
        expect(km.lookup(keyEvent('Tab'), 'edit')?.id).toBe('mesh.exit_edit')
        expect(km.lookup(keyEvent('KeyZ', {ctrlKey: true}), 'edit')?.id).toBe('edit.undo')
    })

    it('does not fire an edit-mode key in object mode', () => {
        expect(km.lookup(keyEvent('KeyE'), 'object')).toBeUndefined()
        expect(km.lookup(keyEvent('KeyE'), 'edit')?.id).toBe('mesh.extrude')
    })

    it('derives the shortcut shown for an operator from the binding', () => {
        expect(km.shortcutFor('mesh.extrude', 'edit')).toBe('E')
        expect(km.shortcutFor('mesh.extrude', 'object')).toBe('E')
        expect(km.shortcutFor('edit.undo')).toBe('Ctrl+Z')
        expect(km.shortcutFor('nothing.here')).toBeUndefined()
        expect(new Keymap(designPreset).shortcutFor('mesh.extrude', 'edit')).toBe('Ctrl+E')
    })
})

describe('presets', () => {
    for (const preset of [blenderPreset, designPreset]) {
        it(`${preset.id}: no two bindings claim the same key in the same mode`, () => {
            const seen = new Map<string, string>()
            for (const b of preset.bindings) {
                if (b.keys.includes('click')) continue
                for (const mode of b.mode ? [b.mode] : ['object', 'edit']) {
                    const k = `${mode}:${comboKey(parseCombo(b.keys))}`
                    const other = seen.get(k)
                    // A mode-specific binding may shadow a global one (that is the lookup rule); two
                    // bindings of the same scope must not collide.
                    const sameScope = other && other.split('|')[1] === String(!!b.mode)
                    expect(sameScope ? `${k} bound to both ${other.split('|')[0]} and ${b.id}` : '').toBe('')
                    if (!other) seen.set(k, `${b.id}|${!!b.mode}`)
                }
            }
        })
        it(`${preset.id}: has undo, redo, the palette and edit-mode entry`, () => {
            const ids = new Set(preset.bindings.map(b => b.id))
            for (const id of ['edit.undo', 'edit.redo', 'ui.command_palette', 'object.enter_edit', 'mesh.exit_edit', 'mesh.extrude', 'mesh.delete']) {
                expect(ids.has(id), id).toBe(true)
            }
        })
    }
})
