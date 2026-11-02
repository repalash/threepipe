import type {CloudDrive} from '../drive/CloudDrive'

/** A file to share: a File, or any Blob with the name to serve it under. */
export type ShareFile = File | {name: string, blob: Blob}

export interface ShareResult {
    /** The link anyone can open: the item's entry (its index.html, or the first file). */
    url: string
    /** The drive item, for `cloud.drive.unshare(id)`, `remove(id)` or `newId(id)`. */
    id: string
}

/**
 * `cloud.share`: puts files in the signed-in person's drive (in the app's folder) as one item and makes it open for
 * anyone with the link. Needs `cloud.auth.signIn()` first.
 */
export class CloudShare {
    constructor(private _drive: CloudDrive) {}

    async upload(files: ShareFile | ShareFile[], o: {name?: string} = {}): Promise<ShareResult> {
        const list = (Array.isArray(files) ? files : [files]).map(f => f instanceof Blob ? {name: (f as File).name, blob: f as Blob} : f)
        if (!list.length) throw new Error('cloud.share: no files')
        const item = list.length === 1
            ? await this._drive.save(o.name ?? list[0].name, list[0].blob)
            : await this._drive.saveFolder(o.name ?? `share ${new Date().toISOString().slice(0, 10)}`, list.map(f => ({path: f.name, blob: f.blob})),
                {entry: list.find(f => f.name === 'index.html')?.name ?? list[0].name})
        return {url: await this._drive.share(item.id), id: item.id}
    }
}
