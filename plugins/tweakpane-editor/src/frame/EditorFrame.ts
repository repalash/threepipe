import {bindActions, createDiv, createStyles} from 'threepipe'
import type {CommandAction, ThreeViewer} from 'threepipe'
import {EditorModeBar, EditorModeBarHost} from './EditorModeBar'
import {readStored, writeStored} from '../dom-utils'
import styles from './EditorFrame.css?inline'

/**
 * The layouts of {@link EditorFrame}:
 * - `titlebar`: a slim bar on top (app, file name); the canvas and the panel are edge to edge below it.
 * - `statusbar`: a slim bar at the bottom (app, file name), like a code editor.
 * - `floating`: the canvas fills the window; the panel and the mode bar float over it, with the same gap on every side.
 *   No bar, so no file name ({@link EditorFrame.documentName}).
 */
export type EditorFrameLayout = 'titlebar' | 'statusbar' | 'floating'

/** The names of the layouts, for menus */
export const EDITOR_FRAME_LAYOUTS: [EditorFrameLayout, string][] = [['titlebar', 'Title bar'], ['statusbar', 'Status bar'], ['floating', 'Floating panels']]

/**
 * The places of {@link EditorFrame} where panels go ({@link EditorFrame.addPanel}):
 * - `left`: the sidebar left of the canvas, from the top to the bottom of the frame;
 * - `bottom`: the strip below the canvas, between the left sidebar and the panel;
 * - `right`: the top part of the right sidebar, above the settings of the mode, in the panel (the container of the
 *   Tweakpane UI), with a split between them.
 *
 * The right sidebar is the panel with the {@link EditorModeBar}.
 */
export type EditorFrameArea = 'left' | 'bottom' | 'right'

/**
 * The areas whose size can change ({@link EditorFrame.setAreaSize}) and that can collapse
 * ({@link EditorFrame.setAreaCollapsed}): the left and the bottom area, and `right`, the panel.
 */
export type EditorFrameSizedArea = EditorFrameArea | 'right'

/** The CSS variable of the size of each area, on the body */
const AREA_SIZE_VARS: Record<EditorFrameSizedArea, string> = {
    left: '--lay-left-area-size',
    bottom: '--lay-bottom-area-size',
    right: '--tweakpane-ui-container-width',
}

/** The entry of a panel in the mode bar ({@link EditorFrame.addPanel}) */
export interface EditorFrameAreaOptions {
    /** The name of the entry. Default: {@link EditorFrame.AreaNames} */
    name?: string
    /** The icon of the entry: an SVG string, 16 px. Default: a sidebar or a strip */
    icon?: string
    /** The colour of the icon and of the mark while the area shows, as the colours of the modes. Default: the grey of the labels */
    color?: string
}

/** A panel of the frame ({@link EditorFrame.addPanel}): its entry in the mode bar, and the place where it starts */
export interface EditorFramePanelOptions extends EditorFrameAreaOptions {
    /** The place of the panel until the person moves it (its Move menu): `left` (default), `bottom` or `right` */
    area?: EditorFrameArea
}

/** A panel in the frame: its element in a section of its place, and its entry in the mode bar */
interface FramePanel {
    id: string
    element: HTMLElement
    options: EditorFramePanelOptions
    area: EditorFrameArea
    hidden: boolean
    /** Its place in the stack: 0 in the order it was added; a move puts it after the others ({@link EditorFrame.movePanel}) */
    order: number
    section: HTMLDivElement
    entry: HTMLButtonElement
}

/** The places in their order: the entries of the mode bar follow it */
const PLACES: EditorFrameArea[] = ['left', 'bottom', 'right']

/**
 * The part of its side of the window that a card of the floating layout takes ({@link EditorFrame.setAreaSpan}): it
 * starts `start` px after the gap of the window (from the top for the left card and the panel, from the left end of its
 * row for the bottom strip), and is `length` px long; no length: to the end of the side.
 */
export interface EditorFrameAreaSpan {
    start: number
    length?: number
}

/** An item of a menu of the bars: its name, whether it is the one picked now, and what a click on it does */
type MenuItem = [label: string, checked: boolean, onPick: () => void]

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
    /**
     * Called with a new name typed in the bars. When it is set, a click on the name edits it: Enter or a click outside
     * keeps it, Escape goes back. The caller sets {@link EditorFrame.documentName} (`TweakpaneEditorPlugin` does this,
     * and sends `documentNameChange`).
     */
    onRename?: (name: string) => void
    /**
     * Returns the panel: the mode bar hides and shows it, and the frame opens its root folder when it is folded.
     * `TweakpaneEditorPlugin` passes the container of the Tweakpane UI. Without it, the mode bar hides no panel.
     */
    panel?: () => HTMLElement | null
    /**
     * The viewer: while it has a `CommandsPlugin`, the keys of the frame are registered there as actions
     * ({@link EditorFrame.actions}). Without it (or without the plugin), the frame runs its keys itself.
     * `TweakpaneEditorPlugin` passes its viewer.
     */
    viewer?: ThreeViewer
}

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
    app: svg('<path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z"/><path d="M8 8l5.6-3.3M8 8v6.5M8 8L2.4 4.7"/>'),
    theme: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>'),
    layout: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 5.5h12M10 5.5v8"/>'),
    left: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/>'),
    right: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M10 2.5v11"/>'),
    bottom: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 10h12"/>'),
}

/**
 * The frame of the page around the editor: the layout of the canvas, the Tweakpane panel and the {@link EditorModeBar},
 * with a title bar or a status bar ({@link EditorFrameLayout}).
 *
 * - The bars show the app name, the name of the open file or project ({@link documentName}; a click edits it with
 *   {@link EditorFrameOptions.onRename}), a light or dark button and a layout menu.
 * - Shift+T switches between the light and dark theme of the same family ({@link EditorFrameOptions.themePairs}).
 * - The panel has no title of its own: the mode bar names the open mode and hides the panel.
 *
 * Made by `TweakpaneEditorPlugin` (its `layout`). The actions (light or dark, layout) are at the bottom of the mode bar in each layout. The body has the
 * class `lay-frame` and `lay-<layout>`. The canvas size follows the CSS of the layout, and the viewer follows the canvas
 * size (the ResizeObserver of `ThreeViewer`).
 *
 * The frame has three fixed places ({@link EditorFrameArea}): the left sidebar, the bottom strip below the canvas, and
 * the top of the right sidebar (above the settings of the mode, in the panel). An app adds panels to them with
 * {@link addPanel}, and the person moves them (the Move menu of their entry); an empty place takes
 * no room. The CSS variables `--lay-left-area`, `--lay-right-area` and `--lay-bottom-area` on the body are the width or
 * the height of each area (`0px` when it is empty). In the floating layout the areas are cards over the canvas, and
 * `--lay-left-inset` and `--lay-bottom-inset` are the parts of the canvas that the left and the bottom card cover with
 * their gap: the perf pill, the bar of the sticky notes and the tool bar keep out of them.
 *
 * The left area, the bottom area and the panel have a size and can collapse ({@link setAreaSize},
 * {@link setAreaCollapsed}). A drag on the inner edge of the area changes its size, between the limits of
 * {@link AreaLimits}; a drag past half of the smallest size collapses it, and a drag out of the edge opens it again. A
 * double-click on the edge sets the default size, or opens a collapsed area. The sizes and the collapsed left and bottom
 * areas that the person picks are kept in `localStorage` ({@link AreaStorageKey}). The panel collapses as the mode bar
 * hides it, and the mode bar shows it again.
 *
 * The layout changes at the window widths of {@link Breakpoints}. Side by side (`lay-side`), the canvas, the panel and
 * the mode bar are next to each other. In a portrait window under 920 px wide (a phone, `lay-stack`), the layout keeps
 * its bars (floating has no gap there); the canvas is on top at full width, and the panel and the mode bar are below it,
 * with the same height. The CSS variable `--lay-split` is the part of the height for the canvas: `0.45`, set on
 * `body.lay-frame` (a page sets another with a more specific rule, like `html body.lay-frame { --lay-split: 0.5; }`).
 * When the panel is hidden there, the mode bar is a row at the bottom.
 *
 * The mode bar lists the modes, then an entry for each panel (its name and icon from {@link addPanel}). A tap on an
 * entry shows or hides its panel ({@link setPanelHidden}), a right-click or a long press moves it ({@link movePanel}). In a
 * narrow window (`lay-single`), the place of the panel shows one of them at a time ({@link setStackedArea}): a mode
 * shows the panel there, an entry shows its area, and a tap on the one shown hides that place.
 *
 * In the floating layout, the cards move and take a part of their side ({@link setAreaOffset}, {@link setAreaSpan}), and
 * a head at the top of the left column shows the logo, the app name and the file name.
 */
export class EditorFrame {
    /** The default theme pairs: Shift+T goes from one to the other */
    static ThemePairs: [string, string][] = [['clean', 'clean-dark'], ['light', 'dark'], ['white', 'black']]

    /**
     * The smallest and the largest size of each area in px ({@link setAreaSize}, a drag of its edge). The bottom area is
     * also at most half of the window, and the left area and the panel leave {@link MinCanvasWidth} for the canvas, next
     * to each other and the mode bar.
     */
    static AreaLimits: Record<EditorFrameSizedArea, [number, number]> = {left: [160, 480], bottom: [80, 400], right: [240, 600]}

    /** The width in px that the left area and the panel leave for the canvas ({@link AreaLimits}) */
    static MinCanvasWidth = 240

