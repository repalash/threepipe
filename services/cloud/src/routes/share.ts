// Copied from ijewel-mono services/share-worker/src/worker.js @ 54d43285, the essentials only: shares, named slugs,
// write-once assets and markdown rendering. Dropped: private/Access hosts, passwords, share-db, source zips, the
// token store and its UI, goauth.
/**
 * /share — file sharing for the team and their agents. One authenticated multipart POST returns a
 * live URL:
 *
 *   curl -F "file=@page.html" -H "Authorization: Bearer $TP_SHARE_TOKEN" https://<host>/share
 *
 *   POST   /share              SHARE_TOKENS; `file` parts (nested paths allowed), optional `slug` (named
 *                              share: a re-upload to the same slug updates it in place; only its owner
 *                              may), optional `asset=1` (write-once assets instead) → {slug, url, files}
 *                              or {assets: [{name, id, sha256, size, url, existed}]}
 *   DELETE /share/<slug>       SHARE_TOKENS; the owner removes a share
 *   GET    /<slug>/<path>      the share's files; /<slug>/ is index.html, the one file, or a listing.
 *                              A .md opened in a browser renders to a page (src/markdown.js).
 *   GET    /a/<id>/<name>      a write-once asset: content-addressed, cached for a year, ranges honoured
 *
 * Storage: one prefix per share in BUCKET — <slug>/<path>, plus <slug>/.meta.json ({createdAt,
 * owner}). Dotfile segments are never served, which keeps the meta file private. Assets live under
 * .a/<id>/<name>, where <id> is the start of the content's SHA-256: the same bytes always map to the
 * same URL, and nothing in this API overwrites or deletes one (an account admin can, in R2). Reports
 * live under reports/, which no slug can name (RESERVED).
 */
import type {Env} from '../env.ts'
import {cors, escapeHtml, html, json, presentedToken, tokenOwner} from '../common/http.ts'
import {isMarkdownPath, markdownResponse, wantsRenderedMarkdown} from '../markdown.js'

const META_KEY = '.meta.json'
const isShareFile = (key: string) => !key.slice(key.indexOf('/') + 1).startsWith('.')
// Two characters at least: one character stays free for the asset route /a/.
export const SLUG_RE = /^[a-z0-9-]{2,40}$/i
/** The worker's own routes and the reports prefix: never a slug. */
const RESERVED = new Set(['share', 'staff', 'reports', 'api'])
const ASSET_PREFIX = '.a/'
const assetId = (sha256: string) => `${sha256.slice(0, 4)}-${sha256.slice(4, 12)}`
// The request body is buffered in memory once (formData) and the R2 write buffers on top of that;
// 64 MiB per request keeps the isolate well under its 128 MiB limit.
const UPLOAD_MAX_BYTES = 64 * 1024 * 1024
export const ASSET_PATH_RE = /^\/a\/([0-9a-f]{4}-[0-9a-f]{8})\/([^/]+)$/
const METHODS = 'POST, DELETE, OPTIONS'

const MIME: Record<string, string> = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
    pdf: 'application/pdf', wasm: 'application/wasm',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', hdr: 'application/octet-stream', exr: 'application/octet-stream', bin: 'application/octet-stream',
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', woff: 'font/woff', woff2: 'font/woff2', zip: 'application/zip',
}

function contentTypeFor(path: string, formType?: string): string {
    const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
    if (MIME[ext]) return MIME[ext]
    if (formType && formType !== 'application/octet-stream') return formType
    return 'application/octet-stream'
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

function randomSlug(): string {
    const b = crypto.getRandomValues(new Uint8Array(5))
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('')
}

/** An uploaded filename as a safe relative path (nested dirs allowed), or null for anything with
 *  empty, '.', '..' or dotfile segments. */
function cleanPath(name: string): string | null {
    const p = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!p || p.length > 512) return null
    const segs = p.split('/')
    if (segs.some(s => !s || s === '.' || s === '..' || s.startsWith('.'))) return null
    if (!/^[\w\-./ ()+@]+$/.test(p)) return null
    return p
}

/** One line per change, into Workers Logs: who replaced what, and when. No bodies, no tokens. */
function audit(req: Request, who: string, action: string, slug: string, extra: Record<string, unknown> = {}) {
    console.log(JSON.stringify({audit: action, slug, who, ip: req.headers.get('cf-connecting-ip') || '', at: new Date().toISOString(), ...extra}))
}

