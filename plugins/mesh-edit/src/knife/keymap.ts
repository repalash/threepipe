/**
 * The knife's modal keymap: which DOM input means which knife action.
 *
 * Two of Blender's `Knife Tool Modal Map`s, item for item, as data:
 * - {@link KNIFE_MODAL_MAP_BLENDER}, `km_knife_tool_modal_map` in `blender_default.py:6404` (the default
 *   keymap, the editor's Blender preset);
 * - {@link KNIFE_MODAL_MAP_INDUSTRY}, `km_knife_tool_modal_map` in `industry_compatible_data.py:3515` (the
 *   Industry Compatible keymap the editor's Design preset is built on: Ctrl snaps to midpoints, Shift
 *   ignores snapping, Alt+drag orbits, D measures).
 *
 * Matching is Blender's `wm_eventmatch` (`windowmanager/intern/wm_event_system.cc:2398`): the type, the
 * value (unless `ANY`), and each modifier exactly unless the item says `any` - except that a modifier
 * key's own flag is ignored when it is the event. The first item that matches wins, which is how a
 * double click becomes `ADD_CUT_CLOSED` before `ADD_CUT`, and Ctrl+Z `UNDO` rather than the Z lock.
 *
 * Two additions to both maps, asked for by the editor plan: `E` ends the current cut (`NEW_CUT`, as right
 * click does) and `Backspace` undoes the last segment (`UNDO`, as Ctrl+Z does). They come after Blender's
 * own items, so they never shadow one. The DOM layer reads the Command key as Ctrl, as the editor's
 * keymaps do everywhere, so Cmd+Z undoes on a Mac.
 */

import type {KnifeModalItem} from '@threepipe/mesh-kernel'

/** An event as Blender's keymap sees it: `wmEvent` type/value and the modifiers held. */
export interface KnifeKeymapEvent {
    /** Blender's event type name: `LEFTMOUSE`, `A`, `RET`, `LEFT_SHIFT`, ... */
    type: string
    value: 'PRESS' | 'RELEASE' | 'DOUBLE_CLICK'
    shift: boolean
    ctrl: boolean
    alt: boolean
    oskey: boolean
}

/** One modal keymap item: `(item, {"type", "value", modifiers or "any"})`. */
export interface KnifeKeymapItem {
    item: KnifeModalItem
    type: string
    value: 'PRESS' | 'RELEASE' | 'ANY' | 'DOUBLE_CLICK'
    /** `"any": True`: modifiers are not checked. */
    any?: boolean
    shift?: boolean
    ctrl?: boolean
    alt?: boolean
    oskey?: boolean
}

/** `blender_default.py:6412-6437`, then the editor's two additions. */
export const KNIFE_MODAL_MAP_BLENDER: KnifeKeymapItem[] = [
    {item: 'CANCEL', type: 'ESC', value: 'PRESS', any: true},
    {item: 'PANNING', type: 'MIDDLEMOUSE', value: 'ANY', any: true},
    {item: 'ADD_CUT_CLOSED', type: 'LEFTMOUSE', value: 'DOUBLE_CLICK', any: true},
    {item: 'ADD_CUT', type: 'LEFTMOUSE', value: 'ANY', any: true},
    {item: 'UNDO', type: 'Z', value: 'PRESS', ctrl: true},
    {item: 'CONFIRM', type: 'RET', value: 'PRESS', any: true},
    {item: 'CONFIRM', type: 'NUMPAD_ENTER', value: 'PRESS', any: true},
    {item: 'CONFIRM', type: 'SPACE', value: 'PRESS', any: true},
    {item: 'NEW_CUT', type: 'RIGHTMOUSE', value: 'PRESS'},
    {item: 'SNAP_MIDPOINTS_ON', type: 'LEFT_SHIFT', value: 'PRESS', any: true},
    {item: 'SNAP_MIDPOINTS_OFF', type: 'LEFT_SHIFT', value: 'RELEASE', any: true},
    {item: 'SNAP_MIDPOINTS_ON', type: 'RIGHT_SHIFT', value: 'PRESS', any: true},
    {item: 'SNAP_MIDPOINTS_OFF', type: 'RIGHT_SHIFT', value: 'RELEASE', any: true},
    {item: 'IGNORE_SNAP_ON', type: 'LEFT_CTRL', value: 'PRESS', any: true},
    {item: 'IGNORE_SNAP_OFF', type: 'LEFT_CTRL', value: 'RELEASE', any: true},
    {item: 'IGNORE_SNAP_ON', type: 'RIGHT_CTRL', value: 'PRESS', any: true},
    {item: 'IGNORE_SNAP_OFF', type: 'RIGHT_CTRL', value: 'RELEASE', any: true},
    {item: 'X_AXIS', type: 'X', value: 'PRESS'},
    {item: 'Y_AXIS', type: 'Y', value: 'PRESS'},
    {item: 'Z_AXIS', type: 'Z', value: 'PRESS'},
    {item: 'ANGLE_SNAP_TOGGLE', type: 'A', value: 'PRESS'},
    {item: 'CYCLE_ANGLE_SNAP_EDGE', type: 'R', value: 'PRESS'},
    {item: 'CUT_THROUGH_TOGGLE', type: 'C', value: 'PRESS'},
    {item: 'SHOW_DISTANCE_ANGLE_TOGGLE', type: 'S', value: 'PRESS'},
    {item: 'DEPTH_TEST_TOGGLE', type: 'V', value: 'PRESS'},
    // Additions.
    {item: 'NEW_CUT', type: 'E', value: 'PRESS'},
    {item: 'UNDO', type: 'BACK_SPACE', value: 'PRESS'},
]

