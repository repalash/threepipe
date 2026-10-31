/**
 * The plain-DOM parts of the feedback UI: the styles, the toast, and small element builders. No user or
 * page text ever goes through innerHTML: everything is textContent or an attribute.
 *
 * Theming: every colour is a CSS custom property on `.tpc-root` (`--tpc-bg`, `--tpc-fg`, `--tpc-muted`,
 * `--tpc-line`, `--tpc-field`, `--tpc-accent`, `--tpc-danger`, `--tpc-radius`, `--tpc-font`); `.tpc-dark`
 * switches the defaults. An app overrides them in its own CSS.
 */

const CSS = `
.tpc-root{--tpc-bg:#fff;--tpc-fg:#1c2127;--tpc-muted:#5f6b7c;--tpc-line:#d3d8de;--tpc-field:#f6f7f9;--tpc-accent:#2d72d2;--tpc-danger:#cd4246;--tpc-ok:#238551;--tpc-radius:8px;--tpc-font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font:var(--tpc-font);color:var(--tpc-fg)}
.tpc-root.tpc-dark{--tpc-bg:#2f343c;--tpc-fg:#f6f7f9;--tpc-muted:#abb3bf;--tpc-line:#404854;--tpc-field:#252a31;--tpc-accent:#4c90f0;--tpc-danger:#e76a6e;--tpc-ok:#32a467}
.tpc-root *{box-sizing:border-box}
.tpc-backdrop{position:fixed;inset:0;background:rgba(17,20,24,.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px}
.tpc-dialog{background:var(--tpc-bg);border:1px solid var(--tpc-line);border-radius:calc(var(--tpc-radius) + 4px);box-shadow:0 12px 40px rgba(0,0,0,.35);width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:16px 18px}
.tpc-dialog h2{font-size:16px;margin:0 0 4px;font-weight:600}
.tpc-sub{color:var(--tpc-muted);margin:0 0 12px}
.tpc-types{display:flex;gap:6px;margin:0 0 10px}
.tpc-types button{flex:1}
.tpc-root button{font:inherit;color:inherit;background:var(--tpc-field);border:1px solid var(--tpc-line);border-radius:var(--tpc-radius);padding:6px 12px;cursor:pointer}
.tpc-root button:hover:not([disabled]){border-color:var(--tpc-accent)}
.tpc-root button[aria-pressed=true]{border-color:var(--tpc-accent);color:var(--tpc-accent);font-weight:600}
.tpc-root button.tpc-primary{background:var(--tpc-accent);border-color:var(--tpc-accent);color:#fff;font-weight:600}
.tpc-root button[disabled]{opacity:.5;cursor:default}
.tpc-root textarea,.tpc-root input[type=email]{width:100%;font:inherit;color:inherit;background:var(--tpc-field);border:1px solid var(--tpc-line);border-radius:var(--tpc-radius);padding:8px 10px}
.tpc-root textarea{min-height:110px;resize:vertical}
.tpc-root textarea:focus,.tpc-root input:focus{outline:2px solid var(--tpc-accent);outline-offset:-1px}
.tpc-field{margin:0 0 10px}
.tpc-field label{display:block;color:var(--tpc-muted);margin:0 0 4px}
.tpc-attach{border:1px solid var(--tpc-line);border-radius:var(--tpc-radius);padding:8px 10px;margin:0 0 10px}
.tpc-attach legend{color:var(--tpc-muted);padding:0 4px}
.tpc-attach label{display:flex;gap:8px;align-items:flex-start;padding:3px 0;cursor:pointer}
.tpc-attach small{color:var(--tpc-muted)}
.tpc-shot{display:block;max-width:160px;max-height:90px;border-radius:4px;border:1px solid var(--tpc-line);margin:2px 0 4px 24px}
.tpc-preview summary{cursor:pointer;color:var(--tpc-muted)}
.tpc-preview pre{max-height:220px;overflow:auto;background:var(--tpc-field);border-radius:var(--tpc-radius);padding:8px;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.tpc-note{color:var(--tpc-muted);font-size:12px;margin:6px 0}
.tpc-error{color:var(--tpc-danger);margin:6px 0}
.tpc-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:12px}
.tpc-actions .tpc-grow{flex:1}
.tpc-done{text-align:center;padding:8px 0}
.tpc-id{display:inline-block;font:600 20px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;padding:6px 12px;border:1px dashed var(--tpc-line);border-radius:var(--tpc-radius);margin:8px 0;user-select:all}
.tpc-turnstile{min-height:0;margin:6px 0}
.tpc-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483001;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}
.tpc-toast{display:flex;gap:10px;align-items:center;background:var(--tpc-bg);border:1px solid var(--tpc-line);border-radius:var(--tpc-radius);box-shadow:0 6px 20px rgba(0,0,0,.25);padding:8px 10px}
.tpc-toast span{flex:1;min-width:0;overflow-wrap:anywhere}
.tpc-toast .tpc-toast-mark{flex:0 0 auto;width:16px;height:16px;border-radius:50%;background:var(--tpc-danger);color:#fff;font:700 11px/16px system-ui,sans-serif;text-align:center}
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
    const x = h('button', {type: 'button', 'aria-label': 'Close'}, '✕')
    const el = h('div', {class: 'tpc-toast', role: 'alert', 'data-tpc-toast': true}, h('span', {class: 'tpc-toast-mark', 'aria-hidden': 'true'}, '!'), h('span', {}, message), report, x)
    report?.addEventListener('click', () => { close(); onReport!() })
    x.addEventListener('click', close)
    toastHost.appendChild(el)
    if (timeout > 0) setTimeout(close, timeout)
    return el
}