async function readMeta(env: Env, slug: string): Promise<{createdAt?: string, owner?: string} | null> {
    const obj = await env.BUCKET.get(`${slug}/${META_KEY}`)
    if (!obj) return null
    try { return await obj.json() } catch { return {} }
}

async function listShareFiles(env: Env, slug: string): Promise<R2Object[]> {
    const files: R2Object[] = []
    let cursor: string | undefined
    do {
        const r = await env.BUCKET.list({prefix: `${slug}/`, cursor})
        files.push(...r.objects)
        cursor = r.truncated ? r.cursor : undefined
    } while (cursor)
    return files
}

/** The owner changes what they made; 'admin' changes anything. */
const mayWrite = (meta: {owner?: string} | null, who: string, slug: string) =>
    who === 'admin' || !meta?.owner || meta.owner === who ? null : `'${slug}' belongs to ${meta.owner}`

// ---- the API (SHARE_TOKENS) ----------------------------------------------------------
export async function handleShareApi(req: Request, env: Env, url: URL): Promise<Response> {
    if (req.method === 'OPTIONS') return cors(req, env, new Response(null, {status: 204}), METHODS)
    const res = await shareApi(req, env, url).catch((e: any) => {
        console.error('share', e?.stack || e)
        return json({error: 'internal'}, 500)
    })
    return cors(req, env, res, METHODS)
}

async function shareApi(req: Request, env: Env, url: URL): Promise<Response> {
    const m = url.pathname.match(/^\/share(?:\/([^/]+))?\/?$/)
    if (!m) return json({error: 'not found'}, 404)
    const who = await tokenOwner(env.SHARE_TOKENS, presentedToken(req, url))
    if (!who) return json({error: 'unauthorized'}, 401)
    if (req.method === 'POST' && !m[1]) return upload(req, env, url, who)
    if (req.method === 'DELETE' && m[1]) return remove(req, env, who, m[1])
    return json({error: 'method not allowed'}, 405)
}

async function upload(req: Request, env: Env, url: URL, who: string): Promise<Response> {
    if (Number(req.headers.get('content-length')) > UPLOAD_MAX_BYTES) return tooLarge()
    let form: FormData
    try { form = await req.formData() } catch (e: any) { return json({error: `bad multipart body: ${e.message}`}, 400) }
    const parts = [...form].filter(([, v]) => typeof v !== 'string') as [string, File][]
    if (parts.reduce((n, [, f]) => n + f.size, 0) > UPLOAD_MAX_BYTES) return tooLarge()
    if (!parts.length) return json({error: 'no files in form (use -F "file=@page.html")'}, 400)
    const asset = form.get('asset')
    if (typeof asset === 'string' && asset && asset !== '0' && asset !== 'false') return uploadAssets(req, env, url, who, parts)

    let slug = String(form.get('slug') || '').trim().toLowerCase()
    if (slug && (!SLUG_RE.test(slug) || RESERVED.has(slug))) return json({error: 'bad slug (use 2-40 chars: a-z 0-9 -; not share, staff, reports or api)'}, 400)
    const isNew = !slug
    if (isNew) slug = randomSlug()
    const existing = isNew ? null : await readMeta(env, slug)
    const refusal = mayWrite(existing, who, slug)
    if (refusal) return json({error: refusal}, 403)
    const meta = existing || {createdAt: new Date().toISOString(), owner: who}

    const files: string[] = []
    for (const [, value] of parts) {
        const path = cleanPath(value.name)
        if (!path) return json({error: `bad filename: ${value.name}`}, 400)
        await env.BUCKET.put(`${slug}/${path}`, value.stream(), {httpMetadata: {contentType: contentTypeFor(path, value.type)}})
        files.push(path)
    }
    await env.BUCKET.put(`${slug}/${META_KEY}`, JSON.stringify(meta))
    audit(req, who, existing ? 'update' : 'create', slug, {files: files.length})
    const base = `${url.origin}/${slug}/`
    const shareUrl = files.includes('index.html') || files.length !== 1 ? base : base + files[0].split('/').map(encodeURIComponent).join('/')
    return json({slug, url: shareUrl, files, owner: meta.owner ?? null})
}

