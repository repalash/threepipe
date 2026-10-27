import {Group2, IObject3D, Mesh, PhysicalMaterial, SphereGeometry, ThreeViewer, TorusGeometry, TransformControlsPlugin, UndoManagerPlugin, Vector3} from 'threepipe'
import {SelectionUxPlugin, SelectionUxSettings} from './SelectionUxPlugin'
import {LayersPanelPlugin} from './LayersPanelPlugin'
import type {NotesPlugin} from './NotesPlugin'

/**
 * UI shared by the playground and the editor page: the mode menu over the canvas with a settings popover,
 * the floating layers + notes side panel, hints, toast, the shortcut sheet and the notes scratchpad.
 * The modes, the saved settings and the hint text live in SelectionUxPlugin; this file only draws them.
 */

interface Opt<K extends keyof SelectionUxSettings> {key: K, label: string, options: [SelectionUxSettings[K], string][]}

const options: Opt<any>[] = [
    {key: 'visual', label: 'Look', options: [['figma2d', '2D'], ['box3d', '3D box'], ['brackets', 'Brackets'], ['hybrid', 'Hybrid'], ['minimal', 'Handles'], ['legacy', 'Current']]},
    {key: 'outlineWidth', label: 'Outline px', options: [[1, '1'], [1.5, '1.5'], [2, '2'], [3, '3']]},
    {key: 'boxSpace', label: 'Box aligns to', options: [['local', 'Object'], ['world', 'World']]},
    {key: 'emptyDrag', label: 'Drag on empty', options: [['orbit', 'Orbit'], ['marquee', 'Box select']]},
    {key: 'dragMove', label: 'Drag object', options: [['any', 'Moves it'], ['selected', 'If selected'], ['off', 'Orbits']]},
    {key: 'movePlane', label: 'Move on', options: [['auto', 'Auto'], ['ground', 'Floor XZ'], ['xy', 'Front XY'], ['yz', 'Side YZ'], ['view', 'Facing you']]},
    {key: 'scalePivot', label: 'Scale from', options: [['base', 'Base'], ['center', 'Center'], ['opposite', 'Corner']]},
    {key: 'rotate', label: 'Rotate with', options: [['corners', 'Corners'], ['knob', 'Knob'], ['ring', 'Ring'], ['off', 'Off']]},
    {key: 'rotateAxis', label: 'Rotate axis', options: [['up', 'Turntable'], ['view', 'Screen'], ['free', 'Free']]},
    {key: 'marquee', label: 'Box select', options: [['touch', 'Touch'], ['contain', 'Inside']]},
    {key: 'objectHelpers', label: 'Lights, cams', options: [['overlay', 'New overlay'], ['widgets', '3D widgets'], ['both', 'Both'], ['none', 'None']]},
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
    ['showHints', 'Hint line at the bottom'],
]

/** ?mode=<id> or ?preset=<index> picks a mode, overriding the saved one */
export function applyModeFromUrl(ux: SelectionUxPlugin) {
    const q = new URLSearchParams(location.search)
    const id = q.get('mode') ?? (q.get('preset') !== null ? ux.modes[+q.get('preset')!]?.id : null)
    if (id) ux.setMode(id)
}

function modeLabel(ux: SelectionUxPlugin) {
    const m = ux.modes.find(x => x.id === ux.mode)
    return m ? `${m.short ? `<b>${m.short}</b> ` : ''}<span class="sux-mode-label">${m.label}</span>` : '<b>·</b> <span class="sux-mode-label">Custom</span>'
}

// region mode menu + settings popover

export interface ModeMenuOptions {
    /** [label, url] links in the menu, e.g. to the other page */
    links?: [string, string][]
    /** extra buttons in the settings popover */
    actions?: [string, () => void][]
    /** where the mode button goes, e.g. the slot of EditorToolbarPlugin; default: top center of host */
    buttonHost?: HTMLElement
}

