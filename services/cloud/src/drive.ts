import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {base64url, BUCKET, cleanSegments, fileUrl, hmacSha256, jsonBody, logError, randomCode} from './env'
import {CloudUser, requireUser} from './auth'
import {contentTypeFor, putStreamed, uploadSize} from './uploads'
import {grantFolder} from './appFolders'
import {DRIVE_LIST_MAX, driveQuota, FOLDER_DEPTH_MAX, NAME_COPIES_MAX, VISIBILITY_FILES_MAX, SIGN_DEFAULT_SECONDS, SIGN_MAX_SECONDS, sizeText} from './limits'

/**
 * The drive: each user's files, saved by apps (the editor) or uploaded.
 *
 * - An **item** is one upload: a file, or a folder of files that belong together (a .gltf with its .bin and textures,
 *   a small site). Its random id is in the R2 keys, `d/<handle>/<item id>/<name at upload or relative path>`, which never
 *   change. So relative references inside an item work, and serving never reads the database.
 * - **Folders** and the names of items are labels in D1 (`drive_folders`, `drive_items`): renaming or moving is one row.
 *   A path like `/furniture/chair.glb` is resolved with one recursive query (API and page only).
 * - **Visibility** per item: `private`, read through a signed URL that covers the whole item
 *   (`files…/t/<exp>.<sig>/d/<handle>/<item>/…`), or `link`, the item URL works for anyone (the id cannot be guessed).
 *   It is on each object's metadata too, so the files host decides without D1 (src/files.ts).
 *
 *   GET    /api/v1/drive?folder=<id>                 → {folder, path, folders, items}   ('' or none: the root)
 *   GET    /api/v1/drive/resolve?path=/a/b/name      → {folder} or {item}
 *   POST   /api/v1/drive/folders {name, parent?}     → folder
 *   PATCH  /api/v1/drive/folders/<id> {name?, parent?}
 *   DELETE /api/v1/drive/folders/<id>                 (empty folders only)
 *   PUT    /api/v1/drive/files?folder=<id>&name=<name>&visibility=   body: the file → a new item with that one file
 *   POST   /api/v1/drive/items {name, folder?, entry?, visibility?}  → an empty item, for a folder upload (then PUT each file)
 *   PUT    /api/v1/drive/items/<id>/<relative path>  body: one file of the item (overwrites)
 *   GET    /api/v1/drive/items/<id>                  → the item and its files
 *   GET    /api/v1/drive/items/<id>/<relative path>  → the file (owner)
 *   PATCH  /api/v1/drive/items/<id> {name?, folder?, visibility?, entry?}
 *   DELETE /api/v1/drive/items/<id>
 *   POST   /api/v1/drive/items/<id>/sign {ttl?}      → {url, expires_at}: the item's base URL, signed (ends with /)
 *   POST   /api/v1/drive/items/<id>/new-id           → the item under a new id: every old URL of it stops working
 *
 * App keys (src/connect.ts) only reach their folder and what is below it.
 */

type Visibility = 'private' | 'link'
const VISIBILITIES: Visibility[] = ['private', 'link']

const ROOT = ''

interface Folder {id: string, name: string, parent_id: string}
interface Item {id: string, name: string, folder_id: string, entry: string | null, visibility: Visibility, size: number, files_count: number, created: string, updated: string}
/** An item's columns, with its size and file count summed from its files (read, never stored). */
const ITEM_SELECT = `SELECT i.id, i.name, i.folder_id, i.entry, i.visibility, i.created, i.updated,
    (SELECT COALESCE(SUM(size), 0) FROM files WHERE item_id = i.id AND deleted_at IS NULL) AS size,
    (SELECT COUNT(*) FROM files WHERE item_id = i.id AND deleted_at IS NULL) AS files_count FROM drive_items i`


/** `?visibility=` / `{visibility}` of a new item: `private` (default) or `link`, so a share is written once, shared. */
function newVisibility(v: unknown): Visibility {
    if (v === undefined || v === null || v === '') return 'private'
    if (!VISIBILITIES.includes(v as Visibility)) throw new HTTPException(400, {message: `visibility is one of ${VISIBILITIES.join(', ')}`})
    return v as Visibility
}

/** A name for a folder or an item: any language, no `/`, `\` or control characters, 1 to 255 bytes. */
function label(name: unknown): string {
    const n = typeof name === 'string' ? name.normalize('NFC').trim() : ''
    if (!n || n === '.' || n === '..' || new TextEncoder().encode(n).length > 255 || /[\p{Cc}\p{Cf}/\\]/u.test(n))
        throw new HTTPException(400, {message: 'name: 1 to 255 bytes, no / \\ or control characters'})
    return n
}

