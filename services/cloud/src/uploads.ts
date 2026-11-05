import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {cleanSegments, fileUrl, hex} from './env'
import {assertScope, CloudUser, isStaff, requireUserAndScope, ScopeRow} from './auth'
import {DAY, SHARE_DEFAULT_DAYS, SHARE_MAX_DAYS, sizeText, UPLOAD_BATCH_BYTES, UPLOAD_BATCH_FILES, UPLOAD_MAX_BYTES} from './limits'

const DAY_MS = DAY * 1000

// the drive (d/) has its own routes: src/drive.ts
type Prefix = 's' | 'a' | 'b' | 'p'
const PREFIXES: Prefix[] = ['s', 'a', 'b', 'p']

const MIME: Record<string, string> = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wasm: 'application/wasm', pdf: 'application/pdf', zip: 'application/zip',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', hdr: 'application/octet-stream', exr: 'application/octet-stream',
    ktx2: 'image/ktx2', woff2: 'font/woff2',
}

export function contentTypeFor(path: string, given?: string | null): string {
    const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
    const type = given?.trim().toLowerCase()
    return MIME[ext] || (type && !type.startsWith('application/octet-stream') && !type.startsWith('application/x-www-form-urlencoded') ? type : 'application/octet-stream')
}

interface Target {
    key: string
    /** the part of the key that belongs to one owner: `s/<slug>`, `b/<repo>/<ref>`, `p/<name>`; none for `a/` */
    scope?: string
    expiresAt: string | null
    sha256?: string
}

/** The part of a key that belongs to one owner: `s/<slug>`, `b/<repo>/<ref>`, `p/<name>`; none for `a/` or a path too short to have one. */
function scopeOf(prefix: Prefix, segs: string[]): string | undefined {
    const n = prefix === 'b' ? 2 : prefix === 'a' ? 0 : 1
    return n && segs.length >= n ? `${prefix}/${segs.slice(0, n).join('/')}` : undefined
}

function target(prefix: Prefix, segs: string[], c: Context<CloudEnv>): Target {
    switch (prefix) {
    case 's': {
        if (segs.length < 2) throw new HTTPException(400, {message: 's/<slug>/<file path>'})
        const days = c.req.query('ttl') ? Number(c.req.query('ttl')) : SHARE_DEFAULT_DAYS
        if (!Number.isFinite(days) || days <= 0 || days > SHARE_MAX_DAYS) throw new HTTPException(400, {message: `ttl is a number of days, 1 to ${SHARE_MAX_DAYS}`})
        return {key: 's/' + segs.join('/'), scope: scopeOf(prefix, segs), expiresAt: new Date(Date.now() + days * DAY_MS).toISOString()}
    }
    case 'b':
        if (segs.length < 3) throw new HTTPException(400, {message: 'b/<repo>/<pr-123 or sha>/<file path>'})
        return {key: 'b/' + segs.join('/'), scope: scopeOf(prefix, segs), expiresAt: null}
    case 'p':
        if (segs.length < 2) throw new HTTPException(400, {message: 'p/<name>/<file path>'})
        return {key: 'p/' + segs.join('/'), scope: scopeOf(prefix, segs), expiresAt: null}
    case 'a': {
        if (segs.length !== 1) throw new HTTPException(400, {message: 'a/<file name>'})
        const sha = (c.req.header('x-content-sha256') || '').toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(sha)) throw new HTTPException(400, {message: 'send x-content-sha256: <hex sha256 of the file>'})
        return {key: `a/${sha.slice(0, 8)}/${segs[0]}`, expiresAt: null, sha256: sha}
    }
    }
}

/** `<prefix>/<path>` of a request to /api/v1/uploads/:prefix/:path, checked. */
function requestKey(c: Context<CloudEnv>): {prefix: Prefix, segs: string[], key: string} {
    const prefix = c.req.param('prefix') as Prefix
    if (!PREFIXES.includes(prefix)) throw new HTTPException(404, {message: `prefix is one of ${PREFIXES.join(', ')}`})
    const segs = cleanSegments((c.req.param('path') || ''))
    if (!segs) throw new HTTPException(400, {message: 'bad path'})
    return {prefix, segs, key: prefix + '/' + segs.join('/')}
}

