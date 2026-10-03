/**
 * The transform modal keymap: Blender's "Transform Modal Map"
 * (`scripts/presets/keyconfig/keymap_data/blender_default.py`, `km_transform_modal_map`), as a
 * function from a DOM event to the modal item the transform handles.
 *
 * The engine (track E) owns the application keymap; this is only the in-transform map, kept here
 * so the plugin works standalone and so another keymap can replace it by setting
 * {@link ModalTransformOptions.keymap}.
 */

export type TransformModalItem =
    | 'confirm' | 'cancel'
    | 'axisX' | 'axisY' | 'axisZ' | 'planeX' | 'planeY' | 'planeZ' | 'consOff'
    | 'translate' | 'rotate' | 'resize'
    | 'snapInvOn' | 'snapInvOff' | 'snapToggle'
    | 'propsizeUp' | 'propsizeDown'
    | 'precisionOn' | 'precisionOff'
    | 'autoConstraint' | 'autoConstraintPlane'
    | 'incrementUp' | 'incrementDown'
    | 'propFalloffCycle' | 'propConnectedToggle'

export interface ModalKeyEvent {
    code: string
    key: string
    ctrl: boolean
    shift: boolean
    alt: boolean
    /** Key down or key up. */
    press: boolean
    repeat?: boolean
}

export type TransformKeymap = (event: ModalKeyEvent) => TransformModalItem | null

/** Blender's default transform modal map. */
export const blenderTransformKeymap: TransformKeymap = e => {
    if (e.press) {
        switch (e.code) {
        case 'Enter':
        case 'NumpadEnter':
            return 'confirm'
        case 'Escape':
            return 'cancel'
        case 'KeyX':
            return e.shift ? 'planeX' : 'axisX'
        case 'KeyY':
            return e.shift ? 'planeY' : 'axisY'
        case 'KeyZ':
            return e.shift ? 'planeZ' : 'axisZ'
        case 'KeyC':
            if (e.alt) return 'propConnectedToggle'
            return 'consOff'
        case 'KeyG':
            return 'translate'
        case 'KeyR':
            return 'rotate'
        case 'KeyS':
            return 'resize'
        case 'KeyO':
            return e.shift ? 'propFalloffCycle' : null
        case 'Tab':
            return e.shift ? 'snapToggle' : null
        case 'PageUp':
            return 'propsizeUp'
        case 'PageDown':
            return 'propsizeDown'
        case 'NumpadAdd':
            return e.alt ? 'propsizeUp' : null
        case 'NumpadSubtract':
            return e.alt ? 'propsizeDown' : null
        case 'ArrowUp':
            return 'incrementUp'
        case 'ArrowDown':
            return 'incrementDown'
        case 'ControlLeft':
        case 'ControlRight':
            return 'snapInvOn'
        case 'ShiftLeft':
        case 'ShiftRight':
            return 'precisionOn'
        default:
            return null
        }
    }
    switch (e.code) {
    case 'ControlLeft':
    case 'ControlRight':
        return 'snapInvOff'
    case 'ShiftLeft':
    case 'ShiftRight':
        return 'precisionOff'
    default:
        return null
    }
}
