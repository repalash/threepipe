import type {Context, Next} from 'hono'
import type {CloudEnv} from './env'
import {verifySigned} from './drive'
import config from 'virtual:teenybase'

const HTML_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation'

/**
 * Serves the cloud bucket on FILES_HOST (or under /_files/ on the API host when FILES_HOST is not set): one R2 read per
 * request, no database. Owner, expiry, deletion and visibility are read from the object's metadata.
 * HTML and SVG get a sandbox CSP: their scripts run in an opaque origin, away from the API host's sessions.
 *
 *   /<s|a|b|p>/<path>                  public
 *   /d/<handle>/<item>/<file>          a drive item shared as `link` (src/drive.ts)
 *   /t/<exp>.<sig>/d/<handle>/<item>/… a private drive item, signed (src/drive.ts)
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
    // the files host's own address has no file: the cloud's pages
    if (c.env.FILES_HOST && path === '/') return c.redirect(`${config.appUrl}/drive`, 302)
    // with the CORS header too: a sandboxed page (origin null) then sees the 404 itself, not a CORS error
    const plain = (text: string, status: 404 | 410) => c.text(text, status, {'access-control-allow-origin': '*'})
    const notFound = () => plain('not found', 404)
    let key: string
    try {
        key = decodeURIComponent(path).normalize('NFC').replace(/^\/+/, '')
    } catch {
        return notFound() // a malformed %-escape
    }
    if (key.split('/').some(s => s === '..' || s.startsWith('.'))) return notFound()

    // a private drive file is read through a signed URL: /t/<exp>.<sig>/d/<handle>/<item>/<file>
    let signed: string | undefined
    if (key.startsWith('t/')) {
        const [, token, ...rest] = key.split('/')
        signed = token
        key = rest.join('/')
        if (!key.startsWith('d/')) return notFound()
    }
    if (!/^[sabpd]\/./.test(key)) return notFound()
    if (key.endsWith('/')) key += 'index.html'
    if (signed && !await verifySigned(c.env, signed, key)) return c.text('the signed URL expired or is not valid', 403)
    const allowed = (meta: Record<string, string>) => !key.startsWith('d/') || !!signed || meta.visibility === 'link'

    let obj = await c.env.CLOUD_BUCKET.get(key, {onlyIf: c.req.raw.headers, range: c.req.raw.headers})
    if (!obj && !key.split('/').pop()!.includes('.')) {
        // a folder without the trailing slash: redirect so its relative links resolve
        const index = await c.env.CLOUD_BUCKET.head(key + '/index.html')
        if (index && allowed(index.customMetadata || {})) return c.redirect(url.pathname + '/' + url.search, 301)
    }
    if (!obj) return notFound()
    const meta = obj.customMetadata || {}
    if (meta.deleted) return plain('gone: ' + meta.deleted, 410)
    if (meta.expires && Date.parse(meta.expires) < Date.now()) return plain('expired', 410)
    if (!allowed(meta)) return notFound()

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('etag', obj.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('access-control-allow-origin', '*')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('cache-control', key.startsWith('a/') ? 'public, max-age=31536000, immutable' :
        key.startsWith('d/') ? 'private, max-age=60' : 'public, max-age=60, must-revalidate')
    if (key.startsWith('d/')) headers.set('referrer-policy', 'no-referrer') // the item id and the signature are the secret part of the URL
    const type = headers.get('content-type') || ''
    if (type.startsWith('text/html') || type.startsWith('image/svg')) headers.set('content-security-policy', HTML_SANDBOX)
    // R2 answers a failed precondition without a body: If-None-Match/If-Modified-Since → 304, If-Match/If-Unmodified-Since → 412
    if (!('body' in obj)) return new Response(null, {status: c.req.header('if-match') || c.req.header('if-unmodified-since') ? 412 : 304, headers})
    // R2 reports a range even when none was asked for: only a request with a Range header gets a 206
    if (c.req.header('range') && obj.range && 'offset' in obj.range) {
        const offset = obj.range.offset ?? 0
        const length = obj.range.length ?? obj.size - offset
        headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
        headers.set('content-length', String(length))
        return new Response(c.req.method === 'HEAD' ? null : obj.body, {status: 206, headers})
    }
    headers.set('content-length', String(obj.size))
    return new Response(c.req.method === 'HEAD' ? null : obj.body, {headers})
}