/** Streams a request body of `size` bytes into R2 through a SHA-256 digest; nothing is buffered. `stored` is null when `onlyIf` failed. */
export async function putStreamed(bucket: R2Bucket, key: string, body: ReadableStream, size: number, options: R2PutOptions) {
    const digest = new crypto.DigestStream('SHA-256')
    const fixed = new FixedLengthStream(size)
    const [toDigest, toR2] = body.tee()
    const digested = toDigest.pipeTo(digest)
    const piped = toR2.pipeTo(fixed.writable)
    const stored = await bucket.put(key, fixed.readable, options)
    await Promise.all([piped, digested])
    return {stored, sha256: hex(await digest.digest)}
}

/** The size of an upload from its Content-Length, checked against the cap. */
export function uploadSize(c: Context<CloudEnv>): number {
    const size = Number(c.req.header('content-length'))
    if (!Number.isInteger(size) || size <= 0) throw new HTTPException(411, {message: 'send the file as the request body, with Content-Length'})
    if (size > UPLOAD_MAX_BYTES) throw new HTTPException(413, {message: `max ${sizeText(UPLOAD_MAX_BYTES)} per file`})
    return size
}

/**
 * Claims the scope for the user, or 403 when another user has it. `row` is its owner, read with the user in one query
 * (requireUserAndScope); D1 is written only to claim a new scope or an expired share, or to move a share's expiry later.
 * Of two claims at the same time one wins: the upsert changes the row only when it is the user's or has expired.
 */
async function claimScope(env: CloudflareBindings, scope: string, user: CloudUser, row: ScopeRow | null, expires: string | null) {
    // names that look like ours (the PR builds b/threepipe/…, p/threepipe…, s/threepipe…): staff only, like project
    // slugs, so nobody claims an official-looking URL or the build of a PR before CI uploads it
    if (/^[sbp]\/threepipe/.test(scope) && !isStaff(user))
        throw new HTTPException(403, {message: `${scope.split('/').slice(0, 2).join('/')}… is for threepipe`})
    const taken = () => new HTTPException(403, {message: `'${scope}' belongs to another user`})
    const now = new Date().toISOString()
    // a share's scope lives to the end of the UTC day of its last file's expiry: later uploads move it at most once a day
    if (expires) expires = new Date(Math.ceil(Date.parse(expires) / DAY_MS) * DAY_MS).toISOString()
    if (row && !(row.expires && row.expires < now)) {
        if (row.owner !== user.id) throw taken()
        // a share lives as long as its last file: move its expiry later when a new file outlives it
        if (row.expires && expires && expires > row.expires)
            // only later, compared in the statement: of two uploads at once with different ttls the later expiry stays
            await env.PRIMARY_DB.prepare('UPDATE scopes SET expires_at = ?1 WHERE scope = ?2 AND owner_id = ?3 AND expires_at < ?1').bind(expires, scope, user.id).run()
        return
    }
    const won = await env.PRIMARY_DB.prepare(`INSERT INTO scopes (id, scope, owner_id, expires_at) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT (scope) DO UPDATE SET owner_id = excluded.owner_id,
                expires_at = CASE WHEN scopes.owner_id = excluded.owner_id AND scopes.expires_at > excluded.expires_at THEN scopes.expires_at ELSE excluded.expires_at END
            WHERE scopes.owner_id = excluded.owner_id OR scopes.expires_at < ?5 RETURNING owner_id`)
        .bind(crypto.randomUUID(), scope, user.id, expires, now).first<{owner_id: string}>()
    if (won?.owner_id !== user.id) throw taken()
}

