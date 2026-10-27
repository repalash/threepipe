/**
 * A vertical bar of mode icons on the right, like the iJewel playground, for the tweakpane editor's modes
 * (Viewer, Interaction, Post-processing, Export...). Each mode keeps its own colour, like Blender's property tabs:
 * it is quicker to find, and easy to point at when talking about it ("the green export tab").
 * Click a mode to show its panels; click the open mode again to hide the panel.
 * The button at the bottom shows the names next to the icons (like a sidebar): on at the first visit, then remembered.
 * The page reads the bar's width from the CSS variable `--mb-width` on the root element.
 */
export interface ModeBarEditor {
    modeKeys: string[]
    setSelectedMode(i: number): void
}

interface ModeLook {color: string, icon: string}

const svg = (d: string) => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

/** Colour and icon per mode name; unknown modes get a grey dot */
export const MODE_LOOKS: Record<string, ModeLook> = {
    'Viewer': {color: '#0d99ff', icon: svg('<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>')},
    'Interaction': {color: '#f97316', icon: svg('<path d="M6 3l9 5.5-4 1 2.5 5-2 1-2.5-5L6 13z"/>')},
    'Buffers': {color: '#a855f7', icon: svg('<path d="M10 3l7.5 3.8L10 10.6 2.5 6.8z"/><path d="M2.5 10.2L10 14l7.5-3.8M2.5 13.6L10 17.4l7.5-3.8"/>')},
    'Post-processing': {color: '#ec4899', icon: svg('<path d="M10 2.8l1.6 4.5 4.6 1.6-4.6 1.6L10 15l-1.6-4.5-4.6-1.6 4.6-1.6z"/><path d="M15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>')},
    'Export': {color: '#22c55e', icon: svg('<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13"/>')},
    'Configurator': {color: '#14b8a6', icon: svg('<path d="M4 5h12M4 10h12M4 15h12"/><circle cx="8" cy="5" r="1.7" fill="currentColor"/><circle cx="13" cy="10" r="1.7" fill="currentColor"/><circle cx="7" cy="15" r="1.7" fill="currentColor"/>')},
    'Animation': {color: '#eab308', icon: svg('<circle cx="10" cy="10" r="7"/><path d="M8.3 7l4.4 3-4.4 3z" fill="currentColor"/>')},
    'Extras': {color: '#64748b', icon: svg('<path d="M8 3.5h4v2.2a1.4 1.4 0 1 0 2.2 0V3.5h2.3v4H14.3a1.4 1.4 0 1 0 0 2.2h2.2v6.8h-13V3.5z"/>')},
    'Debug': {color: '#ef4444', icon: svg('<rect x="6" y="6.5" width="8" height="10" rx="4"/><path d="M10 9.5v7M6 10H3.5M16.5 10H14M6 14H4M16 14h-2M7.5 6.5L6 4M12.5 6.5L14 4"/>')},
}

const TOGGLE_ICON = svg('<path d="M8 6l4 4-4 4"/>')
const EXPANDED_KEY = 'mb-expanded'

const FALLBACK: ModeLook = {color: '#8a8f98', icon: svg('<circle cx="10" cy="10" r="3.5" fill="currentColor"/>')}

/**
 * Build the bar. `panel` is the element hidden when the open mode is clicked again (the tweakpane container).
 * Returns the bar element and a function to mark a mode as selected when it changes elsewhere.
 */
