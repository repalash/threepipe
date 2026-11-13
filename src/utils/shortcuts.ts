/**
 * A keyboard shortcut, parsed from its string ({@link parseShortcut}): `'Mod+Z'`, `'Shift+D'`, `'Delete'`.
 */
export interface ParsedShortcut {
    /** The key: a key name (`'Z'`, `'Delete'`, `'\\'`) or a `KeyboardEvent.code` (`'KeyC'`, `'Backslash'`) */
    key: string
    /** Cmd on a Mac, an iPhone or an iPad; Ctrl on other platforms */
    mod: boolean
    shift: boolean
    alt: boolean
}

/** The place on the keyboard (`KeyboardEvent.code`) of the characters that are not a letter or a digit */
const CHAR_CODES = new Map([
    ['\\', 'Backslash'], ['/', 'Slash'], ['[', 'BracketLeft'], [']', 'BracketRight'], [';', 'Semicolon'], ['\'', 'Quote'],
    [',', 'Comma'], ['.', 'Period'], ['-', 'Minus'], ['=', 'Equal'], ['`', 'Backquote'],
])
/** The character of each code in {@link CHAR_CODES}, for the labels */
const CODE_CHARS = new Map([...CHAR_CODES].map(([c, code]) => [code, c]))
/** Short labels of some keys. `Mod`, `Shift` and `Alt` are in {@link formatShortcut}. */
const KEY_LABELS = new Map([['Escape', 'Esc'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowLeft', '←'], ['ArrowRight', '→']])
/** The short labels of the numpad keys (`NumpadAdd` is `Num +`); a digit or another name stays as it is (`Num 7`) */
const NUMPAD_LABELS: Record<string, string> = {Add: '+', Subtract: '-', Multiply: '*', Divide: '/', Decimal: '.', Equal: '=', Comma: ','}
/** The signs that a US keyboard types with Shift: their label has no Shift, the sign tells it (`?`, not `Shift+?`) */
const SHIFT_SIGNS = new Set('~!@#$%^&*()_+{}|:"<>?')

/**
 * The place on the keyboard (`KeyboardEvent.code`) of a key name with one character: `'z'` is `KeyZ`, `'1'` is
 * `Digit1`, `'\\'` is `Backslash`. Other names have no place here.
 */
function codeOf(key: string): string | undefined {
    if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase()
    if (/^[0-9]$/.test(key)) return 'Digit' + key
    return CHAR_CODES.get(key)
}

/**
 * Parses a shortcut string: modifiers and a key, joined with `+`. The modifiers are `Mod` (Cmd on a Mac, Ctrl on other
 * platforms), `Shift` and `Alt`, in any order and case. The key is a key name (`Z`, `Delete`, `Escape`, `\`, `+`) or a
 * `KeyboardEvent.code` (`KeyC`, `Digit1`, `Backslash`). See {@link matchShortcut} for how a key matches.
 * @returns the parsed shortcut, or `undefined` for a string without a key or with another modifier (`Ctrl+Z`)
 */
export function parseShortcut(shortcut: string): ParsedShortcut | undefined {
    const parts = shortcut.split('+')
    let key = parts.pop()
    // `Mod++`: the key is +
    if (key === '' && parts[parts.length - 1] === '') {
        parts.pop()
        key = '+'
    }
    if (!key) return undefined
    const parsed: ParsedShortcut = {key, mod: false, shift: false, alt: false}
    for (const part of parts) {
        const m = part.toLowerCase()
        if (m === 'mod' || m === 'shift' || m === 'alt') parsed[m] = true
        else return undefined
    }
    return parsed
}

/**
 * The key press is the shortcut ({@link parseShortcut}): the same modifiers (no more, no less) and the same key.
 * - `Mod` is Cmd on a Mac (also an iPhone or an iPad with a keyboard) and Ctrl on other platforms. The other one of the
 *   two is not a modifier of a shortcut: a key press with it matches no shortcut (Ctrl+Z on a Mac is not `Mod+Z`).
 * - A key name matches the character of the key (`KeyboardEvent.key`, in any case), or the place of that key on a US
 *   keyboard (`KeyboardEvent.code`): for a digit or a sign always, for a letter only when the key types no Latin letter.
 *   So `Mod+Z` also works on a keyboard with other letters (Cyrillic, Greek), and `Alt+T` works on a Mac, where Alt
 *   changes the character; on a QWERTZ keyboard the Z key is `Z`, not `Y`.
 * - A `KeyboardEvent.code` (`KeyC`) matches only that place on the keyboard.
 * - A shortcut with a sign that needs Shift names Shift too: `Shift+/` for `?`.
 * @param mac - `Mod` is Cmd (a Mac). Default: the platform of the browser.
 */
export function matchShortcut(event: KeyboardEvent, shortcut: string | ParsedShortcut, mac = isMacPlatform()): boolean {
    const s = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut
    if (!s) return false
    const mod = mac ? event.metaKey : event.ctrlKey
    const other = mac ? event.ctrlKey : event.metaKey
    if (other || !!event.shiftKey !== s.shift || !!event.altKey !== s.alt || !!mod !== s.mod) return false
    const key = event.key?.toLowerCase()
    if (key === s.key.toLowerCase()) return true
    // an event without a code (made by a script) matches by its key only
    if (!event.code) return false
    if (event.code === s.key) return true
    if (event.code !== codeOf(s.key)) return false
    // a letter by its place only when the key types no Latin letter (another script, or Alt on a Mac)
    return !/^[a-z]$/i.test(s.key) || !/^[a-z]$/.test(key ?? '')
}

/**
 * A label of a shortcut ({@link parseShortcut}) for a UI: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` on other platforms.
 * A `KeyboardEvent.code` shows as its key: `KeyC` is `C`, `Digit1` is `1`, `Backslash` is `\`, `NumpadAdd` is `Num +`. A sign that needs Shift
 * shows without it: `Shift+?` is `?`.
 * @param shortcut - the shortcut string. A string that does not parse is returned as it is.
 * @param mac - Mac labels (⌘, ⌥, ⇧). Default: the platform of the browser.
 */
export function formatShortcut(shortcut: string, mac = isMacPlatform()): string {
    const s = parseShortcut(shortcut)
    if (!s) return shortcut
    const k = s.key
    const code = /^(Key|Digit)(.)$/.exec(k)
    const numpad = /^Numpad(.+)$/.exec(k)
    const key = code ? code[2] : numpad ? 'Num ' + (NUMPAD_LABELS[numpad[1]] ?? numpad[1]) : CODE_CHARS.get(k) ?? KEY_LABELS.get(k) ?? (k.length === 1 ? k.toUpperCase() : k)
    if (SHIFT_SIGNS.has(k)) s.shift = false
    if (mac) return (s.alt ? '⌥' : '') + (s.shift ? '⇧' : '') + (s.mod ? '⌘' : '') + key
    return [s.mod && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', key].filter(Boolean).join('+')
}

/** The browser runs on a Mac, an iPhone or an iPad: `Mod` is Cmd ({@link matchShortcut}, {@link formatShortcut}) */
function isMacPlatform() {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
}

/** The types of `input` that take no typed text: a checkbox (a Tweakpane checkbox too), a button, a colour or a file picker */
const NO_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'color', 'file'])

/**
 * The target of a key event is a text field: an input that takes text, a text area, a select, or an editable element
 * (or inside one). Keyboard shortcuts leave such a key to the field. A checkbox, a radio button, a button, a colour or a
 * file input keeps the focus after a click, but takes no text: the shortcuts work there.
 */
export function isTextTarget(target: EventTarget | null): boolean {
    const t = target as HTMLElement | null
    if (!t) return false
    if (t.isContentEditable || t.closest?.('textarea, select')) return true
    const input = t.closest?.('input') as HTMLInputElement | null | undefined
    return !!input && !NO_TEXT_INPUTS.has(input.type)
}

/**
 * The key belongs to the element with the focus: any key typed in a text field ({@link isTextTarget}), and Space or
 * Enter on a button, a checkbox, a radio button or another input (they press it). Keyboard shortcuts leave such a key
 * to the element; other keys (Delete, a letter) on a focused checkbox still run the shortcuts.
 */
export function isTargetKey(event: KeyboardEvent): boolean {
    if (isTextTarget(event.target)) return true
    if (event.key !== ' ' && event.key !== 'Enter') return false
    return !!(event.target as HTMLElement | null)?.closest?.('button, input, summary, [role="button"], [role="checkbox"]')
}
