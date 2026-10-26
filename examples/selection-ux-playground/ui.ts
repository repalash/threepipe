import {IObject3D, ThreeViewer, TransformControlsPlugin, UndoManagerPlugin, Vector3} from 'threepipe'
import {defaultSelectionUxSettings, SelectionUxPlugin, SelectionUxSettings} from './SelectionUxPlugin'

/**
 * UI shared by the playground and the editor page: the variant bar over the canvas with a settings popover,
 * hints, toast, shortcut sheet and the notes scratchpad.
 */

interface Opt<K extends keyof SelectionUxSettings> {key: K, label: string, options: [SelectionUxSettings[K], string][]}

export const presets: {short: string, name: string, desc: string, s: Partial<SelectionUxSettings>}[] = [
    {short: 'A', name: 'Figma 2D', desc: 'Screen box, corner scale, rotate outside corners, hover outline', s: {visual: 'figma2d', rotate: 'corners', rotateAxis: 'up', scalePivot: 'base', stretchHandles: false, outlineHover: true}},
    {short: 'B', name: '3D box', desc: 'Line box, corner dots, face stretch, turn ring', s: {visual: 'box3d', rotate: 'ring', scalePivot: 'opposite', stretchHandles: true, xray: true}},
    {short: 'C', name: 'Brackets', desc: 'Minimal corner brackets, rotate knob', s: {visual: 'brackets', rotate: 'knob', rotateAxis: 'up', scalePivot: 'base', stretchHandles: false, xray: false}},
    {short: 'D', name: 'Hybrid', desc: '3D box + 2D handles, side stretch, free rotate', s: {visual: 'hybrid', rotate: 'corners', rotateAxis: 'free', scalePivot: 'base', stretchHandles: true, xray: true}},
    {short: 'E', name: 'Outline', desc: 'Mesh outline + part lines from the render pipeline, handles only', s: {visual: 'minimal', rotate: 'corners', rotateAxis: 'up', scalePivot: 'base', outlineSelected: true, outlineHover: true, outlineParts: true, outlineXray: true}},
    {short: 'F', name: 'Focus', desc: 'Outline, dims the rest (colors of the selection stay), turn ring', s: {visual: 'minimal', rotate: 'ring', scalePivot: 'base', outlineSelected: true, outlineHover: true, outlineParts: true, outlineXray: true, dimOthers: true}},
    {short: '—', name: 'Current', desc: 'Existing PickingPlugin box and clicks', s: {visual: 'legacy'}},
]

const options: Opt<any>[] = [
    {key: 'visual', label: 'Look', options: [['figma2d', '2D'], ['box3d', '3D box'], ['brackets', 'Brackets'], ['hybrid', 'Hybrid'], ['minimal', 'Handles'], ['legacy', 'Current']]},
    {key: 'outlineWidth', label: 'Outline px', options: [[1, '1'], [1.5, '1.5'], [2, '2'], [3, '3']]},
    {key: 'boxSpace', label: 'Box aligns to', options: [['local', 'Object'], ['world', 'World']]},
    {key: 'emptyDrag', label: 'Drag on empty', options: [['orbit', 'Orbit'], ['marquee', 'Box select']]},
    {key: 'dragMove', label: 'Drag object', options: [['any', 'Moves it'], ['selected', 'If selected'], ['off', 'Orbits']]},
    {key: 'movePlane', label: 'Move on', options: [['auto', 'Auto'], ['ground', 'Floor'], ['view', 'Facing you']]},
    {key: 'scalePivot', label: 'Scale from', options: [['base', 'Base'], ['center', 'Center'], ['opposite', 'Corner']]},
    {key: 'rotate', label: 'Rotate with', options: [['corners', 'Corners'], ['knob', 'Knob'], ['ring', 'Ring'], ['off', 'Off']]},
    {key: 'rotateAxis', label: 'Rotate axis', options: [['up', 'Turntable'], ['view', 'Screen'], ['free', 'Free']]},
    {key: 'marquee', label: 'Box select', options: [['touch', 'Touch'], ['contain', 'Inside']]},
    {key: 'unit', label: 'Units', options: [['mm', 'mm'], ['cm', 'cm'], ['m', 'm']]},
    {key: 'accent', label: 'Color', options: [['#0d99ff', 'Blue'], ['#7b61ff', 'Violet'], ['#14ae5c', 'Green'], ['#ff7a1a', 'Orange']]},
]
const toggles: [keyof SelectionUxSettings, string][] = [
    ['outlineSelected', 'Outline selected meshes (pipeline)'],
    ['outlineHover', 'Outline on hover (pipeline)'],
    ['outlineParts', 'Lines between parts of a group'],
    ['outlineXray', 'Dashed outline where hidden'],
    ['fillTint', 'Tint selection'],
    ['dimOthers', 'Dim everything else'],
    ['stretchHandles', 'Side / face stretch handles'],
    ['smartGuides', 'Smart guides + snapping'],
    ['hover', 'Hover highlight'],
    ['showName', 'Name + breadcrumb'],
    ['showDims', 'Size label'],
    ['xray', 'Show hidden box edges'],
]

