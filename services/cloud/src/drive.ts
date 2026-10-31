import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {base64url, BUCKET, cleanSegments, filesOrigin, keyUrl, randomCode} from './env'
import {CloudUser, requireUser} from './auth'
import {contentTypeFor, putStreamed, uploadSize} from './uploads'
import {grantFolder} from './appFolders'

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
 *   PUT    /api/v1/drive/files?folder=<id>&name=<name>   body: the file → a new item with that one file
 *   POST   /api/v1/drive/items {name, folder?, entry?}   → an empty item, for a folder upload (then PUT each file)
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

export type Visibility = 'private' | 'link'
const VISIBILITIES: Visibility[] = ['private', 'link']

const GB = 1024 * 1024 * 1024
/** Drive quota per role (sum of file sizes in d/). */
export const DRIVE_QUOTA: Record<CloudUser['role'], number> = {member: 1 * GB, staff: 50 * GB, admin: 50 * GB}

const SIGN_DEFAULT_SECONDS = 60 * 60
const SIGN_MAX_SECONDS = 7 * 24 * 60 * 60
/** Changing visibility or the id rewrites each file of the item (R2 has no metadata update or rename). */
const ITEM_FILES_MAX = 500
const LIST_MAX = 1000
const ROOT = ''

interface Folder {id: string, name: string, parent_id: string}
interface Item {id: string, name: string, folder_id: string, entry: string | null, visibility: Visibility, size: number, files_count: number, created: string, updated: string}
const ITEM_COLUMNS = 'id, name, folder_id, entry, visibility, size, files_count, created, updated'

const json = <T>(c: Context<CloudEnv>) => c.req.json<T>().catch(() => ({} as Partial<T>))
const db = (c: Context<CloudEnv>) => c.env.PRIMARY_DB

/** A name for a folder or an item: any language, no `/`, `\` or control characters, 1 to 255 bytes. */
function label(name: unknown): string {
    const n = typeof name === 'string' ? name.normalize('NFC').trim() : ''
    if (!n || n === '.' || n === '..' || new TextEncoder().encode(n).length > 255 || /[\p{Cc}\p{Cf}/\\]/u.test(n))
        throw new HTTPException(400, {message: 'name: 1 to 255 bytes, no / \\ or control characters'})
    return n
}

/** The item's base key, `d/<handle>/<id>/`. */
const itemBase = (user: CloudUser, id: string) => `d/${user.username}/${id}/`
const itemOut = (c: Context<CloudEnv>, user: CloudUser, item: Item) =>
    ({...item, url: keyUrl(filesOrigin(c.env, new URL(c.req.url).origin), itemBase(user, item.id) + (item.entry ?? ''))})

// ---- folders and scope ----

