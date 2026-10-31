import tippy, {createSingleton, CreateSingletonInstance, Instance} from 'tippy.js'

/**
 * The look of a mode button in the {@link EditorModeBar}: its colour and its icon (an SVG string).
 */
export interface EditorModeLook {
    color: string
    icon: string
}

/** The part of the editor that the mode bar uses */
export interface EditorModeBarHost {
    /** The names of the modes, a button for each */
    modeKeys: string[]
    /** Shows the panels of a mode, and marks it in the mode bar ({@link EditorModeBar.select}), as `TweakpaneEditorPlugin` does */
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
 * - The button at the bottom steps through three states ({@link cycle}): the names next to the icons (like a sidebar)
 *   and the panel; the icons and the panel; the icons only, the panel hidden. Ctrl+\ (Cmd+\) does the same (in
 *   {@link EditorFrame}).
 * - Without the names, each button has a tooltip (tippy.js, the `editor` theme of the editor).
 *
 * The bar sets the CSS variable `--mb-width` on the root element, and the class `mb-panel-hidden` on the body when the
 * panel is hidden, for the page layout ({@link EditorFrame}).
 */
export class EditorModeBar {
    /**
     * The colour and icon of each mode name. A mode that is not here gets a grey dot. Read when the bar is made: set it
     * before `TweakpaneEditorPlugin.loadPlugins`.
     */
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
    static Widths = {narrow: 44, wide: 168}

    /** The media query of a window wide enough to show the names at the first visit (nothing stored) */
    static WideQuery = '(min-width: 920px)'

    /** The default `localStorage` key that keeps the names shown or hidden, or `null` to not keep them */
    static StorageKey: string | null = 'tpEditorModeBarExpanded'

    /** Called when the names are shown or hidden, with the new state (the toggle button, or {@link setExpanded}) */
    onExpandedChange?: (expanded: boolean) => void

    readonly element: HTMLDivElement
    private _buttons: HTMLButtonElement[]
    /** The tooltips of the buttons; one at a time, moving between the buttons */
    private _tips: Instance[] = []
    private _tipGroup: CreateSingletonInstance
    private _toggle: HTMLButtonElement
    private _toggleTip: Instance
    /** The key of {@link cycle}, for the tooltip */
    private _key: string
    private _selected = 0
    private _open = true
    private _expanded = true
    /** The tooltips are off while a menu of a button of the bar is open ({@link holdTooltips}) */
    private _tipsHeld = false