export function currentPreset(st: SelectionUxSettings) {
    return presets.find(p => Object.entries(p.s).every(([k, v]) => (st as any)[k] === v))
}

export function applyPreset(ux: SelectionUxPlugin, i: number) {
    const st = ux.settings
    // keep the choices that are about the person, not the variant
    Object.assign(st, defaultSelectionUxSettings, {emptyDrag: st.emptyDrag, dragMove: st.dragMove, unit: st.unit, accent: st.accent, outlineWidth: st.outlineWidth}, presets[i].s)
    ux.applySettings()
    try {
        localStorage.setItem('selection-ux-preset', String(i))
    } catch (e) {
        // private mode
    }
}

/** ?preset=N, else the last one picked in this browser */
export function applyInitialPreset(ux: SelectionUxPlugin) {
    let i = 0
    const q = new URLSearchParams(location.search).get('preset')
    try {
        i = q !== null ? +q : +(localStorage.getItem('selection-ux-preset') || 0)
    } catch (e) {
        i = q !== null ? +q : 0
    }
    applyPreset(ux, Math.max(0, Math.min(presets.length - 1, i || 0)))
}

// region variant bar + settings popover

export interface VariantBarOptions {
    /** [label, url] links shown at the end of the bar, e.g. to the other page */
    links?: [string, string][]
    /** extra buttons in the settings popover */
    actions?: [string, () => void][]
}

