/**
 * Cloudflare Turnstile in the report dialog, loaded only when the dialog opens: the guest's pass for
 * `POST /reports`. No npm package: Cloudflare serves the script, and it must be loaded from there.
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */

/** The action the worker expects (services/cloud/src/turnstile.ts). */
export const TURNSTILE_ACTION = 'threepipe-report'
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
    render(el: HTMLElement, opts: Record<string, unknown>): string
    reset(id: string): void
    remove(id: string): void
}

let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(src = TURNSTILE_SCRIPT): Promise<TurnstileApi> {
    const w = window as unknown as {turnstile?: TurnstileApi}
    if (w.turnstile) return Promise.resolve(w.turnstile)
    if (loading) return loading
    loading = new Promise<TurnstileApi>((resolve, reject) => {
        const s = document.createElement('script')
        s.src = src
        s.async = true
        s.onload = () => w.turnstile ? resolve(w.turnstile) : reject(new Error('Turnstile did not load'))
        s.onerror = () => { loading = null; s.remove(); reject(new Error('Turnstile could not be loaded')) }
        document.head.appendChild(s)
    })
    return loading
}

/** A rendered widget. `token` is the current pass (single use, valid 300 s); `reset` asks for a new one. */
export interface TurnstileWidget {
    readonly token: string | null
    reset(): void
    remove(): void
}

export async function renderTurnstile(el: HTMLElement, siteKey: string, opts: {theme?: 'light' | 'dark', onChange?: (token: string | null) => void, scriptUrl?: string} = {}): Promise<TurnstileWidget> {
    const api = await loadTurnstile(opts.scriptUrl)
    let token: string | null = null
    const set = (t: string | null) => { token = t; opts.onChange?.(t) }
    const id = api.render(el, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        theme: opts.theme ?? 'auto',
        callback: (t: string) => set(t),
        'expired-callback': () => set(null),
        'error-callback': () => set(null),
    })
    return {
        get token() { return token },
        reset: () => { set(null); api.reset(id) },
        remove: () => api.remove(id),
    }
}
