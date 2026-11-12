import {
    ChangeEvent,
    clonePrimitive,
    copyPrimitive,
    createStyles,
    equalsPrimitive,
    getOrCall,
    JSUndoManager,
    UiConfigMethods,
    UiObjectConfig,
} from 'threepipe'
import tippy, {Instance} from 'tippy.js'
import styles from './UiConfigForm.css?inline'
import {lucideIcon} from './lucideIcons'
import {addTooltipStyles, EDITOR_TOOLTIP_PROPS, tooltipParent} from '../tooltips'

/**
 * How {@link UiConfigForm} draws its configs:
 * - `form`: a row for each field, with its name (the default)
 * - `bar`: a toolbar, one row of buttons: buttons, checkboxes as toggle buttons, dropdowns as selects, and the other
 *   fields as buttons that open the field in a small popover. A folder is a group, with a line between groups.
 * - `stack`: the same buttons in a column
 *
 * A config with an `icon` shows it in front of its label. In a bar on a narrow screen (640 px), a button with an icon
 * shows the icon only, with the label in its tooltip.
 */
export type UiConfigFormLayout = 'form' | 'bar' | 'stack'

export interface UiConfigFormOptions {
    /** One undo step per edit; quick edits of the same field (scrub, typing, the slider) merge into one */
    undoManager?: JSUndoManager
    /** Called after every change, e.g. to redraw */
    onChange?: (config: UiObjectConfig) => void
    /**
     * Called after a dropdown change (also after its undo and redo) or a button click: these can change which fields
     * there are (e.g. the type of a curve). Make the form again then. A form made in this call (synchronously) takes
     * the place of this one: the undo and redo of the older edits refresh it.
     */
    onStructureChange?: () => void
    /**
     * Whether a number field takes whole numbers only. The default: a `stepSize` of 1 or more that is a whole number,
     * or a name of a count ({@link isIntegerName}).
     */
    isInteger?: (config: UiObjectConfig, label: string) => boolean
    /** How the form draws the configs, see {@link UiConfigFormLayout}. Default: `form`. Changes with {@link UiConfigForm.layout}. */
    layout?: UiConfigFormLayout
    /**
     * Called when the function of a button throws or rejects. The button is enabled again. Default: `console.error`.
     */
    onError?: (error: unknown, config: UiObjectConfig) => void
    /** The key of a config, like `⌘S` or `Shift+R`, shown in its tooltip (`bar` and `stack`) */
    shortcutOf?: (config: UiObjectConfig) => string | undefined
}

/**
 * A small plain-DOM form for a list of uiconfig.js configs, the same configs that the Tweakpane panels use. For a popup
 * or a card next to an object, where a Tweakpane panel is too large.
 *
 * - Fields: number (drag the name to scrub, Shift for 10x), slider, checkbox, dropdown, vector, color, text, button,
 *   monitor, and folders (always open). An `input` (or another type) bound to a boolean or a number gets a checkbox or
 *   a number field.
 * - A button's function can return an undo function or `{action, undo, redo}`, as in uiconfig.js: the action runs, and
 *   with an `undoManager` it is one undo step.
 * - The values are read and written through the bindings of the configs. A change calls `onChange` of the config and
 *   of each parent folder, as the Tweakpane renderer does.
 * - With an `undoManager`, each edit is one undo step. Quick edits of the same field merge into one step.
 * - A config that is `hidden` when the form is made is not drawn. Make the form again when the fields change
 *   ({@link UiConfigFormOptions.onStructureChange}).
 *
 * - A button whose function returns a promise is disabled, and shows a spinner, until the promise settles. An error is
 *   given to {@link UiConfigFormOptions.onError}.
 * - An `icon` of a config (uiconfig.js `icon`): SVG markup, an image URL, or the name of one of the Lucide icons in
 *   {@link lucideIcons} (like `'camera'` or `'download'`).
 * - The `bar` and `stack` layouts ({@link UiConfigFormLayout}) draw the configs as a toolbar, e.g. the buttons over a
 *   canvas. The colours follow the Tweakpane theme of the page.
 *
 * The form does not watch the values: call {@link refresh} after a change from elsewhere (code, another panel). Its own
 * undo and redo steps refresh it. A refresh is cheap (the DOM changes only when a value does), so it can run each frame.
 *
 * ```ts
 * const form = new UiConfigForm(UiConfigMethods.GetChildren(object.uiConfig), {undoManager})
 * popup.appendChild(form.element)
 *
 * // a toolbar
 * const bar = new UiConfigForm([
 *     {type: 'button', label: 'Snapshot', icon: 'camera', value: async() => snapshot.downloadSnapshot()},
 *     {type: 'checkbox', label: 'Auto rotate', icon: 'rotate-3d', property: [controls, 'autoRotate']},
 * ], {layout: 'bar'})
 * ```
 */
