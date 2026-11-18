import type {ViewerAction} from '../../viewer/ViewerActions'

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
    /**
     * The gizmo sends `mouseDown` when the person presses one of its handles: of two gizmos that share a key, the one
     * pressed last takes it ({@link gizmoActions})
     */
    events?: {addEventListener(type: 'mouseDown', listener: () => void): void}
    /** Of two gizmos that share a key, this one takes it while none was pressed yet (the transform gizmo) */
    preferred?: boolean
    /**
     * The element of the viewer of the gizmo (its canvas): the gizmo pressed last is kept for each one, so a press in
     * another viewer does not change which gizmo takes a key here. Without it, the gizmos share one.
     */
    scope?(): object | undefined
}

/** For each viewer (the element of {@link GizmoActionTarget.scope}): the gizmo whose handle was pressed last there */
const lastPressed = new WeakMap<object, GizmoActionTarget>()
/** The scope of the gizmos without one */
const noScope = {}
const scopeOf = (target: GizmoActionTarget) => target.scope?.() ?? noScope

/** A key, and the same key with Shift: Shift, held down, snaps a gizmo, and its keys still work then */
export const withShift = (keys: string[]) => keys.flatMap(k => [k, 'Shift+' + k])

/**
 * The shared actions of the transform gizmos (`TransformControls2`, `PivotControls`): Q (local or world space), + and -
 * (the size), X, Y, Z (an axis) and Space (on or off). The keys are places on the keyboard (`KeyboardEvent.code`), and
 * they work with Shift held down too (Shift snaps the gizmo). When two gizmos with these keys are active (the transform
 * gizmo and the pivot gizmo), one takes a key: the one whose handle was pressed last, else the preferred one
 * ({@link GizmoActionTarget.preferred}); the actions have a higher `priority` then. The owner of the gizmo registers them
 * in `viewer.actions` (its plugin does that).
 * @param prefix - the start of the ids, like `'transformControls'`
 * @param group - the group of the actions in a UI
 * @param target - the gizmo
 */
export function gizmoActions(prefix: string, group: string, target: GizmoActionTarget): ViewerAction[] {
    target.events?.addEventListener('mouseDown', () => {
        lastPressed.set(scopeOf(target), target)
    })
    const action = (id: string, label: string, keys: string[], run: () => void, enabled = () => target.active()): ViewerAction => ({
        id: prefix + '.' + id, label, group, shortcut: withShift(keys), enabled,
        // of two gizmos with the key: the one pressed last, else the preferred one
        get priority() {
            return gizmoPriority(target)
        },
        run: () => {
            run()
            target.changed()
        },
    })
    return [
        action('toggleSpace', 'Local or world space', ['KeyQ'], () => target.toggleSpace()),
        // + is Shift and the = key on a US keyboard (Shift+Equal, from withShift)
        action('larger', 'Larger gizmo', ['Equal', 'NumpadAdd'], () => target.adjustSize(0.1)),
        action('smaller', 'Smaller gizmo', ['Minus', 'NumpadSubtract'], () => target.adjustSize(-0.1)),
        action('toggleX', 'Show or hide the X axis', ['KeyX'], () => target.toggleAxis(0)),
        action('toggleY', 'Show or hide the Y axis', ['KeyY'], () => target.toggleAxis(1)),
        action('toggleZ', 'Show or hide the Z axis', ['KeyZ'], () => target.toggleAxis(2)),
        // also while it is off, to turn it on again
        action('toggleEnabled', 'Turn the gizmo on or off', ['Space'], () => target.toggleEnabled(), () => target.attached()),
    ]
}

/** The `priority` of the keys of a gizmo: 2 for the gizmo pressed last in its viewer, 1 for the preferred one, else 0 */
export function gizmoPriority(target: GizmoActionTarget): number {
    return lastPressed.get(scopeOf(target)) === target ? 2 : target.preferred ? 1 : 0
}
