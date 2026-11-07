/**
 * The plain-DOM parts of the feedback UI: the styles, the toast, and small element builders. No user or
 * page text ever goes through innerHTML: everything is textContent or an attribute.
 *
 * Theming: the defaults are the clean colour mode of @threepipe/plugin-tweakpane (tpTheme-clean / tpTheme-clean-dark),
 * like the tweakpane editor and the threepipe cloud pages. Every colour is a CSS custom property on `.tpc-root`
 * (`--tpc-bg`, `--tpc-fg`, `--tpc-muted`, `--tpc-faint`, `--tpc-line`, `--tpc-field`, `--tpc-hover`,
 * `--tpc-active`, `--tpc-accent`, `--tpc-accent-hover`, `--tpc-danger`, `--tpc-ok`, `--tpc-check`, `--tpc-radius`,
 * `--tpc-shadow`, `--tpc-font`); `.tpc-dark` switches them. An app overrides them in its own CSS.
 */

const CSS = `
.tpc-root{--tpc-bg:#fff;--tpc-fg:#1e1e1e;--tpc-muted:#757575;--tpc-faint:#b3b3b3;--tpc-line:#e6e6e6;--tpc-field:#f5f5f5;--tpc-hover:#ebebeb;--tpc-active:#e3e3e3;--tpc-accent:#0d99ff;--tpc-accent-hover:#0b87e0;--tpc-danger:#e03e1a;--tpc-ok:#14ae5c;--tpc-check:rgba(0,0,0,.5);--tpc-radius:5px;--tpc-shadow:0 0 0 1px rgba(0,0,0,.08),0 10px 28px rgba(0,0,0,.14);--tpc-font:12px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font:var(--tpc-font);letter-spacing:.005em;color:var(--tpc-fg);-webkit-font-smoothing:antialiased}
.tpc-root.tpc-dark{--tpc-bg:#2c2c2c;--tpc-fg:#fff;--tpc-muted:#b3b3b3;--tpc-faint:#757575;--tpc-line:#444;--tpc-field:#383838;--tpc-hover:#444;--tpc-active:#4d4d4d;--tpc-danger:#ff7262;--tpc-ok:#3dd68c;--tpc-check:rgba(255,255,255,.5);--tpc-shadow:0 0 0 1px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.5)}
.tpc-root *{box-sizing:border-box}
.tpc-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px}
.tpc-dialog{background:var(--tpc-bg);border-radius:8px;box-shadow:var(--tpc-shadow);width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:16px}
.tpc-dialog h2{font-size:13px;line-height:20px;margin:0 0 4px;font-weight:600}
.tpc-sub{color:var(--tpc-muted);margin:0 0 12px}
.tpc-root button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border:0;border-radius:var(--tpc-radius);background:transparent;box-shadow:inset 0 0 0 1px var(--tpc-line);font:inherit;font-weight:500;color:var(--tpc-fg);white-space:nowrap;cursor:pointer}
.tpc-root button:hover:not([disabled]){background:var(--tpc-hover)}
.tpc-root button:active:not([disabled]){background:var(--tpc-active)}
.tpc-root button:focus-visible,.tpc-root input:focus-visible,.tpc-root textarea:focus-visible,.tpc-root summary:focus-visible{outline:2px solid var(--tpc-accent);outline-offset:1px}
.tpc-root button[disabled]{opacity:.45;cursor:default}
.tpc-root button.tpc-primary{background:var(--tpc-accent);box-shadow:none;color:#fff}
.tpc-root button.tpc-primary:hover:not([disabled]){background:var(--tpc-accent-hover)}
.tpc-root button.tpc-icon{width:28px;padding:0;box-shadow:none;color:var(--tpc-muted)}
.tpc-root button.tpc-icon:hover:not([disabled]){color:var(--tpc-fg)}
.tpc-root svg.tpc-i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
.tpc-types{display:flex;gap:2px;margin:0 0 12px;padding:2px;background:var(--tpc-field);border-radius:6px}
.tpc-root .tpc-types button{flex:1;height:24px;box-shadow:none;color:var(--tpc-muted);border-radius:4px}
.tpc-root .tpc-types button:hover:not([disabled]){background:transparent;color:var(--tpc-fg)}
.tpc-root .tpc-types button[aria-pressed=true]{background:var(--tpc-bg);color:var(--tpc-fg);box-shadow:0 0 0 1px var(--tpc-line),0 1px 2px rgba(0,0,0,.06)}
.tpc-root textarea,.tpc-root input[type=email]{width:100%;font:inherit;color:inherit;background:var(--tpc-field);border:0;border-radius:var(--tpc-radius);padding:6px 8px;min-width:0}
.tpc-root input[type=email]{height:28px;padding:0 8px}
.tpc-root textarea{min-height:112px;resize:vertical}
.tpc-root textarea:hover,.tpc-root input[type=email]:hover{box-shadow:inset 0 0 0 1px var(--tpc-line)}
.tpc-root textarea:focus,.tpc-root input[type=email]:focus{outline:none;background:var(--tpc-bg);box-shadow:inset 0 0 0 1px var(--tpc-accent)}
.tpc-root textarea::placeholder,.tpc-root input::placeholder{color:var(--tpc-faint)}
.tpc-root input[type=checkbox]{appearance:none;flex:0 0 14px;width:14px;height:14px;padding:0;margin:1px 0 0;border-radius:3px;cursor:pointer;background:transparent;box-shadow:inset 0 0 0 1px var(--tpc-check);display:inline-grid;place-content:center}
.tpc-root input[type=checkbox]:checked{background:var(--tpc-accent);box-shadow:none}
.tpc-root input[type=checkbox]:checked::after{content:"";width:7px;height:4px;border:1.75px solid #fff;border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
.tpc-root input[type=checkbox]:disabled{opacity:.45;cursor:default}
.tpc-field{margin:0 0 12px}
.tpc-field label{display:block;color:var(--tpc-muted);margin:0 0 4px}
.tpc-attach{border:1px solid var(--tpc-line);border-radius:var(--tpc-radius);padding:8px 12px;margin:0 0 12px}
.tpc-attach legend{color:var(--tpc-muted);padding:0 4px}
.tpc-attach label{display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer}
.tpc-attach small{color:var(--tpc-muted)}
.tpc-shot{display:block;max-width:160px;max-height:92px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1);margin:4px 0 4px 22px}
.tpc-preview{margin:0 0 8px}
.tpc-preview summary{cursor:pointer;color:var(--tpc-muted);padding:4px 0}
.tpc-preview pre{max-height:220px;overflow:auto;background:var(--tpc-field);border-radius:var(--tpc-radius);padding:8px;margin:4px 0 0;font:11px/1.45 ui-monospace,"SF Mono",Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.tpc-note{color:var(--tpc-muted);font-size:11px;margin:8px 0}
.tpc-error{color:var(--tpc-danger);margin:8px 0}
.tpc-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px}
.tpc-actions .tpc-grow{flex:1}
.tpc-done{text-align:center;padding:8px 0}
.tpc-done .tpc-actions{justify-content:center}
.tpc-id{display:inline-block;font:500 20px/28px ui-monospace,"SF Mono",Menlo,Consolas,monospace;padding:6px 12px;background:var(--tpc-field);border-radius:var(--tpc-radius);margin:8px 0;user-select:all}
.tpc-turnstile{min-height:0;margin:8px 0}
.tpc-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483001;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}
.tpc-toast{display:flex;gap:8px;align-items:center;background:var(--tpc-bg);border-radius:8px;box-shadow:var(--tpc-shadow);padding:8px 8px 8px 12px}
.tpc-toast span{flex:1;min-width:0;overflow-wrap:anywhere}
.tpc-toast .tpc-toast-mark{flex:0 0 auto;width:16px;height:16px;border-radius:50%;background:var(--tpc-danger);color:#fff;font:600 11px/16px system-ui,sans-serif;text-align:center}
`

