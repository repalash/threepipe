/**
 * The look of a mode button in the {@link EditorModeBar}: its colour and its icon (an SVG string).
 */
export interface EditorModeLook {
    color: string
    icon: string
}

/** The part of the editor that the mode bar uses */
export interface EditorModeBarHost {
    modeKeys: string[]
    setSelectedMode(i: number): void
}

const svg = (d: string) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const TOGGLE_ICON = svg('<path d="M8 6l4 4-4 4"/>')
const FALLBACK: EditorModeLook = {color: '#8a8f98', icon: svg('<circle cx="10" cy="10" r="3.5" fill="currentColor"/>')}

/**
 * A vertical bar of mode buttons on the right of the page, for the modes of the {@link TweakpaneEditorPlugin}
 * (Viewer, Interaction, Export...), instead of the tabs at the bottom.
 *
 * - Each mode has its own colour and icon ({@link EditorModeBar.Looks}), like the property tabs of Blender: a mode is
 *   quicker to find, and easy to name ("the green export tab").
 * - A click on a mode shows its panels. A click on the open mode hides the panel, and the canvas takes its room.
 * - The button at the bottom shows the names next to the icons, like a sidebar.
 *
 * The bar sets the CSS variable `--mb-width` on the root element, and the class `mb-panel-hidden` on the body when the
 * panel is hidden, for the page layout ({@link EditorFrame}).
 */
export class EditorModeBar {
    /** The colour and icon of each mode name. A mode that is not here gets a grey dot. */
    static Looks: Record<string, EditorModeLook> = {
        'Viewer': {color: '#0d99ff', icon: svg('<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>')},
        'Interaction': {color: '#f97316', icon: svg('<path d="M6 3l9 5.5-4 1 2.5 5-2 1-2.5-5L6 13z"/>')},
        'Buffers': {color: '#a855f7', icon: svg('<path d="M10 3l7.5 3.8L10 10.6 2.5 6.8z"/><path d="M2.5 10.2L10 14l7.5-3.8M2.5 13.6L10 17.4l7.5-3.8"/>')},
        ['Post-processing']: {color: '#ec4899', icon: svg('<path d="M10 2.8l1.6 4.5 4.6 1.6-4.6 1.6L10 15l-1.6-4.5-4.6-1.6 4.6-1.6z"/><path d="M15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>')},
        'Export': {color: '#22c55e', icon: svg('<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13"/>')},
        'Configurator': {color: '#14b8a6', icon: svg('<path d="M4 5h12M4 10h12M4 15h12"/><circle cx="8" cy="5" r="1.7" fill="currentColor"/><circle cx="13" cy="10" r="1.7" fill="currentColor"/><circle cx="7" cy="15" r="1.7" fill="currentColor"/>')},
        'Animation': {color: '#eab308', icon: svg('<circle cx="10" cy="10" r="7"/><path d="M8.3 7l4.4 3-4.4 3z" fill="currentColor"/>')},
        'Extras': {color: '#64748b', icon: svg('<path d="M8 3.5h4v2.2a1.4 1.4 0 1 0 2.2 0V3.5h2.3v4H14.3a1.4 1.4 0 1 0 0 2.2h2.2v6.8h-13V3.5z"/>')},
        'Debug': {color: '#ef4444', icon: svg('<rect x="6" y="6.5" width="8" height="10" rx="4"/><path d="M10 9.5v7M6 10H3.5M16.5 10H14M6 14H4M16 14h-2M7.5 6.5L6 4M12.5 6.5L14 4"/>')},
    }

    /** Width of the bar without and with the names, in px */
    static Widths = {narrow: 44, wide: 156}

    readonly element: HTMLDivElement
    private _tip: HTMLDivElement
    private _buttons: HTMLButtonElement[]
    private _toggle: HTMLButtonElement
    private _selected = 0
    private _open = true
    private _expanded = true