export function setupVariantBar(host: HTMLElement, viewer: ThreeViewer, ux: SelectionUxPlugin, op: VariantBarOptions = {}) {
    injectUiStyles()
    const bar = document.createElement('div')
    bar.className = 'sux-bar'
    host.appendChild(bar)
    const pop = document.createElement('div')
    pop.className = 'sux-pop'
    host.appendChild(pop)
    let open = false

    const renderBar = () => {
        const cur = currentPreset(ux.settings)
        bar.innerHTML = ''
        presets.forEach((p, i) => {
            const b = document.createElement('button')
            b.className = 'sux-chip' + (cur === p ? ' on' : '')
            b.innerHTML = `<b>${p.short}</b> ${p.name}`
            b.title = p.desc
            b.onclick = () => {
                applyPreset(ux, i)
                renderAll()
            }
            bar.appendChild(b)
        })
        if (!cur) {
            const c = document.createElement('span')
            c.className = 'sux-chip on sux-custom'
            c.textContent = 'Custom'
            bar.appendChild(c)
        }
        const sep = document.createElement('span')
        sep.className = 'sux-sep-v'
        bar.appendChild(sep)
        const gear = document.createElement('button')
        gear.className = 'sux-chip sux-gear' + (open ? ' on' : '')
        gear.title = 'All settings'
        gear.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4h7M12 4h2M2 12h2M7 12h7"/><circle cx="10.5" cy="4" r="1.5"/><circle cx="5.5" cy="12" r="1.5"/></svg> Settings'
        gear.onclick = () => {
            open = !open
            renderAll()
        }
        bar.appendChild(gear)
        const help = document.createElement('button')
        help.className = 'sux-chip'
        help.textContent = '?'
        help.title = 'Shortcuts'
        help.onclick = () => toggleHelp(true)
        bar.appendChild(help)
        for (const [label, url] of op.links || []) {
            const a = document.createElement('a')
            a.className = 'sux-chip sux-link'
            a.textContent = label
            a.href = url
            bar.appendChild(a)
        }
    }

    const renderPop = () => {
        pop.style.display = open ? '' : 'none'
        if (!open) return
        const st = ux.settings
        const cur = currentPreset(st)
        pop.innerHTML = `<div class="sux-pop-head"><b>${cur ? cur.short + ' · ' + cur.name : 'Custom'}</b><span>${cur ? cur.desc : 'Changed from a preset'}</span><button class="sux-x" title="Close">×</button></div>`
        pop.querySelector('.sux-x')!.addEventListener('click', () => {
            open = false
            renderAll()
        })
        for (const o of options) {
            const f = document.createElement('div')
            f.className = 'sux-field'
            f.innerHTML = `<label>${o.label}</label>`
            const seg = document.createElement('div')
            seg.className = 'sux-seg'
            for (const [v, l] of o.options) {
                const b = document.createElement('button')
                b.textContent = l
                b.className = (st as any)[o.key] === v ? 'on' : ''
                b.onclick = () => {
                    (st as any)[o.key] = v
                    ux.applySettings()
                    renderAll()
                }
                seg.appendChild(b)
            }
            f.appendChild(seg)
            pop.appendChild(f)
        }
        const tg = document.createElement('div')
        tg.className = 'sux-toggles'
        for (const [k, l] of toggles) {
            const lab = document.createElement('label')
            lab.className = 'sux-toggle'
            lab.innerHTML = `<input type="checkbox" ${(st as any)[k] ? 'checked' : ''}> ${l}`
            lab.querySelector('input')!.onchange = (e) => {
                (st as any)[k] = (e.target as HTMLInputElement).checked
                ux.applySettings()
                renderAll()
            }
            tg.appendChild(lab)
        }
        const gizmo = document.createElement('label')
        gizmo.className = 'sux-toggle'
        gizmo.innerHTML = `<input type="checkbox" ${viewer.getPlugin(TransformControlsPlugin)?.enabled ? 'checked' : ''}> Also show the current 3D gizmo`
        gizmo.querySelector('input')!.onchange = (e) => {
            const on = (e.target as HTMLInputElement).checked
            let tc = viewer.getPlugin(TransformControlsPlugin)
            if (on && !tc) tc = viewer.addPluginSync(TransformControlsPlugin)
            if (tc) tc.enabled = on
            const sel = ux.selected
            ux.select([], false)
            ux.select(sel, false)
        }
        tg.appendChild(gizmo)
        pop.appendChild(tg)

        const btns = document.createElement('div')
        btns.className = 'sux-btns'
        const actions: [string, () => void][] = [
            ['Load helmet glTF', async() => {
                const m = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {autoCenter: true, autoScale: true, autoScaleRadius: 1.4})
                if (m) {
                    m.position.add(new Vector3(-4.5, 1.6, 4.5))
                    m.setDirty?.({change: 'transform'})
                    ux.select([m])
                }
            }],
            ['Undo', () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.undo()],
            ['Redo', () => viewer.getPlugin(UndoManagerPlugin)?.undoManager?.redo()],
            ...op.actions || [],
        ]
        for (const [label, fn] of actions) {
            const b = document.createElement('button')
            b.textContent = label
            b.onclick = fn
            btns.appendChild(b)
        }
        pop.appendChild(btns)
        const note = document.createElement('div')
        note.className = 'sux-note'
        note.innerHTML = `Drop a .glb / .gltf / .3dm on the canvas to try your own model. Link to a preset: <code>?preset=0..${presets.length - 1}</code>`
        pop.appendChild(note)
    }

    const renderAll = () => {
        renderBar()
        renderPop()
    }
    ux.addEventListener('uxUpdate', e => {
        if (e.reason === 'settings') renderAll()
    })
    renderAll()
}

// endregion

// region hints, toast, shortcuts

