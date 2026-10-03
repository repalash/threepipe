/**
 * The knife's modal keymap: which DOM input means which knife action.
 *
 * Ported from Blender's `Knife Tool Modal Map` (`scripts/presets/keyconfig/keymap_data/blender_default.py`,
 * `km_knife_tool_modal_map`, `:6404`, Blender main e4e6c79a), item for item, with Blender's matching
 * rules: a binding with `"any": True` ignores modifiers, one without it needs exactly the modifiers it
 * lists, and the first binding that matches wins (so a double click is `ADD_CUT_CLOSED` before it is
 * `ADD_CUT`, and Ctrl+Z is `UNDO`, not the Z axis lock).
 *
 * Two additions, not in Blender's map, both asked for by the editor plan: `E` ends the current cut
 * (`NEW_CUT`, as right click does) and `Backspace` undoes the last segment (`UNDO`, as Ctrl+Z does).
 * On a Mac, Command stands in for Ctrl in Ctrl+Z, as the editor's keymaps do everywhere.
 */

import type {KnifeModalItem} from '@threepipe/mesh-kernel'

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

/** What one input maps to: a modal item and whether it is a release (Blender's `prev_val`). */
export interface KnifeModalInput {
    item: KnifeModalItem
    release: boolean
}

const bare = (e: {ctrl: boolean, shift: boolean, alt: boolean, meta: boolean}) => !e.ctrl && !e.shift && !e.alt && !e.meta

/**
 * A keyboard event through the Knife Tool Modal Map. Null means the knife does not bind it (a plain
 * key release, or a key with modifiers it does not take).
 */
export function knifeKeyToModal(e: KnifeKeyInput): KnifeModalInput | null {
    // Modifier keys toggle snapping on press and release, whatever else is held ("any": True).
    switch (e.code) {
    case 'ShiftLeft':
    case 'ShiftRight':
        if (e.repeat) return null
        return {item: e.press ? 'SNAP_MIDPOINTS_ON' : 'SNAP_MIDPOINTS_OFF', release: !e.press}
    case 'ControlLeft':
    case 'ControlRight':
        if (e.repeat) return null
        return {item: e.press ? 'IGNORE_SNAP_ON' : 'IGNORE_SNAP_OFF', release: !e.press}
    }
    if (!e.press) return null
    const press = (item: KnifeModalItem): KnifeModalInput => ({item, release: false})
    switch (e.code) {
    case 'Escape':
        return press('CANCEL') // "any": True
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
        return press('CONFIRM') // "any": True
    case 'KeyZ':
        // ("UNDO", Z, ctrl) is listed before ("Z_AXIS", Z): exactly Ctrl, else exactly nothing.
        if ((e.ctrl || e.meta) && !e.shift && !e.alt) return press('UNDO')
        return bare(e) ? press('Z_AXIS') : null
    case 'Backspace':
        // Addition: Backspace undoes the last segment too.
        return bare(e) ? press('UNDO') : null
    case 'KeyE':
        // Addition: E ends the current cut, as right click does.
        return bare(e) ? press('NEW_CUT') : null
    case 'KeyX': return bare(e) ? press('X_AXIS') : null
    case 'KeyY': return bare(e) ? press('Y_AXIS') : null
    case 'KeyA': return bare(e) ? press('ANGLE_SNAP_TOGGLE') : null
    case 'KeyR': return bare(e) ? press('CYCLE_ANGLE_SNAP_EDGE') : null
    case 'KeyC': return bare(e) ? press('CUT_THROUGH_TOGGLE') : null
    case 'KeyS': return bare(e) ? press('SHOW_DISTANCE_ANGLE_TOGGLE') : null
    case 'KeyV': return bare(e) ? press('DEPTH_TEST_TOGGLE') : null
    }
    return null
}

/** A mouse button through the Knife Tool Modal Map. */
export function knifeButtonToModal(e: KnifeButtonInput): KnifeModalInput | null {
    switch (e.button) {
    case 0:
        // ("ADD_CUT_CLOSED", LEFTMOUSE, DOUBLE_CLICK) before ("ADD_CUT", LEFTMOUSE, ANY).
        if (e.press && e.clicks >= 2) return {item: 'ADD_CUT_CLOSED', release: false}
        return {item: 'ADD_CUT', release: !e.press}
    case 1:
        // ("PANNING", MIDDLEMOUSE, ANY): the view navigation underneath gets the event too.
        return {item: 'PANNING', release: !e.press}
    case 2:
        // ("NEW_CUT", RIGHTMOUSE, PRESS) - no "any", so only without modifiers.
        return e.press && bare(e) ? {item: 'NEW_CUT', release: false} : null
    }
    return null
}

/**
 * The keys the knife shows in the status bar, in Blender's order (`knife_update_header`,
 * `editmesh_knife.cc:1061`), with the additions marked.
 */
export const KNIFE_STATUS_KEYS: {key: string, label: string, item: KnifeModalItem}[] = [
    {key: 'LMB', label: 'Cut', item: 'ADD_CUT'},
    {key: 'Double-click', label: 'Close', item: 'ADD_CUT_CLOSED'},
    {key: 'RMB / E', label: 'Stop', item: 'NEW_CUT'},
    {key: 'Enter / Space', label: 'Confirm', item: 'CONFIRM'},
    {key: 'Esc', label: 'Cancel', item: 'CANCEL'},
    {key: 'Ctrl+Z / Backspace', label: 'Undo', item: 'UNDO'},
    {key: 'MMB', label: 'Pan View', item: 'PANNING'},
    {key: 'Shift', label: 'Midpoint Snap', item: 'SNAP_MIDPOINTS_ON'},
    {key: 'Ctrl', label: 'Ignore Snap', item: 'IGNORE_SNAP_ON'},
    {key: 'C', label: 'Cut Through', item: 'CUT_THROUGH_TOGGLE'},
    {key: 'X / Y / Z', label: 'Axis', item: 'X_AXIS'},
    {key: 'S', label: 'Measure', item: 'SHOW_DISTANCE_ANGLE_TOGGLE'},
    {key: 'V', label: 'X-Ray', item: 'DEPTH_TEST_TOGGLE'},
    {key: 'A', label: 'Angle Constraint', item: 'ANGLE_SNAP_TOGGLE'},
]
