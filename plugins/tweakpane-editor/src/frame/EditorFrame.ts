import {createDiv, createStyles} from 'threepipe'
import tippy, {Instance} from 'tippy.js'
import {EditorModeBar, EditorModeBarHost} from './EditorModeBar'
import {isTextTarget, readStored, writeStored} from '../dom-utils'
import styles from './EditorFrame.css?inline'

/**
 * The layouts of {@link EditorFrame}:
 * - `titlebar`: a slim bar on top (app, file name, actions); the canvas and the panel are edge to edge below it.
 * - `statusbar`: no title; a slim bar at the bottom (file name, actions), like a code editor.
 * - `floating`: the canvas fills the window; the panel and the mode bar float over it, with the same gap on every side.
 *   No bar, so no file name ({@link EditorFrame.documentName}); the actions are in the mode bar.
 */
export type EditorFrameLayout = 'titlebar' | 'statusbar' | 'floating'

/** The names of the layouts, for menus */
export const EDITOR_FRAME_LAYOUTS: [EditorFrameLayout, string][] = [['titlebar', 'Title bar'], ['statusbar', 'Status bar'], ['floating', 'Floating panels']]

/**
 * The areas of {@link EditorFrame} that an app fills ({@link EditorFrame.setArea}):
 * - `left`: the sidebar left of the canvas, from the top to the bottom of the frame;
 * - `bottom`: the strip below the canvas, between the left sidebar and the panel.
 *
 * The right sidebar is the panel (the container of the Tweakpane UI) with the {@link EditorModeBar}.
 */
export type EditorFrameArea = 'left' | 'bottom'

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