const shortcuts: [string, string][] = [
    ['Select', 'Click'],
    ['Add / remove from selection', 'Shift + Click'],
    ['Select inside a group', 'Double-click'],
    ['Select the deepest part', '⌘/Ctrl + Click'],
    ['Box select', 'Shift + Drag empty (or Drag, in Box select mode)'],
    ['Select parent', 'Esc  or  Shift + Enter'],
    ['Select children', 'Enter'],
    ['Next / previous sibling', 'Tab / Shift + Tab'],
    ['Select all at this level', '⌘/Ctrl + A'],
    ['Move', 'Drag the object'],
    ['Switch floor / facing-you plane', 'Tab while moving'],
    ['Move on one axis', 'Shift while dragging'],
    ['Duplicate while moving', 'Alt + Drag'],
    ['Turn off snapping', 'Hold ⌘/Ctrl while dragging'],
    ['Scale (always uniform)', 'Drag a corner'],
    ['Scale from center', 'Alt + Drag a corner'],
    ['Stretch one side', 'Drag a side / face handle'],
    ['Uniform from a side', 'Shift + Drag a side handle'],
    ['Rotate in 15° steps', 'Shift while rotating'],
    ['Cancel a drag', 'Esc'],
    ['Nudge', 'Arrow keys (Shift = ×10)'],
    ['Nudge up / down', 'Alt + ↑ / ↓'],
    ['Group / Ungroup', '⌘/Ctrl + G / ⌘/Ctrl + Shift + G'],
    ['Duplicate', '⌘/Ctrl + D'],
    ['Copy / Paste', '⌘/Ctrl + C / V'],
    ['Delete', 'Delete'],
    ['Hide / show all', 'H / Shift + H'],
    ['Zoom to selection', 'F  or  Shift + 2'],
    ['Zoom to fit all', 'Shift + 1'],
    ['Orbit (any mode)', 'Space + Drag, or Right-drag in Box select mode'],
    ['Undo / Redo', '⌘/Ctrl + Z / ⌘/Ctrl + Shift + Z'],
    ['This sheet', '?'],
]

export function toggleHelp(show?: boolean) {
    const h = document.getElementById('sux-help')
    if (!h) return
    const on = show ?? !h.classList.contains('show')
    h.classList.toggle('show', on)
}

export function setupHints(host: HTMLElement, ux: SelectionUxPlugin) {
    injectUiStyles()
    const help = document.createElement('div')
    help.id = 'sux-help'
    help.innerHTML = '<div class="card"><h4>Shortcuts</h4>' + shortcuts.map(([a, b]) => `<div><span>${a}</span><span>${b.split('  ').map(x => `<kbd>${x}</kbd>`).join(' ')}</span></div>`).join('') + '</div>'
    document.body.appendChild(help)
    help.addEventListener('click', () => toggleHelp(false))
    window.addEventListener('keydown', e => {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (e.key === '?') toggleHelp()
    })

    const hint = document.createElement('div')
    hint.className = 'sux-hint'
    host.appendChild(hint)
    const k = (s: string) => `<kbd>${s}</kbd>`
    const update = () => {
        const st = ux.settings
        if (st.visual === 'legacy') {
            hint.innerHTML = 'Current behaviour: click to select, Shift/Ctrl+click to add'
            return
        }
        const sel = ux.selected
        const orbit = st.emptyDrag === 'orbit' ? `Drag empty space to orbit · ${k('Shift')}+drag to box-select` : `Drag empty space to box-select · ${k('Space')}+drag or right-drag to orbit`
        if (!sel.length) hint.innerHTML = `Click an object to select · ${orbit} · ${k('?')} shortcuts`
        else if (!ux.canEdit) hint.innerHTML = `${ux.editingLocked ? 'Editing is locked' : 'Locked layer'} · ${k('Esc')} deselects`
        else {
            const L = ux.levels(sel[0])
            const i = L.findIndex(l => l.includes(sel[0]))
            const hasKids = L[i] && L[i][L[i].length - 1].children.length > 0 && !sel[0].geometry
            const parts = [
                st.dragMove === 'off' ? '' : 'Drag to move',
                'Corners scale',
                st.rotate === 'corners' ? 'Just outside a corner rotates' : st.rotate === 'knob' ? 'Knob rotates' : st.rotate === 'ring' ? 'Ring turns it' : '',
                hasKids ? 'Double-click to go inside' : '',
                i > 0 ? `${k('Esc')} selects parent` : `${k('Esc')} deselects`,
            ].filter(Boolean)
            hint.innerHTML = parts.join(' · ')
        }
    }
    ux.addEventListener('uxUpdate', e => {
        if (e.reason !== 'drag' && e.reason !== 'hover' && e.reason !== 'transform') update()
    })
    update()

    const toast = document.createElement('div')
    toast.className = 'sux-toast'
    host.appendChild(toast)
    let timer = 0
    ux.addEventListener('toast', e => {
        toast.textContent = e.message
        toast.classList.add('show')
        clearTimeout(timer)
        timer = window.setTimeout(() => toast.classList.remove('show'), 1800)
    })
}

// endregion

// region notes