/** The item's base key, `d/<handle>/<id>/`. */
const itemBase = (user: CloudUser, id: string) => `d/${user.username}/${id}/`
const itemOut = (c: Context<CloudEnv>, user: CloudUser, item: Item) => ({...item, url: fileUrl(c, itemBase(user, item.id) + (item.entry ?? ''))})

// ---- folders and scope ----

/** The folders from the root down to `id`, inclusive ([] for the root), or 404. One recursive query. */
async function chain(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Folder[]> {
    if (id === ROOT) return []
    const {results} = await c.env.PRIMARY_DB.prepare(`WITH RECURSIVE up(id, name, parent_id, depth) AS (
            SELECT id, name, parent_id, 0 FROM drive_folders WHERE id = ?1 AND owner_id = ?2
            UNION ALL SELECT f.id, f.name, f.parent_id, up.depth + 1 FROM drive_folders f JOIN up ON f.id = up.parent_id AND f.owner_id = ?2 WHERE up.depth < ${FOLDER_DEPTH_MAX})
        SELECT id, name, parent_id FROM up ORDER BY depth DESC`).bind(id, user.id).all<Folder>()
    if (!results.length) throw new HTTPException(404, {message: 'no such folder'})
    return results
}

/** The chain to folder `id`, or 403 when an app key may not use it (only its own folder and below). */
async function scopedChain(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Folder[]> {
    await startFolder(c, user)
    const ch = await chain(c, user, id)
    if (user.scope && user.scope !== '*' && !ch.some(f => f.id === user.scope)) throw new HTTPException(403, {message: 'this app key can only use its own folder'})
    return ch
}

/** Whether the folder has a folder or an item named `name` (other than `except`): a path must name one thing. */
async function taken(c: Context<CloudEnv>, ownerId: string, folder: string, name: string, except = ''): Promise<boolean> {
    return !!await c.env.PRIMARY_DB.prepare(`SELECT id FROM drive_folders WHERE owner_id = ?1 AND parent_id = ?2 AND name = ?3 AND id != ?4
            UNION ALL SELECT id FROM drive_items WHERE owner_id = ?1 AND folder_id = ?2 AND name = ?3 AND id != ?4 LIMIT 1`)
        .bind(ownerId, folder, name, except).first()
}

async function assertFree(c: Context<CloudEnv>, user: CloudUser, folder: string, name: string, except?: string) {
    if (await taken(c, user.id, folder, name, except)) throw new HTTPException(409, {message: `'${name}' exists in this folder`})
}

/** A write that names something: when a request at the same time took the name, the unique index refuses it (409). */
async function naming<T>(name: string, write: Promise<T>): Promise<T> {
    try {
        return await write
    } catch (e) {
        if (/UNIQUE/.test(String(e))) throw new HTTPException(409, {message: `'${name}' exists in this folder`})
        throw e
    }
}

/**
 * `name`, or `name (2)`, `name (3)`…: the first one free in the folder. A file name keeps its extension last
 * (`chair (2).glb`); a folder name (`ext: false`) is numbered at the end, dots and all.
 */
export async function freeName(c: Context<CloudEnv>, ownerId: string, folder: string, name: string, ext = true): Promise<string> {
    const dot = ext ? name.lastIndexOf('.') : -1
    const [stem, end] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    for (let i = 1; i < NAME_COPIES_MAX; i++) {
        const n = i === 1 ? name : `${stem} (${i})${end}`
        if (!await taken(c, ownerId, folder, n)) return n
    }
    throw new HTTPException(409, {message: `too many items named '${name}' here`})
}

async function folderOf(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Folder> {
    const f = await c.env.PRIMARY_DB.prepare('SELECT id, name, parent_id FROM drive_folders WHERE id = ? AND owner_id = ?').bind(id, user.id).first<Folder>()
    if (!f) throw new HTTPException(404, {message: 'no such folder'})
    return f
}

/** The user's item, or 404; for an app key only inside its folder. */
async function itemOf(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Item> {
    const it = await c.env.PRIMARY_DB.prepare(`${ITEM_SELECT} WHERE i.id = ? AND i.owner_id = ?`).bind(id, user.id).first<Item>()
    if (!it) throw new HTTPException(404, {message: 'no such item'})
    if (user.scope && user.scope !== '*') await scopedChain(c, user, it.folder_id)
    return it
}

/**
 * Where a request starts: an app key's folder (made again if the user deleted it, src/appFolders.ts), else the root.
 * Every drive route calls it first, so `user.scope` is a folder that exists when the scope checks run.
 */
async function startFolder(c: Context<CloudEnv>, user: CloudUser): Promise<string> {
    if (!user.scope || user.scope === '*') return ROOT
    if (!checked.has(user)) {
        user.scope = await grantFolder(c, user.id, user.link!)
        checked.add(user)
    }
    return user.scope === '*' ? ROOT : user.scope
}
const checked = new WeakSet<CloudUser>()

/** Creates the folder `name` under `parent` (the folder made for an app on connect too, marked with `app`). */
export async function createFolder(c: Context<CloudEnv>, ownerId: string, parent: string, name: string, app?: string): Promise<Folder> {
    const id = randomCode(12)
    await naming(name, c.env.PRIMARY_DB.prepare('INSERT INTO drive_folders (id, owner_id, parent_id, name, app) VALUES (?, ?, ?, ?, ?)').bind(id, ownerId, parent, name, app ?? null).run())
    return {id, name, parent_id: parent}
}

// ---- files ----

/** The bytes of the user's drive files (the account page). */
export async function driveUsage(c: Context<CloudEnv>, userId: string): Promise<{used: number}> {
    const r = await c.env.PRIMARY_DB.prepare(`SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE owner_id = ? AND prefix = 'd' AND deleted_at IS NULL`)
        .bind(userId).first<{used: number}>()
    return {used: r?.used ?? 0}
}

/**
 * Streams the request body into the item as `rel`. Its bytes are reserved first, in one statement that checks the quota
 * (parallel uploads cannot each spend the same free space), then the R2 write, then one D1 batch: the file's hash, the
 * entry and the item as it is now. Two round trips, as a check and a register would be.
 */
async function writeFile(c: Context<CloudEnv>, user: CloudUser, item: Item, rel: string) {
    const segs = cleanSegments(rel)
    if (!segs) throw new HTTPException(400, {message: 'bad file path (no \\ ? # %, control characters or dot files)'})
    rel = segs.join('/')
    const key = itemBase(user, item.id) + rel
    const size = uploadSize(c)
    const body = c.req.raw.body
    if (!body) throw new HTTPException(400, {message: 'empty body'})
    const contentType = contentTypeFor(key, c.req.header('content-type'))
    const quota = driveQuota(user)
    const db = c.env.PRIMARY_DB
    // the file's old size (an overwrite counts its new size only), the usage, and the reservation, which writes the row
    // only when the other files and this one fit
    const [prev, usage, reserved] = await db.batch([
        db.prepare('SELECT size FROM files WHERE bucket = ? AND path = ?').bind(BUCKET, key),
        db.prepare(`SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE owner_id = ? AND prefix = 'd' AND deleted_at IS NULL`).bind(user.id),
        db.prepare(`INSERT INTO files (id, owner_id, bucket, prefix, path, size, content_type, item_id)
                SELECT ?1, ?2, ?3, 'd', ?4, ?5, ?6, ?7
                WHERE (SELECT COALESCE(SUM(size), 0) FROM files WHERE owner_id = ?2 AND prefix = 'd' AND deleted_at IS NULL AND path != ?4) + ?5 <= ?8
            ON CONFLICT (bucket, path) DO UPDATE SET size = excluded.size, content_type = excluded.content_type,
                deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL`)
            .bind(crypto.randomUUID(), user.id, BUCKET, key, size, contentType, item.id, quota),
    ]) as D1Result<{size?: number, used?: number}>[]
    const old = prev.results[0]?.size
    if (!reserved.meta.changes) throw new HTTPException(413, {message: `drive quota: ${sizeText(quota)} (${sizeText(usage.results[0]?.used ?? 0)} used)`})
    // the reservation goes back when the write fails: the row is removed (a new file) or gets its old size (an overwrite)
    const unreserve = () => (old === undefined
        ? db.prepare('DELETE FROM files WHERE bucket = ? AND path = ? AND size = ? AND sha256 IS NULL').bind(BUCKET, key, size)
        : db.prepare('UPDATE files SET size = ? WHERE bucket = ? AND path = ? AND size = ?').bind(old, BUCKET, key, size)).run()
    let sha256: string
    try {
        const put = await putStreamed(c.env.CLOUD_BUCKET, key, body, size, {
            httpMetadata: {contentType},
            customMetadata: {owner: user.id, item: item.id, visibility: item.visibility},
        })
        if (!put.stored) throw new HTTPException(409, {message: 'the file was written by another request at the same time; retry'})
        sha256 = put.sha256
    } catch (e) {
        await unreserve()
        throw e
    }
    // one round trip: the hash, the entry (the item's first file), and the item as it is now. A visibility change or a
    // delete while the file streamed: the object follows the item.
    const res = await db.batch([
        db.prepare('UPDATE files SET sha256 = ? WHERE bucket = ? AND path = ?').bind(sha256, BUCKET, key),
        db.prepare('UPDATE drive_items SET entry = COALESCE(entry, ?) WHERE id = ? RETURNING visibility').bind(rel, item.id),
    ])
    const now = (res[1] as D1Result<{visibility: Visibility}>).results[0]
    if (!now) {
        await db.prepare('DELETE FROM files WHERE bucket = ? AND path = ?').bind(BUCKET, key).run()
        await c.env.CLOUD_BUCKET.delete(key)
        throw new HTTPException(409, {message: 'the item was deleted during the upload'})
    }
    if (now.visibility !== item.visibility) await setVisibility(c, key, now.visibility)
    return {path: rel, size, sha256}
}

/**
 * Writes the object again with this visibility (R2 cannot change metadata in place), unless it has it already. Only over
 * the version it read: when an upload replaced the file meanwhile, its bytes stay and the new version is looked at.
 */
async function setVisibility(c: Context<CloudEnv>, key: string, visibility: Visibility) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const obj = await c.env.CLOUD_BUCKET.get(key)
        if (!obj || obj.customMetadata?.visibility === visibility) return
        const put = await c.env.CLOUD_BUCKET.put(key, obj.body, {httpMetadata: obj.httpMetadata, customMetadata: {...obj.customMetadata, visibility},
            onlyIf: {etagMatches: obj.etag}})
        if (put) return
    }
    throw new HTTPException(409, {message: 'the file kept changing during the visibility change; try again'})
}

async function itemFiles(c: Context<CloudEnv>, item: Item) {
    const {results} = await c.env.PRIMARY_DB.prepare('SELECT path, size, content_type FROM files WHERE item_id = ? AND deleted_at IS NULL ORDER BY path')
        .bind(item.id).all<{path: string, size: number, content_type: string}>()
    return results
}


/**
 * Copies `from` to `to` for the item `itemId` (a try again on a failure). → the etag of the object it copied, null when
 * there is no object at `from`, undefined when the copy failed.
 */
async function copyObject(c: Context<CloudEnv>, from: string, to: string, itemId: string): Promise<string | null | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const obj = await c.env.CLOUD_BUCKET.get(from)
            if (!obj) return null
            await c.env.CLOUD_BUCKET.put(to, obj.body, {httpMetadata: obj.httpMetadata, customMetadata: {...obj.customMetadata, item: itemId}})
            return obj.etag
        } catch { /* once more */ }
    }
    return undefined
}

