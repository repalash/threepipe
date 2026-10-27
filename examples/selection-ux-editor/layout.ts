import {ThreeViewer} from 'threepipe'
import {SelectionUxPlugin} from '../selection-ux-playground/SelectionUxPlugin'

/**
 * The frame around the editor: what sits around the canvas, the panel and the mode bar. Four to compare (?layout=):
 * - `titlebar`: a slim bar on top (app, file name, actions), canvas and panel edge to edge below it, no page padding.
 * - `statusbar`: no title; a slim bar at the bottom (file, selection, actions), like a code editor.
 * - `floating`: the canvas fills the window, the panel and the mode bar float over it with the same gap on every side.
 * - `cards`: the tweakpane editor's own frame (canvas card with a margin), as before.
 * The pick is remembered in this browser.
 */
export type EditorLayout = 'titlebar' | 'statusbar' | 'floating' | 'cards'
export const EDITOR_LAYOUTS: [EditorLayout, string][] = [['titlebar', 'Title bar'], ['statusbar', 'Status bar'], ['floating', 'Floating panels'], ['cards', 'Cards (before)']]
const KEY = 'sux-editor-layout'

export interface LayoutActions {
    open(): void
    shortcuts(): void
    toggleTheme(): void
    report(): void
}

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
    app: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 8l5.6-3.3M8 8v6.5M8 8L2.4 4.7" stroke="currentColor" stroke-width="1.3"/></svg>',
    open: svg('<path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5z"/>'),
    keys: svg('<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6"/>'),
    theme: svg('<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>'),
    layout: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 5.5h12M10 5.5v8"/>'),
    report: svg('<path d="M4 1.5h5.5L12.5 4.5v10H4z"/><path d="M6 7.5h4.5M6 10h4.5M6 12.5h3"/>'),
}