/**
 * Scratchpad for feedback. Kept in localStorage, and on the playground server (POST /api/notes) when it has one,
 * so the notes can be read back from the session that serves the page.
 */
export function setupNotes(host: HTMLElement, ux: SelectionUxPlugin) {
    injectUiStyles()
    host.classList.add('sux-notes')
    host.innerHTML = `<div class="sux-notes-head"><b>Notes</b><small></small></div>
<textarea placeholder="Feedback, ideas, bugs… Saved automatically. “+ Context” adds the current variant and selection."></textarea>
<div class="sux-btns"><button class="ctx" title="Insert the current preset and selection">+ Context</button><button class="copy">Copy</button></div>`
    const text = host.querySelector('textarea')!
    const status = host.querySelector('small')!
    const key = 'selection-ux-playground-notes'
    const api = '/api/notes'
    let serverOk = false
    let timer = 0

    try {
        text.value = localStorage.getItem(key) || ''
    } catch (e) {
        text.value = ''
    }

    // the server copy wins when it is longer, e.g. notes written on another device
    fetch(api).then(async r => r.ok ? r.json() : Promise.reject(r.status)).then((d: {text?: string}) => {
        serverOk = true
        if (typeof d.text === 'string' && d.text.length > text.value.length) text.value = d.text
        status.textContent = 'saved on server'
    }).catch(() => {
        status.textContent = 'saved in this browser'
    })

    const save = () => {
        try {
            localStorage.setItem(key, text.value)
        } catch (e) {
            // private mode: the server copy is all there is
        }
        if (!serverOk) {
            status.textContent = 'saved in this browser'
            return
        }
        status.textContent = 'saving…'
        fetch(api, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: text.value})})
            .then(r => {
                status.textContent = r.ok ? 'saved on server' : 'server save failed, kept in browser'
            })
            .catch(() => {
                status.textContent = 'server save failed, kept in browser'
            })
    }
    text.addEventListener('input', () => {
        status.textContent = 'editing…'
        clearTimeout(timer)
        timer = window.setTimeout(save, 600)
    })
    // keep Ctrl+Z, Delete, arrows etc. in the text box, away from the scene undo and hotkeys
    text.addEventListener('keydown', e => e.stopPropagation())

    host.querySelector('.ctx')!.addEventListener('click', () => {
        const st = ux.settings
        const preset = currentPreset(st)
        const sel = ux.selected.map(o => ux.displayName(o)).join(', ')
        const page = document.title
        const at = text.selectionStart ?? text.value.length
        const line = `${at ? '\n' : ''}[${new Date().toLocaleString()} · ${page} · ${preset ? preset.short + ' · ' + preset.name : 'custom: ' + st.visual + ', rotate ' + st.rotate}${sel ? ' · selected: ' + sel : ''}]\n`
        text.value = text.value.slice(0, at) + line + text.value.slice(at)
        text.focus()
        text.selectionStart = text.selectionEnd = at + line.length
        save()
    })
    host.querySelector('.copy')!.addEventListener('click', () => {
        navigator.clipboard?.writeText(text.value).then(() => {
            status.textContent = 'copied'
        })
    })
}

// endregion