interface Stored {key: string, size: number, sha256: string, expiresAt: string | null}

/** Runs `fn` on every item, `n` at a time; the results in the order of the items. */
async function inParallel<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let i = 0
    await Promise.all(Array.from({length: Math.min(n, items.length)}, async() => {
        while (i < items.length) {
            const k = i++
            out[k] = await fn(items[k])
        }
    }))
    return out
}

/**
 * Uploads (`PUT` one file, `POST` many) and deletes (`DELETE`) of files in the cloud bucket (the drive is src/drive.ts).
 * Keys are the URL paths; the owner, expiry and deletion are on the R2 object (src/files.ts serves with one R2 read).
 * D1: one read per request (the user and the scope's owner, `scopes`), a write only to claim a scope. No row per file.
 * s/ objects are removed by the bucket's expiry rule (init-infra.sh); b/ builds stay until cleaned up.
 */
export function uploadRoutes(app: Hono<CloudEnv>) {
    app.put('/api/v1/uploads/:prefix/:path{.+}', async (c) => {
        const {prefix, segs} = requestKey(c)
        const t = target(prefix, segs, c)
        const {user, scopeRow} = await requireUserAndScope(c, t.scope)
        const size = uploadSize(c)
        assertScope(user)
        if (t.scope) await claimScope(c.env, t.scope, user, scopeRow, t.expiresAt)
        const contentType = contentTypeFor(t.key, c.req.header('content-type'))
        const body = c.req.raw.body
        if (!body) throw new HTTPException(400, {message: 'empty body'})

        if (prefix === 'a') {
            const existing = await c.env.CLOUD_BUCKET.head(t.key)
            if (existing) {
                if (existing.customMetadata?.deleted) throw new HTTPException(410, {message: `removed: ${existing.customMetadata.deleted}`})
                if (existing.customMetadata?.sha256 !== t.sha256) throw new HTTPException(409, {message: 'another file has the same short hash and name; rename the file'})
                return c.json({url: fileUrl(c, t.key), path: t.key, size: existing.size, sha256: t.sha256, expires_at: null, existed: true})
            }
        }

        const {stored, sha256} = await putStreamed(c.env.CLOUD_BUCKET, t.key, body, size, {
            httpMetadata: {contentType},
            // s/ shares carry their expiry (410 right on time); the bucket's expiry rule removes s/ objects later
            customMetadata: {owner: user.id, ...prefix === 's' && t.expiresAt ? {expires: t.expiresAt} : {}, ...t.sha256 ? {sha256: t.sha256} : {}},
            ...prefix === 'a' ? {onlyIf: new Headers({'if-none-match': '*'})} : {},
        })
        if (!stored) throw new HTTPException(409, {message: 'the file was written by another request at the same time; retry'})
        if (t.sha256 && sha256 !== t.sha256) {
            await c.env.CLOUD_BUCKET.delete(t.key)
            throw new HTTPException(400, {message: 'x-content-sha256 does not match the uploaded bytes'})
        }

        return c.json({url: fileUrl(c, t.key), path: t.key, size, sha256, expires_at: t.expiresAt})
    })

    // Many files in one request, like ij-share's folder upload: multipart/form-data, each part a file whose field name
    // is its path under the URL's folder. The key and the scope are checked once for all of them.
    app.post('/api/v1/uploads/:prefix/:path{.+}', async (c) => {
        const prefix = c.req.param('prefix') as Prefix
        if (!PREFIXES.includes(prefix) || prefix === 'a') throw new HTTPException(400, {message: 'many files go to s/, b/ or p/ (a/ is one PUT per file)'})
        // the URL names the scope, so it is checked with the user before the body is read
        const scope = scopeOf(prefix, cleanSegments(c.req.param('path').replace(/\/+$/, '')) || [])
        if (!scope) throw new HTTPException(400, {message: `POST to the folder: ${prefix === 'b' ? 'b/<repo>/<ref>' : prefix + '/<name>'}/`})
        const {user, scopeRow} = await requireUserAndScope(c, scope)
        assertScope(user)
        const size = Number(c.req.header('content-length'))
        if (!Number.isInteger(size) || size <= 0) throw new HTTPException(411, {message: 'send the files as multipart/form-data, with Content-Length'})
        if (size > UPLOAD_BATCH_BYTES) throw new HTTPException(413, {message: `max ${sizeText(UPLOAD_BATCH_BYTES)} per request (a bigger file: one PUT)`})
        const folder = c.req.param('path').replace(/\/+$/, '')
        const form = await c.req.raw.formData().catch(() => {
            throw new HTTPException(400, {message: 'send multipart/form-data: one part per file, its field name the path'})
        })
        const parts = [...form.entries()].filter((e): e is [string, File] => typeof e[1] !== 'string')
        if (!parts.length) throw new HTTPException(400, {message: 'no files'})
        if (parts.length > UPLOAD_BATCH_FILES) throw new HTTPException(413, {message: `max ${UPLOAD_BATCH_FILES} files per request`})
        const items = parts.map(([name, file]) => {
            const segs = cleanSegments(`${folder}/${name}`)
            if (!segs) throw new HTTPException(400, {message: `bad path: ${name}`})
            return {t: target(prefix, segs, c), file}
        })
        if (items.some(i => i.t.scope !== scope)) throw new HTTPException(400, {message: `the files of one request go under one ${prefix === 'b' ? 'b/<repo>/<ref>' : prefix + '/<name>'}`})
        if (new Set(items.map(i => i.t.key)).size !== items.length) throw new HTTPException(400, {message: 'a path appears twice'})
        await claimScope(c.env, scope, user, scopeRow, items[0].t.expiresAt)
        // 6 at a time: a worker request has at most 6 R2 calls waiting for an answer (more only queue)
        const stored = await inParallel(items, 6, async({t, file}): Promise<Stored> => {
            const body = await file.arrayBuffer()
            await c.env.CLOUD_BUCKET.put(t.key, body, {
                httpMetadata: {contentType: contentTypeFor(t.key, file.type)},
                customMetadata: {owner: user.id, ...prefix === 's' && t.expiresAt ? {expires: t.expiresAt} : {}},
            })
            return {key: t.key, size: body.byteLength, sha256: hex(await crypto.subtle.digest('SHA-256', body)), expiresAt: t.expiresAt}
        })
        return c.json({files: stored.map(f => ({url: fileUrl(c, f.key), path: f.key, size: f.size, sha256: f.sha256, expires_at: f.expiresAt}))})
    })

    app.delete('/api/v1/uploads/:prefix/:path{.+}', async (c) => {
        const {prefix, segs, key} = requestKey(c)
        const scope = scopeOf(prefix, segs)
        const {user, scopeRow} = await requireUserAndScope(c, scope)
        assertScope(user)
        const obj = await c.env.CLOUD_BUCKET.head(key)
        if (!obj || obj.customMetadata?.deleted) throw new HTTPException(404, {message: 'not found'})
        // owners delete the files of their scope; a/ stays permanent unless staff removes it (copyright, abuse, storage)
        // the scope's owner, or who uploaded this file (a share whose name went to another user after it expired)
        const mine = !!scope && (scopeRow?.owner === user.id || obj.customMetadata?.owner === user.id), asset = prefix === 'a'
        if (!isStaff(user) && (!mine || asset)) throw new HTTPException(403, {message: asset ? 'permanent assets are removed by staff only' : 'not your file'})
        const reason = (c.req.query('reason') || (mine ? 'deleted by owner' : 'removed by staff')).slice(0, 200)
        // a small tombstone object at the path, so the link answers 410
        await c.env.CLOUD_BUCKET.put(key, '', {customMetadata: {deleted: reason, deleted_at: new Date().toISOString(), deleted_by: user.id}})
        return c.json({deleted: key, reason})
    })
}
