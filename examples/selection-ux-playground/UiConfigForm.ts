import {clonePrimitive, copyPrimitive, equalsPrimitive, getOrCall, JSUndoManager, UiConfigMethods, UiObjectConfig} from 'threepipe'

export interface UiConfigFormOptions {
    /** One undo step per edit; quick edits of the same field (scrub, typing) merge into one */
    undoManager?: JSUndoManager
    /** Called after every change, e.g. to redraw */
    onChange?: (config: UiObjectConfig) => void
    /** A dropdown or a button can change which fields there are (e.g. the curve type); rebuild the form then */
    onStructureChange?: () => void
}

interface Row {config: UiObjectConfig, update: () => void}

/**
 * A small plain-DOM form for a list of uiconfig.js configs (the same configs the tweakpane panels use):
 * number (scrub the label), slider, checkbox, dropdown, vector, color, text, button, monitor and folders.
 * Values are read and written through the config bindings, onChange runs up the parent chain like in the renderers.
 */
export class UiConfigForm {
    readonly element: HTMLDivElement
    private _rows: Row[] = []
    /** A generator can list the same config twice (the line generator adds the curve's uiConfig again); draw it once */
    private _drawn = new Set<UiObjectConfig>()
    private _undo?: {config: UiObjectConfig, cmd: {undo: () => void, redo: () => void}, time: number, before: any}

    constructor(configs: UiObjectConfig[], private _options: UiConfigFormOptions = {}) {
        this.element = document.createElement('div')
        this.element.className = 'ucf'
        for (const c of configs) this._render(c, this.element, [])
    }

    /** Read the values again, e.g. after an undo; a field that has the focus keeps what is typed */
    refresh() {
        for (const r of this._rows) r.update()
    }

    private _children(c: UiObjectConfig) {
        return UiConfigMethods.GetChildren(c) as UiObjectConfig[]
    }

    private _set(c: UiObjectConfig, parents: UiObjectConfig[], value: any, last = true) {
        const [obj, key] = binding(c)
        if (!obj) return
        const before = clonePrimitive(obj[key])
        if (equalsPrimitive(before, value)) return
        const apply = (v: any, isLast: boolean) => {
            const cur = obj[key]
            if (cur && typeof cur === 'object' && typeof cur.copy === 'function') copyPrimitive(cur, v)
            else obj[key] = clonePrimitive(v)
            this._dispatch(c, parents, isLast)
        }
        apply(value, last)
        const um = this._options.undoManager
        if (!um) return
        const now = performance.now()
        const u = this._undo
        const merge = !!u && u.config === c && um.peek() === u.cmd && now - u.time < 1000
        const first = merge && u ? u.before : before
        const after = clonePrimitive(value)
        const cmd = {undo: () => apply(first, true), redo: () => apply(after, true)}
        if (merge) um.replaceLast(cmd)
        else um.record(cmd)
        this._undo = {config: c, cmd, time: now, before: first}
    }

    /** onChange of the config, then of each parent (what tweakpane does with parentOnChange) */
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
        // a config with getValue / setValue (the curve type dropdown) gets its property binding here, like tweakpane does
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
                if (typeof fn === 'function') await fn.call(obj)
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
        const value = () => {
            const [obj, key] = binding(c)
            return obj ? obj[key] : undefined
        }