let stylesAdded = false
export function injectUiStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.sux-bar, .sux-pop, .sux-hint, .sux-toast, .sux-notes, #sux-help, .sux-name, .sux-dims {
  font: 11px/1.3 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.sux-bar {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 12; display: flex; gap: 2px; align-items: center;
  background: rgba(30,30,30,.92); padding: 4px; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); max-width: calc(100% - 20px); overflow-x: auto;
}
.sux-chip {
  border: 0; background: transparent; color: #ddd; padding: 6px 9px; border-radius: 7px; font: inherit; cursor: pointer; white-space: nowrap;
  display: inline-flex; gap: 5px; align-items: center; text-decoration: none;
}
.sux-chip b { color: #8fd0ff; font-weight: 600; }
.sux-chip:hover { background: #3a3a3a; }
.sux-chip.on { background: #0d99ff; color: #fff; }
.sux-chip.on b { color: #fff; }
.sux-custom { cursor: default; background: #555 !important; }
.sux-sep-v { width: 1px; align-self: stretch; background: #444; margin: 2px 4px; }
.sux-link { color: #8fd0ff; }
.sux-pop {
  position: absolute; top: 56px; right: 12px; z-index: 12; width: 300px; max-height: calc(100% - 80px); overflow: auto;
  background: #fff; color: #1e1e1e; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.2); padding-bottom: 8px;
}
.sux-pop-head { display: flex; flex-direction: column; gap: 2px; padding: 12px 36px 10px 12px; border-bottom: 1px solid #eee; position: relative; margin-bottom: 6px; }
.sux-pop-head span { color: #757575; }
.sux-x { position: absolute; right: 8px; top: 8px; border: 0; background: transparent; font-size: 16px; cursor: pointer; color: #757575; }
.sux-field { display: flex; align-items: center; padding: 3px 12px; gap: 8px; min-height: 24px; }
.sux-field > label { width: 80px; flex: none; color: #757575; }
.sux-seg { display: flex; flex: 1; background: #f0f0f0; border-radius: 5px; padding: 2px; gap: 2px; flex-wrap: wrap; }
.sux-seg button { flex: 1; border: 0; background: transparent; border-radius: 4px; padding: 4px; font: inherit; color: #757575; cursor: pointer; white-space: nowrap; }
.sux-seg button.on { background: #fff; color: #1e1e1e; box-shadow: 0 0 0 1px #e0e0e0; }
.sux-toggles { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; }
.sux-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.sux-toggle input { margin: 0; accent-color: #0d99ff; }
.sux-btns { display: flex; gap: 6px; padding: 4px 12px; flex-wrap: wrap; }
.sux-btns button { border: 1px solid #e6e6e6; background: #fff; color: #1e1e1e; border-radius: 5px; padding: 5px 8px; font: inherit; cursor: pointer; }
.sux-btns button:hover { background: #f2f2f2; }
.sux-note { color: #757575; padding: 6px 12px 4px; }
.sux-hint {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: rgba(30,30,30,.86); color: #fff; padding: 6px 12px;
  border-radius: 8px; pointer-events: none; white-space: nowrap; z-index: 10;
}
.sux-hint kbd, #sux-help kbd { font: inherit; background: rgba(255,255,255,.16); border-radius: 3px; padding: 0 4px; }
.sux-toast {
  position: absolute; left: 50%; top: 56px; transform: translateX(-50%) translateY(-8px); background: #1e1e1e; color: #fff; padding: 7px 12px;
  border-radius: 8px; opacity: 0; transition: opacity .15s, transform .15s; pointer-events: none; z-index: 13;
}
.sux-toast.show { opacity: 1; transform: translateX(-50%); }
#sux-help { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: none; align-items: center; justify-content: center; z-index: 2000; }
#sux-help.show { display: flex; }
#sux-help .card { background: #1e1e1e; color: #fff; border-radius: 12px; padding: 18px 22px; max-width: 760px; columns: 2; column-gap: 32px; line-height: 1.9; }
#sux-help .card h4 { margin: 0 0 4px; font-size: 12px; }
#sux-help .card div { display: flex; justify-content: space-between; gap: 16px; break-inside: avoid; }
#sux-help .card div span:first-child { color: #bbb; }
.sux-notes { display: flex; flex-direction: column; background: #fff; color: #1e1e1e; user-select: text; }
.sux-notes-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px 6px; }
.sux-notes-head small { color: #757575; }
.sux-notes textarea {
  flex: 1; min-height: 80px; margin: 0 12px; border: 1px solid #e6e6e6; border-radius: 6px; padding: 8px; font: inherit; line-height: 1.5;
  resize: none; outline: none; background: #fffdf3; color: #1e1e1e;
}
.sux-notes textarea:focus { border-color: #0d99ff; }
.sux-notes .sux-btns { padding: 6px 12px 10px; }
.sux-name, .sux-dims { position: absolute; left: 0; top: 0; white-space: nowrap; line-height: 16px; }
.sux-name { color: var(--sux-accent); pointer-events: auto; font-weight: 500; }
.sux-crumb { opacity: 0.65; cursor: pointer; }
.sux-crumb:hover { opacity: 1; text-decoration: underline; }
.sux-sep { opacity: 0.4; margin: 0 4px; }
.sux-dims { background: var(--sux-accent); color: #fff; border-radius: 3px; padding: 0 5px; font-variant-numeric: tabular-nums; }
@media (max-width: 800px) { .sux-hint { display: none; } .sux-pop { width: calc(100% - 24px); } }
`
    document.head.appendChild(st)
}
