/** A file to share: a File, or any Blob with the name to serve it under. */
export type ShareFile = File | {name: string, blob: Blob}

export interface ShareOptions {
    /** A named share: a second upload to the same slug updates it in place (only its owner may). */
    slug?: string
    /** Write-once, content-addressed assets (`/a/<id>/<name>`) instead of a share. */
    asset?: boolean
    /** One of the worker's SHARE_TOKENS. Default: `cloud.share.token`. */
    token?: string
}

export interface ShareResult {
    /** The page to open: the share's index.html or its one file, or the share root. */
    url: string
    slug?: string
    files?: string[]
    /** For `asset: true`: one entry per file, `{name, url, sha256, size, existed}`. */
    assets?: {name: string, url: string, id: string, sha256: string, size: number, existed: boolean}[]
}

/**
 * `cloud.share`: upload files to threepipe-cloud's `POST /share` and get a URL back. It needs a share
 * token (the worker's SHARE_TOKENS), so it is for the team and their tools, not for anonymous visitors:
 * set `cloud.share.token` from your own sign-in or a prompt, never from source.
 */
export class CloudShare {
    /** One of the worker's SHARE_TOKENS. */
    token?: string

    constructor(private _endpoint: () => string | undefined) {}

    get available(): boolean {
        return !!this._endpoint() && !!this.token
    }

    async upload(files: ShareFile | ShareFile[], o: ShareOptions = {}): Promise<ShareResult> {
        const endpoint = this._endpoint()
        const token = o.token ?? this.token
        if (!endpoint) throw new Error('cloud.share: no endpoint is set')
        if (!token) throw new Error('cloud.share: no share token is set (cloud.share.token)')
        const fd = new FormData()
        if (o.slug) fd.set('slug', o.slug)
        if (o.asset) fd.set('asset', '1')
        for (const f of Array.isArray(files) ? files : [files]) {
            if (f instanceof Blob) fd.append('file', f, f.name)
            else fd.append('file', f.blob, f.name)
        }
        const res = await fetch(endpoint.replace(/\/+$/, '') + '/share', {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: fd, credentials: 'omit'})
        const body = await res.json().catch(() => null) as (ShareResult & {error?: string}) | null
        if (!res.ok || !body) throw new Error(`cloud.share: ${body?.error ?? `the server answered ${res.status}`}`)
        if (body.assets) return {url: body.assets[0]?.url ?? '', assets: body.assets}
        return body
    }
}