export function setupModeBar(editor: ModeBarEditor, host: HTMLElement, panel?: () => HTMLElement | null) {
    injectStyles()
    const bar = document.createElement('div')
    bar.className = 'mb-root'
    bar.setAttribute('role', 'tablist')
    bar.setAttribute('aria-orientation', 'vertical')
    const tip = document.createElement('div')
    tip.className = 'mb-tip'
    let selected = 0
    let open = true
    let expanded = true
    try {
        expanded = localStorage.getItem(EXPANDED_KEY) !== '0'
    } catch (e) {
        // no storage: names shown
    }
    const showTip = (b: HTMLElement, text: string, color: string) => {
        if (expanded) return // the name is on the button
        tip.textContent = text
        tip.style.setProperty('--mb-color', color)
        if (!tip.isConnected) document.body.appendChild(tip)
        const r = b.getBoundingClientRect()
        const tr = tip.getBoundingClientRect()
        tip.style.left = r.left - tr.width - 8 + 'px'
        tip.style.top = r.top + r.height / 2 - tr.height / 2 + 'px'
        tip.classList.add('show')
    }
    const buttons = editor.modeKeys.map((key, i) => {
        const look = MODE_LOOKS[key] ?? FALLBACK
        const b = document.createElement('button')
        b.className = 'mb-btn'
        b.style.setProperty('--mb-color', look.color)
        b.innerHTML = `${look.icon}<span class="mb-label">${key}</span>`
        b.setAttribute('role', 'tab')
        b.setAttribute('aria-label', key)
        b.addEventListener('click', () => {
            if (i === selected) setOpen(!open)
            else {
                editor.setSelectedMode(i)
                select(i)
                setOpen(true)
            }
        })
        b.addEventListener('pointerenter', () => showTip(b, key, look.color))
        b.addEventListener('pointerleave', () => tip.classList.remove('show'))
        bar.appendChild(b)
        return b
    })
    const toggle = document.createElement('button')
    toggle.className = 'mb-btn mb-toggle'
    toggle.style.setProperty('--mb-color', 'currentColor')
    toggle.innerHTML = `${TOGGLE_ICON}<span class="mb-label">Hide names</span>`
    toggle.addEventListener('click', () => {
        tip.classList.remove('show')
        setExpanded(!expanded)
    })
    toggle.addEventListener('pointerenter', () => showTip(toggle, 'Show names', '#8a8f98'))
    toggle.addEventListener('pointerleave', () => tip.classList.remove('show'))
    bar.appendChild(toggle)
    const setExpanded = (v: boolean) => {
        expanded = v
        bar.classList.toggle('mb-wide', v)
        toggle.setAttribute('aria-label', v ? 'Hide the mode names' : 'Show the mode names')
        toggle.setAttribute('aria-expanded', String(v))
        document.documentElement.style.setProperty('--mb-width', v ? '156px' : '44px')
        try {
            localStorage.setItem(EXPANDED_KEY, v ? '1' : '0')
        } catch (e) {
            // no storage: this page only
        }
        // the canvas size follows the CSS; the viewer resizes on the window's resize
        window.dispatchEvent(new Event('resize'))
    }
    const select = (i: number) => {
        selected = i
        buttons.forEach((b, k) => {
            b.classList.toggle('on', k === i && open)
            b.setAttribute('aria-selected', String(k === i))
        })
    }
    const setOpen = (v: boolean) => {
        open = v
        const p = panel?.()
        if (p) p.style.visibility = v ? '' : 'hidden'
        // the page can give the canvas the panel's room (the editor's CSS does)
        document.body.classList.toggle('mb-panel-hidden', !v)
        select(selected)
    }
    host.appendChild(bar)
    setExpanded(expanded)
    select(0)
    /** Open a mode's panel (and show the panel if it was hidden), like a click on its button */
    const show = (i: number) => {
        if (i < 0 || i >= buttons.length) return
        if (i !== selected) {
            editor.setSelectedMode(i)
            select(i)
        }
        if (!open) setOpen(true)
    }
    return {element: bar, select, setExpanded, show}
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.mb-root {
  --mb-bg: #ffffff; --mb-line: #e6e6e6; --mb-hover: #f2f3f5;
  position: fixed; right: 0; top: 0; bottom: 0; width: 44px; z-index: 30; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 0; background: var(--mb-bg); border-left: 1px solid var(--mb-line); box-sizing: border-box;
}
body[class*="tpTheme-"] .mb-root {
  --mb-bg: var(--tp-base-background-color, #1c2026); --mb-line: var(--tp-container-border-color, rgba(255,255,255,.1));
  --mb-hover: var(--tp-button-background-color-hover, rgba(255,255,255,.08));
}
.mb-btn {
  position: relative; width: 34px; height: 34px; border: 0; border-radius: 5px; background: transparent; color: var(--mb-color); cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0; transition: background-color .12s;
}
.mb-btn:hover { background: var(--mb-hover); }
.mb-btn.on { background: color-mix(in srgb, var(--mb-color) 16%, transparent); }
.mb-btn.on::before { content: ''; position: absolute; left: -5px; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--mb-color); }
.mb-btn:focus-visible { outline: 2px solid var(--mb-color); outline-offset: 1px; }
.mb-label { display: none; font: 500 12px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); color: var(--tp-container-foreground-color, #1e1e1e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mb-toggle { margin-top: auto; color: var(--tp-label-foreground-color, #8a8f98); }
.mb-toggle svg { transition: transform .15s; }
/* expanded: a sidebar with the names */
.mb-root.mb-wide { width: 156px; align-items: stretch; padding: 10px 6px; }
.mb-wide .mb-btn { width: auto; justify-content: flex-start; gap: 10px; padding: 0 8px; }
.mb-wide .mb-btn.on::before { left: -6px; }
.mb-wide .mb-label { display: block; }
.mb-wide .mb-toggle .mb-label { color: inherit; font-weight: 400; }
.mb-wide .mb-toggle svg { transform: rotate(180deg); }
.mb-tip {
  position: fixed; z-index: 1001; pointer-events: none; background: #1e1e1e; color: #fff; border-radius: 4px; padding: 5px 8px; white-space: nowrap;
  font: 500 11px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); opacity: 0; transition: opacity .1s;
  box-shadow: inset 3px 0 0 var(--mb-color);
}
.mb-tip.show { opacity: 1; }
`
    document.head.appendChild(st)
}