    /** The smallest length in px of a card of the floating layout along its side ({@link setAreaSpan}) */
    static MinCardLength = 120

    /** The smallest size in px of a panel in the stack of a place, when a drag moves the split ({@link addPanel}) */
    static MinSectionSize = 48

    /**
     * The `localStorage` key that keeps the sizes and the collapsed left and bottom areas that the person picks (a drag
     * or a double-click of an edge), or `null` to not keep them. Read when the frame is made.
     */
    static AreaStorageKey: string | null = 'tpEditorFrameAreas'

    /**
     * The window widths in px where the layout of the frame changes (read on each resize; change them before the frame is
     * made, or call a resize):
     * - `stack`: a portrait window narrower than this (a phone) has the canvas on top and the panel below it (the body
     *   class `lay-stack`); else the parts are side by side (`lay-side`).
     * - `singleView`: a window narrower than this, in any orientation, has no room for the left and the bottom area next
     *   to the canvas (the smallest left area, panel, mode bar and canvas: 160 + 240 + 44 + 240 = 684 px). The areas then
     *   show in the place of the panel, one view at a time, picked with their entries in the mode bar (`lay-single`, also
     *   set with `lay-stack`, see {@link setStackedArea}).
     */
    static Breakpoints = {stack: 920, singleView: 700}

    /** The names of the places: the default names of the entries of the panels, and the Move menu ({@link addPanel}) */
    static AreaNames: Record<EditorFrameArea, string> = {left: 'Left sidebar', bottom: 'Bottom strip', right: 'Right sidebar'}

    /** The time in ms of a press on the entry of a panel, on a touch screen, that opens its Move menu ({@link addPanel}) */
    static LongPressTime = 500

    readonly modeBar: EditorModeBar
    private _layout: EditorFrameLayout
    private _documentName = ''
    private _top: HTMLDivElement
    private _bottom: HTMLDivElement
    /** The head of the floating layout (it has no bar): the logo, the app name and the file name, at the top of the left column */
    private _head: HTMLDivElement
    /** The actions in the mode bar, above the names toggle */
    private _modeActions: HTMLDivElement
    /** The boxes of the places, with the sections of their panels ({@link addPanel}); left and bottom in the page while the frame is */
    private _areas: Record<EditorFrameArea, HTMLDivElement>
    /** The panels ({@link addPanel}), in the order they were added; and the box of their entries in the mode bar */
    private _panels = new Map<string, FramePanel>()
    private _entryBox: HTMLDivElement
    /** The place and the hidden state that the person picked for each panel (its entry, its Move menu), by id; kept */
    private _picks: Record<string, {area?: EditorFrameArea, hidden?: boolean, order?: number}> = {}
    /** The count of the moves: the order of the last moved panel */
    private _moves = 0
    /** The size of each panel in the stack of its place, as a weight (`flex-grow`), by id; kept; not set: 1 */
    private _weights: Record<string, number> = {}
    /** The edges that a drag resizes, in the page while the frame is */
    private _handles: Record<EditorFrameSizedArea, HTMLDivElement>
    /** The sizes set in px ({@link setAreaSize}), and kept; not set: the size of the CSS */
    private _sizes: Partial<Record<EditorFrameSizedArea, number>> = {}
    /** The sizes on screen: {@link _sizes} within the room that is left now ({@link _fitAreas}) */
    private _applied: Partial<Record<EditorFrameSizedArea, number>> = {}
    /** The grips of the floating cards ({@link setAreaOffset}) and their ends ({@link setAreaSpan}), in the page while the frame is */
    private _grips: HTMLDivElement[]
    /** The offsets set in px ({@link setAreaOffset}), and kept; and the offsets on screen, within the room */
    private _offsets: Partial<Record<EditorFrameSizedArea, number>> = {}
    private _appliedOffsets: Partial<Record<EditorFrameSizedArea, number>> = {}
    /** The spans set ({@link setAreaSpan}), and kept; and the spans on screen, with the length of a card that fills its side */
    private _spans: Partial<Record<EditorFrameSizedArea, EditorFrameAreaSpan>> = {}
    private _appliedSpans: Partial<Record<EditorFrameSizedArea, Required<EditorFrameAreaSpan>>> = {}
    /** The collapsed left and bottom areas; the panel collapses as the mode bar hides it */
    private _collapsed: Partial<Record<EditorFrameArea, boolean>> = {}
    /** The collapses that the person picked (`keep`), the ones that {@link _storeAreas} writes */
    private _keptCollapsed: Partial<Record<EditorFrameArea, boolean>> = {}
    /** The line between the right area and the settings of the mode, in the panel ({@link addPanel} `right`) */
    private _rightSplit: HTMLDivElement
    /** The part of the panel height for the right area, 0 to 1, with the settings of the mode under it; kept */
    private _rightShare = 0.5
    /** The settings of the mode are hidden, while the right area shows ({@link setModeSettingsHidden}) */
    private _modeHidden = false
    /** The area in the place of the panel in a narrow window ({@link setStackedArea}) */
    private _stacked: EditorFrameSizedArea = 'right'
    /** Ends the drag of an edge that is in progress */
    private _endDrag?: () => void
    /** The open layout menu, and the button that opened it */
    private _menu?: HTMLDivElement
    private _menuAnchor?: HTMLElement
    /** The tooltips of the buttons in the bars */
    private _themePairs: [string, string][]
    private _styles?: HTMLStyleElement
    private _unbindActions: () => void

    /**
     * The keys of the frame, as actions (`bindActions` of threepipe: a `CommandsPlugin` of
     * {@link EditorFrameOptions.viewer} lists and runs them, else the frame does): Shift+T switches between the light and
     * the dark theme, Ctrl+\ (Cmd+\ on a Mac) steps through the collapse states of the mode bar and the panel. The
     * place of the T key, and the \ key or its place (a layout where it types another character).
     */
    readonly actions: CommandAction[] = [
        {id: 'editorFrame.toggleTheme', label: 'Light or dark theme', group: 'Editor', shortcut: 'Shift+KeyT', run: () => this.toggleTheme()},
        {id: 'editorFrame.cycleModeBar', label: 'Collapse or expand the mode bar', group: 'Editor', shortcut: 'Mod+\\', run: () => this.modeBar.cycle()},
    ]

    /**
     * @param editor - the editor with the modes, for the mode bar (`TweakpaneEditorPlugin`)
     * @param options - the layout, the app name, the theme and the callbacks
     */
    constructor(editor: EditorModeBarHost, readonly options: EditorFrameOptions = {}) {
        this._styles = createStyles(styles)
        this._themePairs = options.themePairs ?? EditorFrame.ThemePairs
        this._layout = options.layout ?? 'titlebar'

        this.modeBar = new EditorModeBar(editor, document.body, options.panel)

        const title = options.title ?? 'threepipe'
        this._top = this._bar('lay-top')
        this._top.innerHTML = `<span class="lay-app">${ICONS.app}<b></b><span class="lay-dim">Editor</span></span><span class="lay-sep"></span><span class="lay-file"></span>`
        this._top.querySelector('b')!.textContent = title
        // the status bar: the logo and the app name, as in the title bar and the floating head, then the file name
        this._bottom = this._bar('lay-bottom')
        this._bottom.innerHTML = `<span class="lay-app">${ICONS.app}<b></b></span><span class="lay-sep"></span><span class="lay-file"></span>`
        this._bottom.querySelector('b')!.textContent = title
        this._head = this._bar('lay-head')
        this._head.innerHTML = `<span class="lay-app">${ICONS.app}<b></b></span><span class="lay-sep"></span><span class="lay-file"></span>`
        this._head.querySelector('b')!.textContent = title
        if (options.onRename) for (const bar of [this._top, this._bottom, this._head]) this._editableName(bar.querySelector('.lay-file')!)
        // the same place in each layout: the mode bar, above the names toggle
        this._modeActions = createDiv({classList: ['lay-mode-actions'], addToBody: false})
        this._modeActions.append(...this._actions())
        this.modeBar.element.insertBefore(this._modeActions, this.modeBar.element.lastElementChild)
        // the right area is in the panel, placed when it has an element (_applyRight)
        this._areas = {left: this._area('left'), bottom: this._area('bottom'), right: createDiv({classList: ['lay-area', 'lay-area-right'], addToBody: false})}
        this._rightSplit = this._paneSplit()
        this._entryBox = createDiv({classList: ['lay-area-entries'], addToBody: false})
        // after the modes: before the actions and the names toggle
        this.modeBar.element.insertBefore(this._entryBox, this.modeBar.element.children[editor.modeKeys.length] ?? null)
        this._refreshEntries()
        this._handles = {left: this._handle('left'), bottom: this._handle('bottom'), right: this._handle('right')}
        this._grips = (['left', 'bottom', 'right'] as const).flatMap(a => [this._grip(a), this._end(a, 'start'), this._end(a, 'end')])
        this.modeBar.onLayoutChange = this._fitAreas
        this._restoreAreas()

        this._unbindActions = bindActions(options.viewer, this.actions)
        window.addEventListener('resize', this._fitAreas)
        this.modeBar.element.addEventListener('click', this._expandPanel)
        // before the click of a mode, which would hide the panel when its mode is the open one
        this.modeBar.element.addEventListener('click', this._onModeBarClick, true)
        this.setLayout(this._layout)
    }

    get layout() {
        return this._layout
    }

