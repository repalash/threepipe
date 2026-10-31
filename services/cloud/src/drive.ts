import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {base64url, BUCKET, cleanSegments, filesOrigin, likePrefix, randomCode} from './env'
import {assertScope, CloudUser, isStaff, requireUser} from './auth'

/**
 * The drive: `d/<handle>/…`, files that belong to one user (saved by apps like the editor, or uploaded).
 *
 * - Private by default: only the owner reads them, through the API (`GET /api/v1/uploads/d/…`) or a signed URL.
 * - `public`: served at `files…/d/<handle>/<path>`.
 * - Share links: `files…/f/<id>/…` for a file or a folder, until the link is deleted.
 *
 * Serving never reads the database: visibility is on the object, a share link is a small pointer object `f/<id>`,
 * and a signed URL carries its own HMAC (src/files.ts).
 */

export type Visibility = 'private' | 'public'
const VISIBILITIES: Visibility[] = ['private', 'public']

const GB = 1024 * 1024 * 1024
/** Drive quota per role (sum of file sizes in d/). */
export const DRIVE_QUOTA: Record<CloudUser['role'], number> = {member: 1 * GB, staff: 50 * GB, admin: 50 * GB}

const SIGN_DEFAULT_SECONDS = 60 * 60
const SIGN_MAX_SECONDS = 7 * 24 * 60 * 60

const json = <T>(c: Context<CloudEnv>) => c.req.json<T>().catch(() => ({} as Partial<T>))

/** The drive path a request names (`d/<handle>/…`, a folder ends with `/`), checked against the user and an app key's folder. */
function drivePath(user: CloudUser, path: unknown): string {
    if (typeof path !== 'string') throw new HTTPException(400, {message: 'path: d/<your username>/<file or folder/>'})
    const folder = path.endsWith('/')
    const segs = cleanSegments(folder ? path.slice(0, -1) : path)
    if (!segs || segs[0] !== 'd' || segs.length < (folder ? 2 : 3)) throw new HTTPException(400, {message: 'path: d/<your username>/<file or folder/>'})
    if (segs[1] !== user.username) throw new HTTPException(403, {message: `your drive is d/${user.username}/`})
    const p = segs.join('/') + (folder ? '/' : '')
    assertScope(user, p)
    return p
}

/** Before a drive upload: the quota (an overwrite counts its new size only) and the visibility of the new file. */
export async function checkDrive(c: Context<CloudEnv>, user: CloudUser, key: string, size: number): Promise<Visibility> {
    const asked = c.req.query('visibility') as Visibility | undefined
    if (asked !== undefined && !VISIBILITIES.includes(asked)) throw new HTTPException(400, {message: `visibility is one of ${VISIBILITIES.join(', ')}`})
    const r = await c.env.PRIMARY_DB.prepare(`SELECT COALESCE(SUM(size), 0) AS used, COALESCE(SUM(CASE WHEN path = ? THEN size END), 0) AS old,
            MAX(CASE WHEN path = ? THEN visibility END) AS vis FROM files WHERE owner_id = ? AND prefix = 'd' AND deleted_at IS NULL`)
        .bind(key, key, user.id).first<{used: number, old: number, vis: Visibility | null}>()
    const quota = DRIVE_QUOTA[user.role]
    if ((r?.used ?? 0) - (r?.old ?? 0) + size > quota)
        throw new HTTPException(413, {message: `drive quota: ${quota / GB} GB (${Math.round((r?.used ?? 0) / 1024 / 1024)} MB used)`})
    return asked ?? r?.vis ?? 'private'
}

/** The owner's own drive file, through the API (Authorization header or cookie). */
export async function driveRead(c: Context<CloudEnv>) {
    const user = await requireUser(c)
    const key = drivePath(user, 'd/' + decodeURIComponent(c.req.param('path') || ''))
    const obj = await c.env.CLOUD_BUCKET.get(key)
    if (!obj || obj.customMetadata?.owner !== user.id || obj.customMetadata?.deleted) throw new HTTPException(404, {message: 'not found'})
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('etag', obj.httpEtag)
    headers.set('content-length', String(obj.size))
    headers.set('cache-control', 'private, no-store')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('content-security-policy', 'sandbox')
    return new Response(obj.body, {headers})
}

