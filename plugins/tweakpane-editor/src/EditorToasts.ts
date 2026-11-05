import {createStyles} from 'threepipe'
import styles from './EditorToasts.css?inline'

/** The kind of a toast: a message, a warning (an amber dot) or an error (a red dot) */
export type EditorToastKind = 'info' | 'warn' | 'error'

/**
 * Short messages over the canvas of the editor: small dark chips at the top centre of the container, under the camera
 * pill. A toast goes after {@link EditorToasts.Duration} (an error after twice that time), or on a click. The newest is
 * at the bottom; with more than {@link EditorToasts.MaxToasts}, the oldest goes.
 *
 * `TweakpaneEditorPlugin` makes one (`TweakpaneEditorPlugin.toasts`) and shows the `error` and `warn` of each run
 * of an action of a `CommandsPlugin` in it. Other UIs show their messages with {@link show}.
 */
export class EditorToasts {
    /** How long a toast stays, in ms. An error stays twice this time. */
    static Duration = 4000
    /** The most toasts at a time */
    static MaxToasts = 3

    /** The element of the toasts, in the container */
    readonly element: HTMLDivElement
    private _styles: HTMLStyleElement
    private _timers = new Map<HTMLElement, number>()

    /** @param container - the element over the canvas, like `viewer.container` */
    constructor(container: HTMLElement) {
        this._styles = createStyles(styles)
        this.element = document.createElement('div')
        this.element.className = 'etoast-host'
        this.element.setAttribute('aria-live', 'polite')
        container.appendChild(this.element)
    }

    /**
     * Shows a toast
     * @returns the element of the toast
     */
    show(message: string, kind: EditorToastKind = 'info'): HTMLElement {
        const toast = document.createElement('div')
        toast.className = 'etoast etoast-' + kind
        toast.textContent = message
        if (kind === 'error') toast.setAttribute('role', 'alert')
        toast.addEventListener('click', () => this._remove(toast))
        this.element.appendChild(toast)
        this._timers.set(toast, window.setTimeout(() => this._remove(toast), EditorToasts.Duration * (kind === 'error' ? 2 : 1)))
        const shown = [...this._timers.keys()]
        for (const old of shown.slice(0, Math.max(0, shown.length - EditorToasts.MaxToasts))) this._remove(old)
        return toast
    }

    /** Removes the toasts, their element and their styles */
    dispose() {
        for (const toast of [...this._timers.keys()]) this._remove(toast)
        this.element.remove()
        this._styles.remove()
    }

    private _remove(toast: HTMLElement) {
        window.clearTimeout(this._timers.get(toast))
        this._timers.delete(toast)
        toast.remove()
    }
}
