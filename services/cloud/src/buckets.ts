import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {cleanSegments, keyUrl} from './env'
import {assertScope, isStaff, requireUser} from './auth'
import {contentTypeFor, putStreamed, uploadSize} from './uploads'

/**
 * Staff buckets: sample assets and e2e snapshot baselines. R2 serves them on their own domains (no Worker on reads);
 * the Worker only writes, so staff and CI need an access key instead of an S3 key. Write-once: a path never changes.
 *
 *   PUT  /api/v1/buckets/<samples|e2e>/<path>      staff, with x-content-sha256; same content again → `existed`, other → 409
 *   POST /api/v1/buckets/<samples|e2e>/missing {paths: [...]}  staff → {missing: [...]}  (up to 500 paths per call)
 *
 * e2e paths are content-addressed, `blobs/<sha256><ext>` (scripts/snapshots-r2.mjs), and the bytes must match the name.
 * Uploads are registered in `files` with bucket = samples / e2e.
 */
const BUCKETS = {
    samples: (env: CloudflareBindings) => ({bucket: env.SAMPLES_BUCKET, url: env.SAMPLES_URL}),
    e2e: (env: CloudflareBindings) => ({bucket: env.E2E_BUCKET, url: env.E2E_URL}),
}
type BucketName = keyof typeof BUCKETS
const MISSING_MAX = 500

async function staffBucket(c: Context<CloudEnv>) {
    const user = await requireUser(c)
    const name = c.req.param('bucket') as BucketName
    if (!(name in BUCKETS)) throw new HTTPException(404, {message: `bucket is one of ${Object.keys(BUCKETS).join(', ')}`})
    assertScope(user, `buckets/${name}/`) // app keys: never
    if (!isStaff(user)) throw new HTTPException(403, {message: 'staff only'})
    return {user, name, ...BUCKETS[name](c.env)}
}

function checkPath(name: BucketName, path: string): string {
    const segs = cleanSegments(path)
    if (!segs) throw new HTTPException(400, {message: 'bad path'})
    if (name === 'e2e' && !(segs.length === 2 && segs[0] === 'blobs' && /^[0-9a-f]{64}(\.[a-z0-9]+)?$/.test(segs[1])))
        throw new HTTPException(400, {message: 'e2e paths are blobs/<sha256 of the file><ext>'})
    return segs.join('/')
}

export function bucketRoutes(app: Hono<CloudEnv>) {
    app.post('/api/v1/buckets/:bucket/missing', async (c) => {
        const {name, bucket} = await staffBucket(c)
        const body = await c.req.json<{paths?: unknown}>().catch(() => ({} as {paths?: unknown}))
        if (!Array.isArray(body.paths) || body.paths.length > MISSING_MAX || body.paths.some(p => typeof p !== 'string'))
            throw new HTTPException(400, {message: `paths: up to ${MISSING_MAX} paths`})
        const paths = (body.paths as string[]).map(p => checkPath(name, p))
        const heads = await Promise.all(paths.map(p => bucket.head(p)))
        return c.json({missing: paths.filter((_, i) => !heads[i])})
    })

    app.put('/api/v1/buckets/:bucket/:path{.+}', async (c) => {
        const {user, name, bucket, url} = await staffBucket(c)
        const path = checkPath(name, (c.req.param('path')))
        const size = uploadSize(c)
        const expected = (c.req.header('x-content-sha256') || '').toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(expected)) throw new HTTPException(400, {message: 'send x-content-sha256: <hex sha256 of the file>'})
        if (name === 'e2e' && !path.startsWith(`blobs/${expected}`)) throw new HTTPException(400, {message: 'x-content-sha256 does not match the path'})
        const existing = await bucket.head(path)
        if (existing) {
            if (existing.customMetadata?.sha256 === expected) return c.json({url: keyUrl(url, path), path, size: existing.size, existed: true})
            throw new HTTPException(409, {message: `${name}/${path} exists; paths are write-once`})
        }
        const body = c.req.raw.body
        if (!body) throw new HTTPException(400, {message: 'empty body'})
        const contentType = contentTypeFor(path, c.req.header('content-type'))
        const {stored, sha256} = await putStreamed(bucket, path, body, size, {
            httpMetadata: {contentType, ...name === 'e2e' ? {cacheControl: 'public, max-age=31536000, immutable'} : {}},
            customMetadata: {owner: user.id, sha256: expected},
            onlyIf: new Headers({'if-none-match': '*'}),
        })
        if (!stored) throw new HTTPException(409, {message: 'written by another request at the same time; retry'})
        if (sha256 !== expected) {
            await bucket.delete(path)
            throw new HTTPException(400, {message: 'x-content-sha256 does not match the uploaded bytes'})
        }
        await c.env.PRIMARY_DB.prepare(`INSERT INTO files (id, owner_id, bucket, prefix, path, size, sha256, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (bucket, path) DO NOTHING`)
            .bind(crypto.randomUUID(), user.id, name, path.split('/')[0], path, size, sha256, contentType).run()
        return c.json({url: keyUrl(url, path), path, size, sha256})
    })
}