export class UiConfigForm {
    /** Adds the stylesheet of the form to the page when the first form is made. Off: the page styles the `ucf-` classes. */
    static InjectStyles = true
    /** The buttons of a `bar` or a `stack` have tooltips (tippy.js, the editor look). Off: no tooltips. */
    static Tooltips = true
    private static _styles?: HTMLStyleElement

    readonly element: HTMLDivElement
    private _rows: {config: UiObjectConfig, update: (force?: boolean) => void}[] = []
    /** A config that is in the list twice is drawn once */
    private _drawn = new Set<UiObjectConfig>()
    private _undo?: {config: UiObjectConfig, cmd: {undo: () => void, redo: () => void}, time: number, before: any}
    /** The config of a continuous edit (scrub, slider, colour picker) that has no final (`last`) change yet */
    private _unfinished?: UiObjectConfig
    /** The form that the page made in `onStructureChange` of this one, to take its place */
    private _next?: UiConfigForm
    /** The form whose `onStructureChange` runs: a form made in it is its {@link _next} */
    private static _replacing?: UiConfigForm
    private _layout: UiConfigFormLayout
    /** The tooltips of the buttons (`bar` and `stack`) */
    private _tooltips: Instance[] = []
    /** Closes the open popover of a field (`bar` and `stack`) */
    private _closePopover?: () => void

    /**
     * @param _configs - the configs to draw, e.g. the children of an object's `uiConfig`
     * @param _options - layout, undo, change callbacks
     */
    constructor(private _configs: UiObjectConfig[], private _options: UiConfigFormOptions = {}) {
        const replaced = UiConfigForm._replacing
        if (replaced && !replaced._next) replaced._next = this
        if (UiConfigForm.InjectStyles && !UiConfigForm._styles?.isConnected) UiConfigForm._styles = createStyles(styles)
        this._layout = _options.layout ?? 'form'
        this.element = document.createElement('div')
        this._build()
    }

    /** How the form draws the configs. A change between `bar` and `stack` keeps the elements; `form` draws them again. */
    get layout(): UiConfigFormLayout {
        return this._layout
    }
    set layout(layout: UiConfigFormLayout) {
        if (layout === this._layout) return
        const redraw = layout === 'form' || this._layout === 'form'
        this._layout = layout
        if (redraw) this._build()
        else this.element.className = this._className()
    }

    private _className() {
        return this._layout === 'form' ? 'ucf' : 'ucf ucf-' + this._layout
    }

    /** Draws the configs (again) */
    private _build() {
        this._clear()
        this.element.className = this._className()
        if (this._layout !== 'form') this.element.setAttribute('role', 'toolbar')
        else this.element.removeAttribute('role')
        for (const c of this._configs) this._render(c, this.element, [])
    }

    private _clear() {
        this._closePopover?.()
        for (const t of this._tooltips) t.destroy()
        this._tooltips = []
        this._rows = []
        this._drawn.clear()
        while (this.element.lastChild) this.element.lastChild.remove()
    }

    /**
     * Reads the values again, after a change from elsewhere. A field that has the focus keeps what is typed in it.
     * @param force - also the field that has the focus (an undo or redo replaces what it shows)
     */
    refresh(force = false) {
        for (const r of this._rows) r.update(force)
    }

    /** Removes the form from the page */
    dispose() {
        this._clear()
        this.element.remove()
        this._undo = undefined
    }

    /** The form on the page now: this one, or the last one made in place of it (an undo of an older edit refreshes it) */
    private get _live(): UiConfigForm {
        return this._next ? this._next._live : this
    }

    /** Calls `onStructureChange`; a form that the page makes in it takes the place of the live form */
    private _structureChange() {
        const prev = UiConfigForm._replacing
        UiConfigForm._replacing = this._live
        try {
            this._options.onStructureChange?.()
        } finally {
            UiConfigForm._replacing = prev
        }
    }

    private _children(c: UiObjectConfig) {
        return UiConfigMethods.GetChildren(c) as UiObjectConfig[]
    }

