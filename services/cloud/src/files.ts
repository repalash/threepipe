import type {Context, Next} from 'hono'
import type {CloudEnv} from './env'
import {verifySigned} from './drive'

const HTML_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation'

/**
 * Serves the cloud bucket on FILES_HOST (or under /_files/ on the API host when FILES_HOST is not set): one R2 read per
 * request (two for a share link), no database. Owner, expiry, deletion and visibility are read from the object's metadata.
 * HTML and SVG get a sandbox CSP: their scripts run in an opaque origin, away from the API host's sessions.
 *
 *   /<s|a|b|p>/<path>          public
 *   /d/<handle>/<path>         drive: only files made public
 *   /f/<id>/<rest>             drive share link (src/drive.ts): pointer object `f/<id>` → the file or folder
 *   /t/<exp>.<depth>.<sig>/d/… drive signed URL (src/drive.ts)
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
    const notFound = () => c.text('not found', 404)
    let key = decodeURIComponent(path).replace(/^\/+/, '')
    if (key.split('/').some(s => s === '..' || s.startsWith('.'))) return notFound()

    // how a drive file may be read: signed URL, share link, or public
    let signed: string | undefined
    let linkOwner: string | undefined
    if (key.startsWith('t/')) {
        const [, token, ...rest] = key.split('/')
        signed = token
        key = rest.join('/')
        if (!key.startsWith('d/')) return notFound()
    } else if (key.startsWith('f/')) {
        const [, id, ...rest] = key.split('/')
        const pointer = id ? await c.env.CLOUD_BUCKET.head(`f/${id}`) : null
        const target = pointer?.customMetadata?.target
        if (!target) return notFound()
        linkOwner = pointer.customMetadata!.owner
        if (target.endsWith('/')) {
            if (!rest.length) return c.redirect(url.pathname + '/' + url.search, 301)
            key = target + rest.join('/')
        } else {
            if (rest.join('/') !== target.split('/').pop()) return notFound()
            key = target
        }
    }
    if (!/^[sabpd]\/./.test(key)) return notFound()
    if (key.endsWith('/')) key += 'index.html'
    if (signed && !await verifySigned(c.env, signed, key)) return c.text('the signed URL expired or is not valid', 403)
    const allowed = (meta: Record<string, string>) => !key.startsWith('d/') || !!signed || meta.visibility === 'public' ||
        !!linkOwner && meta.owner === linkOwner

    let obj = await c.env.CLOUD_BUCKET.get(key, {onlyIf: c.req.raw.headers, range: c.req.raw.headers})
    if (!obj && !key.split('/').pop()!.includes('.')) {
        // a folder without the trailing slash: redirect so its relative links resolve
        const index = await c.env.CLOUD_BUCKET.head(key + '/index.html')
        if (index && allowed(index.customMetadata || {})) return c.redirect(url.pathname + '/' + url.search, 301)
    }
    if (!obj) return notFound()
    const meta = obj.customMetadata || {}
    if (meta.deleted) return c.text('gone: ' + meta.deleted, 410)
    if (meta.expires && Date.parse(meta.expires) < Date.now()) return c.text('expired', 410)
    if (!allowed(meta)) return notFound()

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('etag', obj.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('access-control-allow-origin', '*')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('cache-control', key.startsWith('a/') ? 'public, max-age=31536000, immutable' :
        key.startsWith('d/') && meta.visibility !== 'public' ? 'private, max-age=60' : 'public, max-age=60, must-revalidate')
    if (signed || linkOwner) headers.set('referrer-policy', 'no-referrer') // keep the secret part of the URL out of Referer
    const type = headers.get('content-type') || ''
    if (type.startsWith('text/html') || type.startsWith('image/svg')) headers.set('content-security-policy', HTML_SANDBOX)
    if (!('body' in obj)) return new Response(null, {status: 304, headers})
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