/** `industry_compatible_data.py:3523-3550`, then the editor's two additions. */
export const KNIFE_MODAL_MAP_INDUSTRY: KnifeKeymapItem[] = [
    {item: 'CANCEL', type: 'ESC', value: 'PRESS', any: true},
    {item: 'PANNING', type: 'LEFTMOUSE', value: 'PRESS', alt: true},
    {item: 'CONFIRM', type: 'RET', value: 'PRESS', any: true},
    {item: 'CONFIRM', type: 'NUMPAD_ENTER', value: 'PRESS', any: true},
    {item: 'ADD_CUT_CLOSED', type: 'LEFTMOUSE', value: 'DOUBLE_CLICK', any: true},
    {item: 'ADD_CUT', type: 'LEFTMOUSE', value: 'ANY', any: true},
    {item: 'UNDO', type: 'Z', value: 'PRESS', ctrl: true},
    {item: 'NEW_CUT', type: 'RIGHTMOUSE', value: 'PRESS'},
    {item: 'SNAP_MIDPOINTS_ON', type: 'LEFT_CTRL', value: 'PRESS'},
    {item: 'SNAP_MIDPOINTS_OFF', type: 'LEFT_CTRL', value: 'RELEASE'},
    {item: 'SNAP_MIDPOINTS_ON', type: 'RIGHT_CTRL', value: 'PRESS'},
    {item: 'SNAP_MIDPOINTS_OFF', type: 'RIGHT_CTRL', value: 'RELEASE'},
    {item: 'IGNORE_SNAP_ON', type: 'LEFT_SHIFT', value: 'PRESS', any: true},
    {item: 'IGNORE_SNAP_OFF', type: 'LEFT_SHIFT', value: 'RELEASE', any: true},
    {item: 'IGNORE_SNAP_ON', type: 'RIGHT_SHIFT', value: 'PRESS', any: true},
    {item: 'IGNORE_SNAP_OFF', type: 'RIGHT_SHIFT', value: 'RELEASE', any: true},
    {item: 'X_AXIS', type: 'X', value: 'PRESS'},
    {item: 'Y_AXIS', type: 'Y', value: 'PRESS'},
    {item: 'Z_AXIS', type: 'Z', value: 'PRESS'},
    {item: 'ANGLE_SNAP_TOGGLE', type: 'A', value: 'PRESS'},
    {item: 'CYCLE_ANGLE_SNAP_EDGE', type: 'R', value: 'PRESS'},
    {item: 'CUT_THROUGH_TOGGLE', type: 'C', value: 'PRESS'},
    {item: 'PANNING', type: 'MIDDLEMOUSE', value: 'PRESS', alt: true},
    {item: 'PANNING', type: 'RIGHTMOUSE', value: 'PRESS', alt: true},
    {item: 'SHOW_DISTANCE_ANGLE_TOGGLE', type: 'D', value: 'PRESS'},
    {item: 'DEPTH_TEST_TOGGLE', type: 'V', value: 'PRESS'},
    // Additions.
    {item: 'NEW_CUT', type: 'E', value: 'PRESS'},
    {item: 'UNDO', type: 'BACK_SPACE', value: 'PRESS'},
]