async function remove(req: Request, env: Env, who: string, slug: string): Promise<Response> {
    if (!SLUG_RE.test(slug)) return json({error: 'bad slug'}, 400)
    const refusal = mayWrite(await readMeta(env, slug), who, slug)
    if (refusal) return json({error: refusal}, 403)
    const files = await listShareFiles(env, slug)
    if (!files.length) return json({error: 'not found'}, 404)
    for (let i = 0; i < files.length; i += 1000) await env.BUCKET.delete(files.slice(i, i + 1000).map(o => o.key))
    audit(req, who, 'delete', slug, {files: files.length})
    return json({deleted: slug, files: files.length})
}

const tooLarge = () => json({error: `upload too large (max ${UPLOAD_MAX_BYTES / 1024 / 1024} MiB per request)`}, 413)

/** Each part stored write-once at .a/<id>/<name>. An existing key is never rewritten, so a URL handed
 *  out once can never change or disappear through this API. */
async function uploadAssets(req: Request, env: Env, url: URL, who: string, parts: [string, File][]): Promise<Response> {
    const assets = []
    for (const [, value] of parts) {
        const path = cleanPath(value.name)
        const name = path ? path.split('/').pop()! : null
        if (!name) return json({error: `bad filename: ${value.name}`}, 400)
        if (!value.size) return json({error: `empty file: ${value.name}`}, 400)
        const bytes = await value.arrayBuffer()
        const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes))
        const id = assetId(sha256)
        const key = `${ASSET_PREFIX}${id}/${name}`
        // A cheap pre-check so a re-upload does not push the bytes again; the put is still conditional
        // (If-None-Match: *), so of two first uploads R2 keeps the first and returns null to the second.
        let stored: R2Object | null = await env.BUCKET.head(key)
        let existed = !!stored
        if (!stored) {
            stored = await env.BUCKET.put(key, bytes, {
                onlyIf: new Headers({'if-none-match': '*'}),
                httpMetadata: {contentType: contentTypeFor(name, value.type)},
                sha256,
                customMetadata: {name, sha256},
            })
            if (!stored) {
                existed = true
                stored = await env.BUCKET.head(key)
                if (!stored) return json({error: 'asset write lost a race and vanished; retry'}, 500)
            } else audit(req, who, 'asset', `${id}/${name}`, {size: stored.size})
        }
        const href = `${url.origin}/a/${id}/${encodeURIComponent(name)}`
        // Same 48-bit id prefix + same name + different bytes: astronomically rare, but the stored object wins.
        if (existed && stored.customMetadata?.sha256 !== sha256) return json({error: 'asset exists with different content', url: href}, 409)
        assets.push({name, id, sha256, size: stored.size, url: href, existed})
    }
    return json({assets})
}

