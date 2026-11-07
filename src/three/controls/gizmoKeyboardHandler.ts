import type {CommandAction} from '../../plugins/interaction/CommandsPlugin'

/** What the shared gizmo actions ({@link gizmoActions}) change on a transform gizmo */
export interface GizmoActionTarget {
    /** The gizmo takes its keys now: enabled and attached to an object */
    active(): boolean
    /** The gizmo is attached to an object: the on/off key works also while it is off */
    attached(): boolean
    toggleSpace(): void
    adjustSize(delta: number): void
    toggleAxis(axis: 0 | 1 | 2): void
    toggleEnabled(): void
    /** Called after each action, to render the change */
    changed(): void
}

/**
 * The shared actions of the transform gizmos (`TransformControls2`, `PivotControls`): Q (local or world space), + and -
 * (the size), X, Y, Z (an axis) and Space (on or off). The keys are places on the keyboard (`KeyboardEvent.code`). The
 * owner of the gizmo binds them with `bindActions` (its plugin does that).
 * @param prefix - the start of the ids, like `'transformControls'`
 * @param group - the group of the actions in a UI
 * @param target - the gizmo
 */
export function gizmoActions(prefix: string, group: string, target: GizmoActionTarget): CommandAction[] {
    const action = (id: string, label: string, shortcut: string | string[], run: () => void, enabled = () => target.active()): CommandAction => ({
        id: prefix + '.' + id, label, group, shortcut, enabled,
        run: () => {
            run()
            target.changed()
        },
    })
    return [
        action('toggleSpace', 'Local or world space', 'KeyQ', () => target.toggleSpace()),
        // + is Shift and the = key on a US keyboard
        action('larger', 'Larger gizmo', ['Equal', 'Shift+Equal', 'NumpadAdd'], () => target.adjustSize(0.1)),
        action('smaller', 'Smaller gizmo', ['Minus', 'NumpadSubtract'], () => target.adjustSize(-0.1)),
        action('toggleX', 'Show or hide the X axis', 'KeyX', () => target.toggleAxis(0)),
        action('toggleY', 'Show or hide the Y axis', 'KeyY', () => target.toggleAxis(1)),
        action('toggleZ', 'Show or hide the Z axis', 'KeyZ', () => target.toggleAxis(2)),
        // also while it is off, to turn it on again
        action('toggleEnabled', 'Turn the gizmo on or off', 'Space', () => target.toggleEnabled(), () => target.attached()),
    ]
}