/**
 * One small button over the canvas: the current mode. It opens a menu with the modes, Settings and Shortcuts.
 */
export function setupModeMenu(host: HTMLElement, viewer: ThreeViewer, ux: SelectionUxPlugin, op: ModeMenuOptions = {}) {
    injectUiStyles()
    const wrap = document.createElement('div')
    wrap.className = 'sux-modes' + (op.buttonHost ? ' sux-modes-inline' : '')
    ;(op.buttonHost ?? host).appendChild(wrap)
    const pop = document.createElement('div')
    pop.className = 'sux-pop'
    host.appendChild(pop)
    let menuOpen = false
    let settingsOpen = false

    const renderMenu = () => {
        wrap.innerHTML = ''
        const btn = document.createElement('button')
        btn.className = 'sux-mode-btn' + (menuOpen ? ' on' : '')
        btn.innerHTML = `${modeLabel(ux)} <svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
        btn.title = 'Selection mode'
        btn.onclick = () => {
            menuOpen = !menuOpen
            renderMenu()
        }
        wrap.appendChild(btn)
        if (!menuOpen) return
        const menu = document.createElement('div')
        menu.className = 'sux-menu'
        const pickMode = (id: string) => {
            ux.setMode(id)
            menuOpen = false
            renderAll()
        }
        for (const m of ux.modes) {
            const it = document.createElement('div')
            it.className = 'sux-menu-item' + (ux.mode === m.id ? ' on' : '')
            it.innerHTML = `<b>${m.short ?? ''}</b><span><span class="t">${m.label}</span>${m.description ? `<span class="d">${m.description}</span>` : ''}</span>`
            it.onclick = () => pickMode(m.id)
            menu.appendChild(it)
        }
        const sep = () => {
            const d = document.createElement('div')
            d.className = 'sux-menu-sep'
            menu.appendChild(d)
        }
        const item = (label: string, fn: () => void) => {
            const it = document.createElement('div')
            it.className = 'sux-menu-item sux-menu-plain'
            it.innerHTML = label
            it.onclick = () => {
                menuOpen = false
                fn()
                renderAll()
            }
            menu.appendChild(it)
        }
        sep()
        item(settingsOpen ? 'Hide settings' : 'Settings…', () => {
            settingsOpen = !settingsOpen
        })
        item('Shortcuts <kbd>?</kbd>', () => toggleHelp(true))
        item(ux.settings.showHints ? 'Hide hints' : 'Show hints', () => {
            ux.settings.showHints = !ux.settings.showHints
            ux.applySettings()
        })
        for (const [label, url] of op.links || []) item(label, () => {
            location.href = url
        })
        wrap.appendChild(menu)
    }

    const renderPop = () => {
        pop.style.display = settingsOpen ? '' : 'none'
        if (!settingsOpen) return
        const st = ux.settings
        const cur = ux.modes.find(x => x.id === ux.mode)
        pop.innerHTML = `<div class="sux-pop-head"><b>${cur ? (cur.short ? cur.short + ' · ' : '') + cur.label : 'Custom'}</b><span>${cur ? cur.description ?? '' : 'Changed from a mode'}</span><button class="sux-x" title="Close">×</button></div>`
        pop.querySelector('.sux-x')!.addEventListener('click', () => {
            settingsOpen = false
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
            ['Add 2000 objects (stress test)', () => addStressObjects(viewer, ux)],
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
        note.innerHTML = `Drop a .glb / .gltf / .3dm on the canvas to try your own model. Open a mode directly: <code>?mode=${ux.modes.map(m => m.id).join('|')}</code>. Settings are saved in this browser${ux.persistKey ? '' : ' (off)'}.`
        pop.appendChild(note)
    }

    const renderAll = () => {
        renderMenu()
        renderPop()
    }
    // close the menu on any click outside it
    window.addEventListener('pointerdown', e => {
        if (menuOpen && !wrap.contains(e.target as Node)) {
            menuOpen = false
            renderMenu()
        }
    }, true)
    ux.addEventListener('uxUpdate', e => {
        if (e.reason === 'settings') renderAll()
    })
    renderAll()
}

// endregion

// region side panel (layers + notes)

/**
 * Floating side panel with the layers on top and the sticky notes below. The layers header drags the whole panel.
 */
export function setupSidePanel(host: HTMLElement, layers: LayersPanelPlugin, notes: NotesPlugin, storageKey: string) {
    injectUiStyles()
    const side = document.createElement('div')
    side.className = 'sux-side'
    host.appendChild(side)
    side.appendChild(layers.element)
    side.appendChild(notes.element)
    layers.makeMovable(side, storageKey)
    return side
}

/** "+ Context" text from the selection UX: the current mode */
export function modeContext(ux: SelectionUxPlugin) {
    return () => {
        const m = ux.modes.find(x => x.id === ux.mode)
        return `${document.title} · ${m ? m.label : 'custom: ' + ux.settings.visual}`
    }
}

// endregion

/** 40 groups of 50 objects, to try the layers panel and picking with a big file */
export function addStressObjects(viewer: ThreeViewer, ux: SelectionUxPlugin) {
    const root = new Group2()
    root.name = 'Stress test (2000)'
    const geos = [new SphereGeometry(0.12, 12, 8), new TorusGeometry(0.1, 0.035, 8, 16)]
    const mats = ['#e8c372', '#dfe3e8', '#d2304f', '#a9dcff'].map(c => new PhysicalMaterial({color: c, metalness: 0.8, roughness: 0.3}))
    for (let g = 0; g < 40; g++) {
        const grp = new Group2()
        grp.name = `Row ${g + 1}`
        grp.position.set(-6 + g % 8 * 1.7, 0, 7 + Math.floor(g / 8) * 1.7)
        for (let i = 0; i < 50; i++) {
            const m = new Mesh(geos[i % 2], mats[(g + i) % 4])
            m.name = `Item ${g * 50 + i + 1}`
            m.position.set(i % 10 * 0.15, 0.12 + Math.floor(i / 10) * 0.25, 0)
            grp.add(m)
        }
        root.add(grp)
    }
    viewer.scene.addObject(root)
    ux.select([root])
}

// region hints, toast, shortcuts

// sections of [what, keys]; in keys, "  " separates alternatives
const shortcuts: [string, [string, string][]][] = [
    ['Select', [
        ['Select', 'Click'],
        ['The one behind', 'Click again'],
        ['Add or remove', 'Shift Click'],
        ['Inside a group', 'Double-click'],
        ['The deepest part', 'Ctrl Click'],
        ['Box select', 'Shift Drag'],
        ['All at this level', 'Ctrl A'],
        ['Parent', 'Esc  Shift Enter'],
        ['Children', 'Enter'],
        ['Next / previous sibling', 'Tab  Shift Tab'],
    ]],
    ['Move and shape', [
        ['Tools: select, move, rotate, scale', 'V W E R'],
        ['Move the selection', 'Drag it'],
        ['On one axis', 'Shift Drag'],
        ['Exact: axis, distance, confirm', 'X Y Z  5  Enter'],
        ['Move plane: floor, wall, facing', 'Tab while moving'],
        ['No snapping', 'Ctrl while dragging'],
        ['Copy while moving', 'Alt Drag'],
        ['Nudge (Shift: ×10)', 'Arrows'],
        ['Nudge up / down', 'Alt ↑  Alt ↓'],
        ['Scale (uniform)', 'Drag a corner'],
        ['From the centre', 'Alt Drag a corner'],
        ['Stretch one side', 'Drag a side'],
        ['Rotate in 15° steps', 'Shift while rotating'],
        ['Cancel a drag', 'Esc'],
    ]],
    ['Edit', [
        ['Geometry: points, parameters', 'Enter on a part'],
        ['Done with the geometry', 'Esc'],
        ['Duplicate (again: same offset)', 'Ctrl D'],
        ['Copy / paste', 'Ctrl C  Ctrl V'],
        ['Group / ungroup', 'Ctrl G  Ctrl Shift G'],
        ['Delete', 'Delete'],
        ['Hide / show all', 'H  Shift H'],
        ['Undo / redo', 'Ctrl Z  Ctrl Shift Z'],
        ['Pen: points, drag for curves', 'P'],
        ['Annotation', 'N'],
    ]],
    ['View and camera', [
        ['Orbit', 'Space Drag'],
        ['Zoom to the selection', 'F'],
        ['Zoom to fit all', 'Shift 1'],
        ['Look through a camera / back', '0'],
        ['Lock the camera to the view', 'L'],
        ['Move the camera to this view', 'Ctrl Alt 0'],
        ['Aim a light or camera', 'Drag its end dot'],
        ['Selection style 1–7', '1 … 7'],
        ['Expand the canvas', 'Shift Space'],
        ['Light / dark theme (editor)', 'Shift T'],
        ['This sheet', '?'],
    ]],
]

const keysHtml = (k: string) => k.split('  ').map(x => `<kbd>${x}</kbd>`).join('<i>or</i>')

export function toggleHelp(show?: boolean) {
    const h = document.getElementById('sux-help')
    if (!h) return
    const on = show ?? !h.classList.contains('show')
    h.classList.toggle('show', on)
    if (on) h.focus()
    else if (document.activeElement === h) h.blur()
}

export function setupHints(host: HTMLElement, ux: SelectionUxPlugin) {
    injectUiStyles()
    const help = document.createElement('div')
    help.id = 'sux-help'
    help.setAttribute('role', 'dialog')
    help.setAttribute('aria-label', 'Keyboard shortcuts')
    help.innerHTML = '<div class="card"><h4>Keyboard shortcuts <small>⌘ on a Mac for Ctrl · Esc or a click closes this</small></h4><div class="cols">' +
        shortcuts.map(([title, rows]) => `<section><h5>${title}</h5>${rows.map(([a, b]) => `<p><span>${a}</span><span>${keysHtml(b)}</span></p>`).join('')}</section>`).join('') + '</div></div>'
    document.body.appendChild(help)
    help.addEventListener('click', () => toggleHelp(false))
    // the open sheet has the focus and owns the keys (data-own-keys), so Esc closes it and does not deselect
    help.tabIndex = -1
    help.dataset.ownKeys = ''
    help.addEventListener('keydown', e => {
        if (e.key === 'Escape' || e.key === '?') toggleHelp(false)
        e.stopPropagation() // PickingPlugin listens on window too (Esc deselects, Delete deletes)
    })
    window.addEventListener('keydown', e => {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (e.key === '?' && !(e.target as HTMLElement)?.closest?.('#sux-help')) toggleHelp(true)
    })

    // the text comes from the plugin (settings.showHints, hintProvider); the × turns it off, the mode menu turns it back on
    const hint = document.createElement('div')
    hint.className = 'sux-hint'
    host.appendChild(hint)
    const text = document.createElement('span')
    const close = document.createElement('button')
    close.className = 'sux-hint-x'
    close.title = 'Hide hints (Mode menu → Show hints)'
    close.textContent = '×'
    close.onclick = () => {
        ux.settings.showHints = false
        ux.applySettings()
    }
    hint.append(text, close)
    const update = () => {
        const h = ux.getHint()
        hint.style.display = h ? '' : 'none'
        if (text.innerHTML !== h) text.innerHTML = h
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



let stylesAdded = false
export function injectUiStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.sux-modes, .sux-pop, .sux-hint, .sux-toast, #sux-help, .sux-name, .sux-dims {
  font: 11px/1.3 var(--tp-font-family, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
}
.sux-modes { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 12; }
.sux-modes-inline { position: relative; top: auto; left: auto; transform: none; }
.sux-modes-inline .sux-mode-btn { box-shadow: none; background: transparent; }
.sux-modes-inline .sux-menu { left: 0; transform: none; }
.sux-mode-btn {
  border: 0; background: rgba(30,30,30,.9); color: #eee; padding: 6px 10px; border-radius: 8px; font: inherit; cursor: pointer;
  display: inline-flex; gap: 6px; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,.18); white-space: nowrap;
}
.sux-mode-btn b { color: #8fd0ff; }
.sux-mode-btn:hover, .sux-mode-btn.on { background: #1e1e1e; color: #fff; }
.sux-menu {
  position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); width: 280px; background: #1e1e1e; color: #fff;
  border-radius: 10px; padding: 6px; box-shadow: 0 8px 28px rgba(0,0,0,.3);
}
.sux-menu-item { display: flex; gap: 10px; padding: 7px 8px; border-radius: 6px; cursor: pointer; align-items: flex-start; }
.sux-menu-item > b { width: 12px; color: #8fd0ff; flex: none; }
.sux-menu-item .t { display: block; }
.sux-menu-item .d { display: block; color: #9a9a9a; margin-top: 2px; }
.sux-menu-item:hover { background: #2f2f2f; }
.sux-menu-item.on { background: #0d99ff; }
.sux-menu-item.on b, .sux-menu-item.on .d { color: #fff; }
.sux-menu-plain { padding: 6px 8px; justify-content: space-between; }
.sux-menu-plain kbd { font: inherit; color: #9a9a9a; }
.sux-menu-sep { height: 1px; background: #333; margin: 4px 2px; }
.sux-side {
  position: absolute; left: 10px; top: 10px; bottom: 52px; width: 240px; z-index: 11; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.sux-side > * { pointer-events: auto; border-radius: 8px; overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.10); }
.sux-side .lp-root { flex: 1; min-height: 120px; height: auto; }
.sux-side .np-root { height: 230px; flex: none; }
.sux-side .np-root.np-collapsed { height: auto; }
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
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: rgba(30,30,30,.86); color: #fff; padding: 5px 6px 5px 12px;
  border-radius: 8px; pointer-events: none; white-space: nowrap; z-index: 10; display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px);
}
.sux-hint > span { overflow: hidden; text-overflow: ellipsis; }
.sux-hint-x { pointer-events: auto; border: 0; background: transparent; color: #aaa; font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
.sux-hint-x:hover { background: #444; color: #fff; }
.sux-hint kbd { font: inherit; background: rgba(255,255,255,.16); border-radius: 3px; padding: 0 4px; }
.sux-toast {
  position: absolute; left: 50%; top: 56px; transform: translateX(-50%) translateY(-8px); background: #1e1e1e; color: #fff; padding: 7px 12px;
  border-radius: 8px; opacity: 0; transition: opacity .15s, transform .15s; pointer-events: none; z-index: 13;
}
.sux-toast.show { opacity: 1; transform: translateX(-50%); }
#sux-help { position: fixed; inset: 0; background: rgba(0,0,0,.28); display: none; align-items: center; justify-content: center; z-index: 2000; padding: 16px; box-sizing: border-box; }
#sux-help.show { display: flex; }
#sux-help:focus { outline: none; }
#sux-help .card { background: #fff; color: #1e1e1e; border-radius: 10px; padding: 16px 20px 18px; width: min(1040px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box;
  box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 12px 40px rgba(0,0,0,.2); cursor: default; }
#sux-help h4 { margin: 0 0 12px; font-size: 13px; font-weight: 600; display: flex; align-items: baseline; gap: 10px; }
#sux-help h4 small { font-size: 11px; font-weight: 400; color: #8a8f97; }
#sux-help .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 4px 24px; }
#sux-help h5 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: #0d99ff; text-transform: uppercase; letter-spacing: .04em; }
#sux-help p { margin: 0; display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 22px; border-bottom: 1px solid #f2f2f3; }
#sux-help p span:first-child { color: #4a4f57; }
#sux-help p span:last-child { flex: none; text-align: right; white-space: nowrap; }
#sux-help kbd { font-family: inherit; font-size: 10.5px; font-weight: 500; line-height: 1; color: #1e1e1e; background: #f3f4f6; border: 1px solid #e3e4e8; border-bottom-width: 2px; border-radius: 4px; padding: 2px 5px; white-space: nowrap; }
#sux-help i { font-style: normal; color: #9a9ea6; margin: 0 4px; font-size: 10px; }
.sux-params {
  --pp-bg: #fff; --pp-fg: #1e1e1e; --pp-dim: #757575; --pp-input: #f3f4f6; --pp-line: #ececec;
  position: absolute; left: 0; top: 0; width: 240px; max-height: 70%; overflow: auto; background: var(--pp-bg); color: var(--pp-fg); border-radius: 6px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 8px 28px rgba(0,0,0,.16); padding: 2px 0 8px; font: 11px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; z-index: 3;
}
/* with the tweakpane UI on the page, take its theme colours */
body[class*="tpTheme-"] .sux-params {
  --pp-bg: var(--tp-base-background-color, #1c2026); --pp-fg: var(--tp-container-foreground-color, #f0f0f0);
  --pp-dim: var(--tp-monitor-foreground-color, #9a9a9a); --pp-input: var(--tp-input-background-color, rgba(255,255,255,.07));
  --pp-line: var(--tp-container-border-color, rgba(255,255,255,.12));
}
.sux-params-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 6px 12px; position: sticky; top: -2px; background: var(--pp-bg); z-index: 1; }
.sux-params-head span { flex: 1; color: var(--pp-dim); }
.sux-params-head button { border: 0; background: var(--sux-accent); color: #fff; border-radius: 4px; padding: 5px 10px; font: inherit; cursor: pointer; }
.sux-params-note { color: var(--pp-dim); padding: 2px 12px 6px; }
.ucf-row { display: flex; align-items: center; gap: 6px; padding: 2px 10px 2px 12px; min-height: 26px; }
.ucf-name { flex: 1; color: var(--pp-dim); user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; }
.ucf-row-wide { flex-wrap: wrap; }
.ucf-row-wide .ucf-name { flex-basis: 100%; }
.ucf-row input, .ucf-row select { font: inherit; color: var(--pp-fg); background: var(--pp-input); border: 1px solid transparent; border-radius: 4px; padding: 4px 6px; outline: none; min-width: 0; }
.ucf-row input[type=number], .ucf-row input:not([type]) { width: 74px; }
.ucf-row input:focus, .ucf-row select:focus { border-color: var(--sux-accent); }
.ucf-row input[type=checkbox] { width: 14px; height: 14px; accent-color: var(--sux-accent); }
.ucf-row input[type=range] { flex: 1; min-width: 60px; padding: 0; background: none; accent-color: var(--sux-accent); }
.ucf-row input[type=color] { width: 40px; height: 24px; padding: 1px; }
.ucf-row select { max-width: 130px; }
.ucf-vec { display: flex; gap: 4px; width: 100%; }
.ucf-vec input[type=number] { flex: 1; width: 0; }
.ucf-folder { margin: 4px 0; border-top: 1px solid var(--pp-line); padding-top: 2px; }
.ucf-folder-head { padding: 6px 12px 2px; font-weight: 600; text-transform: capitalize; }
.ucf-button { display: block; margin: 4px 12px; width: calc(100% - 24px); border: 0; border-radius: 4px; padding: 6px; background: var(--pp-input); color: var(--pp-fg); font: inherit; cursor: pointer; }
.ucf-button:hover { filter: brightness(.96); }
.ucf-monitor { color: var(--pp-dim); }
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