    /**
     * Sets the value of a config through its binding, as one undo step
     * @param last - false while the value still changes (scrub, slider, colour picker), like the `last` of a change event
     * @param structural - the value can change which fields there are (a dropdown): `onStructureChange` is called after
     * the change, and after its undo and redo
     */
    private _set(c: UiObjectConfig, parents: UiObjectConfig[], value: any, last = true, structural = false) {
        const [obj, key] = UiConfigMethods.GetBinding(c)
        if (!obj) return
        const before = clonePrimitive(obj[key])
        if (equalsPrimitive(before, value)) {
            if (last) this._end(c, parents)
            return
        }
        const apply = (v: any, isLast: boolean, replay = false) => {
            const cur = obj[key]
            if (cur && typeof cur === 'object' && typeof cur.copy === 'function') copyPrimitive(cur, v)
            else obj[key] = clonePrimitive(v)
            this._dispatch(c, parents, isLast, replay)
            if (structural) this._structureChange()
        }
        apply(value, last)
        // a continuous edit of this field (scrub, slider, colour picker) that has not ended yet
        const continuing = this._unfinished === c
        this._unfinished = last ? undefined : c
        const um = this._options.undoManager
        if (!um) return
        const now = performance.now()
        const u = this._undo
        // the same field again, in the same gesture or within a second, with no other step between: one step from the
        // first value
        const merge = !!u && u.config === c && um.peek() === u.cmd && (continuing || now - u.time < 1000)
        const first = merge && u ? u.before : before
        const after = clonePrimitive(value)
        const cmd = {undo: () => apply(first, true, true), redo: () => apply(after, true, true)}
        if (merge) um.replaceLast(cmd)
        else um.record(cmd)
        this._undo = {config: c, cmd, time: now, before: first}
    }

    /**
     * Runs the function of a button. As in uiconfig.js, it can return an undo function (redo runs the function again), or
     * an object with `undo` and `redo` and an optional `action` that is run now. With an undo manager, that is one step.
     */
    private async _action(c: UiObjectConfig, parents: UiObjectConfig[], run: () => any) {
        const res = await run()
        if (typeof res === 'object' && typeof res?.action === 'function') await res.action()
        const um = this._options.undoManager
        if (!um || typeof res !== 'function' && typeof res?.undo !== 'function') return
        // read at replay: an action can replace its own undo or redo (EntityComponentPlugin.addComponent does)
        // a returned undo function: redo runs the button again, and its new undo function undoes that run
        let undoFn = typeof res === 'function' ? res : undefined
        const undo = () => undoFn ? undoFn() : res.undo()
        const redo = async() => {
            if (!undoFn) return typeof res.redo === 'function' ? res.redo() : res.action?.()
            const again = await run()
            if (typeof again === 'function') undoFn = again
        }
        // a button can change which fields there are: the page makes the form again after its undo and redo too
        const replayed = () => {
            this._dispatch(c, parents, true, true)
            this._structureChange()
        }
        um.record({
            undo: async() => {
                await undo()
                replayed()
            },
            redo: async() => {
                await redo()
                replayed()
            },
        })
    }

    /** The end of a continuous edit: the final change (`last`), which some configs wait for (e.g. to rebuild a geometry) */
    private _end(c: UiObjectConfig, parents: UiObjectConfig[]) {
        if (this._unfinished !== c) return
        this._unfinished = undefined
        this._dispatch(c, parents, true)
    }

    /**
     * `onChange` of the config, then of each parent folder in the form, then `parentOnChange` of the top one: the same
     * handlers, once each and with the same events, as an edit in a Tweakpane panel (which sets `parentOnChange` on the
     * children that it draws)
     * @param replay - an undo or redo: the fields show the values also when they have the focus
     */
    private _dispatch(c: UiObjectConfig, parents: UiObjectConfig[], last: boolean, replay = false) {
        const path = [...parents, c]
        for (let i = path.length - 1; i > 0; i--) callOnChange(path[i], {type: 'change', last, config: c, configPath: path.slice(i), target: path[i]})
        UiConfigMethods.DispatchOnChangeSync(path[0], {last, config: c, configPath: path.slice(1)})
        this._options.onChange?.(c)
        // after a rebuild (onStructureChange), the replay of an older edit shows in the form made in place of this one
        this._live.refresh(replay)
    }

