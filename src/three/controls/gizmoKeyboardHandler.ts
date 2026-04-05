/**
 * Shared keyboard handler for transform gizmo controls.
 * Handles common shortcuts: Q (space), +/- (size), X/Y/Z (axis), Space (enable).
 * Returns true if the key was handled (caller should mark dirty / dispatch change).
 */
export function handleGizmoKeyDown(
    event: KeyboardEvent,
    callbacks: {
        toggleSpace: () => void
        adjustSize: (delta: number) => void
        toggleAxis: (axis: 0 | 1 | 2) => void
        toggleEnabled: () => void
    },
): boolean {
    if (event.metaKey || event.ctrlKey) return false
    if ((event.target as any)?.tagName === 'TEXTAREA' || (event.target as any)?.tagName === 'INPUT') return false

    switch (event.code) {
    case 'KeyQ':
        callbacks.toggleSpace()
        return true
    case 'Equal':
    case 'NumpadAdd':
        callbacks.adjustSize(0.1)
        return true
    case 'Minus':
    case 'NumpadSubtract':
        callbacks.adjustSize(-0.1)
        return true
    case 'KeyX':
        callbacks.toggleAxis(0)
        return true
    case 'KeyY':
        callbacks.toggleAxis(1)
        return true
    case 'KeyZ':
        callbacks.toggleAxis(2)
        return true
    case 'Space':
        callbacks.toggleEnabled()
        return true
    default:
        return false
    }
}
