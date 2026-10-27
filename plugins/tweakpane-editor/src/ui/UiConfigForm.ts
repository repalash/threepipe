import {
    clonePrimitive,
    copyPrimitive,
    createStyles,
    equalsPrimitive,
    getOrCall,
    JSUndoManager,
    UiConfigMethods,
    UiObjectConfig,
} from 'threepipe'
import styles from './UiConfigForm.css?inline'

export interface UiConfigFormOptions {
    /** One undo step per edit; quick edits of the same field (scrub, typing, the slider) merge into one */
    undoManager?: JSUndoManager
    /** Called after every change, e.g. to redraw */
    onChange?: (config: UiObjectConfig) => void
    /**
     * Called after a dropdown change (also after its undo and redo) or a button click: these can change which fields
     * there are (e.g. the type of a curve). Make the form again then.
     */
    onStructureChange?: () => void
    /**
     * Whether a number field takes whole numbers only. The default: a `stepSize` of 1 or more that is a whole number,
     * or a name of a count ({@link isIntegerName}).
     */
    isInteger?: (config: UiObjectConfig, label: string) => boolean
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
 * The form does not watch the values: call {@link refresh} after a change from elsewhere (code, another panel). Its own
 * undo and redo steps refresh it.
 *
 * ```ts
 * const form = new UiConfigForm(UiConfigMethods.GetChildren(object.uiConfig), {undoManager})
 * popup.appendChild(form.element)
 * ```
 */
export class UiConfigForm {
    /** Adds the stylesheet of the form to the page when the first form is made. Off: the page styles the `ucf-` classes. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement

    readonly element: HTMLDivElement
    private _rows: {config: UiObjectConfig, update: () => void}[] = []
    /** A config that is in the list twice is drawn once */
    private _drawn = new Set<UiObjectConfig>()
    private _undo?: {config: UiObjectConfig, cmd: {undo: () => void, redo: () => void}, time: number, before: any}
    /** The config of a continuous edit (scrub, slider, colour picker) that has no final (`last`) change yet */
    private _unfinished?: UiObjectConfig

    /**
     * @param configs - the configs to draw, e.g. the children of an object's `uiConfig`
     * @param options - undo, change callbacks
     */
    constructor(configs: UiObjectConfig[], private _options: UiConfigFormOptions = {}) {
        if (UiConfigForm.InjectStyles && !UiConfigForm._styles?.isConnected) UiConfigForm._styles = createStyles(styles)
        this.element = document.createElement('div')
        this.element.className = 'ucf'
        for (const c of configs) this._render(c, this.element, [])
    }

    /** Reads the values again, after a change from elsewhere. A field that has the focus keeps what is typed in it. */
    refresh() {
        for (const r of this._rows) r.update()
    }

    /** Removes the form from the page */
    dispose() {
        this.element.remove()
        this._rows = []
        this._drawn.clear()
        this._undo = undefined
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
        const apply = (v: any, isLast: boolean) => {
            const cur = obj[key]
            if (cur && typeof cur === 'object' && typeof cur.copy === 'function') copyPrimitive(cur, v)
            else obj[key] = clonePrimitive(v)
            this._dispatch(c, parents, isLast)
            if (structural) this._options.onStructureChange?.()
        }
        apply(value, last)
        this._unfinished = last ? undefined : c
        const um = this._options.undoManager
        if (!um) return
        const now = performance.now()
        const u = this._undo
        // the same field again within a second, with no other step between: one step from the first value
        const merge = !!u && u.config === c && um.peek() === u.cmd && now - u.time < 1000
        const first = merge && u ? u.before : before
        const after = clonePrimitive(value)
        const cmd = {undo: () => apply(first, true), redo: () => apply(after, true)}
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
        const action = typeof res === 'object' && typeof res?.action === 'function' ? res.action.bind(res) : undefined
        if (action) await action()
        const undo = typeof res === 'function' ? res : typeof res?.undo === 'function' ? res.undo.bind(res) : undefined
        const redo = typeof res === 'function' ? run : typeof res?.redo === 'function' ? res.redo.bind(res) : action
        const um = this._options.undoManager
        if (!undo || !um) return
        um.record({
            undo: async() => {
                await undo()
                this._dispatch(c, parents, true)
            },
            redo: async() => {
                await redo?.()
                this._dispatch(c, parents, true)
            },
        })
    }