export type KnifeKeymapName = 'blender' | 'industry'

export const KNIFE_MODAL_MAPS: Record<KnifeKeymapName, KnifeKeymapItem[]> = {
    blender: KNIFE_MODAL_MAP_BLENDER,
    industry: KNIFE_MODAL_MAP_INDUSTRY,
}

const SHIFT_KEYS = ['LEFT_SHIFT', 'RIGHT_SHIFT']
const CTRL_KEYS = ['LEFT_CTRL', 'RIGHT_CTRL']
const ALT_KEYS = ['LEFT_ALT', 'RIGHT_ALT']
const MOUSE = ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE']

/** `wm_eventmatch` (`wm_event_system.cc:2398`) for one item. */
export function knifeKeymapMatch(e: KnifeKeymapEvent, kmi: KnifeKeymapItem): boolean {
    if (e.type !== kmi.type) return false
    if (kmi.value !== 'ANY' && e.value !== kmi.value) return false
    if (kmi.any) return true
    // A modifier key's own flag does not count against it ("rare case of when these keys are used
    // as the 'type' not as modifiers").
    if (e.shift !== !!kmi.shift && !SHIFT_KEYS.includes(e.type)) return false
    if (e.ctrl !== !!kmi.ctrl && !CTRL_KEYS.includes(e.type)) return false
    if (e.alt !== !!kmi.alt && !ALT_KEYS.includes(e.type)) return false
    if (e.oskey !== !!kmi.oskey && e.type !== 'OSKEY') return false
    return true
}

/** What one input maps to: a modal item and whether it is a release (Blender's `prev_val`). */
export interface KnifeModalInput {
    item: KnifeModalItem
    release: boolean
}

/** The first matching item of a map (`wm_eventmatch_modal_keymap_items`, `:2501`), or null. */
export function knifeEventToModal(e: KnifeKeymapEvent, map: KnifeKeymapItem[] = KNIFE_MODAL_MAP_BLENDER): KnifeModalInput | null {
    for (const kmi of map) {
        if (knifeKeymapMatch(e, kmi)) return {item: kmi.item, release: e.value === 'RELEASE'}
    }
    return null
}

/** A key event as the knife reads it. `code` is `KeyboardEvent.code`. */
export interface KnifeKeyInput {
    code: string
    press: boolean
    ctrl: boolean
    shift: boolean
    alt: boolean
    meta: boolean
    repeat?: boolean
}

/** A mouse button event. `button` is `PointerEvent.button`; `clicks` is `event.detail` on a press. */
export interface KnifeButtonInput {
    button: number
    press: boolean
    clicks: number
    ctrl: boolean
    shift: boolean
    alt: boolean
    meta: boolean
}

/** `KeyboardEvent.code` to Blender's event type, for the keys the knife maps. */
export function blenderKeyType(code: string): string | null {
    const letter = /^Key([A-Z])$/.exec(code)
    if (letter) return letter[1]
    switch (code) {
    case 'Escape': return 'ESC'
    case 'Enter': return 'RET'
    case 'NumpadEnter': return 'NUMPAD_ENTER'
    case 'Space': return 'SPACE'
    case 'Backspace': return 'BACK_SPACE'
    case 'ShiftLeft': return 'LEFT_SHIFT'
    case 'ShiftRight': return 'RIGHT_SHIFT'
    case 'ControlLeft': return 'LEFT_CTRL'
    case 'ControlRight': return 'RIGHT_CTRL'
    case 'AltLeft': return 'LEFT_ALT'
    case 'AltRight': return 'RIGHT_ALT'
    // Command reads as Ctrl, as a modifier and as a key.
    case 'MetaLeft': return 'LEFT_CTRL'
    case 'MetaRight': return 'RIGHT_CTRL'
    }
    return null
}