/**
 * `PATCH /api/v1/uploads/d/<path>` `{visibility?, move_to?}`: make a file public or private, or move/rename it.
 * R2 cannot change metadata or rename in place, so both copy the object (streamed).
 */
export async function drivePatch(c: Context<CloudEnv>) {
    const user = await requireUser(c)
    const key = drivePath(user, 'd/' + decodeURIComponent(c.req.param('path') || ''))
    if (key.endsWith('/')) throw new HTTPException(400, {message: 'one file at a time'})
    const body = await json<{visibility?: Visibility, move_to?: string}>(c)
    if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) throw new HTTPException(400, {message: `visibility is one of ${VISIBILITIES.join(', ')}`})
    const to = body.move_to !== undefined ? drivePath(user, body.move_to) : key
    if (to.endsWith('/')) throw new HTTPException(400, {message: 'move_to is a file path'})
    const db = c.env.PRIMARY_DB
    const row = await db.prepare(`SELECT id, visibility FROM files WHERE bucket = ? AND path = ? AND owner_id = ? AND deleted_at IS NULL`)
        .bind(BUCKET, key, user.id).first<{id: string, visibility: Visibility | null}>()
    if (!row) throw new HTTPException(404, {message: 'not found'})
    const visibility = body.visibility ?? row.visibility ?? 'private'
    if (to === key && visibility === row.visibility) return c.json({path: key, visibility})
    if (to !== key && await db.prepare('SELECT 1 FROM files WHERE bucket = ? AND path = ? AND deleted_at IS NULL').bind(BUCKET, to).first())
        throw new HTTPException(409, {message: `${to} exists; delete it first`})

    const obj = await c.env.CLOUD_BUCKET.get(key)
    if (!obj) throw new HTTPException(404, {message: 'not found'})
    await c.env.CLOUD_BUCKET.put(to, obj.body, {httpMetadata: obj.httpMetadata, customMetadata: {...obj.customMetadata, visibility}})
    if (to !== key) {
        await c.env.CLOUD_BUCKET.delete(key)
        // a deleted row at the new path (from an earlier delete by staff) would block the update on the unique index
        await db.prepare('DELETE FROM files WHERE bucket = ? AND path = ? AND deleted_at IS NOT NULL').bind(BUCKET, to).run()
    }
    await db.prepare('UPDATE files SET path = ?, visibility = ? WHERE id = ?').bind(to, visibility, row.id).run()
    return c.json({path: to, visibility, url: `${filesOrigin(c.env, new URL(c.req.url).origin)}/${to}`})
}

/** The owner deletes a drive file: the object and its registry row are removed (no tombstone). */
export async function driveDelete(c: Context<CloudEnv>, key: string) {
    await c.env.CLOUD_BUCKET.delete(key)
    await c.env.PRIMARY_DB.prepare('DELETE FROM files WHERE bucket = ? AND path = ?').bind(BUCKET, key).run()
    return c.json({deleted: key})
}

async function hmac(env: CloudflareBindings, data: string): Promise<string> {
    if (!env.FILES_URL_SECRET) throw new HTTPException(500, {message: 'FILES_URL_SECRET is not set'})
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.FILES_URL_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
    return base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
}

/**
 * Signed URL path `t/<exp>.<depth>.<sig>/<path>`: valid until `exp` (unix seconds) for the file, or the folder, made of
 * the first `depth` segments of the path. A signed folder keeps relative links working (a .gltf next to its .bin).
 */
export async function signPath(env: CloudflareBindings, path: string, exp: number): Promise<string> {
    const depth = path.replace(/\/$/, '').split('/').length
    return `t/${exp}.${depth}.${await hmac(env, `${exp}.${path}`)}/${path}`
}

/** Whether `token` (the `<exp>.<depth>.<sig>` of a signed URL) allows reading `key`. */
export async function verifySigned(env: CloudflareBindings, token: string, key: string): Promise<boolean> {
    const [e, d, sig] = token.split('.')
    const exp = Number(e), depth = Number(d)
    if (!sig || !Number.isInteger(exp) || exp * 1000 < Date.now() || !Number.isInteger(depth) || depth < 2) return false
    const segs = key.split('/')
    if (depth > segs.length) return false
    const signed = depth === segs.length ? key : segs.slice(0, depth).join('/') + '/'
    const expected = new TextEncoder().encode(await hmac(env, `${exp}.${signed}`))
    const given = new TextEncoder().encode(sig)
    return expected.length === given.length && crypto.subtle.timingSafeEqual(expected, given)
}

