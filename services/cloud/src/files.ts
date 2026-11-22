import type {Context, Next} from 'hono'
import type {CloudEnv} from './env'
import {verifySigned} from './drive'
import config from 'virtual:teenybase'
import {isMarkdownPath, markdownResponse, wantsRenderedMarkdown} from './markdown.js'
import {isVideoPath, videoResponse} from './video.js'
import {MARKDOWN_RENDER_BYTES} from './limits'

const HTML_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation'
/**
 * Types a browser shows without running anything (a PDF viewer does not work sandboxed); every other type gets the
 * sandbox. A `+xml` type is not passive whatever its top-level type (`model/x3d+xml`): browsers parse it as XML, which can run scripts.
 */
const PASSIVE = /^(?:image\/(?:png|jpeg|gif|webp|avif|x-icon|ktx2)|(?:video|audio|font|model)\/(?![\w.+-]*\+xml)[\w.+-]+|application\/(?:pdf|json|wasm|zip|octet-stream)|text\/(?:javascript|css|plain|markdown))\s*(?:;|$)/

/**
 * Serves the cloud bucket on FILES_HOST (or under /_files/ on the API host when FILES_HOST is not set): one R2 read per
 * request, no database. Owner, expiry, deletion and visibility are read from the object's metadata.
 * Everything but passive types (HTML, SVG, XHTML, a type given at upload) gets a sandbox CSP: its scripts run in an
 * opaque origin, away from the API host's sessions. A .md file opened in a browser renders to a page that runs no script
 * (src/markdown.js, from ij-share); curl and agents get the file as it is, and `?raw=1` shows it raw in a browser. A video
 * opened in a browser gets a player page the same way (src/video.js); its <video> reads the file, which takes one Range.
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

    // a rendered page has its own ETag, so the file's conditional and range headers do not apply to it
    const render = isMarkdownPath(key) && wantsRenderedMarkdown(c.req.raw, url)
    const player = !render && isVideoPath(key) && wantsRenderedMarkdown(c.req.raw, url)
    // A Range is checked against the size before any byte is read: R2 answers a range past the end, several ranges or a
    // malformed one with the whole object, and a 206 that carries the whole object corrupts resumed downloads.
    const head = (!render && c.req.header('range')) || player ? await c.env.CLOUD_BUCKET.head(key) : null
    // A file can be replaced: an If-Range that is not its current ETag gets the whole file
    const ifRange = c.req.header('if-range')
    const rangeHeader = render || player || (head && ifRange !== undefined && ifRange !== head.httpEtag) ? undefined : c.req.header('range')
    const range = rangeHeader && head ? parseRange(rangeHeader, head.size) : null
    // declared wide: a head (no body) and a get (a body, or none when a precondition matched) both land here
    let obj = (player || (rangeHeader && !range) ? head
        : await c.env.CLOUD_BUCKET.get(key, render ? {} : {onlyIf: c.req.raw.headers, ...(range ? {range} : {})})) as R2Object | R2ObjectBody | null
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
    if (player) {
        const q = new URLSearchParams(url.search)
        q.delete('render')
        q.set('raw', '1')
        return videoResponse(obj, c.req.raw, {path: key, rawHref: `${encodeURIComponent(key.split('/').pop()!)}?${q}`})
    }
    if (rangeHeader && !range) return unsatisfiable(obj.size)
    // too big to render: the file as it is, with the request's conditional and range headers after all
    let tooBigRange: {offset: number, length: number} | null = null
    if (render && obj.size > MARKDOWN_RENDER_BYTES) {
        if ('body' in obj) await obj.body.cancel()
        const ifRange = c.req.header('if-range')
        const header = ifRange === undefined || ifRange === obj.httpEtag ? c.req.header('range') : undefined
        tooBigRange = header ? parseRange(header, obj.size) : null
        if (header && !tooBigRange) return unsatisfiable(obj.size)
        obj = await c.env.CLOUD_BUCKET.get(key, {onlyIf: c.req.raw.headers, ...(tooBigRange ? {range: tooBigRange} : {})})
        if (!obj) return notFound()
    } else if (render && 'body' in obj) {
        const q = new URLSearchParams(url.search)
        q.delete('render')
        q.set('raw', '1')
        return markdownResponse(obj, c.req.raw, {path: key, rawHref: `${encodeURIComponent(key.split('/').pop()!)}?${q}`})
    }

    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('etag', obj.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('access-control-allow-origin', '*')
    headers.set('x-content-type-options', 'nosniff')
    // a browser opening the file gets a page instead (markdown, video): a cache must not hand these bytes to it
    if (isMarkdownPath(key) || isVideoPath(key)) headers.set('vary', 'accept, sec-fetch-dest, user-agent')
    headers.set('cache-control', key.startsWith('a/') ? 'public, max-age=31536000, immutable' :
        key.startsWith('d/') ? 'private, max-age=60' : 'public, max-age=60, must-revalidate')
    if (key.startsWith('d/')) headers.set('referrer-policy', 'no-referrer') // the item id and the signature are the secret part of the URL
    if (!PASSIVE.test((headers.get('content-type') || '').toLowerCase())) headers.set('content-security-policy', HTML_SANDBOX)
    // R2 answers a failed precondition without a body: If-None-Match/If-Modified-Since → 304, If-Match/If-Unmodified-Since → 412
    if (!('body' in obj)) return new Response(null, {status: c.req.header('if-match') || c.req.header('if-unmodified-since') ? 412 : 304, headers})
    const part = range || tooBigRange
    if (part) {
        const {offset, length} = part
        headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`)
        headers.set('content-length', String(length))
        return new Response(c.req.method === 'HEAD' ? null : obj.body, {status: 206, headers})
    }
    headers.set('content-length', String(obj.size))
    return new Response(c.req.method === 'HEAD' ? null : obj.body, {headers})
}

/** 416 for a range the file cannot answer, with its size, as RFC 9110 asks. */
function unsatisfiable(size: number) {
    return new Response(null, {status: 416, headers: {'content-range': `bytes */${size}`, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*'}})
}

/**
 * One Range only: `bytes=<start>-<end?>` or `bytes=-<suffix>`, clamped to the object; null → 416. The rule of ij-share's
 * parseRange (ijewel-mono services/share-worker/src/worker.js).
 */
export function parseRange(header: string, size: number): {offset: number, length: number} | null {
    if (!size) return null // nothing to slice; R2 rejects a zero-length range
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!m || (!m[1] && !m[2])) return null
    if (!m[1]) {
        const suffix = Number(m[2])
        return suffix ? {offset: Math.max(0, size - suffix), length: Math.min(suffix, size)} : null
    }
    const start = Number(m[1])
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || end < start) return null
    return {offset: start, length: end - start + 1}
}