// ---- signed URLs ----

async function hmac(env: CloudflareBindings, data: string): Promise<string> {
    if (!env.FILES_URL_SECRET) throw new HTTPException(500, {message: 'FILES_URL_SECRET is not set'})
    return base64url(await hmacSha256(env.FILES_URL_SECRET, data))
}

/** `t/<exp>.<sig>/d/<handle>/<item>/`: until `exp` (unix seconds), every file of the item. */
async function signItem(env: CloudflareBindings, base: string, exp: number): Promise<string> {
    return `t/${exp}.${await hmac(env, `${exp}.${base}`)}/${base}`
}

/** Whether `token` (`<exp>.<sig>` of a signed URL) allows reading `key` (`d/<handle>/<item>/<file>`). */
export async function verifySigned(env: CloudflareBindings, token: string, key: string): Promise<boolean> {
    const [e, sig] = token.split('.')
    const exp = Number(e)
    const segs = key.split('/')
    if (!sig || !Number.isInteger(exp) || exp * 1000 < Date.now() || segs[0] !== 'd' || segs.length < 4) return false
    const expected = new TextEncoder().encode(await hmac(env, `${exp}.${segs.slice(0, 3).join('/')}/`))
    const given = new TextEncoder().encode(sig)
    return expected.length === given.length && crypto.subtle.timingSafeEqual(expected, given)
}