    private _render(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[]) {
        if (!c || getOrCall(c.hidden) || this._drawn.has(c)) return
        this._drawn.add(c)
        // a config with getValue / setValue gets its property binding here, as in the Tweakpane renderer
        UiConfigMethods.InitUiConfig(c)
        const type = String(getOrCall(c.type))
        const label = labelOf(c)
        // disabled and readOnly can change (a callback): refresh() applies them again
        const isDisabled = () => !!(getOrCall(c.disabled) || getOrCall(c.readOnly))
        if (type === 'folder' || type === 'panel') {
            const f = document.createElement('div')
            const path = [...parents, c]
            if (this._layout === 'form') {
                f.className = 'ucf-folder'
                const h = document.createElement('div')
                h.className = 'ucf-folder-head'
                h.textContent = label
                f.appendChild(h)
            } else {
                // a group of buttons in a bar, with a line between groups
                f.className = 'ucf-group'
                f.setAttribute('role', 'group')
                f.setAttribute('aria-label', label)
            }
            host.appendChild(f)
            for (const ch of this._children(c)) this._render(ch, f, path)
            return
        }
        if (type === 'button') return this._button(c, host, parents, label, isDisabled)
        if (this._layout === 'form') return this._row(c, host, parents, type, label, isDisabled)
        const kind = this._kind(c, type)
        if (kind === 'checkbox' || kind === 'toggle') return this._toggle(c, host, parents, label, isDisabled)
        if (kind === 'dropdown') return this._selectChip(c, host, parents, label, isDisabled)
        return this._popoverChip(c, host, parents, type, label, isDisabled)
    }

    /** The kind of field of a config: its type, or for an input (or a type the form does not know) the type of its value */
    private _kind(c: UiObjectConfig, type: string) {
        if (FIELD_TYPES.has(type)) return type
        const v = UiConfigMethods.GetRawValue(c)
        return typeof v === 'boolean' ? 'checkbox' : typeof v === 'number' ? 'number' : 'text'
    }

    private _error(e: unknown, c: UiObjectConfig) {
        if (this._options.onError) this._options.onError(e, c)
        else console.error(e)
    }

    /**
     * The icon and the label of a button. Without an icon, the label is the text of the button (as before the icons).
     * @returns a function that draws the icon again when it changes (an `icon` can be a function, e.g. play or pause)
     */
    private _content(el: HTMLElement, c: UiObjectConfig, label: string, labelSpan = false): () => void {
        const icon = () => getOrCall(c.icon) || ''
        let shown = icon()
        // a label can be a function too (Play or Pause): drawn again when it changes
        let text = label
        const isButton = el.tagName.toLowerCase() === 'button'
        if (!shown && !labelSpan) {
            el.textContent = label
            return () => {
                const now = labelOf(c)
                if (now !== text) el.textContent = text = now
            }
        }
        let i: HTMLElement | undefined
        if (shown) {
            el.classList.add('ucf-has-icon')
            // the name stays the label also when the label is hidden (a bar on a narrow screen shows the icon only)
            if (isButton) el.setAttribute('aria-label', label)
            i = document.createElement('span')
            i.className = 'ucf-icon'
            setIcon(i, shown)
            el.appendChild(i)
        }
        const l = document.createElement('span')
        l.className = 'ucf-label'
        l.textContent = label
        el.appendChild(l)
        return () => {
            const now = icon()
            if (i && now !== shown) setIcon(i, shown = now)
            const t = labelOf(c)
            if (t === text) return
            l.textContent = text = t
            if (isButton && el.getAttribute('aria-label') !== null) el.setAttribute('aria-label', t)
        }
    }

    /**
     * The tooltip of a button in a bar or a stack: its label when the label is not shown (an icon only), and its key
     * ({@link UiConfigFormOptions.shortcutOf})
     */
    private _tooltip(el: HTMLElement, c: UiObjectConfig) {
        if (this._layout === 'form' || !UiConfigForm.Tooltips) return
        addTooltipStyles()
        this._tooltips.push(tippy(el, {
            ...EDITOR_TOOLTIP_PROPS,
            appendTo: tooltipParent,
            placement: 'top',
            onShow: (t) => {
                const key = this._options.shortcutOf?.(c)
                const labelEl = el.querySelector<HTMLElement>('.ucf-label')
                const labelHidden = !!labelEl && labelEl.offsetParent === null
                if (!labelHidden && !key) return false
                const content = document.createElement('span')
                content.textContent = labelOf(c)
                if (key) {
                    const k = document.createElement('kbd')
                    k.className = 'ucf-kbd'
                    k.textContent = key
                    content.appendChild(k)
                }
                t.setContent(content)
                return undefined
            },
        }))
    }