    /** The end of a continuous edit: the final change (`last`), which some configs wait for (e.g. to rebuild a geometry) */
    private _end(c: UiObjectConfig, parents: UiObjectConfig[]) {
        if (this._unfinished !== c) return
        this._unfinished = undefined
        this._dispatch(c, parents, true)
    }

    /** `onChange` of the config, then of each parent (what Tweakpane does with `parentOnChange`) */
    private _dispatch(c: UiObjectConfig, parents: UiObjectConfig[], last: boolean) {
        UiConfigMethods.DispatchOnChangeSync(c, {last})
        for (let i = parents.length - 1; i >= 0; i--) {
            const p = parents[i]
            if (typeof p.onChange === 'function') (p.onChange as any)({type: 'change', last, config: c, target: p})
        }
        this._options.onChange?.(c)
        this.refresh()
    }

    private _render(c: UiObjectConfig, host: HTMLElement, parents: UiObjectConfig[]) {
        if (!c || getOrCall(c.hidden) || this._drawn.has(c)) return
        this._drawn.add(c)
        // a config with getValue / setValue gets its property binding here, as in the Tweakpane renderer
        UiConfigMethods.InitUiConfig(c)
        const type = String(getOrCall(c.type))
        const label = UiConfigMethods.GetLabel(c).replace(/([a-z])([A-Z])/g, '$1 $2')
        const disabled = !!(getOrCall(c.disabled) || getOrCall(c.readOnly))
        if (type === 'folder' || type === 'panel') {
            const f = document.createElement('div')
            f.className = 'ucf-folder'
            const h = document.createElement('div')
            h.className = 'ucf-folder-head'
            h.textContent = label
            f.appendChild(h)
            host.appendChild(f)
            for (const ch of this._children(c)) this._render(ch, f, [...parents, c])
            return
        }
        if (type === 'button') {
            const b = document.createElement('button')
            b.className = 'ucf-button'
            b.textContent = label
            b.disabled = disabled
            b.addEventListener('click', async() => {
                const [obj, key] = UiConfigMethods.GetBinding(c, false)
                const fn = obj ? obj[key] ?? obj.value : undefined
                if (typeof fn === 'function') await this._action(c, parents, () => fn.call(obj))
                if (typeof c.onClick === 'function') await (c.onClick as any)()
                this._dispatch(c, parents, true)
                this._options.onStructureChange?.()
            })
            host.appendChild(b)
            return
        }
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
        let kind = type
        if (!FIELD_TYPES.has(type)) {
            const v = value()
            kind = typeof v === 'boolean' ? 'checkbox' : typeof v === 'number' ? 'number' : 'text'
        }

        if (kind === 'checkbox' || kind === 'toggle') {
            const input = document.createElement('input')
            input.type = 'checkbox'
            input.disabled = disabled
            input.addEventListener('change', () => this._set(c, parents, input.checked))
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                input.checked = !!value()
            }})
        } else if (kind === 'dropdown') {
            const sel = document.createElement('select')
            sel.disabled = disabled
            const opts = this._children(c).map(o => ({label: UiConfigMethods.GetLabel(o), value: (o as any).value ?? UiConfigMethods.GetLabel(o)}))
            opts.forEach((o, i) => sel.appendChild(Object.assign(document.createElement('option'), {value: String(i), textContent: o.label})))
            sel.addEventListener('change', () => this._set(c, parents, opts[+sel.value].value, true, true))
            row.appendChild(sel)
            this._rows.push({config: c, update: () => {
                const v = value()
                const i = opts.findIndex(o => o.value === v || equalsPrimitive(o.value, v))
                if (i >= 0) sel.value = String(i)
            }})
        } else if (kind === 'color') {
            const input = document.createElement('input')
            input.type = 'color'
            input.disabled = disabled
            input.addEventListener('input', () => {
                const cur = value() as any
                if (cur?.isColor) this._set(c, parents, cur.clone().set(input.value), false)
                else this._set(c, parents, typeof cur === 'number' ? parseInt(input.value.slice(1), 16) : input.value, false)
            })
            // the picker closes
            input.addEventListener('change', () => this._end(c, parents))
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                const v = value() as any
                if (document.activeElement !== input) input.value = v?.isColor ? '#' + v.getHexString() : typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : String(v ?? '#000000')
            }})
        } else if (kind === 'vec' || kind === 'vec2' || kind === 'vec3' || kind === 'vec4') {
            const v0 = value() as any
            const axes = ['x', 'y', 'z', 'w'].filter(a => typeof v0?.[a] === 'number')
            const wrap = document.createElement('span')
            wrap.className = 'ucf-vec'
            const inputs = axes.map(a => {
                const input = this._number(disabled, n => {
                    const v = (value() as any).clone()
                    v[a] = n
                    this._set(c, parents, v)
                }, () => (value() as any)?.[a])
                input.title = a
                wrap.appendChild(input)
                return input
            })
            row.classList.add('ucf-row-wide')
            row.appendChild(wrap)
            this._rows.push({config: c, update: () => {
                const v = value() as any
                axes.forEach((a, i) => {
                    if (document.activeElement !== inputs[i]) inputs[i].value = fmt(v?.[a])
                })
            }})
        } else if (kind === 'number' || kind === 'slider') {
            const {min, max, step} = UiConfigMethods.GetBounds(c, kind === 'number')
            const isInt = (this._options.isInteger ?? defaultIsInteger)(c, label)
            const clamp = (n: number) => Math.min(max, Math.max(min, isInt ? Math.round(n) : n))
            const input = this._number(disabled, n => this._set(c, parents, clamp(n)), value)
            if (kind === 'slider') {
                const range = document.createElement('input')
                range.type = 'range'
                range.min = String(min)
                range.max = String(max)
                range.step = String(step)
                range.disabled = disabled
                range.addEventListener('input', () => this._set(c, parents, clamp(+range.value), false))
                // the slider is released
                range.addEventListener('change', () => this._end(c, parents))
                row.appendChild(range)
                this._rows.push({config: c, update: () => {
                    range.value = String(value())
                }})
            }
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                if (document.activeElement !== input) input.value = fmt(value())
            }})
            if (!disabled) this._scrub(name, () => +(value() as any), isInt, n => this._set(c, parents, clamp(n), false), () => this._end(c, parents))
        } else if (kind === 'monitor') {
            const out = document.createElement('span')
            out.className = 'ucf-monitor'
            row.appendChild(out)
            this._rows.push({config: c, update: () => {
                out.textContent = String(value())
            }})
        } else { // input and any other type: text
            const input = document.createElement('input')
            input.type = 'text'
            input.disabled = disabled
            input.addEventListener('change', () => this._set(c, parents, input.value))
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                if (document.activeElement !== input) input.value = String(value() ?? '')
            }})
        }
        // the first values of the fields of this config (a slider has two)
        for (let i = firstRow; i < this._rows.length; i++) this._rows[i].update()
    }

    /**
     * A number field. After a committed edit (Enter, the spinner, a blur), it shows the value of the binding, which can
     * be clamped or rounded, also while it has the focus.
     */
    private _number(disabled: boolean, set: (n: number) => void, get: () => any) {
        const input = document.createElement('input')
        input.type = 'number'
        input.step = 'any'
        input.disabled = disabled
        input.addEventListener('change', () => {
            const n = parseFloat(input.value)
            if (isFinite(n)) set(n)
            input.value = fmt(get())
        })
        return input
    }

    /** Drag the name left or right to change the number, Shift for 10x */
    private _scrub(handle: HTMLElement, get: () => number, isInt: boolean, set: (n: number) => void, end: () => void) {
        handle.style.cursor = 'ew-resize'
        handle.addEventListener('pointerdown', e => {
            e.preventDefault()
            handle.setPointerCapture(e.pointerId)
            const x0 = e.clientX
            const v0 = get()
            const step = isInt ? 0.25 : Math.max(0.001, Math.abs(v0) * 0.01 || 0.01)
            const move = (ev: PointerEvent) => set(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : 1))
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

function fmt(v: any) {
    return typeof v === 'number' ? String(+v.toFixed(4)) : String(v ?? '')
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
