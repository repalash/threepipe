import type {CloudAuth} from '../auth/CloudAuth'

/** One upload in the drive: a file, or a folder of files that belong together (a .gltf with its .bin and textures). */
export interface DriveItem {
    id: string
    name: string
    folder_id: string
    /** The file the item URL opens. */
    entry: string | null
    /** `private`: through signed URLs only; `link`: anyone with `url`. */
    visibility: 'private' | 'link'
    size: number
    files_count: number
    created: string
    updated: string
    /** The item URL (its entry). Opens for anyone when the visibility is `link`. */
    url: string
}

export interface DriveFolder {id: string, name: string, parent: string | null}

/**
 * `cloud.drive`: the signed-in person's drive (services/cloud/src/drive.ts). An app's key reaches its own folder,
 * `Apps/<app>` in the person's drive (`cloud.auth.folder` is its id), and what is below it; without a `folder` option,
 * things go there. Names and folders are labels: renaming or moving never changes an item's URL.
 *
 * ```ts
 * const item = await cloud.drive.save('chair.glb', await viewer.exportScene())
 * await viewer.load(await cloud.drive.fileUrl(item.id))   // private: a signed URL, 1 hour
 * const link = await cloud.drive.share(item.id)            // anyone with the link
 * ```
 */
export class CloudDrive {
    constructor(private _endpoint: () => string, private _auth: CloudAuth) {}

    private async _fetch<T = any>(route: string, init: RequestInit = {}, as: 'json' | 'blob' = 'json'): Promise<T> {
        if (!this._auth.key) throw new Error('cloud.drive: not signed in (cloud.auth.signIn())')
        const res = await fetch(`${this._endpoint().replace(/\/+$/, '')}/api/v1/drive${route}`, {
            ...init, credentials: 'omit', headers: {...init.headers as Record<string, string>, authorization: `Bearer ${this._auth.key}`},
        })
        if (!res.ok) {
            const body = await res.json().catch(() => null) as {message?: string, error?: string} | null
            throw new Error(`cloud.drive: ${body?.message ?? body?.error ?? `the server answered ${res.status}`}`)
        }
        return (as === 'blob' ? res.blob() : res.json()) as Promise<T>
    }

    private _send<T = any>(method: string, route: string, body?: unknown) {
        return this._fetch<T>(route, {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body ?? {})})
    }

    /** Saves a file as a new item (a free name like `chair (2).glb` when the name is taken). */
    save(name: string, blob: Blob, o: {folder?: string} = {}): Promise<DriveItem> {
        const q = new URLSearchParams({name, ...o.folder !== undefined ? {folder: o.folder} : {}})
        return this._fetch(`/files?${q}`, {method: 'PUT', body: blob})
    }

    /** Saves files that belong together as one item; `entry` is the one its URL opens (default: the first). */
    async saveFolder(name: string, files: {path: string, blob: Blob}[], o: {folder?: string, entry?: string} = {}): Promise<DriveItem> {
        const item = await this._send<DriveItem>('POST', '/items', {name, folder: o.folder, entry: o.entry ?? files[0]?.path})
        for (const f of files) await this._fetch(`/items/${encodeURIComponent(item.id)}/${f.path.split('/').map(encodeURIComponent).join('/')}`, {method: 'PUT', body: f.blob})
        return this.item(item.id)
    }

    /** A folder's folders and items (default: the app's folder), and the path to it. */
    list(folder?: string): Promise<{folder: DriveFolder, path: {id: string, name: string}[], folders: DriveFolder[], items: DriveItem[]}> {
        return this._fetch(folder !== undefined ? `?folder=${encodeURIComponent(folder)}` : '')
    }

    /** The folder or the item at a path of names, from the top of the drive (`/Apps/My editor/chair.glb`). */
    resolve(path: string): Promise<{folder?: DriveFolder, item?: DriveItem}> {
        return this._fetch(`/resolve?path=${encodeURIComponent(path)}`)
    }

    /** An item and its files. */
    item(id: string): Promise<DriveItem & {files: {path: string, size: number, content_type: string}[]}> {
        return this._fetch(`/items/${encodeURIComponent(id)}`)
    }

    /** Reads a file of an item (default: its entry). */
    async read(id: string, path?: string): Promise<Blob> {
        path ??= (await this.item(id)).entry ?? ''
        return this._fetch(`/items/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`, {}, 'blob')
    }

    rename(id: string, name: string): Promise<DriveItem> {
        return this._send('PATCH', `/items/${encodeURIComponent(id)}`, {name})
    }

    move(id: string, folder: string): Promise<DriveItem> {
        return this._send('PATCH', `/items/${encodeURIComponent(id)}`, {folder})
    }

    async remove(id: string): Promise<void> {
        await this._send('DELETE', `/items/${encodeURIComponent(id)}`)
    }

    /** Anyone with the item URL can open it; returns that URL. */
    async share(id: string): Promise<string> {
        return (await this._send<DriveItem>('PATCH', `/items/${encodeURIComponent(id)}`, {visibility: 'link'})).url
    }

    /** Private again: the item URL stops working for others. */
    async unshare(id: string): Promise<void> {
        await this._send('PATCH', `/items/${encodeURIComponent(id)}`, {visibility: 'private'})
    }

    /** The item under a new id: every URL of it given out before stops working. */
    newId(id: string): Promise<DriveItem> {
        return this._send('POST', `/items/${encodeURIComponent(id)}/new-id`)
    }

    /**
     * A URL to load a file of an item with (default: its entry), e.g. `viewer.load(url)`. For a private item it is signed
     * for the whole item, so the files it refers to by relative path load too; valid for `ttl` seconds (default 1 hour).
     */
    async fileUrl(id: string, path?: string, ttl?: number): Promise<string> {
        const item = await this.item(id)
        const file = (path ?? item.entry ?? '').split('/').map(encodeURIComponent).join('/')
        if (item.visibility === 'link') return item.url.slice(0, item.url.indexOf(`/${item.id}/`) + item.id.length + 2) + file
        const {url} = await this._send<{url: string}>('POST', `/items/${encodeURIComponent(id)}/sign`, {ttl})
        return url + file
    }

    /** A new folder (default: in the app's folder). */
    newFolder(name: string, parent?: string): Promise<DriveFolder> {
        return this._send('POST', '/folders', {name, parent})
    }
}