    private _button(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[], label: string, isDisabled: () => boolean) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ucf-button'
        const updateIcon = this._content(b, c, label)
        b.disabled = isDisabled()
        // while the function of the button runs (a promise): disabled, with a spinner
        let busy = false
        b.addEventListener('click', async() => {
            if (busy) return
            busy = true
            b.disabled = true
            b.classList.add('ucf-busy')
            try {
                const [obj, key] = UiConfigMethods.GetBinding(c, false)
                const fn = obj ? obj[key] ?? obj.value : undefined
                if (typeof fn === 'function') await this._action(c, parents, () => fn.call(obj))
                if (typeof c.onClick === 'function') await this._action(c, parents, () => (c.onClick as any)())
            } catch (e) {
                this._error(e, c)
            } finally {
                busy = false
                b.classList.remove('ucf-busy')
                b.disabled = isDisabled()
            }
            this._dispatch(c, parents, true)
            this._structureChange()
        })
        host.appendChild(b)
        this._tooltip(b, c)
        this._rows.push({config: c, update: () => {
            const d = busy || isDisabled()
            if (b.disabled !== d) b.disabled = d
            updateIcon()
        }})
    }

    /** A checkbox in a bar or a stack: a toggle button, pressed while the value is true */
    private _toggle(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[], label: string, isDisabled: () => boolean) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ucf-button ucf-toggle'
        const updateIcon = this._content(b, c, label)
        b.addEventListener('click', () => this._set(c, parents, !UiConfigMethods.GetRawValue(c)))
        host.appendChild(b)
        this._tooltip(b, c)
        let pressed: string | undefined
        this._rows.push({config: c, update: () => {
            const p = String(!!UiConfigMethods.GetRawValue(c))
            if (p !== pressed) b.setAttribute('aria-pressed', pressed = p)
            const d = isDisabled()
            if (b.disabled !== d) b.disabled = d
            updateIcon()
        }})
        this._rows[this._rows.length - 1].update()
    }

    /** A dropdown in a bar or a stack: its label (or icon) and a select */
    private _selectChip(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[], label: string, isDisabled: () => boolean) {
        const wrap = document.createElement('label')
        wrap.className = 'ucf-chip'
        // the label in its own element: the select is next to it
        const updateIcon = this._content(wrap, c, label, true)
        const {sel, update} = this._select(c, parents)
        sel.setAttribute('aria-label', label)
        wrap.appendChild(sel)
        host.appendChild(wrap)
        this._tooltip(wrap, c)
        this._rows.push({config: c, update: () => {
            update()
            const d = isDisabled()
            if (sel.disabled !== d) sel.disabled = d
            updateIcon()
        }})
        this._rows[this._rows.length - 1].update()
    }

    /**
     * Any other field in a bar or a stack (a slider, a number, a colour...): a button with the label and the value, that
     * opens the field (the row of the `form` layout) in a popover
     */
    private _popoverChip(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[], type: string, label: string, isDisabled: () => boolean) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ucf-button ucf-more'
        // the name is the label: the value on the button changes
        b.setAttribute('aria-label', label)
        b.setAttribute('aria-haspopup', 'dialog')
        b.setAttribute('aria-expanded', 'false')
        // the label in its own element: the value is next to it
        const updateIcon = this._content(b, c, label, true)
        const val = document.createElement('span')
        val.className = 'ucf-value'
        b.appendChild(val)
        host.appendChild(b)
        this._tooltip(b, c)
        // the field, drawn once; it is on the page while the popover is open
        const pop = document.createElement('div')
        pop.className = 'ucf ucf-popover'
        pop.setAttribute('role', 'dialog')
        pop.setAttribute('aria-label', label)
        this._row(c, pop, parents, type, label, isDisabled)
        /** @param commit - the focused field takes what is typed in it (its change on blur) first; Escape cancels */
        const close = (commit = true) => {
            const focused = document.activeElement as HTMLElement | null
            if (focused && pop.contains(focused)) {
                if (commit) focused.blur()
                // cancel: the field shows the value of the binding again, so the blur below changes nothing
                else this._live.refresh(true)
                b.focus()
            }
            pop.remove()
            b.setAttribute('aria-expanded', 'false')
            document.removeEventListener('pointerdown', onDown, true)
            document.removeEventListener('keydown', onKey, true)
            if (this._closePopover === close) this._closePopover = undefined
        }
        const onDown = (e: Event) => {
            const t = e.target as Node
            if (!pop.contains(t) && !b.contains(t)) close()
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            close(false)
        }
        b.addEventListener('click', () => {
            if (pop.isConnected) return close()
            this._closePopover?.()
            this._closePopover = close
            tooltipParent().appendChild(pop)
            b.setAttribute('aria-expanded', 'true')
            placePopover(pop, b, this._layout === 'stack' ? 'left' : 'top')
            document.addEventListener('pointerdown', onDown, true)
            document.addEventListener('keydown', onKey, true)
            pop.querySelector<HTMLElement>('input, select')?.focus()
        })
        const isColor = this._kind(c, type) === 'color'
        let shown: string | undefined
        this._rows.push({config: c, update: () => {
            const raw = UiConfigMethods.GetRawValue(c)
            // a colour: its hex code, with a swatch in front
            const color = isColor || (raw as any)?.isColor ? colorHex(raw) : undefined
            const v = color ?? valueText(raw)
            if (v !== shown) {
                val.textContent = shown = v
                if (color) {
                    val.classList.add('ucf-swatch')
                    val.style.setProperty('--ucf-swatch', color)
                }
            }
            const d = isDisabled()
            if (b.disabled !== d) b.disabled = d
            updateIcon()
        }})
        this._rows[this._rows.length - 1].update()
    }

    /** A select of the options of a dropdown config */
    private _select(c: UiObjectConfig, parents: UiObjectConfig[]) {
        const value = () => UiConfigMethods.GetRawValue(c)
        const sel = document.createElement('select')
        const opts = this._children(c).map(o => ({label: UiConfigMethods.GetLabel(o), value: (o as any).value ?? UiConfigMethods.GetLabel(o)}))
        opts.forEach((o, i) => sel.appendChild(Object.assign(document.createElement('option'), {value: String(i), textContent: o.label})))
        sel.addEventListener('change', () => this._set(c, parents, opts[+sel.value].value, true, true))
        return {sel, update: () => {
            const v = value()
            const i = opts.findIndex(o => o.value === v || equalsPrimitive(o.value, v))
            if (i >= 0) writeValue(sel, String(i))
        }}
    }

    /** A field of the `form` layout: a row with the name and the input(s) */
    private _row(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[], type: string, label: string, isDisabled: () => boolean) {
        const row = document.createElement('label')
        row.className = 'ucf-row'
        const name = document.createElement('span')
        name.className = 'ucf-name'
        name.textContent = label
        row.appendChild(name)
        host.appendChild(row)
        const value = () => UiConfigMethods.GetRawValue(c)
        const firstRow = this._rows.length
        // an input (or a type the form does not know) bound to a boolean or a number gets a checkbox or a number field
        const kind = this._kind(c, type)

        if (kind === 'checkbox' || kind === 'toggle') {
            const input = document.createElement('input')
            input.type = 'checkbox'
            input.addEventListener('change', () => this._set(c, parents, input.checked))
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                const v = !!value()
                if (input.checked !== v) input.checked = v
            }})
        } else if (kind === 'dropdown') {
            const {sel, update} = this._select(c, parents)
            row.appendChild(sel)
            this._rows.push({config: c, update})
        } else if (kind === 'color') {
            const input = document.createElement('input')
            input.type = 'color'
            input.addEventListener('input', () => {
                const cur = value() as any
                if (cur?.isColor) this._set(c, parents, cur.clone().set(input.value), false)
                else this._set(c, parents, typeof cur === 'number' ? parseInt(input.value.slice(1), 16) : input.value, false)
            })
            // the picker closes
            input.addEventListener('change', () => this._end(c, parents))
            row.appendChild(input)
            this._rows.push({config: c, update: (force) => {
                const v = value() as any
                if (force || document.activeElement !== input) writeValue(input, v?.isColor ? '#' + v.getHexString() : typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : String(v ?? '#000000'))
            }})
        } else if (kind === 'vec' || kind === 'vec2' || kind === 'vec3' || kind === 'vec4') {
            const v0 = value() as any
            // a three.js vector (x, y, z, w) or a tuple of numbers ([0, 1, 2, 3])
            const isArray = Array.isArray(v0)
            const axes: (string | number)[] = isArray ? v0.map((_: any, i: number) => i) : ['x', 'y', 'z', 'w'].filter(a => typeof v0?.[a] === 'number')
            // the bounds of the config apply to each component
            const {min, max} = UiConfigMethods.GetBounds(c, true)
            const wrap = document.createElement('span')
            wrap.className = 'ucf-vec'
            const inputs = axes.map(a => {
                const input = this._number(n => {
                    const cur = value() as any
                    const v = isArray ? [...cur] : cur.clone()
                    v[a] = Math.min(max, Math.max(min, n))
                    this._set(c, parents, v)
                }, () => (value() as any)?.[a], getOrCall(c.stepSize))
                input.title = String(a)
                wrap.appendChild(input)
                return input
            })
            row.classList.add('ucf-row-wide')
            row.appendChild(wrap)
            this._rows.push({config: c, update: (force) => {
                const v = value() as any
                axes.forEach((a, i) => {
                    if (force || document.activeElement !== inputs[i]) writeValue(inputs[i], fmt(v?.[a]))
                })
            }})
        } else if (kind === 'number' || kind === 'slider') {
            const {min, max, step} = UiConfigMethods.GetBounds(c, kind === 'number')
            const isInt = (this._options.isInteger ?? defaultIsInteger)(c, label)
            const clamp = (n: number) => Math.min(max, Math.max(min, isInt ? Math.round(n) : n))
            const input = this._number(n => this._set(c, parents, clamp(n)), value, getOrCall(c.stepSize))
            if (kind === 'slider') {
                const range = document.createElement('input')
                range.type = 'range'
                range.min = String(min)
                range.max = String(max)
                range.step = String(step)
                range.addEventListener('input', () => this._set(c, parents, clamp(+range.value), false))
                // the slider is released
                range.addEventListener('change', () => this._end(c, parents))
                row.appendChild(range)
                this._rows.push({config: c, update: () => {
                    writeValue(range, String(value()))
                }})
            }
            row.appendChild(input)
            this._rows.push({config: c, update: (force) => {
                if (force || document.activeElement !== input) writeValue(input, fmt(value()))
            }})
            // per pixel: the stepSize of the config (as in Tweakpane), else 1% of the value, and at most 1% of the bounds
            const scrubStep = isInt ? 0.25 : getOrCall(c.stepSize) || ((v: number) => Math.min(Math.max(0.001, Math.abs(v) * 0.01 || 0.01), (max - min) / 100))
            // a scrub edits this field: it shows the value also when it has the focus, which the scrub keeps
            const scrubSet = (n: number) => {
                this._set(c, parents, clamp(n), false)
                writeValue(input, fmt(value()))
            }
            this._scrub(name, isDisabled, () => +(value() as any), scrubStep, scrubSet, () => this._end(c, parents))
        } else if (kind === 'monitor') {
            const out = document.createElement('span')
            out.className = 'ucf-monitor'
            row.appendChild(out)
            this._rows.push({config: c, update: () => {
                const v = String(value())
                if (out.textContent !== v) out.textContent = v
            }})
        } else { // input and any other type: text
            const input = document.createElement('input')
            input.type = 'text'
            input.addEventListener('change', () => this._set(c, parents, input.value))
            row.appendChild(input)
            this._rows.push({config: c, update: (force) => {
                if (force || document.activeElement !== input) writeValue(input, String(value() ?? ''))
            }})
        }
        // the fields of the row, found once: a refresh (on each change, e.g. each move of a scrub) touches the DOM only
        // when a value or the disabled state changes
        const controls = row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
        let disabled: boolean | undefined
        this._rows.push({config: c, update: () => {
            const d = isDisabled()
            if (d === disabled) return
            disabled = d
            controls.forEach(el => el.disabled = d)
        }})
        // the first values of the fields of this config (a slider has two)
        for (let i = firstRow; i < this._rows.length; i++) this._rows[i].update()
    }

    /**
     * A number field. After a committed edit (Enter, the spinner, a blur), it shows the value of the binding, which can
     * be clamped or rounded, also while it has the focus.
     * @param step - the change of the arrow keys and the spinner: the `stepSize` of the config. A typed value off the
     * step is kept. Without one, the field takes any value and the browser steps by 1.
     */
    private _number(set: (n: number) => void, get: () => any, step?: number) {
        const input = document.createElement('input')
        input.type = 'number'
        input.step = step && step > 0 ? String(step) : 'any'
        input.addEventListener('change', () => {
            const n = parseFloat(input.value)
            if (isFinite(n)) set(n)
            input.value = fmt(get())
        })
        return input
    }

    /**
     * Drag the handle (the name) left or right with the main button to change the number, Shift for 10x
     * @param step - the change per pixel, or a function of the value at the start of the drag
     */
    private _scrub(handle: HTMLElement, isDisabled: () => boolean, get: () => number, step: number | ((v: number) => number), set: (n: number) => void, end: () => void) {
        handle.style.cursor = 'ew-resize'
        handle.addEventListener('pointerdown', e => {
            if (e.button !== 0 || isDisabled()) return
            e.preventDefault()
            handle.setPointerCapture(e.pointerId)
            const x0 = e.clientX
            const v0 = get()
            const perPixel = typeof step === 'function' ? step(v0) : step
            const move = (ev: PointerEvent) => set(v0 + (ev.clientX - x0) * perPixel * (ev.shiftKey ? 10 : 1))
            const up = () => {
                handle.removeEventListener('pointermove', move)
                handle.removeEventListener('pointerup', up)
                handle.removeEventListener('pointercancel', up)
                if (this._undo) this._undo.time = -Infinity // the next edit is a new undo step (also in the first second of the page)
                end()
            }
            handle.addEventListener('pointermove', move)
            handle.addEventListener('pointerup', up)
            handle.addEventListener('pointercancel', up)
        })
    }
}

