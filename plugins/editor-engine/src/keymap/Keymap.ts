/**
 * Key combos and keymap lookup.
 *
 * A binding is a string such as `ctrl+shift+z` or `numpad1`, matched against `KeyboardEvent.code`
 * (the physical key, so `z` is the Z key on an AZERTY keyboard too - Blender's keymaps are physical
 * as well: `{"type": 'Z', "value": 'PRESS', "ctrl": True}`). `ctrl` also accepts the Command key on
 * a Mac, which is what every browser app does and what `JSUndoManager` and `PickingPlugin` already do.
 *
 * Display strings (`Ctrl+Shift+Z`) are derived from the combo, so a tooltip can never disagree with
 * the key that is actually bound.
 */

import type {EditorMode, KeyBinding, KeymapPreset} from '../registry'

export interface KeyCombo {
    key: string
    ctrl: boolean
    shift: boolean
    alt: boolean
}

/** `KeyboardEvent.code` → the short key name used in bindings. */
export function keyNameFromCode(code: string): string {
    if (code.startsWith('Key') && code.length === 4) return code[3].toLowerCase()
    if (code.startsWith('Digit') && code.length === 6) return code[5]
    if (code.startsWith('Numpad')) return 'numpad' + code.slice(6).toLowerCase()
    if (code.startsWith('Arrow')) return code.slice(5).toLowerCase()
    switch (code) {
    case 'Period': return '.'
    case 'Comma': return ','
    case 'Slash': return '/'
    case 'Backslash': return '\\'
    case 'Minus': return '-'
    case 'Equal': return '='
    case 'BracketLeft': return '['
    case 'BracketRight': return ']'
    case 'Semicolon': return ';'
    case 'Quote': return '\''
    case 'Backquote': return '`'
    default: return code.toLowerCase()
    }
}

/** Parse `ctrl+shift+z` into its parts. Modifier order and case do not matter. */
export function parseCombo(keys: string): KeyCombo {
    const parts = keys.toLowerCase().split('+').map(p => p.trim()).filter(p => p.length)
    const combo: KeyCombo = {key: '', ctrl: false, shift: false, alt: false}
    for (const p of parts) {
        if (p === 'ctrl' || p === 'cmd' || p === 'mod') combo.ctrl = true
        else if (p === 'shift') combo.shift = true
        else if (p === 'alt' || p === 'option') combo.alt = true
        else combo.key = p
    }
    // `shift++` for the plus key would split badly; nobody binds it today.
    return combo
}

export function comboFromEvent(event: KeyboardEvent): KeyCombo {
    return {
        key: keyNameFromCode(event.code),
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
    }
}

export function comboKey(c: KeyCombo): string {
    return (c.ctrl ? 'ctrl+' : '') + (c.shift ? 'shift+' : '') + (c.alt ? 'alt+' : '') + c.key
}

const DISPLAY: Record<string, string> = {
    'delete': 'Delete', 'backspace': 'Backspace', 'tab': 'Tab', 'escape': 'Esc', 'enter': 'Enter', 'space': 'Space',
    'home': 'Home', 'end': 'End', 'pageup': 'PgUp', 'pagedown': 'PgDn',
    'up': '↑', 'down': '↓', 'left': '←', 'right': '→',
    'numpadadd': 'Numpad +', 'numpadsubtract': 'Numpad -', 'numpaddecimal': 'Numpad .', 'numpadenter': 'Numpad Enter',
}

/** `ctrl+shift+z` → `Ctrl+Shift+Z`; the shell's `formatShortcut` swaps the modifier glyphs on a Mac. */
export function formatCombo(keys: string): string {
    const c = parseCombo(keys)
    let key = DISPLAY[c.key]
    if (!key) {
        if (c.key.startsWith('numpad')) key = 'Numpad ' + c.key.slice(6).toUpperCase()
        else if (c.key.length === 1) key = c.key.toUpperCase()
        else if (/^f\d{1,2}$/.test(c.key)) key = c.key.toUpperCase()
        else key = c.key.charAt(0).toUpperCase() + c.key.slice(1)
    }
    return (c.ctrl ? 'Ctrl+' : '') + (c.shift ? 'Shift+' : '') + (c.alt ? 'Alt+' : '') + key
}

/** A preset indexed for lookup in both directions. */
export class Keymap {
    private _byCombo = new Map<string, KeyBinding[]>()
    private _byId = new Map<string, KeyBinding[]>()

    constructor(readonly preset: KeymapPreset) {
        for (const b of preset.bindings) {
            const k = comboKey(parseCombo(b.keys))
            if (!this._byCombo.has(k)) this._byCombo.set(k, [])
            this._byCombo.get(k)!.push(b)
            if (!this._byId.has(b.id)) this._byId.set(b.id, [])
            this._byId.get(b.id)!.push(b)
        }
    }

    /** The binding for a key event in a mode, if any. Mode-specific bindings win over global ones. */
    lookup(event: KeyboardEvent, mode: EditorMode): KeyBinding | undefined {
        const list = this._byCombo.get(comboKey(comboFromEvent(event)))
        if (!list) return undefined
        return list.find(b => b.mode === mode) ?? list.find(b => !b.mode)
    }

    bindingsFor(id: string): KeyBinding[] {
        return this._byId.get(id) ?? []
    }

    /** The display string for an id: the binding for the mode, else the first one. */
    shortcutFor(id: string, mode?: EditorMode): string | undefined {
        const list = this._byId.get(id)
        if (!list?.length) return undefined
        const b = (mode && list.find(x => x.mode === mode)) ?? list.find(x => !x.mode) ?? list[0]
        return formatCombo(b.keys)
    }
}
