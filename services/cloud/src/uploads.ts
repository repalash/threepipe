import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {filesOrigin, hex} from './env'
import {CloudUser, isStaff, requireUser} from './auth'

/** Per file, through the Worker. Bigger builds are split into files anyway (one PUT per file). */
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024
const DAY = 24 * 60 * 60 * 1000
const SHARE_DEFAULT_DAYS = 7
const SHARE_MAX_DAYS = 30
const BUILD_DAYS = 30
const BUCKET = 'cloud'

export type Prefix = 's' | 'a' | 'b' | 'p'
const PREFIXES: Prefix[] = ['s', 'a', 'b', 'p']

const MIME: Record<string, string> = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wasm: 'application/wasm', pdf: 'application/pdf', zip: 'application/zip',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', hdr: 'application/octet-stream', exr: 'application/octet-stream',
    ktx2: 'image/ktx2', woff2: 'font/woff2',
}

export function contentTypeFor(path: string, given?: string | null): string {
    const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
    return MIME[ext] || (given && !given.startsWith('application/octet-stream') && !given.startsWith('application/x-www-form-urlencoded') ? given : 'application/octet-stream')
}

/** Relative path segments without empty, '.', '..' or dotfile parts. */
function cleanSegments(path: string): string[] | null {
    if (!path || path.length > 512) return null
    const segs = path.split('/')
    if (segs.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || !/^[\w\-.()+@ ]+$/.test(s))) return null
    return segs
}

interface Target {
    key: string
    /** the part of the key that belongs to one owner: `s/<slug>`, `b/<repo>/<ref>`, `p/<name>`; none for `a/` */
    scope?: string
    expiresAt: string | null
    sha256?: string
}

function target(prefix: Prefix, segs: string[], c: Context<CloudEnv>): Target {
    const now = Date.now()
    switch (prefix) {
    case 's': {
        if (segs.length < 2) throw new HTTPException(400, {message: 's/<slug>/<file path>'})
        const days = c.req.query('ttl') ? Number(c.req.query('ttl')) : SHARE_DEFAULT_DAYS
        if (!Number.isFinite(days) || days <= 0 || days > SHARE_MAX_DAYS) throw new HTTPException(400, {message: `ttl is a number of days, 1 to ${SHARE_MAX_DAYS}`})
        return {key: 's/' + segs.join('/'), scope: 's/' + segs[0], expiresAt: new Date(now + days * DAY).toISOString()}
    }
    case 'b':
        if (segs.length < 3) throw new HTTPException(400, {message: 'b/<repo>/<pr-123 or sha>/<file path>'})
        return {key: 'b/' + segs.join('/'), scope: `b/${segs[0]}/${segs[1]}`, expiresAt: new Date(now + BUILD_DAYS * DAY).toISOString()}
    case 'p':
        if (segs.length < 1) throw new HTTPException(400, {message: 'p/<name>/<file path>'})
        return {key: 'p/' + segs.join('/'), scope: 'p/' + segs[0], expiresAt: null}
    case 'a': {
        if (segs.length !== 1) throw new HTTPException(400, {message: 'a/<file name>'})
        const sha = (c.req.header('x-content-sha256') || '').toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(sha)) throw new HTTPException(400, {message: 'send x-content-sha256: <hex sha256 of the file>'})
        return {key: `a/${sha.slice(0, 8)}/${segs[0]}`, expiresAt: null, sha256: sha}
    }
    }
}

/** 403 when another user already has files in this scope. */
async function checkScope(env: CloudflareBindings, scope: string, user: CloudUser) {
    const other = await env.PRIMARY_DB.prepare('SELECT owner_id FROM files WHERE bucket = ? AND (path = ? OR path LIKE ?) AND owner_id != ? AND deleted_at IS NULL LIMIT 1')
        .bind(BUCKET, scope, scope.replace(/[%_]/g, '\\$&') + '/%', user.id).first()
    if (other) throw new HTTPException(403, {message: `'${scope}' belongs to another user`})
}

/**
 * Uploads (`PUT`) and deletes (`DELETE`) of files in the cloud bucket. Keys are the URL paths; the owner and expiry are
 * also on the R2 object (src/files.ts serves without a database read). The `files` table is the registry.
 */