/** The field types that the form draws as they are; any other type is drawn by the type of its value */
const FIELD_TYPES = new Set(['checkbox', 'toggle', 'dropdown', 'color', 'vec', 'vec2', 'vec3', 'vec4', 'number', 'slider', 'monitor'])

/** The label of a config: a label from the key of the property gets spaces (roughnessMap: roughness Map); a given label stays as it is */
function labelOf(c: UiObjectConfig) {
    const label = UiConfigMethods.GetLabel(c)
    return getOrCall(c.label) ? label : label.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/**
 * Draws an icon into an element: SVG markup (drawn inline, in the text colour), an image URL, or the name of a Lucide
 * icon ({@link lucideIcon}). An unknown name draws nothing.
 */
function setIcon(el: HTMLElement, icon: string) {
    while (el.lastChild) el.lastChild.remove()
    if (!icon) return
    if (icon.trimStart().startsWith('<svg')) {
        el.innerHTML = icon
        return
    }
    if (/^(https?:|data:|blob:)/.test(icon) || /[/.]/.test(icon)) {
        const img = document.createElement('img')
        img.alt = ''
        img.src = icon
        el.appendChild(img)
        return
    }
    const svg = lucideIcon(icon)
    if (svg) el.innerHTML = svg
}

/** A colour value as a CSS hex code: a three.js colour, a number (0xff8800) or a CSS colour string */
function colorHex(v: any): string {
    if (v?.isColor) return '#' + v.getHexString()
    if (typeof v === 'number') return '#' + v.toString(16).padStart(6, '0')
    return String(v ?? '')
}

/** The value of a field on its button in a bar: a number, a vector, a text */
function valueText(v: any): string {
    if (v === undefined || v === null) return ''
    if (typeof v === 'number') return String(+v.toPrecision(4))
    if (typeof v === 'object') {
        const parts = Array.isArray(v) ? v : ['x', 'y', 'z', 'w'].filter(a => typeof v[a] === 'number').map(a => v[a])
        return parts.map((n: any) => typeof n === 'number' ? String(+n.toPrecision(3)) : String(n)).join(', ')
    }
    return String(v)
}

/** Places a popover next to its button, inside the window: above it (a bar) or on its left (a stack) */
function placePopover(pop: HTMLElement, anchor: HTMLElement, side: 'top' | 'left') {
    const a = anchor.getBoundingClientRect()
    const p = pop.getBoundingClientRect()
    const gap = 8
    let x = side === 'top' ? a.left + a.width / 2 - p.width / 2 : a.left - p.width - gap
    let y = side === 'top' ? a.top - p.height - gap : a.top + a.height / 2 - p.height / 2
    // no room above or on the left: below or on the right
    if (side === 'top' && y < gap) y = a.bottom + gap
    if (side === 'left' && x < gap) x = a.right + gap
    x = Math.max(gap, Math.min(x, window.innerWidth - p.width - gap))
    y = Math.max(gap, Math.min(y, window.innerHeight - p.height - gap))
    pop.style.left = x + 'px'
    pop.style.top = y + 'px'
}

/** `onChange` of a config, a function or a list of functions, without its `parentOnChange` */
function callOnChange(config: UiObjectConfig, ev: ChangeEvent) {
    const on = config.onChange
    if (typeof on === 'function') on(ev)
    else if (Array.isArray(on)) on.flat().forEach(f => typeof f === 'function' && f(ev))
}

/** Sets the value of a field only when it changes: no DOM write (and no new style or layout) for the same value */
function writeValue(el: {value: string}, v: string) {
    if (el.value !== v) el.value = v
}

/** A number with 12 significant digits: no float noise (0.30000000000000004), and small steps (0.00001) stay */
function fmt(v: any) {
    return typeof v === 'number' ? String(+v.toPrecision(12)) : String(v ?? '')
}

function defaultIsInteger(c: UiObjectConfig, label: string) {
    const step = getOrCall(c.stepSize)
    if (typeof step === 'number' && step >= 1 && Number.isInteger(step)) return true
    return isIntegerName(String(getOrCall(c.property)?.[1] ?? label))
}

/** A name of a count (segments, sides, steps...): its number field takes whole numbers */
export function isIntegerName(name: string) {
    return /segment|count|sides|detail|points|tubular|radial|steps/i.test(name)
}