let styled = false
export function ensureStyles(): void {
    if (styled || typeof document === 'undefined') return
    const s = document.createElement('style')
    s.id = 'threepipe-cloud-styles'
    s.textContent = CSS
    document.head.appendChild(s)
    styled = true
}

export type Theme = 'light' | 'dark' | 'auto' | (() => 'light' | 'dark')

export function resolveTheme(t: Theme): 'light' | 'dark' {
    if (typeof t === 'function') return t()
    if (t !== 'auto') return t
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** An element with text (never HTML) and attributes. */
/** The close icon: a 16px line x (an SVG element, so not through h()). */
export function closeIcon(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('class', 'tpc-i')
    svg.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', 'M4 4l8 8M12 4l-8 8')
    svg.appendChild(path)
    return svg
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === false) continue
        el.setAttribute(k, v === true ? '' : v)
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
    return el
}

/** A size in decimal units: 21 B, 2 KB, 1.4 MB. */
export function sizeLabel(bytes: number): string {
    return bytes < 1e3 ? `${bytes} B` : bytes < 1e6 ? `${Math.round(bytes / 1e3)} KB` : `${(bytes / 1e6).toFixed(1)} MB`
}

let toastHost: HTMLElement | null = null

/** A toast in the corner: the message, a Report button and a close button. Gone after `timeout` ms. */
export function showToast(message: string, theme: Theme, onReport?: () => void, timeout = 10000): HTMLElement {
    ensureStyles()
    if (!toastHost || !toastHost.isConnected) {
        toastHost = h('div', {class: 'tpc-root tpc-toasts', 'data-tpc-toasts': true})
        document.body.appendChild(toastHost)
    }
    toastHost.classList.toggle('tpc-dark', resolveTheme(theme) === 'dark')
    const close = () => el.remove()
    const report = onReport ? h('button', {type: 'button', 'data-tpc-toast-report': true}, 'Report') : null
    const x = h('button', {type: 'button', class: 'tpc-icon', 'aria-label': 'Close'}, closeIcon())
    const el = h('div', {class: 'tpc-toast', role: 'alert', 'data-tpc-toast': true}, h('span', {class: 'tpc-toast-mark', 'aria-hidden': 'true'}, '!'), h('span', {}, message), report, x)
    report?.addEventListener('click', () => { close(); onReport!() })
    x.addEventListener('click', close)
    toastHost.appendChild(el)
    if (timeout > 0) setTimeout(close, timeout)
    return el
}
