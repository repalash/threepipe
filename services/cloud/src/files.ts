import type {Context, Next} from 'hono'
import type {CloudEnv} from './env'

const HTML_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation'

/**
 * Serves the cloud bucket on FILES_HOST (or under /_files/ on the API host when FILES_HOST is not set): one R2 read per
 * request, no database. Owner, expiry and deletion are read from the object's metadata.
 * HTML and SVG get a sandbox CSP: their scripts run in an opaque origin, away from the API host's sessions.
 */
export async function filesHost(c: Context<CloudEnv>, next: Next) {
    const url = new URL(c.req.url)
    let path: string
    if (c.env.FILES_HOST) {
        if (url.hostname !== c.env.FILES_HOST) return next()
        path = url.pathname
    } else {
        if (!url.pathname.startsWith('/_files/')) return next()
        path = url.pathname.slice('/_files'.length)
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('method not allowed', 405)
    let key = decodeURIComponent(path).replace(/^\/+/, '')
    if (!/^[sabp]\/./.test(key) || key.split('/').some(s => s === '..' || s.startsWith('.'))) return c.text('not found', 404)
    if (key.endsWith('/')) key += 'index.html'

    let obj = await c.env.CLOUD_BUCKET.get(key, {onlyIf: c.req.raw.headers, range: c.req.raw.headers})
    if (!obj && !key.split('/').pop()!.includes('.')) {
        // a folder without the trailing slash: redirect so its relative links resolve
        if (await c.env.CLOUD_BUCKET.head(key + '/index.html')) return c.redirect(url.pathname + '/' + url.search, 301)
    }
    if (!obj) return c.text('not found', 404)
    const meta = obj.customMetadata || {}
    if (meta.deleted) return c.text('gone: ' + meta.deleted, 410)
    if (meta.expires && Date.parse(meta.expires) < Date.now()) return c.text('expired', 410)

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('etag', obj.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('access-control-allow-origin', '*')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('cache-control', key.startsWith('a/') ? 'public, max-age=31536000, immutable' : 'public, max-age=60, must-revalidate')
    const type = headers.get('content-type') || ''
    if (type.startsWith('text/html') || type.startsWith('image/svg')) headers.set('content-security-policy', HTML_SANDBOX)
    if (!('body' in obj)) return new Response(null, {status: 304, headers})
    if (obj.range && 'offset' in obj.range) {
        const offset = obj.range.offset ?? 0
        const length = obj.range.length ?? obj.size - offset
        headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
        headers.set('content-length', String(length))
        return new Response(c.req.method === 'HEAD' ? null : obj.body, {status: 206, headers})
    }
    headers.set('content-length', String(obj.size))
    return new Response(c.req.method === 'HEAD' ? null : obj.body, {headers})
}
