import {createStyles, ThreeViewer} from 'threepipe'
import {EditorModeBar, EditorModeBarHost} from './EditorModeBar'
import styles from './EditorFrame.css?inline'

/**
 * The layouts of {@link EditorFrame}:
 * - `titlebar`: a slim bar on top (app, file name, actions); the canvas and the panel are edge to edge below it.
 * - `statusbar`: no title; a slim bar at the bottom (file name, actions), like a code editor.
 * - `floating`: the canvas fills the window; the panel and the mode bar float over it, with the same gap on every side.
 */
export type EditorFrameLayout = 'titlebar' | 'statusbar' | 'floating'

/** The names of the layouts, for menus */
export const EDITOR_FRAME_LAYOUTS: [EditorFrameLayout, string][] = [['titlebar', 'Title bar'], ['statusbar', 'Status bar'], ['floating', 'Floating panels']]

/** The layout of the editor page: a frame layout, or `classic` for no frame (the mode tabs at the bottom) */
export type EditorPageLayout = EditorFrameLayout | 'classic'

/** The names of the page layouts, for menus */
export const EDITOR_PAGE_LAYOUTS: [EditorPageLayout, string][] = [...EDITOR_FRAME_LAYOUTS, ['classic', 'Classic (no frame)']]

export interface EditorFrameOptions {
    /** The first layout. Default: `titlebar`. */
    layout?: EditorFrameLayout
    /** The app name in the title bar */
    title?: string
    /** Theme pairs for {@link EditorFrame.toggleTheme} (light, dark) */
    themePairs?: [string, string][]
    /** Reads and sets the Tweakpane color mode, for the light or dark toggle (`TweakpaneUiPlugin.colorMode`) */
    colorMode?: {get(): string, set(mode: string): void}
    /**
     * Called with the layout picked in the layout menu. When it is set, the menu also has `classic` (no frame), and the
     * caller changes the layout (`TweakpaneEditorPlugin.layout` does this). Else the menu has the frame layouts, and a
     * pick calls {@link EditorFrame.setLayout}.
     */
    onPickLayout?: (layout: EditorPageLayout) => void
}

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
    app: svg('<path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z"/><path d="M8 8l5.6-3.3M8 8v6.5M8 8L2.4 4.7"/>'),
    theme: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>'),
    layout: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 5.5h12M10 5.5v8"/>'),
}

/**
 * The frame of the page around the editor: the layout of the canvas, the Tweakpane panel and the {@link EditorModeBar},
 * with a title bar or a status bar ({@link EditorFrameLayout}).
 *
 * - The bars show the app name and the name of the last loaded file, a light or dark button and a layout menu.
 * - Shift+T switches between the light and dark theme of the same family ({@link EditorFrameOptions.themePairs}).
 * - The panel has no title of its own: the mode bar names the open mode and hides the panel.
 *
 * Made by `TweakpaneEditorPlugin` (its `layout`). The layout applies at 920 px wide and more; below that, the page keeps
 * the editor's own layout. The floating layout has its actions in the mode bar. The body has the class `lay-frame` and
 * `lay-<layout>`.
 */
export class EditorFrame {
    /** The default theme pairs: Shift+T goes from one to the other */
    static ThemePairs: [string, string][] = [['clean', 'clean-dark'], ['light', 'dark'], ['white', 'black']]

    readonly modeBar: EditorModeBar
    private _layout: EditorFrameLayout
    private _fileName = 'Untitled'
    private _top: HTMLDivElement
    private _bottom: HTMLDivElement
    /** The actions in the mode bar, for the floating layout (it has no bar) */
    private _floatActions: HTMLDivElement
    private _menu?: HTMLDivElement
    private _themePairs: [string, string][]
    private _styles?: HTMLStyleElement

    constructor(readonly viewer: ThreeViewer, editor: EditorModeBarHost, readonly options: EditorFrameOptions = {}) {
        this._styles = createStyles(styles)
        this._themePairs = options.themePairs ?? EditorFrame.ThemePairs
        this._layout = options.layout ?? 'titlebar'

        this.modeBar = new EditorModeBar(editor, document.body, () => document.getElementById('tweakpaneUiContainer'))

        const title = options.title ?? 'threepipe'
        this._top = this._bar('lay-top')
        this._top.innerHTML = `<span class="lay-app">${ICONS.app}<b></b><span class="lay-dim">Editor</span></span><span class="lay-sep"></span><span class="lay-file"></span><span class="lay-fill"></span>`
        this._top.querySelector('b')!.textContent = title
        this._top.append(...this._actions())
        this._bottom = this._bar('lay-bottom')
        this._bottom.innerHTML = '<span class="lay-file"></span><span class="lay-fill"></span>'
        this._bottom.append(...this._actions())
        this._floatActions = document.createElement('div')
        this._floatActions.className = 'lay-float-actions'
        this._floatActions.append(...this._actions(true))

        viewer.assetManager.addEventListener('loadAsset', this._onLoad)
        window.addEventListener('keydown', this._onKeyDown)
        this._wide.addEventListener('change', this._onWideChange)
        this.modeBar.element.addEventListener('click', this._onModeBarClick)
        this.setLayout(this._layout)
    }

    get layout() {
        return this._layout
    }

    /** The file name in the bars. It is set to the name of each loaded file. */
    get fileName() {
        return this._fileName
    }
    set fileName(name: string) {
        this._fileName = name
        for (const el of [this._top, this._bottom]) el.querySelector('.lay-file')!.textContent = name
    }