    /**
     * @param editor - the editor with the modes
     * @param host - the element the bar is added to
     * @param panel - returns the element that is hidden when the open mode is clicked again (the Tweakpane container)
     * @param storageKey - the `localStorage` key that keeps the names shown or hidden, or `null` to not keep it.
     * Default: {@link EditorModeBar.StorageKey}. At the first visit, the names are shown in a window 920 px wide or more
     * ({@link EditorModeBar.WideQuery}); a narrower window (a phone) has no room for them.
     */
    constructor(readonly editor: EditorModeBarHost, host: HTMLElement, readonly panel?: () => HTMLElement | null, readonly storageKey: string | null = EditorModeBar.StorageKey) {
        const bar = document.createElement('div')
        bar.className = 'mb-root'
        bar.setAttribute('role', 'tablist')
        bar.setAttribute('aria-orientation', 'vertical')
        this.element = bar
        this._expanded = window.matchMedia?.(EditorModeBar.WideQuery).matches ?? true
        if (storageKey) {
            try {
                const stored = localStorage.getItem(storageKey)
                if (stored !== null) this._expanded = stored !== '0'
            } catch (e) {
                // no storage: the default
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
        // Ctrl+\ (Cmd+\ on a Mac) does the same: the key is in EditorFrame
        const mac = /Mac|iPhone|iPad/.test(navigator.userAgent)
        this._key = mac ? '⌘\\' : 'Ctrl \\'
        this._toggle = this._button(TOGGLE_ICON, 'Collapse', '')
        this._toggleTip = this._tips[this._tips.length - 1]
        this._toggle.setAttribute('aria-keyshortcuts', mac ? 'Meta+Backslash' : 'Control+Backslash')
        this._toggle.classList.add('mb-toggle')
        this._toggle.addEventListener('click', () => this.cycle())
        this._tipGroup = createSingleton(this._tips, {placement: 'left', moveTransition: 'transform .15s ease-out', delay: [300, 0], appendTo: () => document.body})
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

    /**
     * One step of the collapse states, as the button at the bottom and Ctrl+\ do: the names and the panel → the icons
     * and the panel → the icons only (the panel hidden) → the names and the panel again. A window without room for the
     * names ({@link EditorModeBar.WideQuery}) skips the names. A click on the open mode still hides or shows the panel.
     */
    cycle() {
        const roomForNames = window.matchMedia?.(EditorModeBar.WideQuery).matches ?? true
        if (!this._open) {
            this.setOpen(true)
            if (roomForNames) this.setExpanded(true, true)
        } else if (this._expanded) {
            this.setExpanded(false, true)
        } else {
            this.setOpen(false)
        }
    }

    /**
     * Shows or hides the names next to the icons
     * @param expanded - the names are shown
     * @param keep - the person picked it (the toggle, Ctrl+\, a UI): it is kept in `localStorage` ({@link storageKey}).
     * A change from code is not, so the person's pick, or the default of the window width, comes back at the next visit.
     */
    setExpanded(expanded: boolean, keep = false) {
        this._expanded = expanded
        this.element.classList.toggle('mb-wide', expanded)
        this._refreshTips()
        this._refreshToggle()
        document.documentElement.style.setProperty('--mb-width', (expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow) + 'px')
        if (keep && this.storageKey) {
            try {
                localStorage.setItem(this.storageKey, expanded ? '1' : '0')
            } catch (e) {
                // no storage: this page only
            }
        }
        this.onExpandedChange?.(expanded)
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
        this._refreshToggle()
    }

    /** Opens a mode's panel (and shows the panel if it was hidden), like a click on its button */
    show(i: number) {
        if (i < 0 || i >= this._buttons.length) return
        if (i !== this._selected) this.editor.setSelectedMode(i) // it calls select
        if (!this._open) this.setOpen(true)
    }

    /** The label, the tooltip and the arrow of the button at the bottom name its next step ({@link cycle}) */
    private _refreshToggle() {
        const next = !this._open ? 'Show the panel' : this._expanded ? 'Hide the names' : 'Hide the panel'
        this._toggle.querySelector('.mb-label')!.textContent = !this._open ? 'Expand' : 'Collapse'
        this._toggleTip.setContent(`${next} (${this._key})`)
        this._toggle.setAttribute('aria-label', next)
        this._toggle.setAttribute('aria-expanded', String(this._open))
    }

    /**
     * Hides the tooltips of the bar and keeps them off while `held` is true, for a menu that a button of the bar opened
     * (the layout menu of {@link EditorFrame}): the tooltip would cover the menu. Then they show again, when the names
     * are hidden.
     */
    holdTooltips(held: boolean) {
        this._tipsHeld = held
        this._refreshTips()
    }

    /**
     * One tooltip at a time, from the singleton (its tooltips stay disabled, else a button would show two). Off when the
     * names are on the buttons, and while held. Disabling it also hides it.
     */
    private _refreshTips() {
        if (this._expanded || this._tipsHeld) this._tipGroup.disable()
        else this._tipGroup.enable()
    }

    /** Adds a tooltip to a button of the bar (not a mode), shown with the others when the names are hidden */
    addTooltip(button: HTMLElement, content: string) {
        this._tips.push(tippy(button, {content}))
        this._tipGroup.setInstances(this._tips)
    }

    dispose() {
        if (!this._open) this.setOpen(true)
        this._tipGroup.destroy()
        this._tips.forEach(t => t.destroy())
        this.element.remove()
        document.documentElement.style.removeProperty('--mb-width')
    }

    private _button(icon: string, label: string, color: string) {
        const b = document.createElement('button')
        b.className = 'mb-btn'
        if (color) b.style.setProperty('--mb-color', color)
        b.innerHTML = `${icon}<span class="mb-label"></span>`
        b.querySelector('.mb-label')!.textContent = label
        this._tips.push(tippy(b, {content: label}))
        this.element.appendChild(b)
        return b
    }
}