// ---- serving ---------------------------------------------------------------------------
function listingPage(slug: string, files: R2Object[]): Response {
    const items = files.map(o => {
        const rel = o.key.slice(slug.length + 1)
        return `<li><a href="/${slug}/${rel.split('/').map(encodeURIComponent).join('/')}">${escapeHtml(rel)}</a> <small>${(o.size / 1024).toFixed(1)} KB</small></li>`
    }).join('\n')
    return html(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(slug)}</title>
<body style="font-family:system-ui;max-width:640px;margin:3rem auto;padding:0 1rem">
<h2>${escapeHtml(slug)}</h2><ul>${items}</ul></body>`)
}

function objectResponse(obj: R2Object | R2ObjectBody, contentType: string | null = null): Response {
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    if (contentType) headers.set('content-type', contentType)
    headers.set('etag', obj.httpEtag)
    headers.set('cache-control', 'private, no-cache')
    if (!('body' in obj) || !obj.body) return new Response(null, {status: 304, headers}) // onlyIf matched
    return new Response(obj.body, {headers})
}

/** GET /<slug>/<path>. */
export async function serveShare(req: Request, env: Env, url: URL): Promise<Response> {
    const m = url.pathname.match(/^\/([^/]+)(?:\/(.*))?$/)
    const slug = m && m[1]
    if (!slug || !SLUG_RE.test(slug) || RESERVED.has(slug.toLowerCase())) return html('<h1>404</h1>', 404)
    let rest = m![2]
    // /<slug> (no trailing slash) → redirect so relative asset paths resolve
    if (rest === undefined) return Response.redirect(`${url.origin}/${slug}/`, 301)
    try { rest = decodeURIComponent(rest) } catch { return html('<h1>404</h1>', 404) }
    if (rest.split('/').some(s => s.startsWith('.'))) return html('<h1>404</h1>', 404)
    const meta = await readMeta(env, slug)
    if (!meta) return html('<h1>404</h1><p>No such share.</p>', 404)

    if (rest === '') {
        const index = await env.BUCKET.get(`${slug}/index.html`)
        if (index) return objectResponse(index)
        const files = (await listShareFiles(env, slug)).filter(o => isShareFile(o.key))
        if (files.length === 1) {
            const href = files[0].key.slice(slug.length + 1).split('/').map(encodeURIComponent).join('/')
            return Response.redirect(`${url.origin}/${slug}/${href}${url.search}`, 302)
        }
        return listingPage(slug, files)
    }
    // /<slug>/dir/ serves dir/index.html. No nested listing.
    if (rest.endsWith('/')) {
        const index = await env.BUCKET.get(`${slug}/${rest}index.html`, {onlyIf: req.headers})
        return index ? objectResponse(index) : html('<h1>404</h1>', 404)
    }
    // A .md file opened in a browser is rendered to HTML; curl and agents get the raw markdown. onlyIf
    // is skipped for a render: the page carries its own ETag, so the raw one must not short-circuit it.
    const render = isMarkdownPath(rest) && wantsRenderedMarkdown(req, url)
    const obj = await env.BUCKET.get(`${slug}/${rest}`, render ? undefined : {onlyIf: req.headers})
    if (!obj) return html('<h1>404</h1>', 404)
    if (render) {
        const q = new URLSearchParams(url.search)
        q.delete('render')
        q.set('raw', '1')
        const rawHref = `${encodeURIComponent(rest.split('/').pop()!)}?${q}`
        return markdownResponse(obj, req, {path: `${slug}/${rest}`, rawHref})
    }
    return objectResponse(obj, isMarkdownPath(rest) ? MIME.md : null)
}

/** GET/HEAD /a/<id>/<name>: content-addressed, so the bytes behind a URL never change: cached for a
 *  year, immutable. One Range is honoured (browsers seek in videos). */
export async function serveAsset(req: Request, env: Env, id: string, rawName: string): Promise<Response> {
    let name: string
    try { name = decodeURIComponent(rawName) } catch { return html('<h1>404</h1>', 404) }
    if (name.startsWith('.')) return html('<h1>404</h1>', 404)
    const key = `${ASSET_PREFIX}${id}/${name}`
    const rangeHeader = req.headers.get('range')
    const head = rangeHeader != null ? await env.BUCKET.head(key) : null
    let range: {offset: number, length: number} | null = null
    if (rangeHeader != null) {
        if (!head) return html('<h1>404</h1>', 404)
        range = parseRange(rangeHeader, head.size)
        if (!range) return new Response(null, {status: 416, headers: {'content-range': `bytes */${head.size}`}})
    }
    const body = await env.BUCKET.get(key, range ? {range, onlyIf: req.headers} : {onlyIf: req.headers})
    if (!body) return html('<h1>404</h1>', 404)
    const headers = new Headers()
    body.writeHttpMetadata(headers)
    headers.set('etag', body.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    headers.set('content-disposition', `inline; filename="${name.replace(/["\\]/g, '\\$&')}"`)
    headers.set('access-control-allow-origin', '*')
    if (!('body' in body) || !body.body) return new Response(null, {status: 304, headers})
    if (range) {
        headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head!.size}`)
        headers.set('content-length', String(range.length))
        return new Response(body.body, {status: 206, headers})
    }
    headers.set('content-length', String(body.size))
    return new Response(body.body, {headers})
}

/** One Range only: `bytes=<start>-<end?>` or `bytes=-<suffix>`, clamped to the object, or null → 416.
 *  Parsed here because workerd answers an unsatisfiable range with the whole object. */
export function parseRange(header: string, size: number): {offset: number, length: number} | null {
    if (!size) return null
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