    /**
     * The name in the bars: the open file or project. The app sets it (the frame does not follow the loads); empty, the
     * bars show no name. `TweakpaneEditorPlugin.documentName` sets it and keeps it when the frame is made again.
     */
    get documentName() {
        return this._documentName
    }
    set documentName(name: string) {
        this._documentName = name
        for (const el of [this._top, this._bottom, this._head]) {
            el.querySelector('.lay-file')!.textContent = name
            el.classList.toggle('lay-noname', !name)
        }
    }

    /** A click on the name edits it in place (contenteditable): Enter or a blur keeps it, Escape goes back */
    private _editableName(el: HTMLElement) {
        el.classList.add('lay-editable')
        el.tabIndex = 0
        el.title = 'Rename'
        el.setAttribute('role', 'textbox')
        el.setAttribute('aria-label', 'Name')
        let cancel = false
        const edit = () => {
            if (el.isContentEditable) return
            cancel = false
            try {
                el.contentEditable = 'plaintext-only'
            } catch (e) {
                el.contentEditable = 'true' // no plaintext-only (an older browser)
            }
            el.focus()
            getSelection()?.selectAllChildren(el)
        }
        el.addEventListener('click', edit)
        el.addEventListener('keydown', e => {
            // the keys are for the text, not for the editor (Shift+T, Ctrl+\, the C key, undo)
            e.stopPropagation()
            if (!el.isContentEditable) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    edit()
                }
                return
            }
            // an IME uses Enter and Escape to end or drop the text it composes (Safari sends that key after the
            // composition ends, with the key code 229)
            // eslint-disable-next-line deprecation/deprecation
            if ((e.key === 'Enter' || e.key === 'Escape') && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                cancel = e.key === 'Escape'
                el.blur()
            }
        })
        el.addEventListener('blur', () => {
            if (!el.isContentEditable) return
            el.removeAttribute('contenteditable')
            const name = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
            if (!cancel && name && name !== this._documentName) this.options.onRename?.(name)
            // the name that is set (back to the old one after Escape, an empty name, or a caller that keeps it)
            this.documentName = this._documentName
            el.scrollLeft = 0 // the edit scrolled a long name to the caret: show its start, with the ellipsis
        })
    }

    setLayout(layout: EditorFrameLayout) {
        this._layout = layout
        // the menu shows the old layout, and its button can leave the page
        this._closeMenu()
        const body = document.body
        body.classList.add('lay-frame')
        for (const [k] of EDITOR_FRAME_LAYOUTS) body.classList.toggle('lay-' + k, k === layout)
        if (layout === 'titlebar') body.appendChild(this._top)
        else this._top.remove()
        if (layout === 'statusbar') body.appendChild(this._bottom)
        else this._bottom.remove()
        if (layout === 'floating') body.appendChild(this._head)
        else this._head.remove()
        this._expandPanel()
        this.documentName = this._documentName
        // the cards move only in the floating layout
        this._fitAreas()
    }

    /**
     * Adds a panel to the frame, or puts a new element in the panel of this id. A panel is an element in a place of the
     * frame, with an entry in the mode bar:
     * - The places are fixed: `left`, the sidebar left of the canvas; `bottom`, the strip below the canvas; `right`, the
     *   top of the right sidebar, above the settings of the mode, in the panel of the Tweakpane UI. The panel starts in
     *   `options.area` (`left`), until the person moves it: a right-click on its entry (a long press on a touch screen)
     *   opens a menu of the places ({@link movePanel}).
     * - The panels of a place are a stack, in the order they were added: the place is split between them, with a line
     *   between two (a gap with drag dots in the floating layout, where each panel is a card). A drag on it moves the
     *   split, at least {@link MinSectionSize} for each; a double-click makes them equal.
     * - The entry, after the modes, has the name, the icon and the colour of `options`. A tap on it shows or hides the
     *   panel ({@link setPanelHidden}); hiding the last shown panel of a place collapses the place. In a narrow window
     *   ({@link Breakpoints}) the left and the bottom place show in the place of the panel, one view at a time
     *   ({@link setStackedArea}).
     * - A place with a panel shows (the body class `lay-has-<area>`), and the canvas makes room for it (the floating
     *   layout: a card over the canvas); an empty place takes no room. The left place is `--lay-left-area-size` wide
     *   (`240px`), the bottom place `--lay-bottom-area-size` tall (`160px`), CSS variables on `body.lay-frame`.
     * - The place, the hidden state and the size in the stack that the person picks are kept by id in `localStorage`
     *   ({@link AreaStorageKey}), with the sizes.
     *
     * The panels go with the frame: `TweakpaneEditorPlugin.addPanel` adds them again when the plugin makes the frame again.
     * @param id - the id of the panel, for {@link removePanel}, {@link movePanel}, {@link setPanelHidden} and the kept state
     * @param element - the element of the panel; it fills its section
     * @param options - its entry in the mode bar (name, icon, colour) and the place where it starts
     */
    addPanel(id: string, element: HTMLElement, options: EditorFramePanelOptions = {}) {
        const old = this._panels.get(id)
        if (old) this._dropPanel(old)
        const section = createDiv({classList: ['lay-section'], addToBody: false})
        section.appendChild(element)
        const entry = this._entry(id)
        this._fillEntry(entry, options.area ?? 'left', options)
        const pick = this._picks[id]
        const area = pick?.area ?? options.area ?? 'left'
        const panel: FramePanel = {id, element, options, area, hidden: pick?.hidden ?? false, order: pick?.order ?? 0, section, entry}
        this._panels.set(id, panel)
        this._layoutArea(area)
        // the old place lost a panel; the new place is not settled: while the app adds its panels (a restore of the
        // kept picks), a hidden panel can come before the shown ones
        if (old && old.area !== area) {
            this._layoutArea(old.area)
            this._settleArea(old.area, false)
        }
        this._fitAreas()
    }

    /** Takes a panel out of the frame ({@link addPanel}); its kept place and size stay for when it is added again */
    removePanel(id: string) {
        const p = this._panels.get(id)
        if (!p) return
        this._dropPanel(p)
        this._layoutArea(p.area)
        this._settleArea(p.area, false)
        // the hidden mode settings belonged to the right place as it was (an app hid them for this panel, like swap)
        if (p.area === 'right') this.setModeSettingsHidden(false)
        this._fitAreas()
    }

    /** Takes the section and the entry of a panel out of the page (with the tooltip of the entry), and the panel out of the list */
    private _dropPanel(p: FramePanel) {
        p.section.remove()
        p.entry.remove()
        this.modeBar.removeTooltip(p.entry)
        this._panels.delete(p.id)
    }

    /**
     * Moves a panel to another place (`left`, `bottom` or `right`), at the end of its stack, and shows it (the place
     * opens when it was collapsed, the panel when the mode bar hid it for the right place; in a narrow window, the place
     * shows in the place of the panel). The Move menu of its
     * entry does this.
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as the person's pick
     */
    movePanel(id: string, area: EditorFrameArea, keep = false) {
        const p = this._panels.get(id)
        if (!p || !PLACES.includes(area)) return
        const from = p.area
        // the end of the stack of its new place, also in a new frame and after a reload (kept)
        if (from !== area) {
            p.area = area
            p.order = ++this._moves
        }
        p.hidden = false
        if (keep) this._picks[id] = {...this._picks[id], area, hidden: false, order: p.order}
        if (this._collapsed[area]) this._setCollapsed(area, false, keep)
        this._layoutArea(from)
        if (from !== area) {
            this._layoutArea(area)
            this._settleArea(from, keep)
            // the hidden mode settings belonged to the right place as it was (an app hid them for this panel, like swap)
            if (from === 'right') this.setModeSettingsHidden(false)
        }
        // a narrow window shows one place at a time: the new one; the right place is in the panel, which the mode bar
        // can have hidden
        if (this._isSingle()) this.setStackedArea(area, keep)
        else if (area === 'right' && !this.modeBar.open) this.modeBar.setOpen(true)
        this._fitAreas()
        if (keep) this._storeAreas()
    }

    /**
     * A place whose panels are all hidden (its last shown panel moved away or was removed) collapses, and its panels show
     * in it, for when it opens: as hiding the last shown panel of a place does ({@link setPanelHidden}). Else the place
     * would take room with nothing in it.
     */
    private _settleArea(area: EditorFrameArea, keep: boolean) {
        const list = this._areaPanels(area)
        if (!list.length || list.some(p => !p.hidden)) return
        // a kept hidden pick no longer holds: the panel shows in the place (also when this is not the person's pick),
        // else a reload would bring back an open place with only hidden panels
        let picked = false
        for (const p of list) {
            p.hidden = false
            if (!keep && !this._picks[p.id]?.hidden) continue
            this._picks[p.id] = {...this._picks[p.id], hidden: false}
            picked = true
        }
        this._applySections(area)
        this._setCollapsed(area, true, keep)
        if (picked && !keep) this._storeAreas()
    }

    /**
     * Shows or hides a panel, as its entry in the mode bar does. Hiding the last shown panel of a place collapses the
     * place instead (the panel stays shown in it, for when the place opens); showing a panel opens its place.
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as the person's pick
     */
    setPanelHidden(id: string, hidden: boolean, keep = false) {
        const p = this._panels.get(id)
        if (!p) return
        if (hidden && !this._areaPanels(p.area).some(q => q !== p && !q.hidden)) {
            this._setCollapsed(p.area, true, keep)
            return
        }
        p.hidden = hidden
        if (keep) this._picks[id] = {...this._picks[id], hidden}
        if (!hidden && this._collapsed[p.area]) this._setCollapsed(p.area, false, keep)
        this._applySections(p.area)
        this._fitAreas()
        if (keep) this._storeAreas()
    }

    /** Whether a panel is hidden in its place ({@link setPanelHidden}); a collapsed place does not hide its panels */
    isPanelHidden(id: string) {
        return !!this._panels.get(id)?.hidden
    }

    /** The place of a panel, or `undefined` for no panel of this id */
    panelArea(id: string): EditorFrameArea | undefined {
        return this._panels.get(id)?.area
    }

    /** The ids of the panels, in the order they were added */
    get panelIds() {
        return Array.from(this._panels.keys())
    }

    /** The place has a panel that is not hidden */
    private _hasShown(area: EditorFrameArea) {
        return this._areaPanels(area).some(p => !p.hidden)
    }

    /** The panels of a place, in their order in its stack */
    private _areaPanels(area: EditorFrameArea) {
        return Array.from(this._panels.values()).filter(p => p.area === area).sort((a, b) => a.order - b.order)
    }

    /** Puts the sections of the panels of a place in it, with a split between two, and the entries in their order */
    private _layoutArea(area: EditorFrameArea) {
        const list = this._areaPanels(area)
        const box = this._areas[area]
        box.replaceChildren()
        list.forEach((p, i) => {
            if (i > 0) box.appendChild(this._split(area, i))
            box.appendChild(p.section)
        })
        box.classList.toggle('lay-split-area', list.length > 1)
        // the entries: the places in their order, then the panels in the order of their stack
        for (const place of PLACES) for (const p of this._areaPanels(place)) this._entryBox.appendChild(p.entry)
        this._applySections(area)
    }

    /** The icon, the name and the colour of the entry of a panel in the mode bar ({@link addPanel}) */
    private _fillEntry(entry: HTMLButtonElement, area: EditorFrameArea, options: EditorFrameAreaOptions) {
        const name = options.name ?? EditorFrame.AreaNames[area]
        entry.innerHTML = options.icon ?? ICONS[area]
        const label = document.createElement('span')
        label.className = 'mb-label'
        label.textContent = name
        entry.appendChild(label)
        entry.setAttribute('aria-label', name)
        ;(entry as any)._tippy?.setContent(name)
        if (options.color) entry.style.setProperty('--mb-color', options.color)
        else entry.style.removeProperty('--mb-color')
    }

    /** Collapses or opens an area: the left and the bottom area as {@link setAreaCollapsed}; the right area in the panel */
    private _setCollapsed(area: EditorFrameArea, collapsed: boolean, keep: boolean) {
        if (area !== 'right') return this.setAreaCollapsed(area, collapsed, keep)
        this._collapsed.right = collapsed
        this._fitAreas()
        if (keep) this._keepCollapsed('right', collapsed)
    }

    private _keepCollapsed(area: EditorFrameArea, collapsed: boolean) {
        this._keptCollapsed[area] = collapsed
        this._storeAreas()
    }

    /**
     * Hides the settings of the mode in the panel while the right place shows panels ({@link addPanel}): the right place
     * takes the whole panel. A click on the open mode in the mode bar does this too, and a click on a mode shows them
     * again. Without the right area, the settings always show (the mode bar hides the panel). Not kept: an app sets it,
     * for example while something is selected (an inspector in the right area, its settings in place of the modes). A
     * panel that leaves the right place (a move or a remove) shows them again.
     */
    setModeSettingsHidden(hidden: boolean) {
        if (hidden === this._modeHidden) return
        this._modeHidden = hidden
        this._fitAreas()
    }

    /** The settings of the mode are hidden ({@link setModeSettingsHidden}) */
    get modeSettingsHidden() {
        return this._modeHidden
    }

    /** The right area takes room in the panel now: it has an element, it is not collapsed, and the panel is open */
    private _rightShown() {
        return this._hasShown('right') && !this._collapsed.right && this.modeBar.open
    }

    /**
     * Puts the right area first in the panel, with the split to the settings of the mode, or takes it out; sets the body
     * classes `lay-has-right`, `lay-right-shown` and `lay-mode-hidden`, and the weights of the two parts
     */
    private _applyRight() {
        const box = this._areas.right
        const panel = this.options.panel?.()
        const has = this._hasShown('right')
        const body = document.body
        if (has && panel) {
            // first the right area, then the split, then the pane of the Tweakpane UI
            let kids = Array.from(panel.children)
            if (kids[0] !== box) panel.insertBefore(box, kids[0] ?? null)
            kids = Array.from(panel.children)
            if (kids[1] !== this._rightSplit) panel.insertBefore(this._rightSplit, kids[1] ?? null)
        } else {
            box.remove()
            this._rightSplit.remove()
        }
        const shown = has && !!panel && !this._collapsed.right
        body.classList.toggle('lay-has-right', has)
        body.classList.toggle('lay-right-shown', shown)
        body.classList.toggle('lay-mode-hidden', shown && this._modeHidden)
        body.style.setProperty('--lay-right-box-grow', String(this._rightShare))
        body.style.setProperty('--lay-right-pane-grow', String(1 - this._rightShare))
    }

    /**
     * The line between the right area and the settings of the mode (a gap with drag dots in the floating layout): a drag
     * moves it, a double-click puts it back at the middle. Kept with the sizes.
     */
    private _paneSplit() {
        const el = createDiv({classList: ['lay-split', 'lay-pane-split'], addToBody: false})
        el.setAttribute('role', 'separator')
        el.setAttribute('aria-orientation', 'horizontal')
        el.title = 'Drag to resize, double-click for equal sizes'
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const box = this._areas.right.getBoundingClientRect().height
            const pane = Array.from(this.options.panel?.()?.children ?? []).find(c => c.classList.contains('tp-rotv'))?.getBoundingClientRect().height ?? 0
            const pair = box + pane
            if (pair <= 0) return
            const y0 = e.clientY
            this._drag(el, ['lay-resizing', 'lay-resizing-y'], (ev: PointerEvent) => {
                const min = Math.min(EditorFrame.MinSectionSize, pair / 2)
                const size = Math.max(min, Math.min(pair - min, box + ev.clientY - y0))
                this._rightShare = Math.round(size / pair * 1000) / 1000
                this._applyRight()
            })
        })
        el.addEventListener('dblclick', () => {
            this._rightShare = 0.5
            this._applyRight()
            this._storeAreas()
        })
        return el
    }

    /** Whether the panel at this index of the stack of a place is hidden ({@link setPanelHidden}) */
    private _sectionHidden(area: EditorFrameArea, index: number) {
        return !!this._areaPanels(area)[index]?.hidden
    }

    /** Hides the hidden sections of a stack, and the splits that are not between two shown sections; the weights of the shown ones */
    private _applySections(area: EditorFrameArea) {
        this._applySplits(area)
        // a place with only hidden panels (a restored pick) takes no room, as an empty one
        document.body.classList.toggle('lay-has-' + area, this._hasShown(area))
        let shownBefore = false
        const children = Array.from(this._areas[area].children) as HTMLElement[]
        const sections = this._sections(area)
        children.forEach((child, k) => {
            const i = sections.indexOf(child)
            if (i < 0) return
            const hidden = this._sectionHidden(area, i)
            child.classList.toggle('lay-section-hidden', hidden)
            const split = children[k - 1]
            if (split?.classList.contains('lay-split')) split.classList.toggle('lay-section-hidden', hidden || !shownBefore)
            shownBefore ||= !hidden
        })
        this._refreshEntries()
    }

    /**
     * Sets the size of an area in px: the width of the left area or the panel (`right`), the height of the bottom area.
     * It is kept between the limits of {@link AreaLimits}, and leaves room for the canvas. When the window gets smaller,
     * or another area or the panel opens, the area gets smaller to leave that room, and its size comes back when there is
     * room again. `null` sets the size of the CSS again (240 px, 160 px, and the panel width of the Tweakpane UI).
     * @param area - `left`, `bottom` or `right` (the panel)
     * @param size - the size in px, or `null`
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as a size that the person picks
     */
    setAreaSize(area: EditorFrameSizedArea, size: number | null, keep = false) {
        if (size === null) {
            delete this._sizes[area]
            delete this._applied[area]
            document.body.style.removeProperty(AREA_SIZE_VARS[area])
            // the size of the CSS can be larger: the other areas make room first, this one keeps its size if it can
            this._fit(area)
        } else {
            const [min, max] = EditorFrame.AreaLimits[area]
            // the offsets of the other cards give way to a size that is set: it is on screen first, then the others fit
            this._sizes[area] = Math.round(Math.max(min, Math.min(max, this._room(area, false), size)))
            this._applySize(area, false)
            this._fit(area)
        }
        if (keep) this._storeAreas()
    }

    /**
     * Collapses an area or opens it again. A collapsed left or bottom area is hidden and takes no room; the edge stays,
     * to drag it out or double-click it. The panel (`right`) collapses as the mode bar hides it ({@link EditorModeBar.setOpen}).
     * @param area - `left`, `bottom` or `right` (the panel)
     * @param collapsed - collapse or open
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as the person's pick. Not for the panel.
     */
    setAreaCollapsed(area: EditorFrameSizedArea, collapsed: boolean, keep = false) {
        if (area === 'right') {
            if (this.modeBar.open === collapsed) this.modeBar.setOpen(!collapsed)
            return
        }
        this._collapsed[area] = collapsed
        document.body.classList.toggle('lay-collapsed-' + area, collapsed)
        this._fitAreas()
        if (keep) this._keepCollapsed(area, collapsed)
    }

    /** Whether an area is collapsed ({@link setAreaCollapsed}); the panel (`right`) when the mode bar hides it */
    isAreaCollapsed(area: EditorFrameSizedArea) {
        return area === 'right' ? !this.modeBar.open : !!this._collapsed[area]
    }

    /** The area that the place of the panel shows in a narrow window ({@link setStackedArea}) */
    get stackedArea() {
        return this._stacked
    }

    /**
     * Sets the area that shows in the place of the panel in a narrow window (below the canvas on a phone, in the right
     * column of a narrow landscape window, see {@link Breakpoints}), where there is no room for the areas next to the
     * canvas: the panel (`right`, the default), or the left or the bottom area. The mode bar stays next to it: a tap on a
     * mode shows the panel again, a tap on the entry of an area shows that area. A left or bottom area without an element
     * shows the panel. It opens the place of the panel when the mode bar hid it. When the areas show next to the canvas,
     * this has no effect (it is kept for the next narrow window). The body has the class `lay-stacked-left` or
     * `lay-stacked-bottom`.
     * @param area - `right` (the panel), `left` or `bottom`
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as the person's pick (an entry of the mode bar)
     */
    setStackedArea(area: EditorFrameSizedArea, keep = false) {
        this._stacked = area
        for (const a of ['left', 'bottom']) document.body.classList.toggle('lay-stacked-' + a, a === area)
        if (!this.modeBar.open) this.modeBar.setOpen(true)
        this._refreshEntries()
        if (keep) this._storeAreas()
    }

    /**
     * Moves a card of the floating layout away from its side of the window, on the axis of its size: the left card to the
     * right, the bottom card up, the panel with the mode bar to the left. The card stays within the room that leaves
     * {@link MinCanvasWidth} for the canvas (the bottom card: within half of the window height); when the window gets
     * smaller, the offset gets smaller first, then the size. It applies only in the floating layout with the areas next to
     * the canvas (not in a narrow window, see {@link Breakpoints}); elsewhere it is kept for later. A drag of the grip of
     * a card (a strip in the gap on its side of the window) sets it and the start of its span ({@link setAreaSpan}); a
     * double-click of the grip puts the card back. The CSS variable `--lay-<area>-offset` on the body.
     * @param area - `left`, `bottom` or `right` (the panel and the mode bar)
     * @param offset - the offset in px, or `null` for none
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as the person's pick
     */
    setAreaOffset(area: EditorFrameSizedArea, offset: number | null, keep = false) {
        if (offset === null) delete this._offsets[area]
        else this._offsets[area] = Math.round(Math.max(0, offset))
        this._fit(area)
        if (keep) this._storeAreas()
    }

    /** The offset of a card on screen in px ({@link setAreaOffset}): 0 when it is not moved, or outside the floating layout */
    areaOffset(area: EditorFrameSizedArea) {
        return this._appliedOffsets[area] ?? 0
    }

    /**
     * Sets the part of its side that a card of the floating layout takes: the top and the height of the left card and of
     * the panel with the mode bar, the left end and the width of the bottom card (in its row, between the left card and
     * the panel). The length is at least {@link MinCardLength}, and the card stays in its side. `null`: the whole side
     * (the default). It applies where {@link setAreaOffset} applies. A drag of the ends of a card (the top and the bottom
     * edge, or the left and the right end) sets it, and a double-click of an end fills the side again; a drag of the grip
     * moves the card along its side. The CSS variables `--lay-<area>-start` and `--lay-<area>-length` on the body.
     * @param area - `left`, `bottom` or `right` (the panel and the mode bar)
     * @param span - the start and the length in px ({@link EditorFrameAreaSpan}), or `null`
     * @param keep - keep it in `localStorage` ({@link AreaStorageKey}), as the person's pick
     */
    setAreaSpan(area: EditorFrameSizedArea, span: EditorFrameAreaSpan | null, keep = false) {
        if (span === null) delete this._spans[area]
        else {
            const start = Math.round(Math.max(0, span.start))
            this._spans[area] = span.length === undefined ? {start} : {start, length: Math.round(Math.max(EditorFrame.MinCardLength, span.length))}
        }
        this._fit(area)
        if (keep) this._storeAreas()
    }

    /** The span of a card on screen in px ({@link setAreaSpan}), with the length of a card that fills its side; `undefined` outside the floating layout */
    areaSpan(area: EditorFrameSizedArea): Required<EditorFrameAreaSpan> | undefined {
        const span = this._appliedSpans[area]
        return span && {...span}
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
        this._unbindActions()
        window.removeEventListener('resize', this._fitAreas)
        this.modeBar.onLayoutChange = undefined
        this.modeBar.element.removeEventListener('click', this._expandPanel)
        this.modeBar.element.removeEventListener('click', this._onModeBarClick, true)
        for (const [k] of EDITOR_FRAME_LAYOUTS) document.body.classList.remove('lay-' + k)
        document.body.classList.remove('lay-stacked-left', 'lay-stacked-bottom', 'lay-stack', 'lay-side', 'lay-single')
        document.body.classList.remove('lay-frame')
        this._top.remove()
        this._bottom.remove()
        this._head.remove()
        this._modeActions.remove()
        this._entryBox.remove()
        for (const [area, el] of Object.entries(this._areas)) {
            el.remove()
            document.body.classList.remove('lay-has-' + area, 'lay-collapsed-' + area)
        }
        this._rightSplit.remove()
        document.body.classList.remove('lay-right-shown', 'lay-mode-hidden')
        document.body.style.removeProperty('--lay-right-box-grow')
        document.body.style.removeProperty('--lay-right-pane-grow')
        this._endDrag?.()
        for (const el of [...Object.values(this._handles), ...this._grips]) el.remove()
        // the classic layout has the sizes of the Tweakpane UI
        for (const v of Object.values(AREA_SIZE_VARS)) document.body.style.removeProperty(v)
        for (const area of Object.keys(AREA_SIZE_VARS)) {
            for (const k of ['offset', 'start', 'length']) document.body.style.removeProperty(`--lay-${area}-${k}`)
        }
        this._closeMenu()
        this.modeBar.dispose()
        this._styles?.remove()
    }

    /**
     * The panel has no title in the frame (the mode bar hides and shows it), so it is opened if it was folded (the
     * Tweakpane UI starts folded on a phone): when a layout applies, and on a click in the mode bar.
     */
    private _expandPanel = () => {
        // the main pane, a child of the panel: not the pane of a Tweakpane UI in a section of the panel
        const root = Array.from(this.options.panel?.()?.children ?? []).find(c => c.classList.contains('tp-rotv')) as HTMLElement | undefined
        if (root && !root.classList.contains('tp-rotv-expanded')) root.querySelector<HTMLElement>('.tp-rotv_b')?.click()
    }

    /** A narrow window ({@link Breakpoints}): the place of the panel shows one view at a time */
    private _isSingle() {
        return document.body.classList.contains('lay-single')
    }

    /** Sets the body classes of the layout for the window size ({@link Breakpoints}) */
    private _applyBreakpoints() {
        const {stack: stackBelow, singleView} = EditorFrame.Breakpoints
        const stack = innerHeight >= innerWidth && innerWidth < stackBelow
        const body = document.body
        body.classList.toggle('lay-stack', stack)
        body.classList.toggle('lay-side', !stack)
        body.classList.toggle('lay-single', stack || innerWidth < singleView)
    }

    /** The left or the bottom area that the place of the panel shows now, in a narrow window */
    private _stackedShown(): EditorFrameArea | undefined {
        const a = this._stacked
        if (a === 'right' || !this._hasShown(a)) return undefined
        return this._isSingle() ? a : undefined
    }

    /**
     * The entry of a panel in the mode bar: a tap shows or hides it; a right-click, or a long press on a touch screen,
     * opens its Move menu (the places)
     */
    private _entry(id: string) {
        let held = false
        const b = this._button(ICONS.left, '', '', () => {
            // the end of a long press that opened the menu is not a tap
            if (held) held = false
            else this._onPanelEntry(id)
        })
        b.classList.add('lay-area-entry')
        b.setAttribute('aria-haspopup', 'menu')
        let timer = 0
        let start: {x: number, y: number} | undefined
        const cancel = () => {
            clearTimeout(timer)
            timer = 0
            start = undefined
        }
        // a long press on Android also sends contextmenu, before or after the timer: one menu, and no tap after it
        b.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault()
            const touch = !!timer
            cancel()
            if (held) return
            this._toggleMenu(b, () => this._moveItems(id))
            held = touch
        })
        b.addEventListener('pointerdown', (e: PointerEvent) => {
            held = false
            if (e.pointerType === 'mouse') return
            start = {x: e.clientX, y: e.clientY}
            timer = window.setTimeout(() => {
                timer = 0
                held = true
                this._toggleMenu(b, () => this._moveItems(id))
            }, EditorFrame.LongPressTime)
        })
        b.addEventListener('pointermove', (e: PointerEvent) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel()
        })
        b.addEventListener('pointerup', cancel)
        b.addEventListener('pointercancel', cancel)
        return b
    }

    /** The Move menu of a panel: the places, the one of the panel checked */
    private _moveItems(id: string): MenuItem[] {
        const p = this._panels.get(id)
        return PLACES.map(area => [EditorFrame.AreaNames[area], p?.area === area, () => this.movePanel(id, area, true)])
    }

    /**
     * A tap on the entry of a panel. The right place (in the panel of the Tweakpane UI), or a wide window: the panel
     * shows or hides, and the pick is kept. A narrow window, for the left or the bottom place: the place in the place of
     * the panel; when it is there, the panel hides, or the place when it is the only one shown (as the open mode does).
     */
    private _onPanelEntry(id: string) {
        const p = this._panels.get(id)
        if (!p) return
        const area = p.area
        if (area === 'right') {
            // in the panel: a narrow window with a left or bottom place in its place, or the panel that the mode bar hid,
            // shows the panel again, with this panel in it (not a toggle of a panel that could not be seen)
            const covered = !!this._stackedShown() || !this.modeBar.open
            if (this._stackedShown()) this.setStackedArea('right', true)
            if (!this.modeBar.open) this.modeBar.setOpen(true)
            if (covered) {
                if (this._collapsed.right) this._setCollapsed('right', false, true)
                if (p.hidden) this.setPanelHidden(id, false, true)
                this._refreshEntries()
                return
            }
        }
        if (!this._isSingle() || area === 'right') {
            if (this._collapsed[area]) {
                this._setCollapsed(area, false, true)
                if (p.hidden) this.setPanelHidden(id, false, true)
                return
            }
            return this.setPanelHidden(id, !p.hidden, true)
        }
        const shown = this._stackedShown() === area && this.modeBar.open
        if (shown && !p.hidden) {
            if (this._areaPanels(area).some(q => q !== p && !q.hidden)) return this.setPanelHidden(id, true, true)
            return this.modeBar.setOpen(false)
        }
        if (p.hidden) this.setPanelHidden(id, false, true)
        this.setStackedArea(area, true)
    }

    /** Shows the box of the entries when there is a panel, and marks the entries of the panels that show */
    private _refreshEntries() {
        const single = this._isSingle()
        let any = false
        for (const area of PLACES) {
            const list = this._areaPanels(area)
            any ||= list.length > 0
            const areaShown = area === 'right' ? !this._collapsed.right && this.modeBar.open && !this._stackedShown() :
                single ? this._stackedShown() === area && this.modeBar.open : !this._collapsed[area]
            for (const p of list) {
                const shown = areaShown && !p.hidden
                p.entry.classList.toggle('lay-entry-on', shown)
                p.entry.setAttribute('aria-pressed', String(shown))
            }
        }
        this._entryBox.style.display = any ? '' : 'none'
    }

    /**
     * A tap on a mode while a left or bottom area is in the place of the panel: the panel comes back. A tap on the open
     * mode only does that (else the mode bar would hide the panel); another mode opens as usual.
     */
    private _onModeBarClick = (e: MouseEvent) => {
        const tab = (e.target as Element | null)?.closest?.('[role]')
        if (tab?.getAttribute('role') !== 'tab') return
        const open = tab.getAttribute('aria-selected') === 'true' && this.modeBar.open
        // a narrow window: a mode shows the panel in the place of an area; the open mode does not hide it then
        if (this._stackedShown()) {
            this.setStackedArea('right', true)
            this.setModeSettingsHidden(false)
            if (open) e.stopImmediatePropagation()
            return
        }
        // the mode bar hid the panel: a mode opens it with its settings (the mode bar opens it after this)
        if (!this.modeBar.open) return this.setModeSettingsHidden(false)
        // with the right area in the panel: the open mode hides or shows its settings, not the panel; another mode
        // shows its settings
        if (!this._rightShown()) return
        if (!open) return this.setModeSettingsHidden(false)
        e.stopImmediatePropagation()
        this.setModeSettingsHidden(!this._modeHidden)
    }

    private _bar(cls: string) {
        return createDiv({classList: ['lay-bar', cls], addToBody: false})
    }

    /** An empty place, in the page: hidden until {@link addPanel} puts a panel in it */
    private _area(area: EditorFrameArea) {
        return document.body.appendChild(createDiv({classList: ['lay-area', 'lay-area-' + area], addToBody: false}))
    }

    /**
     * The edge of an area that a drag resizes: the inner edge (right of the left area, left of the panel, top of the
     * bottom area). A drag past half of the smallest size collapses the area, a drag out opens it; the size is kept at
     * the end of the drag. A double-click sets the default size, or opens a collapsed area.
     */
    private _handle(area: EditorFrameSizedArea) {
        const el = document.body.appendChild(createDiv({classList: ['lay-handle', 'lay-handle-' + area], addToBody: false}))
        el.setAttribute('role', 'separator')
        el.setAttribute('aria-orientation', area === 'bottom' ? 'horizontal' : 'vertical')
        el.title = 'Drag to resize, double-click for the default size'
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const vertical = area !== 'bottom'
            // left grows to the right, the panel to the left, the bottom area up
            const sign = area === 'left' ? 1 : -1
            const start = vertical ? e.clientX : e.clientY
            const startSize = this.isAreaCollapsed(area) ? 0 : this._areaSize(area)
            const [min] = EditorFrame.AreaLimits[area]
            this._drag(el, ['lay-resizing', 'lay-resizing-' + (vertical ? 'x' : 'y')], (ev: PointerEvent) => {
                const size = startSize + sign * ((vertical ? ev.clientX : ev.clientY) - start)
                if (size < min / 2) return this.setAreaCollapsed(area, true)
                this.setAreaCollapsed(area, false)
                this.setAreaSize(area, size)
            }, () => {this._keptCollapsed[area] = !!this._collapsed[area]})
        })
        el.addEventListener('dblclick', () => {
            if (this.isAreaCollapsed(area)) this.setAreaCollapsed(area, false, true)
            else this.setAreaSize(area, null, true)
        })
        return el
    }

    /**
     * A drag of an edge or a grip from a press on `el`: `move` for each move of the pointer, then `done` and the areas are
     * kept at the end. `classes` are on the body while it lasts (the cursor).
     */
    private _drag(el: HTMLElement, classes: string[], move: (ev: PointerEvent) => void, done?: () => void) {
        this._endDrag?.()
        const end = () => {
            removeEventListener('pointermove', move)
            removeEventListener('pointerup', end)
            removeEventListener('pointercancel', end)
            document.body.classList.remove(...classes)
            el.classList.remove('lay-active')
            this._endDrag = undefined
            done?.()
            this._storeAreas()
        }
        addEventListener('pointermove', move)
        addEventListener('pointerup', end)
        addEventListener('pointercancel', end)
        document.body.classList.add(...classes)
        el.classList.add('lay-active')
        this._endDrag = end
    }

    /** The sections of the panels of a place, in order */
    private _sections(area: EditorFrameArea) {
        return Array.from(this._areas[area].children).filter(c => c.classList.contains('lay-section')) as HTMLElement[]
    }

    /**
     * Puts the weights of the panels of a place on their sections (kept by id; not set: 1). The shown panels get their
     * weights scaled to add up to their number: a section has no flex basis, and grow factors that add up to less than 1
     * would leave a part of the place empty (a panel of weight 0.5 alone, after a move or when the others hide). The kept
     * weights do not change.
     */
    private _applySplits(area: EditorFrameArea) {
        const list = this._areaPanels(area)
        const shown = list.filter(p => !p.hidden)
        const sum = shown.reduce((s, p) => s + (this._weights[p.id] ?? 1), 0)
        const scale = sum > 0 ? shown.length / sum : 1
        for (const p of list) {
            const w = this._weights[p.id] ?? 1
            p.section.style.flexGrow = String(p.hidden ? w : Math.round(w * scale * 1000) / 1000)
        }
    }

    /**
     * The split before the section `index` of a stack: a line (a gap with drag dots in the floating layout). A drag moves
     * it, between the two sections next to it; a double-click makes all the sections equal.
     */
    private _split(area: EditorFrameArea, index: number) {
        const el = createDiv({classList: ['lay-split'], addToBody: false})
        const vertical = area !== 'bottom'
        el.setAttribute('role', 'separator')
        el.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical')
        el.title = 'Drag to resize, double-click for equal sizes'
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const sections = this._sections(area)
            const sizes = sections.map(s => {
                const r = s.getBoundingClientRect()
                return vertical ? r.height : r.width
            })
            // the shown section before this split (a hidden one between takes no room)
            let a = index - 1
            while (a > 0 && this._sectionHidden(area, a)) a--
            const b = index
            const pair = sizes[a] + sizes[b]
            const p0 = vertical ? e.clientY : e.clientX
            this._drag(el, ['lay-resizing', 'lay-resizing-' + (vertical ? 'y' : 'x')], (ev: PointerEvent) => {
                const min = Math.min(EditorFrame.MinSectionSize, pair / 2)
                const size = Math.max(min, Math.min(pair - min, sizes[a] + (vertical ? ev.clientY : ev.clientX) - p0))
                // only the two panels next to the split change: they share their weights as their new sizes; the
                // others keep theirs (a hidden one measures 0 and would get no room when it shows again)
                const list = this._areaPanels(area)
                const [pa, pb] = [list[a], list[b]]
                if (!pa || !pb) return
                const pairWeight = (this._weights[pa.id] ?? 1) + (this._weights[pb.id] ?? 1)
                const wa = Math.round(pairWeight * size / pair * 1000) / 1000
                this._weights[pa.id] = wa
                this._weights[pb.id] = Math.round((pairWeight - wa) * 1000) / 1000
                this._applySplits(area)
            })
        })
        el.addEventListener('dblclick', () => {
            for (const p of this._areaPanels(area)) delete this._weights[p.id]
            this._applySplits(area)
            this._storeAreas()
        })
        return el
    }

    /**
     * The grip of a floating card: a strip in the gap on its side of the window. A drag moves the card on both axes, its
     * offset ({@link setAreaOffset}) and the start of its span ({@link setAreaSpan}; the card keeps its length while it
     * moves); a double-click puts the card back at its side, the whole side long.
     */
    private _grip(area: EditorFrameSizedArea) {
        const el = document.body.appendChild(createDiv({classList: ['lay-grip', 'lay-grip-' + area], addToBody: false}))
        el.title = 'Drag to move, double-click to put it back'
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const x0 = e.clientX, y0 = e.clientY
            const offset0 = this.areaOffset(area)
            const span0 = this._appliedSpans[area]
            if (!span0) return
            this._drag(el, ['lay-moving'], (ev: PointerEvent) => {
                const dx = ev.clientX - x0, dy = ev.clientY - y0
                // across: away from the side of the window; along: down the side, or to the right in the row
                const [across, along] = area === 'left' ? [dx, dy] : area === 'right' ? [-dx, dy] : [-dy, dx]
                this._offsets[area] = Math.max(0, Math.round(offset0 + across))
                this._spans[area] = {start: Math.max(0, Math.round(span0.start + along)), length: span0.length}
                this._fit(area)
            }, () => this._keepApplied(area))
        })
        el.addEventListener('dblclick', () => {
            delete this._offsets[area]
            delete this._spans[area]
            this._fit(area)
            this._storeAreas()
        })
        return el
    }

    /**
     * An end of a floating card along its side: the top (`start`) or the bottom edge (`end`) of the left card and the
     * panel, the left or the right end of the bottom card. A drag sets its span ({@link setAreaSpan}), a double-click
     * fills the side again.
     */
    private _end(area: EditorFrameSizedArea, which: 'start' | 'end') {
        const el = document.body.appendChild(createDiv({classList: ['lay-end', 'lay-end-' + area, `lay-end-${area}-${which}`], addToBody: false}))
        const horizontal = area === 'bottom'
        el.setAttribute('role', 'separator')
        el.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal')
        el.title = 'Drag to resize, double-click to fill the side'
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const p0 = horizontal ? e.clientX : e.clientY
            const span0 = this._appliedSpans[area]
            if (!span0) return
            const endAt = span0.start + span0.length
            this._drag(el, ['lay-resizing', 'lay-resizing-' + (horizontal ? 'x' : 'y')], (ev: PointerEvent) => {
                const d = (horizontal ? ev.clientX : ev.clientY) - p0
                if (which === 'end') this._spans[area] = {start: span0.start, length: Math.max(EditorFrame.MinCardLength, span0.length + d)}
                else {
                    // the other end stays
                    const start = Math.max(0, Math.min(endAt - EditorFrame.MinCardLength, span0.start + d))
                    this._spans[area] = {start, length: endAt - start}
                }
                this._fit(area)
            }, () => this._keepApplied(area))
        })
        el.addEventListener('dblclick', () => {
            delete this._spans[area]
            this._fit(area)
            this._storeAreas()
        })
        return el
    }

    /**
     * After a drag: the set offset and span of a card are the ones on screen, so the next drag starts from what is seen.
     * A card that reaches the end of its side keeps no length: it reaches the end also when the side gets longer or
     * shorter (another card hides or shows, the window changes); at both ends it fills the side again.
     */
    private _keepApplied(area: EditorFrameSizedArea) {
        if (this._offsets[area] !== undefined) this._offsets[area] = this.areaOffset(area)
        const span = this._appliedSpans[area]
        if (!this._spans[area] || !span) return
        if (span.start + span.length < this._fullLength(area) - 0.5) this._spans[area] = {...span}
        else if (span.start > 0) this._spans[area] = {start: span.start}
        else delete this._spans[area]
        // the same on screen; a span without a length leaves the length to the CSS
        this._applySpan(area)
    }

    /**
     * The largest size that leaves room for the canvas: half of the window for the bottom area; for the left area and the
     * panel, the window less the other one (when it shows) and its offset ({@link setAreaOffset}), the mode bar and
     * {@link MinCanvasWidth}. The size and the offset of the area itself share this room.
     * @param offsets - `false` to leave out the offset of the other one (a size that is set, which the offset gives way to)
     */
    private _room(area: EditorFrameSizedArea, offsets = true) {
        if (area === 'bottom') return innerHeight / 2
        const other = area === 'left' ?
            this.modeBar.open ? this._areaSize('right') : 0 :
            this._shows('left') ? this._areaSize('left') : 0
        const offset = offsets ? this.areaOffset(area === 'left' ? 'right' : 'left') : 0
        return innerWidth - other - offset - this._modeBarWidth() - EditorFrame.MinCanvasWidth
    }

    private _modeBarWidth() {
        return this.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
    }

    /** The cards move and take a part of their side: the floating layout, with the areas next to the canvas */
    private _movable() {
        return this._layout === 'floating' && !this._isSingle()
    }

    /** A length in px of the CSS of the body (a custom property, like `--lay-gap`); 0 when it is not set */
    private _cssPx(name: string) {
        return parseFloat(getComputedStyle(document.body).getPropertyValue(name)) || 0
    }

    /** The gap of the floating cards to the window (`--lay-gap`) */
    private _gap() {
        return this._cssPx('--lay-gap')
    }

    /** The height that the head of the floating layout takes from the left column, with its gap (`--lay-head`) */
    private _headRoom() {
        const head = this._cssPx('--lay-head')
        return head ? head + this._gap() : 0
    }

    /**
     * The length of the whole side of a floating card: the window height less the gaps for the panel, and also less the
     * head for the left card; for the bottom card, its row between the left card and the panel (with their offsets and gaps)
     */
    private _fullLength(area: EditorFrameSizedArea) {
        const gap = this._gap()
        if (area !== 'bottom') return innerHeight - 2 * gap - (area === 'left' ? this._headRoom() : 0)
        const left = this._shows('left') ? this._areaSize('left') + gap + this.areaOffset('left') : 0
        const right = (this.modeBar.open ? this._areaSize('right') : 0) + this._modeBarWidth() + 2 * gap + this.areaOffset('right')
        return innerWidth - left - gap - right
    }

    /** Puts the offset of a card on screen ({@link setAreaOffset}): within the room that its size leaves */
    private _applyOffset(area: EditorFrameSizedArea) {
        const prop = `--lay-${area}-offset`
        const card = area === 'right' || this._shows(area)
        const size = area === 'right' && !this.modeBar.open ? 0 : this._areaSize(area)
        const offset = this._movable() && card ? Math.round(Math.max(0, Math.min(this._offsets[area] ?? 0, this._room(area) - size))) : 0
        if (offset) {
            this._appliedOffsets[area] = offset
            document.body.style.setProperty(prop, offset + 'px')
        } else {
            delete this._appliedOffsets[area]
            document.body.style.removeProperty(prop)
        }
    }

    /** Puts the span of a card on screen ({@link setAreaSpan}): at least {@link MinCardLength} long, in its side */
    private _applySpan(area: EditorFrameSizedArea) {
        const style = document.body.style
        if (!this._movable() || !(area === 'right' || this._shows(area))) {
            delete this._appliedSpans[area]
            style.removeProperty(`--lay-${area}-start`)
            style.removeProperty(`--lay-${area}-length`)
            return
        }
        const full = this._fullLength(area)
        const set = this._spans[area] ?? {start: 0}
        const length = Math.round(Math.max(Math.min(EditorFrame.MinCardLength, full), Math.min(full, set.length ?? full - set.start)))
        const start = Math.round(Math.max(0, Math.min(set.start, full - length)))
        this._appliedSpans[area] = {start, length}
        if (start) style.setProperty(`--lay-${area}-start`, start + 'px')
        else style.removeProperty(`--lay-${area}-start`)
        // no length: the CSS fills the side from the start
        if (set.length !== undefined) style.setProperty(`--lay-${area}-length`, length + 'px')
        else style.removeProperty(`--lay-${area}-length`)
    }

    /**
     * The size of an area on screen in px: the width of the left area or the panel, the height of the bottom area. In a
     * narrow window, the width of the panel is the width of the area shown in its place.
     */
    private _areaSize(area: EditorFrameSizedArea) {
        const shown = area === 'right' ? this._stackedShown() : undefined
        const el = shown ? this._areas[shown] : area === 'right' ? this.options.panel?.() : this._areas[area]
        const r = el?.getBoundingClientRect()
        return (area === 'bottom' ? r?.height : r?.width) || this._applied[area] || EditorFrame.AreaLimits[area][0]
    }

    /** The area takes room next to the canvas now: it has an element and is not collapsed, or the panel is open */
    private _shows(area: EditorFrameSizedArea) {
        if (area === 'right') return this.modeBar.open
        return this._areas[area].children.length > 0 && !this._collapsed[area] && !this._isSingle()
    }

    /**
     * Puts the size of an area on screen, within the room that is left now ({@link _room}): the set size, or the size of
     * the CSS when none is set, made smaller only when the room is less
     * @param offsets - `false` to leave the offset of the other card out of the room ({@link _room})
     */
    private _applySize(area: EditorFrameSizedArea, offsets = true) {
        const size = this._sizes[area]
        if (size === undefined) {
            const prop = AREA_SIZE_VARS[area]
            const shrunk = this._applied[area] !== undefined
            delete this._applied[area]
            if (shrunk) document.body.style.removeProperty(prop)
            // stacked, the panel and the areas are as wide as the window
            if (!this._shows(area) || document.body.classList.contains('lay-stack')) return
            const room = this._room(area, offsets)
            if (this._areaSize(area) <= room) return
            const fit = Math.round(Math.max(EditorFrame.AreaLimits[area][0], room))
            this._applied[area] = fit
            document.body.style.setProperty(prop, fit + 'px')
            return
        }
        const applied = Math.round(Math.max(EditorFrame.AreaLimits[area][0], Math.min(size, this._room(area, offsets))))
        this._applied[area] = applied
        document.body.style.setProperty(AREA_SIZE_VARS[area], applied + 'px')
    }

    /**
     * Applies the set sizes again when the room changes: the window size, an area shown, emptied, collapsed or opened,
     * the panel or the names of the mode bar shown or hidden. The kept sizes also apply before the plugin sets the areas.
     */
    private _fitAreas = () => this._fit()

    /** {@link _fitAreas}, with one area fitted last: the one that the person just changed keeps its size if it can */
    private _fit(last?: EditorFrameSizedArea) {
        this._applyBreakpoints()
        const areas = (Object.keys(AREA_SIZE_VARS) as EditorFrameSizedArea[]).filter(a => a !== last)
        const order = last ? [...areas, last] : areas
        // the offsets get smaller first: fitted to the sizes of now, so no size gets smaller for the old offset of another card
        for (const area of order) this._applyOffset(area)
        for (const area of order) {
            this._applySize(area)
            this._applyOffset(area)
        }
        // the row of the bottom card is known after the sizes and the offsets
        for (const area of order) this._applySpan(area)
        this._applyRight()
        // the window can change between a phone and a wide window, and the panel can show or hide
        this._refreshEntries()
    }

    /**
     * Keeps the sizes, the collapsed left and bottom areas, the area in the place of the panel, the offsets and the spans of
     * the floating cards and the splits of the stacks ({@link AreaStorageKey})
     */
    private _storeAreas() {
        const key = EditorFrame.AreaStorageKey
        if (key) writeStored(key, JSON.stringify({sizes: this._sizes, collapsed: this._keptCollapsed, panels: this._picks, weights: this._weights, stacked: this._stacked, offsets: this._offsets, spans: this._spans, rightShare: this._rightShare}))
    }

    /** Applies what {@link _storeAreas} keeps; a value that is not of the frame is left out */
    private _restoreAreas() {
        const key = EditorFrame.AreaStorageKey
        let stored: {sizes?: Record<string, unknown>, collapsed?: Record<string, unknown>, stacked?: unknown,
            offsets?: Record<string, unknown>, spans?: Record<string, {start?: unknown, length?: unknown} | undefined>,
            panels?: Record<string, {area?: unknown, hidden?: unknown, order?: unknown} | undefined>, weights?: Record<string, unknown>, rightShare?: unknown} | undefined
        try {
            stored = JSON.parse(key && readStored(key) || 'null') ?? undefined
        } catch (e) {
            return // not a value of this frame
        }
        const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v)
        for (const area of Object.keys(AREA_SIZE_VARS) as EditorFrameSizedArea[]) {
            const size = stored?.sizes?.[area]
            const [min, max] = EditorFrame.AreaLimits[area]
            // the size that the person picked; the room of this window applies on screen only
            if (isNum(size)) this._sizes[area] = Math.round(Math.max(min, Math.min(max, size)))
            const offset = stored?.offsets?.[area]
            if (isNum(offset)) this._offsets[area] = Math.round(Math.max(0, offset))
            const span = stored?.spans?.[area]
            if (span && isNum(span.start)) {
                const start = Math.round(Math.max(0, span.start))
                this._spans[area] = isNum(span.length) ? {start, length: Math.round(Math.max(EditorFrame.MinCardLength, span.length))} : {start}
            }
        }
        if (isNum(stored?.rightShare) && stored.rightShare > 0 && stored.rightShare < 1) this._rightShare = stored.rightShare
        if (stored?.collapsed?.right === true) this._collapsed.right = this._keptCollapsed.right = true
        // the picks of the panels, applied when addPanel adds a panel of that id
        for (const [id, pick] of Object.entries(stored?.panels ?? {})) {
            if (!pick || typeof pick !== 'object') continue
            const area = PLACES.find(a => a === pick.area)
            const hidden = typeof pick.hidden === 'boolean' ? pick.hidden : undefined
            const order = isNum(pick.order) && pick.order > 0 ? Math.round(pick.order) : undefined
            if (area || hidden !== undefined) this._picks[id] = {...area ? {area} : {}, ...hidden !== undefined ? {hidden} : {}, ...order ? {order} : {}}
            if (order) this._moves = Math.max(this._moves, order)
        }
        for (const [id, w] of Object.entries(stored?.weights ?? {})) if (isNum(w) && w > 0) this._weights[id] = w
        for (const area of ['left', 'bottom'] as const) {
            if (stored?.collapsed?.[area] !== true) continue
            this._collapsed[area] = this._keptCollapsed[area] = true
            document.body.classList.add('lay-collapsed-' + area)
        }
        const stacked = stored?.stacked
        this.setStackedArea(stacked === 'left' || stacked === 'bottom' ? stacked : 'right')
        this._fitAreas()
    }

    /** The light or dark button and the layout button, in the mode bar */
    private _actions() {
        const buttons: HTMLButtonElement[] = []
        if (this.options.colorMode) buttons.push(this._button(ICONS.theme, 'Light or dark (Shift T)', 'Light / dark', () => this.toggleTheme()))
        buttons.push(this._button(ICONS.layout, 'Layout of the page', 'Layout', b => this._toggleMenu(b, () => this._layoutItems())))
        return buttons
    }

    /** A button in the mode bar, with a name that the wide mode bar shows and the tooltip of the mode bar */
    private _button(icon: string, tip: string, name: string, onClick: (b: HTMLButtonElement) => void) {
        const b = createDiv({elementTag: 'button', innerHTML: icon, classList: ['mb-btn', 'lay-mode-btn'], addToBody: false})
        const label = document.createElement('span')
        label.className = 'mb-label'
        label.textContent = name
        b.appendChild(label)
        this.modeBar.addTooltip(b, tip)
        b.setAttribute('aria-label', tip)
        b.addEventListener('click', () => onClick(b))
        return b
    }

    /** The items of the layout menu: the layouts of the frame, and the classic page when the app can switch to it */
    private _layoutItems(): MenuItem[] {
        const pick = this.options.onPickLayout
        return (pick ? EDITOR_PAGE_LAYOUTS : EDITOR_FRAME_LAYOUTS).map(([k, label]) => [label, k === this._layout, () => {
            if (pick) pick(k)
            else if (k !== 'classic') this.setLayout(k)
        }])
    }

    /** Opens a menu at its button, or closes it when that button opened it */
    private _toggleMenu(anchor: HTMLElement, items: () => MenuItem[]) {
        const wasOpen = this._menuAnchor === anchor
        this._closeMenu()
        if (!wasOpen) this._openMenu(anchor, items())
    }

    private _openMenu(anchor: HTMLElement, items: MenuItem[]) {
        const m = createDiv({classList: ['lay-menu'], addToBody: false})
        m.setAttribute('role', 'menu')
        for (const [label, checked, onPick] of items) {
            const it = createDiv({elementTag: 'button', addToBody: false})
            it.setAttribute('role', 'menuitemradio')
            it.setAttribute('aria-checked', String(checked))
            it.textContent = label
            it.addEventListener('click', () => {
                this._closeMenu()
                onPick()
            })
            m.appendChild(it)
        }
        document.body.appendChild(m)
        this._menu = m
        this._menuAnchor = anchor
        this._holdTooltip(anchor, true)
        const r = anchor.getBoundingClientRect()
        const mr = m.getBoundingClientRect()
        m.style.left = Math.min(innerWidth - mr.width - 8, r.left) + 'px'
        m.style.top = (r.bottom + mr.height + 8 > innerHeight ? r.top - mr.height - 4 : r.bottom + 4) + 'px'
        // the press that opened the menu is over: the next press outside the menu and its button closes it, as Escape
        document.addEventListener('pointerdown', this._onMenuPointerDown, true)
        document.addEventListener('keydown', this._onMenuKeyDown, true)
    }

    private _closeMenu() {
        if (!this._menu) return
        if (this._menuAnchor) this._holdTooltip(this._menuAnchor, false)
        this._menu.remove()
        this._menu = this._menuAnchor = undefined
        document.removeEventListener('pointerdown', this._onMenuPointerDown, true)
        document.removeEventListener('keydown', this._onMenuKeyDown, true)
    }

    /**
     * The tooltip of the button that opened the menu would cover its first item: off while the menu is open. The
     * buttons in the mode bar share the tooltip of the mode bar, so the mode bar holds it.
     */
    private _holdTooltip(anchor: HTMLElement, held: boolean) {
        if (this.modeBar.element.contains(anchor)) this.modeBar.holdTooltips(held)
    }

    private _onMenuPointerDown = (e: PointerEvent) => {
        const t = e.target as Node
        if (!this._menu?.contains(t) && !this._menuAnchor?.contains(t)) this._closeMenu()
    }

    private _onMenuKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this._closeMenu()
    }
}