        if (type === 'checkbox' || type === 'toggle') {
            const input = document.createElement('input')
            input.type = 'checkbox'
            input.disabled = disabled
            input.addEventListener('change', () => this._set(c, parents, input.checked))
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                input.checked = !!value()
            }})
        } else if (type === 'dropdown') {
            const sel = document.createElement('select')
            sel.disabled = disabled
            const opts = this._children(c).map(o => ({label: UiConfigMethods.GetLabel(o), value: (o as any).value ?? UiConfigMethods.GetLabel(o)}))
            opts.forEach((o, i) => sel.appendChild(Object.assign(document.createElement('option'), {value: String(i), textContent: o.label})))
            sel.addEventListener('change', () => {
                this._set(c, parents, opts[+sel.value].value)
                this._options.onStructureChange?.()
            })
            row.appendChild(sel)
            this._rows.push({config: c, update: () => {
                const v = value()
                const i = opts.findIndex(o => o.value === v || equalsPrimitive(o.value, v))
                if (i >= 0) sel.value = String(i)
            }})
        } else if (type === 'color') {
            const input = document.createElement('input')
            input.type = 'color'
            input.disabled = disabled
            input.addEventListener('input', () => {
                const cur = value() as any
                if (cur?.isColor) this._set(c, parents, cur.clone().set(input.value), false)
                else this._set(c, parents, typeof cur === 'number' ? parseInt(input.value.slice(1), 16) : input.value, false)
            })
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                const v = value() as any
                if (document.activeElement !== input) input.value = v?.isColor ? '#' + v.getHexString() : typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : String(v ?? '#000000')
            }})
        } else if (type === 'vec' || type === 'vec2' || type === 'vec3' || type === 'vec4') {
            const v0 = value() as any
            const axes = ['x', 'y', 'z', 'w'].filter(a => typeof v0?.[a] === 'number')
            const wrap = document.createElement('span')
            wrap.className = 'ucf-vec'
            const inputs = axes.map(a => {
                const input = this._number(disabled, n => {
                    const v = (value() as any).clone()
                    v[a] = n
                    this._set(c, parents, v)
                })
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
        } else if (type === 'number' || type === 'slider') {
            const {min, max, step} = UiConfigMethods.GetBounds(c, type === 'number')
            const isInt = Number.isInteger(getOrCall(c.stepSize) ?? NaN) || isIntegerName(String(getOrCall(c.property)?.[1] ?? label))
            const clamp = (n: number) => Math.min(max, Math.max(min, isInt ? Math.round(n) : n))
            const input = this._number(disabled, n => this._set(c, parents, clamp(n)))
            if (type === 'slider') {
                const range = document.createElement('input')
                range.type = 'range'
                range.min = String(min)
                range.max = String(max)
                range.step = String(step)
                range.disabled = disabled
                range.addEventListener('input', () => this._set(c, parents, clamp(+range.value), false))
                row.appendChild(range)
                this._rows.push({config: c, update: () => {
                    range.value = String(value())
                }})
            }
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                if (document.activeElement !== input) input.value = fmt(value())
            }})
            // scrub: drag the name left or right, Shift for 10x
            if (!disabled) this._scrub(name, () => +(value() as any), isInt, n => this._set(c, parents, clamp(n), false))
        } else if (type === 'monitor') {
            const out = document.createElement('span')
            out.className = 'ucf-monitor'
            row.appendChild(out)
            this._rows.push({config: c, update: () => {
                out.textContent = String(value())
            }})
        } else { // input and anything else: text
            const input = document.createElement('input')
            input.disabled = disabled
            input.addEventListener('change', () => this._set(c, parents, input.value))
            row.appendChild(input)
            this._rows.push({config: c, update: () => {
                if (document.activeElement !== input) input.value = String(value() ?? '')
            }})
        }
        this._rows[this._rows.length - 1]?.update()
    }

    private _number(disabled: boolean, set: (n: number) => void) {
        const input = document.createElement('input')
        input.type = 'number'
        input.step = 'any'
        input.disabled = disabled
        input.addEventListener('change', () => {
            const n = parseFloat(input.value)
            if (isFinite(n)) set(n)
        })
        return input
    }

    private _scrub(handle: HTMLElement, get: () => number, isInt: boolean, set: (n: number) => void) {
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
                if (this._undo) this._undo.time = 0 // the next edit is a new undo step
            }
            handle.addEventListener('pointermove', move)
            handle.addEventListener('pointerup', up)
        })
    }
}

/**
 * The object and key of a field. uiconfig.js `GetBinding` turns the key of an array item ('0') into a number in the
 * config's own array, and the next call reads the key 0 as no binding: the first point of a spline lost its value.
 * Array items are read directly here.
 */
function binding(c: UiObjectConfig): [any, any] {
    const p = c.property as any
    if (Array.isArray(p) && Array.isArray(p[0]) && /^\d+$/.test(String(p[1]))) return [p[0], +p[1]]
    return UiConfigMethods.GetBinding(c) as [any, any]
}

function fmt(v: any) {
    return typeof v === 'number' ? String(+v.toFixed(4)) : String(v ?? '')
}

/** Counts are whole numbers */
export function isIntegerName(k: string) {
    return /segment|count|sides|detail|points|tubular|radial|steps/i.test(k)
}