/**
 *   GET    /api/v1/drive?folder=d/<handle>/…/&after=<path>   → {files: [{path, size, content_type, visibility, updated}], next}
 *   POST   /api/v1/drive/sign {path, ttl?}                     → {url, expires_at}   (ttl in seconds, default 1 h, max 7 days)
 *   POST   /api/v1/drive-links {path}                          → {id, path, url}     (a file, or a folder ending with /)
 *   DELETE /api/v1/drive-links/<id>
 * Listing links: /api/v1/table/drive_links/… (teenybase, owner only).
 */
export function driveRoutes(app: Hono<CloudEnv>) {
    app.get('/api/v1/drive', async (c) => {
        const user = await requireUser(c)
        const folder = drivePath(user, c.req.query('folder') || user.scope || `d/${user.username}/`)
        if (!folder.endsWith('/')) throw new HTTPException(400, {message: 'folder ends with /'})
        const after = c.req.query('after') || ''
        const limit = 1000
        const {results} = await c.env.PRIMARY_DB.prepare(`SELECT path, size, content_type, visibility, updated FROM files
                WHERE owner_id = ? AND prefix = 'd' AND deleted_at IS NULL AND path LIKE ? ESCAPE '\\' AND path > ? ORDER BY path LIMIT ?`)
            .bind(user.id, likePrefix(folder), after, limit + 1).all()
        const more = results.length > limit
        const files = results.slice(0, limit)
        return c.json({files, next: more ? (files[files.length - 1] as {path: string}).path : null})
    })

    app.post('/api/v1/drive/sign', async (c) => {
        const user = await requireUser(c)
        const body = await json<{path?: string, ttl?: number}>(c)
        const path = drivePath(user, body.path)
        const ttl = body.ttl ?? SIGN_DEFAULT_SECONDS
        if (!Number.isInteger(ttl) || ttl <= 0 || ttl > SIGN_MAX_SECONDS) throw new HTTPException(400, {message: `ttl is seconds, 1 to ${SIGN_MAX_SECONDS}`})
        const exp = Math.floor(Date.now() / 1000) + ttl
        return c.json({url: `${filesOrigin(c.env, new URL(c.req.url).origin)}/${await signPath(c.env, path, exp)}`, expires_at: new Date(exp * 1000).toISOString()})
    })

    app.post('/api/v1/drive-links', async (c) => {
        const user = await requireUser(c)
        const path = drivePath(user, (await json<{path?: string}>(c)).path)
        const id = randomCode(16)
        await c.env.CLOUD_BUCKET.put(`f/${id}`, '', {customMetadata: {target: path, owner: user.id}})
        await c.env.PRIMARY_DB.prepare('INSERT INTO drive_links (id, owner_id, path) VALUES (?, ?, ?)').bind(id, user.id, path).run()
        // a file link ends with the file name, so loaders that look at the extension work
        const tail = path.endsWith('/') ? '' : path.split('/').pop()
        return c.json({id, path, url: `${filesOrigin(c.env, new URL(c.req.url).origin)}/f/${id}/${tail}`})
    })

    app.delete('/api/v1/drive-links/:id', async (c) => {
        const user = await requireUser(c)
        const id = c.req.param('id')
        const row = await c.env.PRIMARY_DB.prepare('SELECT owner_id, path FROM drive_links WHERE id = ?').bind(id).first<{owner_id: string, path: string}>()
        if (!row || row.owner_id !== user.id && !isStaff(user)) throw new HTTPException(404, {message: 'not found'})
        assertScope(user, row.path)
        await c.env.CLOUD_BUCKET.delete(`f/${id}`)
        await c.env.PRIMARY_DB.prepare('DELETE FROM drive_links WHERE id = ?').bind(id).run()
        return c.json({deleted: id})
    })
}