/** A keyboard event through a knife modal map. Null when the map does not bind it. */
export function knifeKeyToModal(e: KnifeKeyInput, map: KnifeKeymapItem[] = KNIFE_MODAL_MAP_BLENDER): KnifeModalInput | null {
    const type = blenderKeyType(e.code)
    if (!type) return null
    // Held modifier keys auto-repeat; the press already toggled the snapping.
    if (e.repeat && [...SHIFT_KEYS, ...CTRL_KEYS, ...ALT_KEYS].includes(type)) return null
    return knifeEventToModal({type, value: e.press ? 'PRESS' : 'RELEASE', shift: e.shift, ctrl: e.ctrl || e.meta, alt: e.alt, oskey: false}, map)
}

/** A mouse button through a knife modal map. A press with `clicks >= 2` is Blender's `DOUBLE_CLICK`. */
export function knifeButtonToModal(e: KnifeButtonInput, map: KnifeKeymapItem[] = KNIFE_MODAL_MAP_BLENDER): KnifeModalInput | null {
    const type = MOUSE[e.button]
    if (!type) return null
    const value = !e.press ? 'RELEASE' : e.clicks >= 2 ? 'DOUBLE_CLICK' : 'PRESS'
    return knifeEventToModal({type, value, shift: e.shift, ctrl: e.ctrl || e.meta, alt: e.alt, oskey: false}, map)
}

/** What the mouse buttons do while the knife runs (`knife_update_header`, `editmesh_knife.cc:1061`). */
export const KNIFE_STATUS_MOUSE = {lmb: 'Cut', mmb: 'Pan View', rmb: 'Stop'} as const

const KEY_LABELS: Record<string, string> = {
    LEFT_SHIFT: 'Shift', LEFT_CTRL: 'Ctrl', RET: 'Enter', SPACE: 'Space', ESC: 'Esc', BACK_SPACE: 'Backspace',
}

/**
 * The keys the knife shows in the status bar, in Blender's order (`knife_update_header`), after the mouse
 * buttons ({@link KNIFE_STATUS_MOUSE}), read from the map so they cannot go stale.
 */
export function knifeStatusKeys(map: KnifeKeymapItem[] = KNIFE_MODAL_MAP_BLENDER): {key: string, label: string, item: KnifeModalItem}[] {
    const keysFor = (item: KnifeModalItem): string => {
        const out: string[] = []
        for (const k of map) {
            if (k.item !== item || k.value === 'RELEASE') continue
            // The mouse buttons have their own slots; one side of a two-sided key is enough.
            if ((MOUSE.includes(k.type) && k.value !== 'DOUBLE_CLICK') || k.type.startsWith('RIGHT_') || k.type === 'NUMPAD_ENTER') continue
            const name = (k.ctrl ? 'Ctrl+' : '') + (k.alt ? 'Alt+' : '') + (k.shift ? 'Shift+' : '')
                + (k.value === 'DOUBLE_CLICK' ? 'Double-click' : KEY_LABELS[k.type] ?? k.type)
            if (!out.includes(name)) out.push(name)
        }
        return out.join(' / ')
    }
    const rows: [KnifeModalItem, string][] = [
        ['ADD_CUT_CLOSED', 'Close'], ['NEW_CUT', 'Stop'], ['CONFIRM', 'Confirm'], ['CANCEL', 'Cancel'], ['UNDO', 'Undo'],
        ['SNAP_MIDPOINTS_ON', 'Midpoint Snap'], ['IGNORE_SNAP_ON', 'Ignore Snap'], ['CUT_THROUGH_TOGGLE', 'Cut Through'],
        ['X_AXIS', 'Axis'], ['SHOW_DISTANCE_ANGLE_TOGGLE', 'Measure'], ['DEPTH_TEST_TOGGLE', 'X-Ray'], ['ANGLE_SNAP_TOGGLE', 'Angle Constraint'],
    ]
    return rows
        .map(([item, label]) => ({key: item === 'X_AXIS' ? 'X / Y / Z' : keysFor(item), label, item}))
        .filter(r => r.key)
}
