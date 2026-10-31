/**
 * The plain-DOM parts of the feedback UI: the styles, the toast, and small element builders. No user or
 * page text ever goes through innerHTML: everything is textContent or an attribute.
 *
 * Theming: every colour is a CSS custom property on `.tpc-root` (`--tpc-bg`, `--tpc-fg`, `--tpc-muted`,
 * `--tpc-line`, `--tpc-field`, `--tpc-field-hover`, `--tpc-accent`, `--tpc-accent-hover`, `--tpc-danger`, `--tpc-ok`,
 * `--tpc-radius`, `--tpc-shadow`, `--tpc-font`); `.tpc-dark` switches the defaults. The defaults are the clean colour
 * mode of @threepipe/plugin-tweakpane, like the threepipe cloud pages. An app overrides them in its own CSS.
 */

const CSS = `
.tpc-root{--tpc-bg:#fff;--tpc-fg:#1e1e1e;--tpc-muted:#757575;--tpc-line:#e6e6e6;--tpc-field:#f5f5f5;--tpc-field-hover:#ededed;--tpc-accent:#0d99ff;--tpc-accent-hover:#0b87e0;--tpc-danger:#e03e1a;--tpc-ok:#14ae5c;--tpc-radius:6px;--tpc-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.12);--tpc-font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font:var(--tpc-font);color:var(--tpc-fg)}
.tpc-root.tpc-dark{--tpc-bg:#2c2c2c;--tpc-fg:#fff;--tpc-muted:#b3b3b3;--tpc-line:#444;--tpc-field:#383838;--tpc-field-hover:#404040;--tpc-danger:#ff7262;--tpc-ok:#3dd68c;--tpc-shadow:0 0 0 1px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.4)}
.tpc-root *{box-sizing:border-box}
.tpc-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px}
.tpc-dialog{background:var(--tpc-bg);border-radius:calc(var(--tpc-radius) + 6px);box-shadow:var(--tpc-shadow);width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:20px}
.tpc-dialog h2{font-size:15px;line-height:20px;margin:0 0 4px;font-weight:500}
.tpc-sub{color:var(--tpc-muted);margin:0 0 16px}
.tpc-types{display:flex;gap:4px;margin:0 0 12px;padding:2px;background:var(--tpc-field);border-radius:calc(var(--tpc-radius) + 2px)}
.tpc-types button{flex:1}
.tpc-root button{font:inherit;color:inherit;background:var(--tpc-bg);border:0;box-shadow:inset 0 0 0 1px var(--tpc-line);border-radius:var(--tpc-radius);height:32px;padding:0 12px;cursor:pointer;transition:background-color .12s ease-out,box-shadow .12s ease-out,color .12s ease-out}
.tpc-root button:hover:not([disabled]){background:var(--tpc-field-hover)}
.tpc-root button:focus-visible{outline:2px solid var(--tpc-accent);outline-offset:1px}
.tpc-types button{background:transparent;box-shadow:none;color:var(--tpc-muted);height:28px}
.tpc-types button:hover:not([disabled]){background:transparent;color:var(--tpc-fg)}
.tpc-root .tpc-types button[aria-pressed=true]{background:var(--tpc-bg);color:var(--tpc-fg);box-shadow:0 0 0 1px var(--tpc-line),0 1px 2px rgba(0,0,0,.06);font-weight:500}
.tpc-root button.tpc-primary{background:var(--tpc-accent);box-shadow:none;color:#fff;font-weight:500}
.tpc-root button.tpc-primary:hover:not([disabled]){background:var(--tpc-accent-hover)}
.tpc-root button.tpc-icon{width:32px;padding:0;display:inline-grid;place-items:center;box-shadow:none;background:transparent;color:var(--tpc-muted)}
.tpc-root button.tpc-icon:hover:not([disabled]){background:var(--tpc-field);color:var(--tpc-fg)}
.tpc-root button[disabled]{opacity:.5;cursor:default}
.tpc-root svg.tpc-i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
.tpc-root textarea,.tpc-root input[type=email]{width:100%;font:inherit;color:inherit;background:var(--tpc-field);border:0;border-radius:var(--tpc-radius);padding:8px 12px;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .12s ease-out,background-color .12s ease-out}
.tpc-root input[type=email]{height:32px}
.tpc-root textarea{min-height:112px;resize:vertical}
.tpc-root textarea:hover,.tpc-root input[type=email]:hover{box-shadow:inset 0 0 0 1px var(--tpc-line)}
.tpc-root textarea:focus,.tpc-root input:focus{outline:none;background:var(--tpc-bg);box-shadow:inset 0 0 0 1px var(--tpc-accent)}
.tpc-field{margin:0 0 12px}
.tpc-field label{display:block;color:var(--tpc-muted);margin:0 0 4px}
.tpc-attach{border:0;border-top:1px solid var(--tpc-line);padding:12px 0 4px;margin:0 0 4px}
.tpc-attach legend{color:var(--tpc-muted);padding:0 8px 0 0}
.tpc-attach label{display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer}
.tpc-attach input[type=checkbox]{margin:2px 0 0;accent-color:var(--tpc-accent)}
.tpc-attach small{color:var(--tpc-muted)}
.tpc-shot{display:block;max-width:160px;max-height:92px;border-radius:4px;box-shadow:0 0 0 1px var(--tpc-line);margin:4px 0 4px 24px}
.tpc-preview{margin:0 0 8px}
.tpc-preview summary{cursor:pointer;color:var(--tpc-muted);padding:4px 0}
.tpc-preview pre{max-height:220px;overflow:auto;background:var(--tpc-field);border-radius:var(--tpc-radius);padding:8px 12px;margin:4px 0 0;font:11px/1.45 ui-monospace,"SF Mono",Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.tpc-note{color:var(--tpc-muted);font-size:12px;margin:8px 0}
.tpc-error{color:var(--tpc-danger);margin:8px 0}
.tpc-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:16px}
.tpc-actions .tpc-grow{flex:1}
.tpc-done{text-align:center;padding:8px 0}
.tpc-done .tpc-actions{justify-content:center}
.tpc-id{display:inline-block;font:500 20px/28px ui-monospace,"SF Mono",Menlo,Consolas,monospace;padding:8px 16px;background:var(--tpc-field);border-radius:var(--tpc-radius);margin:8px 0;user-select:all;font-variant-numeric:tabular-nums}
.tpc-turnstile{min-height:0;margin:8px 0}
.tpc-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483001;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}
.tpc-toast{display:flex;gap:8px;align-items:center;background:var(--tpc-bg);border-radius:calc(var(--tpc-radius) + 2px);box-shadow:var(--tpc-shadow);padding:8px 8px 8px 12px}
.tpc-toast span{flex:1;min-width:0;overflow-wrap:anywhere}
.tpc-toast .tpc-toast-mark{flex:0 0 auto;width:16px;height:16px;border-radius:50%;background:var(--tpc-danger);color:#fff;font:600 11px/16px system-ui,sans-serif;text-align:center}
@media (prefers-reduced-motion: reduce){.tpc-root button,.tpc-root textarea,.tpc-root input{transition:none}}
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
