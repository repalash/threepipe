/** What /api/v1/connect hands back in the URL fragment (services/cloud/src/connect.ts). */
interface Session {key: string, user: string, folder: string, api: string, exp: number}

const STORAGE_KEY = 'threepipeCloudSession'
/** The `state` of the sign-in that left this tab (sessionStorage), see {@link CloudAuth.handleRedirect} */
const STATE_KEY = 'threepipeCloudState'

/**
 * `cloud.auth`: Sign in with threepipe. The app sends the person to threepipe cloud (`signIn()`), they approve it once,
 * and come back to the same page with a key in the URL fragment, which `handleRedirect()` (called when the plugin is
 * added) reads and removes from the address bar.
 *
 * The key works for 24 hours, on the person's drive only, inside the folder the app was given (`Apps/<app>`, made on
 * the first approval; `folder` is its id), or the whole drive with `access: 'drive'` (`folder` is `*`). It is kept in sessionStorage when
 * the page has it; pages on files.threepipe.org run sandboxed without storage, so call `signIn()` on load there: once
 * approved it comes straight back.
 *
 * `signIn()` keeps a random `state` in sessionStorage and the cloud sends it back with the key; `handleRedirect()` takes
 * only a key that brings it back, so a link with someone else's key in its fragment does not sign the page in. A page
 * without storage (sandboxed) cannot keep it and takes the key as it comes.
 */
export class CloudAuth {
    private _s: Session | null = null

    constructor(private _endpoint: () => string) {
        try {
            const s = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as Session | null
            if (s && s.exp * 1000 > Date.now() && s.api === this._endpoint().replace(/\/+$/, '')) this._s = s
        } catch { /* no storage on this page (sandboxed) */ }
    }

    /** The key to send as `Authorization: Bearer <key>`, while it is valid. */
    get key(): string | undefined {
        return this._s && this._s.exp * 1000 > Date.now() ? this._s.key : undefined
    }

    get signedIn(): boolean {
        return !!this.key
    }

    /** The signed-in person's username. */
    get user(): string | undefined {
        return this.key ? this._s!.user : undefined
    }

    /** The id of the drive folder the key may use (and below), or `*` for the whole drive. */
    get folder(): string | undefined {
        return this.key ? this._s!.folder : undefined
    }

    /**
     * Goes to threepipe cloud to sign in and approve this app, and comes back to `returnUrl` (default: this page).
     * `access: 'drive'` asks for the whole drive instead of the app's own folder; `prompt` shows the approval again.
     */
    signIn(o: {access?: 'app' | 'drive', prompt?: boolean, returnUrl?: string} = {}): void {
        const ret = o.returnUrl ?? location.href.replace(/#.*$/, '')
        let state: string | undefined
        try {
            state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
            sessionStorage.setItem(STATE_KEY, state)
        } catch {
            state = undefined // no storage on this page (sandboxed): nothing to check the answer against
        }
        const q = new URLSearchParams({return: ret, ...o.access === 'drive' ? {access: 'drive'} : {}, ...o.prompt ? {prompt: 'consent'} : {}, ...state ? {state} : {}})
        location.assign(`${this._endpoint().replace(/\/+$/, '')}/api/v1/connect?${q}`)
    }

    /** Forgets the key on this page. To remove the app's access for good, revoke it in Apps & keys (<endpoint>/account). */
    signOut(): void {
        this._s = null
        try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* no storage */ }
    }

    /**
     * Reads the key from the URL fragment after `signIn()` and removes it from the address bar. Returns 'signed-in',
     * 'denied' (the person pressed Cancel) or null (nothing in the fragment, or a key this page did not ask for: no
     * matching `state`, or from another endpoint).
     */
    handleRedirect(): 'signed-in' | 'denied' | null {
        if (typeof location === 'undefined' || !location.hash) return null
        const p = new URLSearchParams(location.hash.slice(1))
        const key = p.get('tp_cloud_key'), denied = p.get('tp_cloud_error')
        if (!key && !denied) return null
        history.replaceState(history.state, '', location.pathname + location.search)
        let expected: string | null | undefined // undefined: this page has no storage, so no state to check
        try {
            expected = sessionStorage.getItem(STATE_KEY)
            sessionStorage.removeItem(STATE_KEY)
        } catch { /* sandboxed page */ }
        if (expected !== undefined && (!expected || p.get('tp_cloud_state') !== expected)) {
            console.warn('CloudAuth: ignored a sign-in this page did not start (its state does not match)')
            return null
        }
        if (!key) return 'denied'
        const api = this._endpoint().replace(/\/+$/, '')
        const from = (p.get('tp_cloud_api') || api).replace(/\/+$/, '')
        if (from !== api) {
            console.warn('CloudAuth: ignored a key from another endpoint', from)
            return null
        }
        this._s = {key, user: p.get('tp_cloud_user') || '', folder: p.get('tp_cloud_folder') || '', api, exp: expiry(key)}
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this._s)) } catch { /* no storage */ }
        return 'signed-in'
    }
}

/** The `exp` of a JWT, in seconds; now + 1 h when it cannot be read. */
function expiry(jwt: string): number {
    try {
        const exp = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp
        if (typeof exp === 'number') return exp
    } catch { /* not a JWT */ }
    return Math.floor(Date.now() / 1000) + 3600
}