/** The folders from the root down to `id`, inclusive ([] for the root), or 404. One recursive query. */
async function chain(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Folder[]> {
    if (id === ROOT) return []
    const {results} = await db(c).prepare(`WITH RECURSIVE up(id, name, parent_id, depth) AS (
            SELECT id, name, parent_id, 0 FROM drive_folders WHERE id = ?1 AND owner_id = ?2
            UNION ALL SELECT f.id, f.name, f.parent_id, up.depth + 1 FROM drive_folders f JOIN up ON f.id = up.parent_id AND f.owner_id = ?2 WHERE up.depth < 64)
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

/** 409 when the folder already has a folder or an item with that name (a path must name one thing). */
async function assertFree(c: Context<CloudEnv>, user: CloudUser, folder: string, name: string, except?: string) {
    const taken = await db(c).prepare(`SELECT id FROM drive_folders WHERE owner_id = ?1 AND parent_id = ?2 AND name = ?3 AND id != ?4
            UNION ALL SELECT id FROM drive_items WHERE owner_id = ?1 AND folder_id = ?2 AND name = ?3 AND id != ?4 LIMIT 1`)
        .bind(user.id, folder, name, except ?? '').first()
    if (taken) throw new HTTPException(409, {message: `'${name}' exists in this folder`})
}

/** `name`, or `name (2).ext`, `name (3).ext`…: the first one free in the folder. */
async function freeName(c: Context<CloudEnv>, user: CloudUser, folder: string, name: string): Promise<string> {
    const dot = name.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    for (let i = 1; i < 100; i++) {
        const n = i === 1 ? name : `${stem} (${i})${ext}`
        try {
            await assertFree(c, user, folder, n)
            return n
        } catch (e) {
            if (!(e instanceof HTTPException) || e.status !== 409) throw e
        }
    }
    throw new HTTPException(409, {message: `too many items named '${name}' here`})
}

async function folderOf(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Folder> {
    const f = await db(c).prepare('SELECT id, name, parent_id FROM drive_folders WHERE id = ? AND owner_id = ?').bind(id, user.id).first<Folder>()
    if (!f) throw new HTTPException(404, {message: 'no such folder'})
    return f
}

/** The user's item, or 404; for an app key only inside its folder. */
async function itemOf(c: Context<CloudEnv>, user: CloudUser, id: string): Promise<Item> {
    const it = await db(c).prepare(`SELECT ${ITEM_COLUMNS} FROM drive_items WHERE id = ? AND owner_id = ?`).bind(id, user.id).first<Item>()
    if (!it) throw new HTTPException(404, {message: 'no such item'})
    await scopedChain(c, user, it.folder_id)
    return it
}

/**
 * Where a request starts: an app key's folder (made again if the user deleted it, src/appFolders.ts), else the root.
 * Every drive route calls it first, so `user.scope` is a folder that exists when the scope checks run.
 */
async function startFolder(c: Context<CloudEnv>, user: CloudUser): Promise<string> {
    if (!user.scope || user.scope === '*' || !user.link) return ROOT
    if (!checked.has(user)) {
        user.scope = await grantFolder(c, user.id, user.link)
        checked.add(user)
    }
    return user.scope === '*' ? ROOT : user.scope
}
const checked = new WeakSet<CloudUser>()

/** Creates the folder `name` under `parent` (the folder made for an app on connect too, marked with `app`). */
export async function createFolder(c: Context<CloudEnv>, ownerId: string, parent: string, name: string, app?: string): Promise<Folder> {
    const id = randomCode(12)
    await db(c).prepare('INSERT INTO drive_folders (id, owner_id, parent_id, name, app) VALUES (?, ?, ?, ?, ?)').bind(id, ownerId, parent, name, app ?? null).run()
    return {id, name, parent_id: parent}
}

// ---- files ----

/** The bytes of the user's drive files, and of the one at `key` (an overwrite counts its new size only). */
async function driveUsage(c: Context<CloudEnv>, userId: string, key = ''): Promise<{used: number, old: number}> {
    const r = await db(c).prepare(`SELECT COALESCE(SUM(size), 0) AS used, COALESCE(SUM(CASE WHEN path = ?1 THEN size END), 0) AS old
            FROM files WHERE owner_id = ?2 AND prefix = 'd' AND deleted_at IS NULL`).bind(key, userId).first<{used: number, old: number}>()
    return {used: r?.used ?? 0, old: r?.old ?? 0}
}

/** Before writing a file: the quota (an overwrite counts its new size only). writeFile checks the total again after. */
async function checkQuota(c: Context<CloudEnv>, user: CloudUser, key: string, size: number) {
    const {used, old} = await driveUsage(c, user.id, key)
    const quota = DRIVE_QUOTA[user.role]
    if (used - old + size > quota)
        throw new HTTPException(413, {message: `drive quota: ${quota / GB} GB (${Math.round(used / 1024 / 1024)} MB used)`})
}

const updateCounts = (c: Context<CloudEnv>, id: string, entry: string | null) => db(c).prepare(`UPDATE drive_items SET entry = COALESCE(entry, ?1),
        size = (SELECT COALESCE(SUM(size), 0) FROM files WHERE item_id = ?2 AND deleted_at IS NULL),
        files_count = (SELECT COUNT(*) FROM files WHERE item_id = ?2 AND deleted_at IS NULL) WHERE id = ?2`).bind(entry, id)

/** Streams the request body into the item as `rel`, registers it, and updates the item's size and count. */
async function writeFile(c: Context<CloudEnv>, user: CloudUser, item: Item, rel: string) {
    const segs = cleanSegments(rel)
    if (!segs) throw new HTTPException(400, {message: 'bad file path (no \\ ? # %, control characters or dot files)'})
    rel = segs.join('/')
    const key = itemBase(user, item.id) + rel
    const size = uploadSize(c)
    await checkQuota(c, user, key, size)
    const body = c.req.raw.body
    if (!body) throw new HTTPException(400, {message: 'empty body'})
    const contentType = contentTypeFor(key, c.req.header('content-type'))
    const {stored, sha256} = await putStreamed(c.env.CLOUD_BUCKET, key, body, size, {
        httpMetadata: {contentType},
        customMetadata: {owner: user.id, item: item.id, visibility: item.visibility},
    })
    if (!stored) throw new HTTPException(409, {message: 'the file was written by another request at the same time; retry'})
    await db(c).batch([
        db(c).prepare(`INSERT INTO files (id, owner_id, bucket, prefix, path, size, sha256, content_type, item_id) VALUES (?, ?, ?, 'd', ?, ?, ?, ?, ?)
                ON CONFLICT (bucket, path) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, content_type = excluded.content_type,
                deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL`)
            .bind(crypto.randomUUID(), user.id, BUCKET, key, size, sha256, contentType, item.id),
        updateCounts(c, item.id, rel),
    ])
    // While the file streamed, the item may have been deleted, got a new id or another visibility. Those routes change
    // D1 first and then only touch the rows they changed, so the row of the item now says what this object must be.
    const now = await db(c).prepare('SELECT visibility FROM drive_items WHERE id = ?').bind(item.id).first<{visibility: Visibility}>()
    if (!now) {
        await dropFile(c, key, item.id) // gone, unless the new id took this row along (then it copies the object)
        throw new HTTPException(409, {message: 'the item was deleted or got a new id during the upload'})
    }
    if (now.visibility !== item.visibility) await setVisibility(c, key, now.visibility)
    // Uploads at the same time all pass checkQuota; the total after them is what counts.
    const {used} = await driveUsage(c, user.id)
    if (used > DRIVE_QUOTA[user.role]) {
        await dropFile(c, key, item.id)
        await updateCounts(c, item.id, null).run()
        throw new HTTPException(413, {message: `drive quota: ${DRIVE_QUOTA[user.role] / GB} GB (other uploads at the same time used it)`})
    }
    return {path: rel, size, sha256}
}

/** Deletes a file this request wrote, if its row is still that item's (a new id moves rows, and their objects with them). */
async function dropFile(c: Context<CloudEnv>, key: string, itemId: string) {
    const r = await db(c).prepare('DELETE FROM files WHERE bucket = ? AND path = ? AND item_id = ?').bind(BUCKET, key, itemId).run()
    if (r.meta.changes) await c.env.CLOUD_BUCKET.delete(key)
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
    const {results} = await db(c).prepare(`SELECT path, size, content_type FROM files WHERE item_id = ? AND deleted_at IS NULL ORDER BY path LIMIT ${ITEM_FILES_MAX + 1}`)
        .bind(item.id).all<{path: string, size: number, content_type: string}>()
    return results
}

async function rewritableFiles(c: Context<CloudEnv>, item: Item) {
    const files = await itemFiles(c, item)
    if (files.length > ITEM_FILES_MAX) throw new HTTPException(413, {message: `items of more than ${ITEM_FILES_MAX} files cannot be rewritten yet`})
    return files
}

// ---- signed URLs ----

async function hmac(env: CloudflareBindings, data: string): Promise<string> {
    if (!env.FILES_URL_SECRET) throw new HTTPException(500, {message: 'FILES_URL_SECRET is not set'})
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.FILES_URL_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
    return base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

/** `t/<exp>.<sig>/d/<handle>/<item>/`: until `exp` (unix seconds), every file of the item. */
export async function signItem(env: CloudflareBindings, base: string, exp: number): Promise<string> {
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
        const [folders, items] = await db(c).batch([
            db(c).prepare('SELECT id, name, parent_id FROM drive_folders WHERE owner_id = ? AND parent_id = ? ORDER BY name LIMIT ?').bind(user.id, id, LIST_MAX),
            db(c).prepare(`SELECT ${ITEM_COLUMNS} FROM drive_items WHERE owner_id = ? AND folder_id = ? ORDER BY name LIMIT ?`).bind(user.id, id, LIST_MAX),
        ]) as [D1Result<Folder>, D1Result<Item>]
        return c.json({
            folder: id === ROOT ? {id: ROOT, name: '', parent: null} : folderOut(path[path.length - 1]),
            path: path.map(f => ({id: f.id, name: f.name})),
            folders: folders.results.map(folderOut),
            items: items.results.map(it => itemOut(c, user, it)),
        })
    })

    app.get('/api/v1/drive/resolve', async (c) => {
        const user = await requireUser(c)
        const parts = (c.req.query('path') || '').normalize('NFC').split('/').filter(Boolean)
        if (!parts.length) return c.json({folder: {id: ROOT, name: '', parent: null}})
        // down the folders by name, as far as they go: one query
        const deepest = await db(c).prepare(`WITH RECURSIVE walk(id, depth) AS (SELECT '', 0
                UNION ALL SELECT f.id, walk.depth + 1 FROM drive_folders f JOIN walk ON f.parent_id = walk.id
                WHERE f.owner_id = ?1 AND walk.depth < ?3 AND f.name = json_extract(?2, '$[' || walk.depth || ']'))
            SELECT id, depth FROM walk ORDER BY depth DESC LIMIT 1`).bind(user.id, JSON.stringify(parts), parts.length).first<{id: string, depth: number}>()
        const at = deepest ?? {id: ROOT, depth: 0}
        if (at.depth === parts.length) {
            await scopedChain(c, user, at.id)
            return c.json({folder: folderOut(await folderOf(c, user, at.id))})
        }
        if (at.depth === parts.length - 1) {
            const it = await db(c).prepare('SELECT id FROM drive_items WHERE owner_id = ? AND folder_id = ? AND name = ?').bind(user.id, at.id, parts[parts.length - 1]).first<{id: string}>()
            if (it) return c.json({item: itemOut(c, user, await itemOf(c, user, it.id))})
        }
        throw new HTTPException(404, {message: 'not found'})
    })

    app.post('/api/v1/drive/folders', async (c) => {
        const user = await requireUser(c)
        const body = await json<{name?: string, parent?: string}>(c)
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
        const body = await json<{name?: string, parent?: string}>(c)
        const name = body.name !== undefined ? label(body.name) : f.name
        const parent = body.parent ?? f.parent_id
        if (parent !== f.parent_id && (await scopedChain(c, user, parent)).some(x => x.id === f.id))
            throw new HTTPException(400, {message: 'a folder cannot move into itself'})
        await assertFree(c, user, parent, name, f.id)
        await db(c).prepare('UPDATE drive_folders SET name = ?, parent_id = ? WHERE id = ?').bind(name, parent, f.id).run()
        return c.json(folderOut({id: f.id, name, parent_id: parent}))
    })

    app.delete('/api/v1/drive/folders/:id', async (c) => {
        const user = await requireUser(c)
        const f = await folderOf(c, user, c.req.param('id'))
        await scopedChain(c, user, f.id)
        if (user.scope === f.id) throw new HTTPException(403, {message: 'an app cannot delete its own folder'})
        const inside = await db(c).prepare('SELECT 1 FROM drive_folders WHERE parent_id = ?1 AND owner_id = ?2 UNION ALL SELECT 1 FROM drive_items WHERE folder_id = ?1 AND owner_id = ?2 LIMIT 1')
            .bind(f.id, user.id).first()
        if (inside) throw new HTTPException(409, {message: 'the folder is not empty'})
        await db(c).prepare('DELETE FROM drive_folders WHERE id = ?').bind(f.id).run()
        return c.json({deleted: f.id})
    })

    // A new item with one file: the usual save. The name is the label; the stored file name is the same, made safe.
    app.put('/api/v1/drive/files', async (c) => {
        const user = await requireUser(c)
        const start = await startFolder(c, user)
        const folder = c.req.query('folder') ?? start
        await scopedChain(c, user, folder)
        const name = await freeName(c, user, folder, label(c.req.query('name')))
        const rel = name.replace(/[\\?#%]/g, '_').replace(/^\./, '_')
        const item: Item = {id: randomCode(16), name, folder_id: folder, entry: null, visibility: 'private', size: 0, files_count: 0, created: '', updated: ''}
        await db(c).prepare('INSERT INTO drive_items (id, owner_id, folder_id, name) VALUES (?, ?, ?, ?)').bind(item.id, user.id, folder, name).run()
        try {
            await writeFile(c, user, item, rel)
        } catch (e) {
            await db(c).prepare('DELETE FROM drive_items WHERE id = ?').bind(item.id).run()
            throw e
        }
        return c.json(itemOut(c, user, await itemOf(c, user, item.id)), 201)
    })

    app.post('/api/v1/drive/items', async (c) => {
        const user = await requireUser(c)
        const body = await json<{name?: string, folder?: string, entry?: string}>(c)
        const start = await startFolder(c, user)
        const folder = body.folder ?? start
        await scopedChain(c, user, folder)
        const name = await freeName(c, user, folder, label(body.name))
        let entry: string | null = null
        if (body.entry !== undefined) {
            entry = cleanSegments(String(body.entry))?.join('/') ?? null
            if (!entry) throw new HTTPException(400, {message: 'bad entry'})
        }
        const id = randomCode(16)
        await db(c).prepare('INSERT INTO drive_items (id, owner_id, folder_id, name, entry) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, folder, name, entry).run()
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
        const body = await json<{name?: string, folder?: string, visibility?: Visibility, entry?: string}>(c)
        const name = body.name !== undefined ? label(body.name) : item.name
        const folder = body.folder ?? item.folder_id
        if (folder !== item.folder_id) await scopedChain(c, user, folder)
        if (name !== item.name || folder !== item.folder_id) await assertFree(c, user, folder, name, item.id)
        if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) throw new HTTPException(400, {message: `visibility is one of ${VISIBILITIES.join(', ')}`})
        const visibility = body.visibility ?? item.visibility
        let entry = item.entry
        if (body.entry !== undefined) {
            entry = cleanSegments(String(body.entry))?.join('/') ?? null
            if (!entry) throw new HTTPException(400, {message: 'bad entry'})
        }
        if (body.visibility !== undefined) await rewritableFiles(c, item) // too many files: refused before anything changes
        // D1 first: an upload that streams meanwhile reads it after registering its file (writeFile)
        await db(c).prepare('UPDATE drive_items SET name = ?, folder_id = ?, visibility = ?, entry = ? WHERE id = ?').bind(name, folder, visibility, entry, item.id).run()
        // then each file that does not have it yet (sending the same visibility again repairs a change cut short)
        if (body.visibility !== undefined) for (const f of await itemFiles(c, item)) await setVisibility(c, f.path, visibility)
        return c.json(itemOut(c, user, await itemOf(c, user, item.id)))
    })

    // A new id for the item: its files are copied under the new id and the old ones deleted, so every URL of the item
    // given out before (links, signed URLs) stops working. Name, folder and visibility stay.
    app.post('/api/v1/drive/items/:id/new-id', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        await rewritableFiles(c, item) // too many files: refused before anything changes
        const oldBase = itemBase(user, item.id), id = randomCode(16), newBase = itemBase(user, id)
        // D1 first, in one batch: the new item takes the rows, the old one is gone. An upload to the old id that
        // registers after this cleans up after itself (writeFile); one that registered before is moved here.
        const [, moved] = await db(c).batch([
            db(c).prepare(`INSERT INTO drive_items (id, owner_id, folder_id, name, entry, visibility, size, files_count, created)
                    SELECT ?, owner_id, folder_id, name || ' ', entry, visibility, size, files_count, created FROM drive_items WHERE id = ?`).bind(id, item.id),
            db(c).prepare(`UPDATE files SET item_id = ?1, path = ?2 || substr(path, ?3) WHERE item_id = ?4 RETURNING path`).bind(id, newBase, oldBase.length + 1, item.id),
            db(c).prepare('DELETE FROM drive_items WHERE id = ?').bind(item.id),
            db(c).prepare('UPDATE drive_items SET name = ? WHERE id = ?').bind(item.name, id),
        ]) as D1Result<{path: string}>[]
        const olds = moved.results.map(r => oldBase + r.path.slice(newBase.length))
        for (const old of olds) {
            const obj = await c.env.CLOUD_BUCKET.get(old)
            if (obj) await c.env.CLOUD_BUCKET.put(newBase + old.slice(oldBase.length), obj.body, {httpMetadata: obj.httpMetadata, customMetadata: {...obj.customMetadata, item: id}})
        }
        for (let i = 0; i < olds.length; i += 1000) await c.env.CLOUD_BUCKET.delete(olds.slice(i, i + 1000))
        return c.json(itemOut(c, user, await itemOf(c, user, id)))
    })

    app.delete('/api/v1/drive/items/:id', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        // D1 first (an upload that registers after this cleans up after itself, see writeFile), then the objects of the rows
        const [rows] = await db(c).batch([
            db(c).prepare('DELETE FROM files WHERE item_id = ? RETURNING path').bind(item.id),
            db(c).prepare('DELETE FROM drive_items WHERE id = ?').bind(item.id),
        ]) as D1Result<{path: string}>[]
        const paths = rows.results.map(r => r.path)
        for (let i = 0; i < paths.length; i += 1000) await c.env.CLOUD_BUCKET.delete(paths.slice(i, i + 1000))
        return c.json({deleted: item.id})
    })

    app.post('/api/v1/drive/items/:id/sign', async (c) => {
        const user = await requireUser(c)
        const item = await itemOf(c, user, c.req.param('id'))
        const ttl = (await json<{ttl?: number}>(c)).ttl ?? SIGN_DEFAULT_SECONDS
        if (!Number.isInteger(ttl) || ttl <= 0 || ttl > SIGN_MAX_SECONDS) throw new HTTPException(400, {message: `ttl is seconds, 1 to ${SIGN_MAX_SECONDS}`})
        const exp = Math.floor(Date.now() / 1000) + ttl
        return c.json({url: keyUrl(filesOrigin(c.env, new URL(c.req.url).origin), await signItem(c.env, itemBase(user, item.id), exp)), expires_at: new Date(exp * 1000).toISOString()})
    })
}
