/**
 * Small shared UI for the motion panels (camera path dialog, timeline bar, record dialog): the toolbar's colours
 * (light by default, the tweakpane theme when it is on the page), form rows, segmented choices and buttons.
 */

let added = false
export function injectMotionStyles() {
    if (added) return
    added = true
    const st = document.createElement('style')
    st.textContent = `
.mo-ui {
  --mo-bg: #ffffff; --mo-fg: #1e1e1e; --mo-dim: #8a8f97; --mo-line: #e9eaec; --mo-hover: #f2f3f5; --mo-field: #f3f4f6;
  --mo-accent: #0d99ff; --mo-accent-fg: #ffffff; --mo-soft: #e5f4ff; --mo-rec: #ef4444; --mo-cam: #8b5cf6;
  --mo-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.10);
  font: 500 11px/1.35 var(--tp-font-family, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif); -webkit-font-smoothing: antialiased;
  color: var(--mo-fg); box-sizing: border-box;
}
.mo-ui *, .mo-ui *::before, .mo-ui *::after { box-sizing: border-box; }
body[class*="tpTheme-"] .mo-ui {
  --mo-bg: var(--tp-base-background-color, #1c2026); --mo-fg: var(--tp-container-foreground-color, #f0f0f0);
  --mo-dim: var(--tp-monitor-foreground-color, #9a9a9a); --mo-line: var(--tp-container-border-color, rgba(255,255,255,.14));
  --mo-hover: var(--tp-button-background-color-hover, rgba(255,255,255,.09)); --mo-field: var(--tp-input-background-color, rgba(255,255,255,.07));
  --mo-soft: rgba(13,153,255,.2);
}
body.tpTheme-black .mo-ui, body.tpTheme-dark .mo-ui, body.tpTheme-blue .mo-ui, body.tpTheme-clean-dark .mo-ui {
  --mo-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 6px 20px rgba(0,0,0,.3);
}
.mo-card { background: var(--mo-bg); border-radius: 8px; box-shadow: var(--mo-shadow); padding: 12px; }
.mo-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 12px; margin: 0 0 10px; }
.mo-title .mo-x { margin-left: auto; }
.mo-row { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 8px; min-height: 28px; }
.mo-row > label { color: var(--mo-dim); }
.mo-note { color: var(--mo-dim); margin: 8px 0 0; }
.mo-ui select, .mo-ui input[type=number], .mo-ui input[type=text] {
  font: inherit; color: inherit; background: var(--mo-field); border: 1px solid transparent; border-radius: 4px; height: 26px; padding: 0 6px; width: 100%; min-width: 0;
}
.mo-ui select:focus, .mo-ui input:focus { outline: none; border-color: var(--mo-accent); }
.mo-num { display: flex; align-items: center; gap: 6px; }
.mo-num input { width: 70px !important; }
.mo-seg { display: flex; background: var(--mo-field); border-radius: 5px; padding: 2px; gap: 2px; }
.mo-seg button { flex: 1; border: 0; background: transparent; color: inherit; font: inherit; height: 22px; border-radius: 4px; cursor: pointer; padding: 0 6px; white-space: nowrap; }
.mo-seg button.on { background: var(--mo-bg); box-shadow: 0 0 0 1px var(--mo-line), 0 1px 2px rgba(0,0,0,.08); }
.mo-check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.mo-btns { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
.mo-btn { font: inherit; border: 0; border-radius: 5px; height: 28px; padding: 0 12px; cursor: pointer; background: var(--mo-field); color: inherit; display: inline-flex; align-items: center; gap: 6px; }
.mo-btn:hover { background: var(--mo-hover); }
.mo-btn.mo-primary { background: var(--mo-accent); color: var(--mo-accent-fg); }
.mo-btn.mo-primary:hover { filter: brightness(1.06); }
.mo-btn.mo-red { background: var(--mo-rec); color: #fff; }
.mo-btn.mo-danger { color: var(--mo-rec); background: transparent; margin-right: auto; padding: 0 6px; }
.mo-btn:disabled { opacity: .45; cursor: default; }
.mo-icon { width: 26px; height: 26px; padding: 0; justify-content: center; background: transparent; }
.mo-icon:hover { background: var(--mo-hover); }
.mo-icon.on { background: var(--mo-soft); color: var(--mo-accent); }
.mo-ui button:focus-visible { outline: 2px solid var(--mo-accent); outline-offset: 1px; }
.mo-chip {
  position: absolute; left: 50%; transform: translateX(-50%); z-index: 13; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px;
  white-space: nowrap; animation: mo-in .18s ease-out;
}
@keyframes mo-in { from { opacity: 0; transform: translate(-50%, 6px); } }
.mo-confirm-back { position: fixed; inset: 0; z-index: 3000; background: rgba(15,17,21,.3); display: flex; align-items: center; justify-content: center; padding: 16px; }
.mo-confirm { width: 320px; max-width: 100%; padding: 16px; }
.mo-confirm p { margin: 0; font-size: 12px; line-height: 1.5; }
.mo-confirm:focus { outline: none; }
`
    document.head.appendChild(st)
}