/** The entry of an area in the mode bar ({@link EditorFrame.setArea}) */
export interface EditorFrameAreaOptions {
    /** The name of the entry. Default: {@link EditorFrame.AreaNames} */
    name?: string
    /** The icon of the entry: an SVG string, 16 px. Default: a sidebar or a strip */
    icon?: string
    /** The colour of the icon and of the mark while the area shows, as the colours of the modes. Default: the grey of the labels */
    color?: string
}

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
}

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
    app: svg('<path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z"/><path d="M8 8l5.6-3.3M8 8v6.5M8 8L2.4 4.7"/>'),
    theme: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>'),
    layout: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 5.5h12M10 5.5v8"/>'),
    left: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/>'),
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
 * Made by `TweakpaneEditorPlugin` (its `layout`). The floating layout has its actions in the mode bar. The body has the
 * class `lay-frame` and `lay-<layout>`. The canvas size follows the CSS of the layout, and the viewer follows the canvas
 * size (the ResizeObserver of `ThreeViewer`).
 *
 * The frame has fixed areas ({@link EditorFrameArea}): the left sidebar, the right sidebar (the panel and the mode bar)
 * and the bottom strip. An app puts an element in the left or the bottom area with {@link setArea}; an empty area takes
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
 * In a wide or a landscape window, the canvas, the panel and the mode bar are side by side. In a portrait window under
 * 920 px wide (a phone), the layout keeps its bars (floating has no gap there); the canvas is on top at full width, and
 * the panel and the mode bar are below it, with the same height. The CSS variable `--lay-split` is the part of the height
 * for the canvas: `0.45`, set on `body.lay-frame` (a page sets another with a more specific rule, like
 * `html body.lay-frame { --lay-split: 0.5; }`). When the panel is hidden there, the mode bar is a row at the bottom.
 *
 * The mode bar lists the modes, then an entry for each area with an element (its name and icon from {@link setArea}).
 * In a wide or a landscape window, the areas show next to the canvas, and a tap on an entry shows or hides its area
 * ({@link setAreaCollapsed}). On a phone, the part below the canvas shows one of them at a time
 * ({@link setStackedArea}): a mode shows the panel there, an entry shows its area, and a tap on the one shown hides
 * the part below the canvas.
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

    /** The smallest size in px of an element in a stack of an area ({@link setArea} with a list), when a drag moves the split */
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

    /** The default names of the entries of the areas in the mode bar ({@link setArea}) */
    static AreaNames: Record<EditorFrameArea, string> = {left: 'Left sidebar', bottom: 'Bottom strip'}

    readonly modeBar: EditorModeBar
    private _layout: EditorFrameLayout
    private _documentName = ''
    private _top: HTMLDivElement
    private _bottom: HTMLDivElement
    /** The head of the floating layout (it has no bar): the logo, the app name and the file name, at the top of the left column */
    private _head: HTMLDivElement
    /** The actions in the mode bar, for the floating layout (it has no bar) */
    private _floatActions: HTMLDivElement
    /** The elements of the areas ({@link setArea}), in the page while the frame is */
    private _areas: Record<EditorFrameArea, HTMLDivElement>
    /** The entries of the areas in the mode bar, after the modes, and their box */
    private _entries: Record<EditorFrameArea, HTMLButtonElement>
    private _entryBox: HTMLDivElement
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
    /** The sizes of the elements of a stack ({@link setArea} with a list), as weights (`flex-grow`), and kept; not set: equal */
    private _splits: Partial<Record<EditorFrameArea, number[]>> = {}
    /** The collapsed left and bottom areas; the panel collapses as the mode bar hides it */
    private _collapsed: Partial<Record<EditorFrameArea, boolean>> = {}
    /** The area below the canvas in a narrow portrait window ({@link setStackedArea}) */
    private _stacked: EditorFrameSizedArea = 'right'
    /** Ends the drag of an edge that is in progress */
    private _endDrag?: () => void
    /** The open layout menu, and the button that opened it */
    private _menu?: HTMLDivElement
    private _menuAnchor?: HTMLElement
    /** The tooltips of the buttons in the bars */
    private _tips: Instance[] = []
    private _themePairs: [string, string][]
    private _styles?: HTMLStyleElement

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
        this._top.innerHTML = `<span class="lay-app">${ICONS.app}<b></b><span class="lay-dim">Editor</span></span><span class="lay-sep"></span><span class="lay-file"></span><span class="lay-fill"></span>`
        this._top.querySelector('b')!.textContent = title
        this._top.append(...this._actions('top'))
        this._bottom = this._bar('lay-bottom')
        this._bottom.innerHTML = '<span class="lay-file"></span><span class="lay-fill"></span>'
        this._bottom.append(...this._actions('bottom'))
        this._head = this._bar('lay-head')
        this._head.innerHTML = `<span class="lay-app">${ICONS.app}<b></b></span><span class="lay-sep"></span><span class="lay-file"></span>`
        this._head.querySelector('b')!.textContent = title
        if (options.onRename) for (const bar of [this._top, this._bottom, this._head]) this._editableName(bar.querySelector('.lay-file')!)
        this._floatActions = createDiv({classList: ['lay-float-actions'], addToBody: false})
        this._floatActions.append(...this._actions('modeBar'))
        this._areas = {left: this._area('left'), bottom: this._area('bottom')}
        this._entryBox = createDiv({classList: ['lay-area-entries'], addToBody: false})
        this._entries = {left: this._entry('left'), bottom: this._entry('bottom')}
        // after the modes: before the actions (floating) and the names toggle
        this.modeBar.element.insertBefore(this._entryBox, this.modeBar.element.children[editor.modeKeys.length] ?? null)
        this._refreshEntries()
        this._handles = {left: this._handle('left'), bottom: this._handle('bottom'), right: this._handle('right')}
        this._grips = (['left', 'bottom', 'right'] as const).flatMap(a => [this._grip(a), this._end(a, 'start'), this._end(a, 'end')])
        this.modeBar.onLayoutChange = this._fitAreas
        this._restoreAreas()

        window.addEventListener('keydown', this._onKeyDown)
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
        // above the names toggle of the mode bar
        if (layout === 'floating') this.modeBar.element.insertBefore(this._floatActions, this.modeBar.element.lastElementChild)
        else this._floatActions.remove()
        this._expandPanel()
        this.documentName = this._documentName
        // the cards move only in the floating layout
        this._fitAreas()
    }

    /**
     * Puts an element in an area of the frame, in place of the element that is there, or empties the area (`null`).
     * - An area with an element shows (the body class `lay-has-<area>`), and the canvas makes room for it (the floating
     *   layout: the area is a card over the canvas). An empty area takes no room.
     * - The element fills the area. The area is `--lay-left-area-size` wide (`240px`) or `--lay-bottom-area-size` tall
     *   (`160px`), CSS variables on `body.lay-frame`; set others with a more specific rule, like
     *   `html body.lay-frame { --lay-left-area-size: 280px; }`.
     * - The mode bar has an entry for the area, after the modes, with the name and the icon of `options`. In a wide or a
     *   landscape window a tap on it shows or hides the area ({@link setAreaCollapsed}).
     * - A narrow portrait window (a phone) has no room for the areas next to the canvas: the part below the canvas shows
     *   one at a time, the panel by default, and a tap on the entry shows the area there ({@link setStackedArea}).
     *
     * - A list of elements is a stack: the area is split between them, with a line between two elements (a gap with drag
     *   dots in the floating layout, where each element is a card). A drag on it moves the split, at least
     *   {@link MinSectionSize} for each element; a double-click makes them equal. The split is kept with the sizes.
     *
     * The areas go with the frame: `TweakpaneEditorPlugin.setArea` keeps the element when the plugin makes the frame again.
     * @param area - `left` or `bottom` ({@link EditorFrameArea})
     * @param element - the element to show in the area, a list of elements for a stack (top to bottom in the left area,
     * left to right in the bottom area), or `null` for an empty area
     * @param options - the name and the icon of its entry in the mode bar
     */
    setArea(area: EditorFrameArea, element: HTMLElement | HTMLElement[] | null, options: EditorFrameAreaOptions = {}) {
        const elements = element === null ? [] : Array.isArray(element) ? element : [element]
        const box = this._areas[area]
        box.replaceChildren()
        // a stack: each element in a section, with a split between two sections
        box.classList.toggle('lay-split-area', elements.length > 1)
        if (elements.length === 1) box.appendChild(elements[0])
        else elements.forEach((el, i) => {
            if (i > 0) box.appendChild(this._split(area, i))
            const section = createDiv({classList: ['lay-section'], addToBody: false})
            section.appendChild(el)
            box.appendChild(section)
        })
        this._applySplits(area)
        document.body.classList.toggle('lay-has-' + area, elements.length > 0)
        const name = options.name ?? EditorFrame.AreaNames[area]
        const entry = this._entries[area]
        entry.innerHTML = options.icon ?? ICONS[area]
        const label = document.createElement('span')
        label.className = 'mb-label'
        label.textContent = name
        entry.appendChild(label)
        entry.setAttribute('aria-label', name)
        ;(entry as any)._tippy?.setContent(name)
        if (options.color) entry.style.setProperty('--mb-color', options.color)
        else entry.style.removeProperty('--mb-color')
        this._fitAreas()
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
            this._sizes[area] = Math.round(Math.max(min, Math.min(max, this._room(area), size)))
            // the offsets and the row of the bottom card follow the new size; this area keeps its size if it can
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
        if (keep) this._storeAreas()
    }

    /** Whether an area is collapsed ({@link setAreaCollapsed}); the panel (`right`) when the mode bar hides it */
    isAreaCollapsed(area: EditorFrameSizedArea) {
        return area === 'right' ? !this.modeBar.open : !!this._collapsed[area]
    }

    /** The area that the part below the canvas shows in a narrow portrait window ({@link setStackedArea}) */
    get stackedArea() {
        return this._stacked
    }

    /**
     * Sets the area that shows in the place of the panel in a narrow window (below the canvas on a phone, in the right
     * column of a narrow landscape window, see {@link Breakpoints}), where there is no room for the areas next to the canvas: the panel (`right`, the default), or the left or the
     * bottom area. The mode bar stays next to it: a tap on a mode shows the panel again, a tap on the entry of an area
     * shows that area. A left or bottom area without an element shows the panel. It opens the part below the canvas when
     * the mode bar hid it. A wider or a landscape window shows all the areas, so this has no effect there. The body has
     * the class `lay-stacked-left` or `lay-stacked-bottom`.
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
        window.removeEventListener('keydown', this._onKeyDown)
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
        this._floatActions.remove()
        this._entryBox.remove()
        for (const [area, el] of Object.entries(this._areas)) {
            el.remove()
            document.body.classList.remove('lay-has-' + area, 'lay-collapsed-' + area)
        }
        this._endDrag?.()
        for (const el of [...Object.values(this._handles), ...this._grips]) el.remove()
        // the classic layout has the sizes of the Tweakpane UI
        for (const v of Object.values(AREA_SIZE_VARS)) document.body.style.removeProperty(v)
        for (const area of Object.keys(AREA_SIZE_VARS)) {
            for (const k of ['offset', 'start', 'length']) document.body.style.removeProperty(`--lay-${area}-${k}`)
        }
        this._closeMenu()
        this._tips.forEach(t => t.destroy())
        this.modeBar.dispose()
        this._styles?.remove()
    }

    /**
     * The panel has no title in the frame (the mode bar hides and shows it), so it is opened if it was folded (the
     * Tweakpane UI starts folded on a phone): when a layout applies, and on a click in the mode bar.
     */
    private _expandPanel = () => {
        const root = this.options.panel?.()?.querySelector<HTMLElement>('.tp-rotv')
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

    /** The left or the bottom area that the part below the canvas shows now, in a narrow portrait window */
    private _stackedShown(): EditorFrameArea | undefined {
        const a = this._stacked
        if (a === 'right' || !this._areas[a].children.length) return undefined
        return this._isSingle() ? a : undefined
    }

    /** The entry of an area in the mode bar: hidden until {@link setArea} puts an element in the area */
    private _entry(area: EditorFrameArea) {
        const b = this._button(ICONS[area], EditorFrame.AreaNames[area], EditorFrame.AreaNames[area], 'modeBar', () => this._onEntry(area))
        b.classList.add('lay-area-entry')
        this._entryBox.appendChild(b)
        return b
    }

    /**
     * A tap on the entry of an area. On a phone: the area below the canvas, or, when it is there, the part below the
     * canvas hides (as the open mode does). Else: the area shows or hides, and the pick is kept.
     */
    private _onEntry(area: EditorFrameArea) {
        if (!this._isSingle()) return this.setAreaCollapsed(area, !this._collapsed[area], true)
        if (this._stackedShown() === area && this.modeBar.open) this.modeBar.setOpen(false)
        else this.setStackedArea(area, true)
    }

    /** Shows the entries of the areas with an element, and marks the ones whose area shows */
    private _refreshEntries() {
        const single = this._isSingle()
        let any = false
        for (const area of ['left', 'bottom'] as const) {
            const entry = this._entries[area]
            const filled = this._areas[area].children.length > 0
            any ||= filled
            entry.style.display = filled ? '' : 'none'
            const shown = filled && (single ? this._stackedShown() === area && this.modeBar.open : !this._collapsed[area])
            entry.classList.toggle('lay-entry-on', shown)
            entry.setAttribute('aria-pressed', String(shown))
        }
        this._entryBox.style.display = any ? '' : 'none'
    }

    /**
     * A tap on a mode while a left or bottom area is below the canvas: the panel comes back. A tap on the open mode
     * only does that (else the mode bar would hide the panel); another mode opens as usual.
     */
    private _onModeBarClick = (e: MouseEvent) => {
        const tab = (e.target as Element | null)?.closest?.('[role]')
        if (tab?.getAttribute('role') !== 'tab' || !this._stackedShown()) return
        this.setStackedArea('right', true)
        if (tab.getAttribute('aria-selected') === 'true' && this.modeBar.open) e.stopImmediatePropagation()
    }


    /** Shift+T: the light or dark theme. Ctrl+\ (Cmd+\ on a Mac): the next collapse state of the mode bar and the panel. */
    private _onKeyDown = (e: KeyboardEvent) => {
        if (e.altKey || e.repeat || e.defaultPrevented) return
        const mod = e.ctrlKey || e.metaKey
        const theme = e.code === 'KeyT' && e.shiftKey && !mod
        // the key (a layout with \ elsewhere), or its place (a layout where it types another character)
        const names = (e.key === '\\' || e.code === 'Backslash') && mod && !e.shiftKey
        if (!theme && !names) return
        if (isTextTarget(e.target)) return
        e.preventDefault()
        if (theme) this.toggleTheme()
        else this.modeBar.cycle()
    }

    private _bar(cls: string) {
        return createDiv({classList: ['lay-bar', cls], addToBody: false})
    }

    /** An empty area, in the page: hidden until {@link setArea} puts an element in it */
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
            })
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

    /** The sections of a stack in an area ({@link setArea} with a list), in order */
    private _sections(area: EditorFrameArea) {
        return Array.from(this._areas[area].children).filter(c => c.classList.contains('lay-section')) as HTMLElement[]
    }

    /** Puts the weights of a stack on its sections: the kept ones when they are for this number of sections, else equal */
    private _applySplits(area: EditorFrameArea) {
        const sections = this._sections(area)
        const weights = this._splits[area]?.length === sections.length ? this._splits[area] : undefined
        sections.forEach((s, i) => {
            s.style.flexGrow = String(weights?.[i] ?? 1)
        })
    }

    /**
     * The split before the section `index` of a stack: a line (a gap with drag dots in the floating layout). A drag moves
     * it, between the two sections next to it; a double-click makes all the sections equal.
     */
    private _split(area: EditorFrameArea, index: number) {
        const el = createDiv({classList: ['lay-split'], addToBody: false})
        const vertical = area === 'left'
        el.setAttribute('role', 'separator')
        el.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical')
        el.title = 'Drag to resize, double-click for equal sizes'
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const sizes = this._sections(area).map(s => {
                const r = s.getBoundingClientRect()
                return vertical ? r.height : r.width
            })
            const [a, b] = [index - 1, index]
            const pair = sizes[a] + sizes[b]
            const p0 = vertical ? e.clientY : e.clientX
            this._drag(el, ['lay-resizing', 'lay-resizing-' + (vertical ? 'y' : 'x')], (ev: PointerEvent) => {
                const min = Math.min(EditorFrame.MinSectionSize, pair / 2)
                const size = Math.max(min, Math.min(pair - min, sizes[a] + (vertical ? ev.clientY : ev.clientX) - p0))
                const next = sizes.slice()
                next[a] = size
                next[b] = pair - size
                // weights that sum to the number of sections, so the split stays when the area changes size
                const total = next.reduce((t, v) => t + v, 0) || 1
                this._splits[area] = next.map(v => Math.round(v / total * next.length * 1000) / 1000)
                this._applySplits(area)
            })
        })
        el.addEventListener('dblclick', () => {
            delete this._splits[area]
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
    }

    /**
     * The largest size that leaves room for the canvas: half of the window for the bottom area; for the left area and the
     * panel, the window less the other one (when it shows) and its offset ({@link setAreaOffset}), the mode bar and
     * {@link MinCanvasWidth}. The size and the offset of the area itself share this room.
     */
    private _room(area: EditorFrameSizedArea) {
        if (area === 'bottom') return innerHeight / 2
        const other = area === 'left' ?
            this.modeBar.open ? this._areaSize('right') : 0 :
            this._shows('left') ? this._areaSize('left') : 0
        return innerWidth - other - this.areaOffset(area === 'left' ? 'right' : 'left') - this._modeBarWidth() - EditorFrame.MinCanvasWidth
    }

    private _modeBarWidth() {
        return this.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
    }

    /** The cards move and take a part of their side: the floating layout, with the areas next to the canvas */
    private _movable() {
        return this._layout === 'floating' && !this._isSingle()
    }

    /** The gap of the floating cards to the window (`--lay-gap`) */
    private _gap() {
        return parseFloat(getComputedStyle(document.body).getPropertyValue('--lay-gap')) || 0
    }

    /** The height that the head of the floating layout takes from the left column, with its gap (`--lay-head`) */
    private _headRoom() {
        const head = parseFloat(getComputedStyle(document.body).getPropertyValue('--lay-head')) || 0
        return head ? head + this._gap() : 0
    }

    /**
     * The length of the whole side of a floating card: the window height less the gaps for the left card (less the head
     * above it) and the panel;
     * for the bottom card, its row between the left card and the panel (with their offsets and gaps)
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

    /** The size of an area on screen in px: the width of the left area or the panel, the height of the bottom area */
    private _areaSize(area: EditorFrameSizedArea) {
        const el = area === 'right' ? this.options.panel?.() : this._areas[area]
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
     */
    private _applySize(area: EditorFrameSizedArea) {
        const size = this._sizes[area]
        if (size === undefined) {
            const prop = AREA_SIZE_VARS[area]
            const shrunk = this._applied[area] !== undefined
            delete this._applied[area]
            if (shrunk) document.body.style.removeProperty(prop)
            // stacked, the panel and the areas are as wide as the window
            if (!this._shows(area) || document.body.classList.contains('lay-stack')) return
            const room = this._room(area)
            if (this._areaSize(area) <= room) return
            const fit = Math.round(Math.max(EditorFrame.AreaLimits[area][0], room))
            this._applied[area] = fit
            document.body.style.setProperty(prop, fit + 'px')
            return
        }
        const applied = Math.round(Math.max(EditorFrame.AreaLimits[area][0], Math.min(size, this._room(area))))
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
        // the window can change between a phone and a wide window, and the panel can show or hide
        this._refreshEntries()
    }

    /** Keeps the sizes, the collapsed left and bottom areas and the area below the canvas ({@link AreaStorageKey}) */
    private _storeAreas() {
        const key = EditorFrame.AreaStorageKey
        if (key) writeStored(key, JSON.stringify({sizes: this._sizes, collapsed: this._collapsed, stacked: this._stacked, offsets: this._offsets, spans: this._spans, splits: this._splits}))
    }

    /** Applies the sizes, the collapsed areas and the area below the canvas that are kept ({@link AreaStorageKey}) */
    private _restoreAreas() {
        const key = EditorFrame.AreaStorageKey
        let stored: {sizes?: Record<string, unknown>, collapsed?: Record<string, unknown>, stacked?: unknown,
            offsets?: Record<string, unknown>, spans?: Record<string, {start?: unknown, length?: unknown} | undefined>,
            splits?: Record<string, unknown>} | undefined
        try {
            stored = JSON.parse(key && readStored(key) || 'null') ?? undefined
        } catch (e) {
            return // not a value of this frame
        }
        for (const area of Object.keys(AREA_SIZE_VARS) as EditorFrameSizedArea[]) {
            const size = stored?.sizes?.[area]
            const [min, max] = EditorFrame.AreaLimits[area]
            // the size that the person picked; the room of this window applies on screen only
            if (typeof size === 'number' && isFinite(size)) this._sizes[area] = Math.round(Math.max(min, Math.min(max, size)))
            const offset = stored?.offsets?.[area]
            if (typeof offset === 'number' && isFinite(offset)) this._offsets[area] = Math.round(Math.max(0, offset))
            const span = stored?.spans?.[area]
            const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v)
            if (span && isNum(span.start)) {
                const start = Math.round(Math.max(0, span.start))
                this._spans[area] = isNum(span.length) ? {start, length: Math.round(Math.max(EditorFrame.MinCardLength, span.length))} : {start}
            }
        }
        for (const area of ['left', 'bottom'] as const) {
            const split = stored?.splits?.[area]
            if (Array.isArray(split) && split.length > 1 && split.every(v => typeof v === 'number' && isFinite(v) && v > 0)) this._splits[area] = split
            if (stored?.collapsed?.[area] !== true) continue
            this._collapsed[area] = true
            document.body.classList.add('lay-collapsed-' + area)
        }
        const stacked = stored?.stacked
        this.setStackedArea(stacked === 'left' || stacked === 'bottom' ? stacked : 'right')
        this._fitAreas()
    }

    /**
     * The light or dark button and the layout button
     * @param where - the top or the bottom bar, or the mode bar (the floating layout): there they have a name that the
     * wide mode bar shows, and the tooltips of the mode bar
     */
    private _actions(where: 'top' | 'bottom' | 'modeBar') {
        const buttons: HTMLButtonElement[] = []
        if (this.options.colorMode) buttons.push(this._button(ICONS.theme, 'Light or dark (Shift T)', 'Light / dark', where, () => this.toggleTheme()))
        buttons.push(this._button(ICONS.layout, 'Layout of the page', 'Layout', where, b => this._toggleMenu(b, () => this._layoutItems())))
        return buttons
    }

    private _button(icon: string, tip: string, name: string, where: 'top' | 'bottom' | 'modeBar', onClick: (b: HTMLButtonElement) => void) {
        const b = createDiv({elementTag: 'button', innerHTML: icon, classList: where === 'modeBar' ? ['mb-btn', 'lay-float-btn'] : ['lay-btn'], addToBody: false})
        if (where === 'modeBar') {
            const label = document.createElement('span')
            label.className = 'mb-label'
            label.textContent = name
            b.appendChild(label)
            this.modeBar.addTooltip(b, tip)
        } else {
            this._tips.push(tippy(b, {content: tip, placement: where === 'top' ? 'bottom' : 'top', appendTo: () => document.body}))
        }
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
     * buttons in the mode bar (the floating layout) share the tooltip of the mode bar, so the mode bar holds it.
     */
    private _holdTooltip(anchor: HTMLElement, held: boolean) {
        if (this.modeBar.element.contains(anchor)) return this.modeBar.holdTooltips(held)
        const tip = this._tips.find(t => t.reference === anchor)
        if (held) tip?.disable() // it also hides
        else tip?.enable()
    }

    private _onMenuPointerDown = (e: PointerEvent) => {
        const t = e.target as Node
        if (!this._menu?.contains(t) && !this._menuAnchor?.contains(t)) this._closeMenu()
    }

    private _onMenuKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this._closeMenu()
    }
}
