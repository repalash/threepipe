/** What /api/v1/connect hands back in the URL fragment (services/cloud/src/connect.ts). */
interface Session {key: string, user: string, folder: string, api: string, exp: number}

const STORAGE_KEY = 'threepipeCloudSession'

/**
 * `cloud.auth`: Sign in with threepipe. The app sends the person to threepipe cloud (`signIn()`), they approve it once,
 * and come back to the same page with a key in the URL fragment, which `handleRedirect()` (called when the plugin is
 * added) reads and removes from the address bar.
 *
 * The key works for 24 hours, on the person's drive only, inside the folder the app was given (`Apps/<app>`, made on
 * the first approval; `folder` is its id), or the whole drive with `access: 'drive'` (`folder` is `*`). It is kept in sessionStorage when
 * the page has it; pages on files.threepipe.org run sandboxed without storage, so call `signIn()` on load there: once
 * approved it comes straight back.
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
        const q = new URLSearchParams({return: ret, ...o.access === 'drive' ? {access: 'drive'} : {}, ...o.prompt ? {prompt: 'consent'} : {}})
        location.assign(`${this._endpoint().replace(/\/+$/, '')}/api/v1/connect?${q}`)
    }

    /** Forgets the key on this page. To remove the app's access for good, revoke it in Apps & keys (<endpoint>/account). */
    signOut(): void {
        this._s = null
        try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* no storage */ }
    }

    /**
     * Reads the key from the URL fragment after `signIn()` and removes it from the address bar. Returns 'signed-in',
     * 'denied' (the person pressed Cancel) or null (nothing in the fragment).
     */
    handleRedirect(): 'signed-in' | 'denied' | null {
        if (typeof location === 'undefined' || !location.hash) return null
        const p = new URLSearchParams(location.hash.slice(1))
        const key = p.get('tp_cloud_key'), denied = p.get('tp_cloud_error')
        if (!key && !denied) return null
        history.replaceState(history.state, '', location.pathname + location.search)
        if (!key) return 'denied'
        this._s = {key, user: p.get('tp_cloud_user') || '', folder: p.get('tp_cloud_folder') || '', api: (p.get('tp_cloud_api') || this._endpoint()).replace(/\/+$/, ''), exp: expiry(key)}
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