// ---- routes ----

const folderOut = (f: Folder) => ({id: f.id, name: f.name, parent: f.parent_id})

export function driveRoutes(app: Hono<CloudEnv>) {
    app.get('/api/v1/drive', async (c) => {
        const user = await requireUser(c)
        const start = await startFolder(c, user)
        const id = c.req.query('folder') ?? start
        const path = await scopedChain(c, user, id)
        const [folders, items] = await c.env.PRIMARY_DB.batch([
            c.env.PRIMARY_DB.prepare('SELECT id, name, parent_id FROM drive_folders WHERE owner_id = ? AND parent_id = ? ORDER BY name LIMIT ?').bind(user.id, id, DRIVE_LIST_MAX),
            c.env.PRIMARY_DB.prepare(`${ITEM_SELECT} WHERE i.owner_id = ? AND i.folder_id = ? ORDER BY i.name LIMIT ?`).bind(user.id, id, DRIVE_LIST_MAX),
        ]) as [D1Result<Folder>, D1Result<Item>]
        return c.json({
            folder: id === ROOT ? {id: ROOT, name: '', parent: null} : folderOut(path[path.length - 1]),
            path: path.map(f => ({id: f.id, name: f.name})),
            folders: folders.results.map(folderOut),
            items: items.results.map(it => itemOut(c, user, it)),
        })
    })

    // Outside an app key's folder it answers 404, like a path that does not exist: an app learns nothing of the rest.
    app.get('/api/v1/drive/resolve', async (c) => {
        const user = await requireUser(c)
        try {
            return await resolvePath(c, user)
        } catch (e) {
            if (e instanceof HTTPException && e.status === 403) throw new HTTPException(404, {message: 'not found'})
            throw e
        }
    })
    const resolvePath = async (c: Context<CloudEnv>, user: CloudUser) => {
        const parts = (c.req.query('path') || '').normalize('NFC').split('/').filter(Boolean)
        if (!parts.length) return c.json({folder: {id: ROOT, name: '', parent: null}})
        // down the folders by name, as far as they go: one query
        const deepest = await c.env.PRIMARY_DB.prepare(`WITH RECURSIVE walk(id, depth) AS (SELECT '', 0
                UNION ALL SELECT f.id, walk.depth + 1 FROM drive_folders f JOIN walk ON f.parent_id = walk.id
                WHERE f.owner_id = ?1 AND walk.depth < ?3 AND f.name = json_extract(?2, '$[' || walk.depth || ']'))
            SELECT id, depth FROM walk ORDER BY depth DESC LIMIT 1`).bind(user.id, JSON.stringify(parts), parts.length).first<{id: string, depth: number}>()
        const at = deepest ?? {id: ROOT, depth: 0}
        if (at.depth === parts.length) {
            await scopedChain(c, user, at.id)
            return c.json({folder: folderOut(await folderOf(c, user, at.id))})
        }
        if (at.depth === parts.length - 1) {
            const it = await c.env.PRIMARY_DB.prepare('SELECT id FROM drive_items WHERE owner_id = ? AND folder_id = ? AND name = ?').bind(user.id, at.id, parts[parts.length - 1]).first<{id: string}>()
            if (it) return c.json({item: itemOut(c, user, await itemOf(c, user, it.id))})
        }
        throw new HTTPException(404, {message: 'not found'})
    }

    app.post('/api/v1/drive/folders', async (c) => {
        const user = await requireUser(c)
        const body = await jsonBody<{name?: string, parent?: string}>(c)
        const start = await startFolder(c, user)
        const parent = body.parent ?? start
        await scopedChain(c, user, parent)
        const name = label(body.name)
        await assertFree(c, user, parent, name)
        return c.json(folderOut(await createFolder(c, user.id, parent, name)), 201)
    })

    app.patch('/api/v1/drive/folders/:id', async (c) => {
        const user = await requireUser(c)
        const f = await folderOf(c, user, c.req.param('id'))
        await scopedChain(c, user, f.id)
        if (user.scope === f.id) throw new HTTPException(403, {message: 'an app cannot rename or move its own folder'})
        const body = await jsonBody<{name?: string, parent?: string}>(c)
        const name = body.name !== undefined ? label(body.name) : f.name
        const parent = body.parent ?? f.parent_id
        if (parent !== f.parent_id && (await scopedChain(c, user, parent)).some(x => x.id === f.id))
            throw new HTTPException(400, {message: 'a folder cannot move into itself'})
        await assertFree(c, user, parent, name, f.id)
        await naming(name, c.env.PRIMARY_DB.prepare('UPDATE drive_folders SET name = ?, parent_id = ? WHERE id = ?').bind(name, parent, f.id).run())
        return c.json(folderOut({id: f.id, name, parent_id: parent}))
    })

    app.delete('/api/v1/drive/folders/:id', async (c) => {
        const user = await requireUser(c)
        const f = await folderOf(c, user, c.req.param('id'))
        await scopedChain(c, user, f.id)
        if (user.scope === f.id) throw new HTTPException(403, {message: 'an app cannot delete its own folder'})
        const inside = await c.env.PRIMARY_DB.prepare('SELECT 1 FROM drive_folders WHERE parent_id = ?1 AND owner_id = ?2 UNION ALL SELECT 1 FROM drive_items WHERE folder_id = ?1 AND owner_id = ?2 LIMIT 1')
            .bind(f.id, user.id).first()
        if (inside) throw new HTTPException(409, {message: 'the folder is not empty'})
        await c.env.PRIMARY_DB.prepare('DELETE FROM drive_folders WHERE id = ?').bind(f.id).run()
        return c.json({deleted: f.id})
    })

    // A new item with one file: the usual save. The name is the label; the stored file name is the same, made safe.
    app.put('/api/v1/drive/files', async (c) => {
        const user = await requireUser(c)
        const start = await startFolder(c, user)
        const folder = c.req.query('folder') ?? start
        await scopedChain(c, user, folder)
        const name = await freeName(c, user.id, folder, label(c.req.query('name')))
        const rel = name.replace(/[\\?#%]/g, '_').replace(/^\./, '_')
        const item: Item = {id: randomCode(16), name, folder_id: folder, entry: null, visibility: newVisibility(c.req.query('visibility')), size: 0, files_count: 0, created: '', updated: ''}
        await naming(name, c.env.PRIMARY_DB.prepare('INSERT INTO drive_items (id, owner_id, folder_id, name, visibility) VALUES (?, ?, ?, ?, ?)').bind(item.id, user.id, folder, name, item.visibility).run())
        try {
            await writeFile(c, user, item, rel)
        } catch (e) {
            // the item goes with its file: the row, and the object if it was written
            await c.env.PRIMARY_DB.batch([
                c.env.PRIMARY_DB.prepare('DELETE FROM files WHERE item_id = ?').bind(item.id),
                c.env.PRIMARY_DB.prepare('DELETE FROM drive_items WHERE id = ?').bind(item.id),
            ])
            await c.env.CLOUD_BUCKET.delete(itemBase(user, item.id) + rel)
            throw e
        }
        return c.json(itemOut(c, user, await itemOf(c, user, item.id)), 201)
    })

    app.post('/api/v1/drive/items', async (c) => {
        const user = await requireUser(c)
        const body = await jsonBody<{name?: string, folder?: string, entry?: string, visibility?: Visibility}>(c)
        const visibility = newVisibility(body.visibility)
        const start = await startFolder(c, user)
        const folder = body.folder ?? start
        await scopedChain(c, user, folder)
        const name = await freeName(c, user.id, folder, label(body.name))
        let entry: string | null = null
        if (body.entry !== undefined) {
            entry = cleanSegments(String(body.entry))?.join('/') ?? null
            if (!entry) throw new HTTPException(400, {message: 'bad entry'})
        }
        const id = randomCode(16)
        await naming(name, c.env.PRIMARY_DB.prepare('INSERT INTO drive_items (id, owner_id, folder_id, name, entry, visibility) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, folder, name, entry, visibility).run())
        return c.json(itemOut(c, user, await itemOf(c, user, id)), 201)
    })

    app.put('/api/v1/drive/items/:id/:path{.+}', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        return c.json(await writeFile(c, user, item, c.req.param('path')))
    })

    app.get('/api/v1/drive/items/:id', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const base = itemBase(user, item.id)
        return c.json({...itemOut(c, user, item), files: (await itemFiles(c, item)).map(f => ({...f, path: f.path.slice(base.length)}))})
    })

    app.get('/api/v1/drive/items/:id/:path{.+}', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const segs = cleanSegments(c.req.param('path'))
        const obj = segs ? await c.env.CLOUD_BUCKET.get(itemBase(user, item.id) + segs.join('/')) : null
        if (!obj || obj.customMetadata?.owner !== user.id) throw new HTTPException(404, {message: 'not found'})
        const headers = new Headers()
        obj.writeHttpMetadata(headers)
        headers.set('etag', obj.httpEtag)
        headers.set('content-length', String(obj.size))
        headers.set('cache-control', 'private, no-store')
        headers.set('x-content-type-options', 'nosniff')
        headers.set('content-security-policy', 'sandbox')
        return new Response(obj.body, {headers})
    })

    app.patch('/api/v1/drive/items/:id', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const body = await jsonBody<{name?: string, folder?: string, visibility?: Visibility, entry?: string}>(c)
        const name = body.name !== undefined ? label(body.name) : item.name
        const folder = body.folder ?? item.folder_id
        if (folder !== item.folder_id) await scopedChain(c, user, folder)
        if (name !== item.name || folder !== item.folder_id) await assertFree(c, user, folder, name, item.id)
        if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) throw new HTTPException(400, {message: `visibility is one of ${VISIBILITIES.join(', ')}`})
        // each file is written again (R2 has no metadata update): sharing is refused for an item too big for one request.
        // Making one private always goes ahead: a request cut short is sent again, and files already done cost one read.
        const files = body.visibility !== undefined ? await itemFiles(c, item) : []
        if (body.visibility === 'link' && item.visibility !== 'link' && files.length > VISIBILITY_FILES_MAX)
            throw new HTTPException(413, {message: `an item of more than ${VISIBILITY_FILES_MAX} files cannot be shared; split it`})
        const visibility = body.visibility ?? item.visibility
        let entry = item.entry
        if (body.entry !== undefined) {
            entry = cleanSegments(String(body.entry))?.join('/') ?? null
            if (!entry) throw new HTTPException(400, {message: 'bad entry'})
        }
        // D1 first, only the fields this request gives: a rename at the same time as a visibility change must not write the visibility it read back.
        const set: [string, string | null][] = []
        if (body.name !== undefined) set.push(['name', name])
        if (body.folder !== undefined) set.push(['folder_id', folder])
        if (body.visibility !== undefined) set.push(['visibility', visibility])
        if (body.entry !== undefined) set.push(['entry', entry])
        if (set.length) await naming(name, c.env.PRIMARY_DB.prepare(`UPDATE drive_items SET ${set.map(([k]) => k + ' = ?').join(', ')} WHERE id = ?`)
            .bind(...set.map(([, v]) => v), item.id).run())
        // then each file that does not have it yet (sending the same visibility again repairs a change cut short)
        let after: Item | undefined
        if (body.visibility !== undefined) {
            let done = 0, want = visibility
            try {
                // A change that came in meanwhile may have finished first (an unshare while this share was writing): the
                // item as it is now is read after the files (it is the answer anyway), and its visibility applied if it
                // differs, so whichever request ends last leaves the files as the item is.
                for (let round = 0; ; round++) {
                    done = 0
                    for (const f of files) {
                        await setVisibility(c, f.path, want)
                        done++
                    }
                    after = await itemOf(c, user, item.id)
                    if (after.visibility === want) break
                    if (round === 3) throw new Error('the visibility kept changing')
                    want = after.visibility
                }
            } catch (e) {
                if (e instanceof HTTPException && e.status === 404) throw e // deleted meanwhile
                // cut short (an R2 error, a limit): the row goes back, so the page shows the item as it still mostly is
                // and the same button tries again (sending a visibility again finishes the files left)
                logError('drive visibility: cut short', {item: item.id, visibility, done, files: files.length, error: String(e)})
                if (item.visibility !== visibility) await c.env.PRIMARY_DB.prepare('UPDATE drive_items SET visibility = ? WHERE id = ? AND visibility = ?')
                    .bind(item.visibility, item.id, visibility).run()
                throw new HTTPException(503, {message: visibility === 'private'
                    ? `It is still shared: ${files.length - done} of ${files.length} file(s) could not be made private. Try again.`
                    : `It is not shared yet: ${files.length - done} of ${files.length} file(s) could not be shared. Try again.`})
            }
        }
        return c.json(itemOut(c, user, after ?? await itemOf(c, user, item.id)))
    })

    // A new id for the item: its files are copied under the new id and the old ones deleted, so every URL of the item
    // given out before (links, signed URLs) stops working. Name, folder and visibility stay.
    app.post('/api/v1/drive/items/:id/new-id', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const oldBase = itemBase(user, item.id), id = randomCode(16), newBase = itemBase(user, id)
        const db = c.env.PRIMARY_DB, bucket = c.env.CLOUD_BUCKET
        const deleteKeys = async (keys: string[]) => { for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000)) }
        // 1. The objects first, under the new id: until every one is there the item does not change (a failure leaves it as it was).
        const {results: rows} = await db.prepare('SELECT path FROM files WHERE item_id = ?').bind(item.id).all<{path: string}>()
        const copied = new Map<string, string>() // file → the etag of the object copied
        for (const {path} of rows) {
            const rel = path.slice(oldBase.length)
            const etag = await copyObject(c, path, newBase + rel, id)
            if (etag === undefined) {
                await deleteKeys([...copied.keys()].map(r => newBase + r))
                throw new HTTPException(503, {message: 'a file could not be copied; the item did not change, try again'})
            }
            if (etag) copied.set(rel, etag)
        }
        // 2. D1 in one batch: the item and its rows take the new id. An upload to the old id that registers after this
        // cleans up after itself (writeFile) and gets a 409.
        const [, moved] = await db.batch([
            db.prepare('UPDATE drive_items SET id = ? WHERE id = ?').bind(id, item.id),
            db.prepare(`UPDATE files SET item_id = ?1, path = ?2 || substr(path, ?3) WHERE item_id = ?4 RETURNING path`).bind(id, newBase, oldBase.length + 1, item.id),
        ]) as D1Result<{path: string}>[]
        // 3. A file an upload replaced or added while 1 ran (it registered before 2) is copied again: its old object is newer.
        const rels = moved.results.map(r => r.path.slice(newBase.length))
        const failed: string[] = []
        for (const rel of rels) {
            const now = await bucket.head(oldBase + rel)
            if (now && now.etag !== copied.get(rel) && await copyObject(c, oldBase + rel, newBase + rel, id) === undefined) failed.push(rel)
        }
        // The copies carry the visibility their objects had in 1; a visibility change that ended before 2 changed only the
        // old objects (and the row, which moved): the new ones take the item's visibility now. Without it, an unshare
        // during 1 leaves a private item whose new unsigned URLs still work.
        const now = await db.prepare('SELECT visibility FROM drive_items WHERE id = ?').bind(id).first<{visibility: Visibility}>()
        if (now) for (const rel of rels) if (!failed.includes(rel)) await setVisibility(c, newBase + rel, now.visibility)
        // 4. The old objects go, but those of files not copied again; copies of files deleted while 1 ran go too.
        const keep = new Set(failed), kept = new Set(rels)
        await deleteKeys([...rels.filter(r => !keep.has(r)).map(r => oldBase + r), ...[...copied.keys()].filter(r => !kept.has(r)).map(r => newBase + r)])
        if (failed.length) {
            logError('new id: files changed during the change were not copied again; their old objects stay', {item: id, from: oldBase, to: newBase, files: failed})
            throw new HTTPException(500, {message: `the item got the new id ${id}, but ${failed.length} file(s) uploaded during the change were not copied; upload them again`})
        }
        return c.json(itemOut(c, user, await itemOf(c, user, id)))
    })

    app.delete('/api/v1/drive/items/:id', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const db = c.env.PRIMARY_DB
        const deleteKeys = async (keys: string[]) => { for (let i = 0; i < keys.length; i += 1000) await c.env.CLOUD_BUCKET.delete(keys.slice(i, i + 1000)) }
        // The objects first: when R2 fails, the item and its rows are still there and deleting it again finishes the job
        // (the other way round, a failure would leave objects, maybe shared, that nothing lists).
        const paths = (await itemFiles(c, item)).map(f => f.path)
        await deleteKeys(paths)
        const [rows] = await db.batch([
            db.prepare('DELETE FROM files WHERE item_id = ? RETURNING path').bind(item.id),
            db.prepare('DELETE FROM drive_items WHERE id = ?').bind(item.id),
        ]) as D1Result<{path: string}>[]
        // a file uploaded while this ran (its upload cleans up after itself when it registers later)
        const done = new Set(paths), late = rows.results.map(r => r.path).filter(p => !done.has(p))
        if (late.length) await deleteKeys(late)
        return c.json({deleted: item.id})
    })

    app.post('/api/v1/drive/items/:id/sign', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const ttl = (await jsonBody<{ttl?: number}>(c)).ttl ?? SIGN_DEFAULT_SECONDS
        if (!Number.isInteger(ttl) || ttl <= 0 || ttl > SIGN_MAX_SECONDS) throw new HTTPException(400, {message: `ttl is seconds, 1 to ${SIGN_MAX_SECONDS}`})
        const exp = Math.floor(Date.now() / 1000) + ttl
        return c.json({url: fileUrl(c, await signItem(c.env, itemBase(user, item.id), exp)), expires_at: new Date(exp * 1000).toISOString()})
    })
}