export function uploadRoutes(app: Hono<CloudEnv>) {
    app.put('/api/v1/uploads/:prefix/:path{.+}', async (c) => {
        const user = await requireUser(c)
        const prefix = c.req.param('prefix') as Prefix
        if (!PREFIXES.includes(prefix)) throw new HTTPException(404, {message: `prefix is one of ${PREFIXES.join(', ')}`})
        const segs = cleanSegments(decodeURIComponent(c.req.param('path')))
        if (!segs) throw new HTTPException(400, {message: 'bad path'})
        const size = Number(c.req.header('content-length'))
        if (!Number.isInteger(size) || size <= 0) throw new HTTPException(411, {message: 'send the file as the request body, with Content-Length'})
        if (size > MAX_UPLOAD_BYTES) throw new HTTPException(413, {message: `max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB per file`})
        const t = target(prefix, segs, c)
        if (t.scope) await checkScope(c.env, t.scope, user)
        const contentType = contentTypeFor(t.key, c.req.header('content-type'))
        const body = c.req.raw.body
        if (!body) throw new HTTPException(400, {message: 'empty body'})

        if (prefix === 'a') {
            const existing = await c.env.CLOUD_BUCKET.head(t.key)
            if (existing) {
                if (existing.customMetadata?.sha256 !== t.sha256) throw new HTTPException(409, {message: 'another file has the same short hash and name; rename the file'})
                return c.json({url: `${filesOrigin(c.env, new URL(c.req.url).origin)}/${t.key}`, path: t.key, size: existing.size, sha256: t.sha256, expires_at: null, existed: true})
            }
        }

        // stream to R2 through a digest: nothing is buffered
        const digest = new crypto.DigestStream('SHA-256')
        const fixed = new FixedLengthStream(size)
        const [toDigest, toR2] = body.tee()
        const digested = toDigest.pipeTo(digest)
        const piped = toR2.pipeTo(fixed.writable)
        const stored = await c.env.CLOUD_BUCKET.put(t.key, fixed.readable, {
            httpMetadata: {contentType},
            customMetadata: {owner: user.id, ...t.expiresAt ? {expires: t.expiresAt} : {}, ...t.sha256 ? {sha256: t.sha256} : {}},
            ...prefix === 'a' ? {onlyIf: new Headers({'if-none-match': '*'})} : {},
        })
        await Promise.all([piped, digested])
        const sha256 = hex(await digest.digest)
        if (!stored) throw new HTTPException(409, {message: 'the file was written by another request at the same time; retry'})
        if (t.sha256 && sha256 !== t.sha256) {
            await c.env.CLOUD_BUCKET.delete(t.key)
            throw new HTTPException(400, {message: 'x-content-sha256 does not match the uploaded bytes'})
        }

        await c.env.PRIMARY_DB.prepare(`INSERT INTO files (id, owner_id, bucket, prefix, path, size, sha256, content_type, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (bucket, path) DO UPDATE SET owner_id = excluded.owner_id, size = excluded.size, sha256 = excluded.sha256, content_type = excluded.content_type,
                expires_at = excluded.expires_at, deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL`)
            .bind(crypto.randomUUID(), user.id, BUCKET, prefix, t.key, size, sha256, contentType, t.expiresAt).run()
        // a new upload to a build keeps the whole build alive
        if (prefix === 'b' && t.scope) {
            await c.env.PRIMARY_DB.prepare('UPDATE files SET expires_at = ? WHERE bucket = ? AND path LIKE ? AND deleted_at IS NULL')
                .bind(t.expiresAt, BUCKET, t.scope.replace(/[%_]/g, '\\$&') + '/%').run()
        }
        return c.json({url: `${filesOrigin(c.env, new URL(c.req.url).origin)}/${t.key}`, path: t.key, size, sha256, expires_at: t.expiresAt})
    })

    app.delete('/api/v1/uploads/:prefix/:path{.+}', async (c) => {
        const user = await requireUser(c)
        const key = `${c.req.param('prefix')}/${decodeURIComponent(c.req.param('path'))}`
        const row = await c.env.PRIMARY_DB.prepare('SELECT owner_id, prefix FROM files WHERE bucket = ? AND path = ? AND deleted_at IS NULL')
            .bind(BUCKET, key).first<{owner_id: string, prefix: Prefix}>()
        if (!row) throw new HTTPException(404, {message: 'not found'})
        // owners delete their s/ b/ p/ files; a/ stays permanent unless staff removes it (copyright, abuse, storage)
        const mayDelete = isStaff(user) || row.owner_id === user.id && row.prefix !== 'a'
        if (!mayDelete) throw new HTTPException(403, {message: row.prefix === 'a' ? 'permanent assets are removed by staff only' : 'not your file'})
        const reason = (c.req.query('reason') || (row.owner_id === user.id ? 'deleted by owner' : 'removed by staff')).slice(0, 200)
        const now = new Date().toISOString()
        // a small tombstone object at the path, so the link answers 410 without a database read
        await c.env.CLOUD_BUCKET.put(key, '', {customMetadata: {deleted: reason, deleted_at: now}})
        await c.env.PRIMARY_DB.prepare('UPDATE files SET deleted_at = ?, deleted_by = ?, deleted_reason = ? WHERE bucket = ? AND path = ?')
            .bind(now, user.id, reason, BUCKET, key).run()
        return c.json({deleted: key, reason})
    })
}