export function setupLayout(viewer: ThreeViewer, actions: LayoutActions) {
    injectStyles()
    const fromUrl = new URLSearchParams(location.search).get('layout') as EditorLayout | null
    let stored: EditorLayout | null = null
    try {
        stored = localStorage.getItem(KEY) as EditorLayout | null
    } catch (e) {
        // no storage: the default
    }
    const valid = (l: string | null): l is EditorLayout => !!l && EDITOR_LAYOUTS.some(([k]) => k === l)
    let current: EditorLayout = valid(fromUrl) ? fromUrl : valid(stored) ? stored : 'titlebar'

    const ux = viewer.getPlugin(SelectionUxPlugin)
    let fileName = 'Untitled'
    viewer.assetManager.addEventListener('loadAsset', (e: {data?: any}) => {
        const path: string | undefined = e.data?.userData?.rootPath || e.data?.__rootPath
        const name = path ? decodeURIComponent(path.split(/[?#]/)[0].split('/').pop() || '') : ''
        if (name) {
            fileName = name
            refresh()
        }
    })

    const button = (icon: string, label: string, onClick: (b: HTMLButtonElement) => void) => {
        const b = document.createElement('button')
        b.className = 'lay-btn'
        b.innerHTML = icon
        b.title = label
        b.setAttribute('aria-label', label)
        b.addEventListener('click', () => onClick(b))
        return b
    }
    const layoutMenu = (anchor: HTMLElement) => {
        document.querySelector('.lay-menu')?.remove()
        const m = document.createElement('div')
        m.className = 'lay-menu'
        m.setAttribute('role', 'menu')
        for (const [k, label] of EDITOR_LAYOUTS) {
            const it = document.createElement('button')
            it.setAttribute('role', 'menuitemradio')
            it.setAttribute('aria-checked', String(k === current))
            it.textContent = label
            it.addEventListener('click', () => {
                m.remove()
                set(k)
            })
            m.appendChild(it)
        }
        document.body.appendChild(m)
        const r = anchor.getBoundingClientRect()
        const mr = m.getBoundingClientRect()
        m.style.left = Math.min(innerWidth - mr.width - 8, r.left) + 'px'
        m.style.top = (r.bottom + mr.height + 8 > innerHeight ? r.top - mr.height - 4 : r.bottom + 4) + 'px'
        setTimeout(() => document.addEventListener('pointerdown', ev => !m.contains(ev.target as Node) && m.remove(), {once: true}))
    }
    const actionButtons = () => [
        button(ICONS.open, 'Open a file or sample', actions.open),
        button(ICONS.keys, 'Shortcuts (?)', actions.shortcuts),
        button(ICONS.theme, 'Light or dark (Shift T)', actions.toggleTheme),
        button(ICONS.layout, 'Layout of the page', layoutMenu),
        button(ICONS.report, 'Report: what changed and what to try', actions.report),
    ]

    // the top bar: app, file name, actions
    const top = document.createElement('div')
    top.className = 'lay-bar lay-top'
    top.innerHTML = `<span class="lay-app">${ICONS.app}<b>threepipe</b><span class="lay-dim">Editor</span></span><span class="lay-sep"></span><span class="lay-file"></span><span class="lay-fill"></span>`
    top.append(...actionButtons())
    // the bottom bar: file, selection, actions
    const bottom = document.createElement('div')
    bottom.className = 'lay-bar lay-bottom'
    bottom.innerHTML = '<span class="lay-file"></span><span class="lay-sep"></span><span class="lay-sel lay-dim"></span><span class="lay-fill"></span>'
    bottom.append(...actionButtons())

    const refresh = () => {
        for (const el of document.querySelectorAll<HTMLElement>('.lay-file')) el.textContent = fileName
        const sel = ux?.selected ?? []
        const text = !sel.length ? 'Nothing selected' : sel.length === 1 ? `${ux!.displayName(sel[0])} selected` : `${sel.length} selected`
        const s = bottom.querySelector('.lay-sel')
        if (s) s.textContent = text
    }
    ux?.addEventListener('uxUpdate', e => e.reason === 'selection' && refresh())

    const set = (l: EditorLayout) => {
        current = l
        for (const [k] of EDITOR_LAYOUTS) document.body.classList.toggle('lay-' + k, k === l)
        if (l === 'titlebar') document.body.appendChild(top)
        else top.remove()
        if (l === 'statusbar') document.body.appendChild(bottom)
        else bottom.remove()
        refresh()
        try {
            localStorage.setItem(KEY, l)
        } catch (e) {
            // no storage: this page only
        }
        // the canvas size follows the CSS; the viewer resizes on the window's resize
        window.dispatchEvent(new Event('resize'))
    }
    set(current)
    return {set, get current() {
        return current
    }, setFileName(name: string) {
        fileName = name
        refresh()
    }}
}

let added = false
function injectStyles() {
    if (added) return
    added = true
    const st = document.createElement('style')
    st.textContent = `
body.lay-titlebar { --lay-top: 36px; --lay-bottom: 0px; }
body.lay-statusbar { --lay-top: 0px; --lay-bottom: 26px; }
body.lay-floating { --lay-top: 0px; --lay-bottom: 0px; --lay-gap: 12px; }
.lay-bar {
  position: fixed; left: 0; right: 0; z-index: 40; display: flex; align-items: center; gap: 4px; padding: 0 8px 0 12px; box-sizing: border-box;
  background: var(--tp-base-background-color, #fff); color: var(--tp-container-foreground-color, #1e1e1e);
  font: 400 12px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); -webkit-font-smoothing: antialiased;
}
.lay-top { top: 0; height: 36px; border-bottom: 1px solid var(--tp-container-border-color, #e6e6e6); }
.lay-bottom { bottom: 0; height: 26px; border-top: 1px solid var(--tp-container-border-color, #e6e6e6); font-size: 11px; padding-left: 10px; }
.lay-app { display: flex; align-items: center; gap: 6px; }
.lay-app b { font-weight: 600; }
.lay-dim { color: var(--tp-label-foreground-color, #757575); }
.lay-sep { width: 1px; height: 14px; background: var(--tp-container-border-color, #e6e6e6); margin: 0 8px; }
.lay-file { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; }
.lay-fill { flex: 1; }
.lay-btn {
  width: 28px; height: 28px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center; opacity: .75;
}
.lay-bottom .lay-btn { width: 22px; height: 22px; }
.lay-btn:hover { opacity: 1; background: var(--tp-button-background-color-hover, #f2f3f5); }
.lay-btn:focus-visible { outline: 2px solid #0d99ff; outline-offset: 1px; }
.lay-menu {
  position: fixed; z-index: 2000; display: flex; flex-direction: column; padding: 4px; min-width: 160px; border-radius: 8px;
  background: var(--tp-base-background-color, #fff); color: var(--tp-container-foreground-color, #1e1e1e);
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 6px 20px rgba(0,0,0,.14); font: 400 12px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
}
.lay-menu button { text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 8px 10px 8px 26px; border-radius: 5px; cursor: pointer; position: relative; }
.lay-menu button:hover { background: var(--tp-button-background-color-hover, #f2f3f5); }
.lay-menu button[aria-checked="true"]::before { content: '✓'; position: absolute; left: 9px; }
@media only screen and (min-width: 920px) {
  /* title and status bar: canvas and panel edge to edge, between the bars */
  body.lay-titlebar #canvas-container, body.lay-statusbar #canvas-container {
    margin: 0 !important; left: 0; top: var(--lay-top) !important; border-radius: 0 !important; box-shadow: none !important;
    height: calc(100% - var(--lay-top) - var(--lay-bottom)) !important;
    width: calc(100% - var(--mb-width, 44px) - var(--tweakpane-ui-container-width, 300px)) !important;
  }
  body.lay-titlebar.mb-panel-hidden #canvas-container, body.lay-statusbar.mb-panel-hidden #canvas-container { width: calc(100% - var(--mb-width, 44px)) !important; }
  body.lay-titlebar #tweakpaneUiContainer, body.lay-statusbar #tweakpaneUiContainer {
    margin: 0 !important; top: var(--lay-top) !important; bottom: var(--lay-bottom) !important; height: auto !important; max-height: none !important;
    right: var(--mb-width, 44px) !important; width: var(--tweakpane-ui-container-width, 300px) !important; overflow-y: auto;
    background: var(--tp-base-background-color, #fff); border-left: 1px solid var(--tp-container-border-color, #e6e6e6); box-sizing: border-box;
  }
  body.lay-titlebar #tweakpaneUiContainer .tp-rotv, body.lay-statusbar #tweakpaneUiContainer .tp-rotv { border-radius: 0 !important; box-shadow: none !important; }
  body.lay-titlebar .mb-root, body.lay-statusbar .mb-root { top: var(--lay-top); bottom: var(--lay-bottom); }
  body.lay-titlebar #mcanvas, body.lay-statusbar #mcanvas, body.lay-floating #mcanvas { border-radius: 0 !important; }

  /* floating: the canvas fills the window, the panel and the mode bar are cards with the same gap on every side */
  body.lay-floating #canvas-container {
    margin: 0 !important; inset: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; box-shadow: none !important;
    --lay-right-inset: calc(var(--tweakpane-ui-container-width, 300px) + var(--mb-width, 44px) + 3 * var(--lay-gap));
  }
  body.lay-floating.mb-panel-hidden #canvas-container { --lay-right-inset: calc(var(--mb-width, 44px) + 2 * var(--lay-gap)); }
  body.lay-floating .mb-root { top: var(--lay-gap); bottom: var(--lay-gap); right: var(--lay-gap); border-radius: 8px; border: 0; box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 2px 10px rgba(0,0,0,.08); }
  body.lay-floating #tweakpaneUiContainer {
    margin: 0 !important; top: var(--lay-gap) !important; bottom: var(--lay-gap) !important; height: auto !important; max-height: none !important;
    right: calc(var(--mb-width, 44px) + 2 * var(--lay-gap)) !important; width: var(--tweakpane-ui-container-width, 300px) !important;
    overflow-y: auto; border-radius: 8px; background: var(--tp-base-background-color, #fff); box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 2px 10px rgba(0,0,0,.08);
  }
  body.lay-floating #tweakpaneUiContainer .tp-rotv { box-shadow: none !important; }
  /* what is centred or on the right of the canvas keeps to the free part */
  body.lay-floating .tb-root, body.lay-floating .sux-hint { left: calc((100% - var(--lay-right-inset)) / 2); max-width: calc(100% - var(--lay-right-inset) - 20px); }
  body.lay-floating .pp-bottom-right { right: calc(var(--lay-right-inset) + 10px - var(--lay-gap)); }
}
`
    document.head.appendChild(st)
}