const svg = (d: string, w = 16) => `<svg viewBox="0 0 16 16" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

export const MO_ICONS = {
    play: svg('<path d="M5 3.5v9l7-4.5z" fill="currentColor"/>'),
    pause: svg('<path d="M5 3.5v9M11 3.5v9" stroke-width="2"/>'),
    toStart: svg('<path d="M4 3.5v9" stroke-width="1.8"/><path d="M12 3.5v9L6 8z" fill="currentColor"/>'),
    loop: svg('<path d="M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2"/>'),
    camera: svg('<rect x="1.5" y="4.5" width="9" height="7" rx="1.5"/><path d="M10.5 7l4-2v6l-4-2"/>'),
    path: svg('<path d="M2.5 12.5c2-6 5-1 7-5s3-4 4-4"/><circle cx="2.5" cy="12.5" r="1.3" fill="currentColor"/><circle cx="13.5" cy="3.5" r="1.3" fill="currentColor"/>'),
    record: svg('<circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    timeline: svg('<path d="M2 4.5h12M2 8h12M2 11.5h12" stroke-opacity=".35"/><rect x="3" y="3" width="6" height="3" rx="1" fill="currentColor" stroke="none"/><rect x="6" y="9.8" width="7" height="3" rx="1" fill="currentColor" stroke="none"/>'),
}

/** A segmented choice; returns the element, the value and a setter */
export function segmented<T extends string>(items: [T, string][], value: T, onChange?: (v: T) => void) {
    const el = document.createElement('div')
    el.className = 'mo-seg'
    el.setAttribute('role', 'radiogroup')
    let cur = value
    const show = () => btns.forEach((x, i) => {
        x.classList.toggle('on', items[i][0] === cur)
        x.setAttribute('aria-checked', String(items[i][0] === cur))
    })
    const btns = items.map(([v, label]) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.setAttribute('role', 'radio')
        b.addEventListener('click', () => {
            cur = v
            show()
            onChange?.(v)
        })
        el.appendChild(b)
        return b
    })
    show()
    return {el, get value() {
        return cur
    }, set(v: T) {
        cur = v
        show()
    }}
}

/** A labelled row */
export function row(label: string, control: HTMLElement) {
    const r = document.createElement('div')
    r.className = 'mo-row'
    const l = document.createElement('label')
    l.textContent = label
    r.append(l, control)
    return r
}

export function select(options: [string, string][], value: string) {
    const s = document.createElement('select')
    for (const [v, label] of options) {
        const o = document.createElement('option')
        o.value = v
        o.textContent = label
        s.appendChild(o)
    }
    s.value = value
    return s
}

export function numberInput(value: number, unit: string, min = 0, step = 0.5) {
    const wrap = document.createElement('div')
    wrap.className = 'mo-num'
    const i = document.createElement('input')
    i.type = 'number'
    i.min = String(min)
    i.step = String(step)
    i.value = String(value)
    const u = document.createElement('span')
    u.textContent = unit
    u.style.color = 'var(--mo-dim)'
    wrap.append(i, u)
    return {el: wrap, input: i}
}

export function button(label: string, cls = '', onClick?: () => void) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'mo-btn ' + cls
    b.innerHTML = label
    if (onClick) b.addEventListener('click', onClick)
    return b
}

/** Seconds as "4.5 s" */
export const fmtSec = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)} s`

/**
 * A small confirm card in the page's style, instead of the browser's confirm(). Enter confirms, Esc cancels; it owns
 * the keys while open, so they do not reach the scene.
 */
export async function confirmBox(message: string, ok = 'OK', danger = false): Promise<boolean> {
    injectMotionStyles()
    return new Promise(resolve => {
        const back = document.createElement('div')
        back.className = 'mo-ui mo-confirm-back'
        const card = document.createElement('div')
        card.className = 'mo-card mo-confirm'
        card.setAttribute('role', 'alertdialog')
        card.setAttribute('aria-label', message)
        card.tabIndex = -1
        card.dataset.ownKeys = ''
        const text = document.createElement('p')
        text.textContent = message
        const btns = document.createElement('div')
        btns.className = 'mo-btns'
        const done = (v: boolean) => {
            back.remove()
            resolve(v)
        }
        const yes = button(ok, danger ? 'mo-red' : 'mo-primary', () => done(true))
        btns.append(button('Cancel', '', () => done(false)), yes)
        card.append(text, btns)
        back.appendChild(card)
        back.addEventListener('pointerdown', e => e.target === back && done(false))
        card.addEventListener('keydown', e => {
            e.stopPropagation()
            if (e.key === 'Escape') done(false)
        })
        document.body.appendChild(back)
        yes.focus()
    })
}
