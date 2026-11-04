/** A key typed in a text field (an input, a text area, a select, an editable element): editor shortcuts leave it alone */
export function isTextTarget(target: EventTarget | null) {
    const t = target as HTMLElement | null
    return !!t && (!!t.isContentEditable || !!t.closest?.('input, textarea, select'))
}

/** The value kept in `localStorage` under `key`, or `null` (nothing kept, or no storage) */
export function readStored(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch (e) {
        return null // no storage
    }
}

/** Keeps a value in `localStorage`; without storage, nothing is kept (this page only) */
export function writeStored(key: string, value: string) {
    try {
        localStorage.setItem(key, value)
    } catch (e) {
        // no storage
    }
}