    setLayout(layout: EditorFrameLayout) {
        this._layout = layout
        const body = document.body
        body.classList.add('lay-frame')
        for (const [k] of EDITOR_FRAME_LAYOUTS) body.classList.toggle('lay-' + k, k === layout)
        if (layout === 'titlebar') body.appendChild(this._top)
        else this._top.remove()
        if (layout === 'statusbar') body.appendChild(this._bottom)
        else this._bottom.remove()
        // above the names toggle of the mode bar
        if (layout === 'floating') this.modeBar.element.insertBefore(this._floatActions, this.modeBar.element.lastElementChild)
        else this._floatActions.remove()
        this._expandPanel()
        this.fileName = this._fileName
        // the canvas size follows the CSS; the viewer resizes on the window's resize
        window.dispatchEvent(new Event('resize'))
    }

    /** Switches between the light and the dark theme of the same family, when the current theme is in a pair */
    toggleTheme() {
        const cm = this.options.colorMode
        if (!cm) return
        const t = cm.get()
        const next = this._themePairs.map(([a, b]) => t === a ? b : t === b ? a : '').find(Boolean)
        if (next) cm.set(next)
    }

    dispose() {
        this.viewer.assetManager.removeEventListener('loadAsset', this._onLoad)
        window.removeEventListener('keydown', this._onKeyDown)
        this._wide.removeEventListener('change', this._onWideChange)
        this.modeBar.element.removeEventListener('click', this._onModeBarClick)
        for (const [k] of EDITOR_FRAME_LAYOUTS) document.body.classList.remove('lay-' + k)
        document.body.classList.remove('lay-frame')
        this._top.remove()
        this._bottom.remove()
        this._floatActions.remove()
        this._menu?.remove()
        this.modeBar.dispose()
        this._styles?.remove()
        window.dispatchEvent(new Event('resize'))
    }

    /** The window is wide enough for the frame (the media query of the CSS) */
    private _wide = window.matchMedia('(min-width: 920px)')

    /**
     * The panel has no title in the frame (the mode bar hides and shows it), so it is opened if it was folded: when a
     * layout applies, when the window becomes wide enough for the frame, and on a click in the mode bar. A narrow
     * window shows the title, which can fold it.
     */
    private _expandPanel = () => {
        const root = document.querySelector<HTMLElement>('#tweakpaneUiContainer .tp-rotv')
        if (root && !root.classList.contains('tp-rotv-expanded')) root.querySelector<HTMLElement>('.tp-rotv_b')?.click()
    }

    private _onWideChange = (e: MediaQueryListEvent) => {
        if (e.matches) this._expandPanel()
    }

    private _onModeBarClick = () => {
        if (this._wide.matches) this._expandPanel()
    }

    private _onLoad = (e: {data?: any}) => {
        const path: string | undefined = e.data?.userData?.rootPath || e.data?.__rootPath
        const base = path ? path.split(/[?#]/)[0].split('/').pop() || '' : ''
        let name = base
        try {
            name = decodeURIComponent(base)
        } catch (decodeError) {
            // a local file name is not URI-encoded ("100% model.glb"): show it as it is
        }
        if (name) this.fileName = name
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'KeyT' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return
        const t = e.target as HTMLElement | null
        if (t?.closest?.('input, textarea, select, [contenteditable]')) return
        e.preventDefault()
        this.toggleTheme()
    }

    private _bar(cls: string) {
        const bar = document.createElement('div')
        bar.className = 'lay-bar ' + cls
        return bar
    }

    /**
     * The light or dark button and the layout button
     * @param inModeBar - as buttons of the mode bar (the floating layout), with a name that the wide mode bar shows
     */
    private _actions(inModeBar = false) {
        const buttons: HTMLButtonElement[] = []
        if (this.options.colorMode) buttons.push(this._button(ICONS.theme, 'Light or dark (Shift T)', 'Light / dark', inModeBar, () => this.toggleTheme()))
        buttons.push(this._button(ICONS.layout, 'Layout of the page', 'Layout', inModeBar, b => this._layoutMenu(b)))
        return buttons
    }

    private _button(icon: string, tip: string, name: string, inModeBar: boolean, onClick: (b: HTMLButtonElement) => void) {
        const b = document.createElement('button')
        b.className = inModeBar ? 'mb-btn lay-float-btn' : 'lay-btn'
        b.innerHTML = icon
        if (inModeBar) {
            const label = document.createElement('span')
            label.className = 'mb-label'
            label.textContent = name
            b.appendChild(label)
        }
        b.title = tip
        b.setAttribute('aria-label', tip)
        b.addEventListener('click', () => onClick(b))
        return b
    }

    private _layoutMenu(anchor: HTMLElement) {
        this._menu?.remove()
        const m = document.createElement('div')
        m.className = 'lay-menu'
        m.setAttribute('role', 'menu')
        const pick = this.options.onPickLayout
        for (const [k, label] of pick ? EDITOR_PAGE_LAYOUTS : EDITOR_FRAME_LAYOUTS) {
            const it = document.createElement('button')
            it.setAttribute('role', 'menuitemradio')
            it.setAttribute('aria-checked', String(k === this._layout))
            it.textContent = label
            it.addEventListener('click', () => {
                m.remove()
                if (pick) pick(k)
                else if (k !== 'classic') this.setLayout(k)
            })
            m.appendChild(it)
        }
        document.body.appendChild(m)
        this._menu = m
        const r = anchor.getBoundingClientRect()
        const mr = m.getBoundingClientRect()
        m.style.left = Math.min(innerWidth - mr.width - 8, r.left) + 'px'
        m.style.top = (r.bottom + mr.height + 8 > innerHeight ? r.top - mr.height - 4 : r.bottom + 4) + 'px'
        setTimeout(() => document.addEventListener('pointerdown', ev => !m.contains(ev.target as Node) && m.remove(), {once: true}))
    }
}