    /**
     * @param editor - the editor with the modes
     * @param host - the element the bar is added to
     * @param panel - returns the element that is hidden when the open mode is clicked again (the Tweakpane container)
     * @param storageKey - the `localStorage` key that keeps the names shown or hidden, or `null` to not keep it.
     * The names are shown at the first visit.
     */
    constructor(readonly editor: EditorModeBarHost, host: HTMLElement, readonly panel?: () => HTMLElement | null, readonly storageKey: string | null = 'tpEditorModeBarExpanded') {
        const bar = document.createElement('div')
        bar.className = 'mb-root'
        bar.setAttribute('role', 'tablist')
        bar.setAttribute('aria-orientation', 'vertical')
        this.element = bar
        this._tip = document.createElement('div')
        this._tip.className = 'mb-tip'
        if (storageKey) {
            try {
                this._expanded = localStorage.getItem(storageKey) !== '0'
            } catch (e) {
                // no storage: names shown
            }
        }
        this._buttons = editor.modeKeys.map((key, i) => {
            const look = EditorModeBar.Looks[key] ?? FALLBACK
            const b = this._button(look.icon, key, look.color)
            b.setAttribute('role', 'tab')
            b.setAttribute('aria-label', key)
            b.addEventListener('click', () => i === this._selected ? this.setOpen(!this._open) : this.show(i))
            return b
        })
        this._toggle = this._button(TOGGLE_ICON, 'Hide names', '', 'Show names')
        this._toggle.classList.add('mb-toggle')
        this._toggle.addEventListener('click', () => {
            this._tip.classList.remove('show')
            this.setExpanded(!this._expanded)
        })
        host.appendChild(bar)
        this.setExpanded(this._expanded)
        this.select(0)
    }

    /** The names are shown next to the icons */
    get expanded() {
        return this._expanded
    }

    /** The panel of the selected mode is shown */
    get open() {
        return this._open
    }

    /** Shows or hides the names next to the icons */
    setExpanded(expanded: boolean) {
        this._expanded = expanded
        this.element.classList.toggle('mb-wide', expanded)
        this._toggle.setAttribute('aria-label', expanded ? 'Hide the mode names' : 'Show the mode names')
        this._toggle.setAttribute('aria-expanded', String(expanded))
        document.documentElement.style.setProperty('--mb-width', (expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow) + 'px')
        if (this.storageKey) {
            try {
                localStorage.setItem(this.storageKey, expanded ? '1' : '0')
            } catch (e) {
                // no storage: this page only
            }
        }
        // the canvas size follows the CSS; the viewer resizes on the window's resize
        window.dispatchEvent(new Event('resize'))
    }

    /** Marks a mode as selected, when it changes elsewhere (the editor's setSelectedMode) */
    select(i: number) {
        this._selected = i
        this._buttons.forEach((b, k) => {
            b.classList.toggle('on', k === i && this._open)
            b.setAttribute('aria-selected', String(k === i))
        })
    }

    /** Shows or hides the panel of the selected mode */
    setOpen(open: boolean) {
        this._open = open
        const p = this.panel?.()
        if (p) p.style.visibility = open ? '' : 'hidden'
        document.body.classList.toggle('mb-panel-hidden', !open)
        this.select(this._selected)
        window.dispatchEvent(new Event('resize'))
    }

    /** Opens a mode's panel (and shows the panel if it was hidden), like a click on its button */
    show(i: number) {
        if (i < 0 || i >= this._buttons.length) return
        if (i !== this._selected) {
            this.editor.setSelectedMode(i)
            this.select(i)
        }
        if (!this._open) this.setOpen(true)
    }

    dispose() {
        if (!this._open) this.setOpen(true)
        this.element.remove()
        this._tip.remove()
        document.documentElement.style.removeProperty('--mb-width')
    }

    private _button(icon: string, label: string, color: string, tip = label) {
        const b = document.createElement('button')
        b.className = 'mb-btn'
        if (color) b.style.setProperty('--mb-color', color)
        b.innerHTML = `${icon}<span class="mb-label"></span>`
        b.querySelector('.mb-label')!.textContent = label
        b.addEventListener('pointerenter', () => this._showTip(b, tip, color || '#8a8f98'))
        b.addEventListener('pointerleave', () => this._tip.classList.remove('show'))
        this.element.appendChild(b)
        return b
    }

    private _showTip(b: HTMLElement, text: string, color: string) {
        if (this._expanded) return // the name is on the button
        const tip = this._tip
        tip.textContent = text
        tip.style.setProperty('--mb-color', color)
        if (!tip.isConnected) document.body.appendChild(tip)
        const r = b.getBoundingClientRect()
        const tr = tip.getBoundingClientRect()
        tip.style.left = r.left - tr.width - 8 + 'px'
        tip.style.top = r.top + r.height / 2 - tr.height / 2 + 'px'
        tip.classList.add('show')
    }
}
