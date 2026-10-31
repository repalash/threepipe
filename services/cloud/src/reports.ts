// From #104 (services/cloud/src/reports.ts), itself copied from ijewel-mono services/ops-worker/src/support.ts @ 54d43285
// (IJ-564). Changed for threepipe cloud: reports go to a project (src/projects.ts), signed-in senders skip Turnstile,
// project members read them (/reports page) instead of staff tokens.
/**
 * Reports: feedback and problem reports from threepipe apps. A person sends one from the modelling
 * editor's Help > Report a Problem…, an error toast's Report, or any app with `@threepipe/plugin-cloud`,
 * to the app's project; its members find it by its id (R-7K3F9Q) on the /reports page and read the text,
 * the log, the versions, the screenshot and the files that came with it.
 *
 * The rules:
 * - THE ID IS PUBLIC. Users paste it in issues and chats, so it names nothing: R2 keys use a random
 *   uuid, and the id opens nothing without being a member of the project.
 * - THE CLIENT REDACTS, AND THIS FILE REDACTS AGAIN (redact()). The log, the environment, the context
 *   and the cause lose query strings, tokens, the user names in home-folder paths and emails other
 *   than the sender's own. The user's own text loses token shapes only: its words, links and emails
 *   are what the user chose to send.
 * - THE DISCORD CARD CARRIES NO USER TEXT. Every field on it is an enum, a validated short string or a
 *   number: no email, text, file name or image.
 * - NOTHING DELETES A ROW. A delete (by a project manager) removes the R2 objects and clears the personal columns; the
 *   row stays as a tombstone.
 */
import type {CloudUser} from './auth'
import {hex, logError} from './env'
import {
    dailyCap, REPORT_CONTEXT_MAX, REPORT_ENVIRONMENT_MAX, REPORT_FILES_BYTES_MAX, REPORT_FILES_MAX, REPORT_IMAGE_MAX, REPORT_LOG_LINE_MAX,
    REPORT_LOG_LINES_MAX, REPORT_NOTE_MAX, REPORT_TEXT_MAX, REPORT_VERSIONS_MAX, REPORTS_LIST_MAX, reportsDaily, sizeText,
} from './limits'

export const TYPES = ['bug', 'question', 'idea', 'other'] as const
export const STATUSES = ['new', 'in_progress', 'waiting_reporter', 'closed', 'spam'] as const
export type ReportType = typeof TYPES[number]
const CARD_COLORS: Record<ReportType, number> = {bug: 0xd9534f, question: 0x5bc0de, idea: 0x5cb85c, other: 0x999999}

// The limits are in src/limits.ts; these two only shorten what is stored.
const SUMMARY_MAX = 200
const NAME_MAX = 200

/** A surface or a cause kind: a short lower-case word. */
const WORD = /^[a-z][a-z0-9-]{0,31}$/
const VERSION = /^[\w.+-]{1,40}$/
/** A version key: 'threepipe', 'app', 'plugin-modelling', … */
const VERSION_KEY = /^[a-z][a-z0-9-]{0,39}$/
const EXT = /^[a-z0-9]{1,8}$/
// No '?', '=' or '&': a mailto: link built from a sender's address must not gain headers.
const EMAIL = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i
/** The versions the card shows: the framework and the app. The rest stay in the report. */
const CARD_VERSION_KEYS = ['threepipe', 'app']

// ---- ids ----------------------------------------------------------------------
// Crockford base32: no I, L, O or U, so an id read aloud or retyped survives.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newReportId(): string {
    const b = crypto.getRandomValues(new Uint8Array(6))
    return 'R-' + [...b].map(x => ALPHABET[x % 32]).join('')
}

/** 'r7k3f9q', 'R-7K3F9Q' and 'R 7K3F9O' all name R-7K3F9Q. */
export function normalizeReportId(s: unknown): string | null {
    if (typeof s !== 'string') return null
    let t = s.toUpperCase().replace(/[^0-9A-Z]/g, '')
    if (t.length === 7 && t.startsWith('R')) t = t.slice(1)
    if (t.length !== 6) return null
    t = t.replace(/O/g, '0').replace(/[IL]/g, '1')
    return [...t].every(c => ALPHABET.includes(c)) ? 'R-' + t : null
}

// ---- redaction ----------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** File extensions that look like a top-level domain after an '@' (logo@2x.png). */
const NOT_A_TLD = /^(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|exr|hdr|ktx2?|glb|gltf|3dm|obj|fbx|stl|usdz|blend|ply|js|mjs|ts|css|json|html?|bin|wasm|zip|mp4|mov|webm|pdf|txt)$/i

function redactUrl(u: string): string {
    // A stack frame's ':line:col' comes after the query ('app.js?v=3:12:7'): it stays.
    const pos = /(?::\d+){1,2}$/.exec(u)?.[0] ?? ''
    if (pos) return redactUrl(u.slice(0, -pos.length)) + pos
    try {
        const url = new URL(u)
        return url.origin === 'null' ? url.protocol + '//' + url.pathname.replace(/^\/\//, '') : url.origin + url.pathname
    } catch {
        return u.replace(/[?#].*$/, '')
    }
}

/** Secret shapes. Shared by the full pass and the pass over the user's own text. */
function redactTokens(s: string): string {
    return s
        .replace(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '<token>')
        .replace(/\b(bearer|basic)\s+[\w.~+/-]{8,}=*/gi, (_m, scheme) => `${scheme} <token>`)
        // key = value and "key": "value", where the key ends in a secret word: access_token, refreshToken, client_secret, x-api-key, …
        .replace(/([\w-]*(?:token|secret|password|passwd|session|cookie|api[_-]?key|auth|credential)s?)(["']?\s*[:=]\s*["']?)[^\s"',;&]{8,}/gi, '$1$2<token>')
        .replace(/\b(?:sk|rk|pk)_(?:live|test)_\w{8,}|\bwhsec_\w{16,}|\bre_\w{16,}|\bgh[pousr]_\w{20,}|\bgithub_pat_\w{20,}|\bglpat-[\w-]{20,}|\bxox[abprs]-[\w-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[\w-]{35}|\bsk-[\w-]{32,}/g, '<token>')
}

/** The user name in a home-folder path: /Users/jane/…, /home/jane/…, C:\Users\jane\… (also inside file:// URLs). */
function redactHomePaths(s: string): string {
    return s
        .replace(/(\/(?:Users|home)\/)(?!<user>)[^/\s"'<>:]+/g, '$1<user>')
        .replace(/(\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)(?!<user>)[^\\/\s"'<>:]+/gi, '$1<user>')
}

/**
 * The server's pass over every string of a report except the user's own text. The client redacts
 * first; this pass catches what a client of another version, or a page that logs something new,
 * lets through. `keep` is the sender's own email.
 */
export function redact(s: string, keep?: string): string {
    return redactTokens(redactHomePaths(s.replace(/\b(?:https?|file):\/\/[^\s"'<>)\]]+/gi, redactUrl)))
        .replace(/\b[0-9a-f]{32,}\b/gi, '<token>')
        .replace(/\b[\w-]{40,}\b/g, m => UUID.test(m) || !(/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m)) ? m : '<token>')
        .replace(/[^\s@<>()",;:'`]{1,64}@[a-z0-9.-]{1,190}\.([a-z]{2,24})\b/gi, (m, tld) =>
            NOT_A_TLD.test(tld) ? m : keep && m.toLowerCase() === keep ? m : '<email>')
}

/** Every string inside a JSON value, keys too, redacted. */
function redactDeep(v: unknown, keep?: string, depth = 0): unknown {
    if (typeof v === 'string') return redact(v, keep)
    if (depth > 4) return null
    if (Array.isArray(v)) return v.map(x => redactDeep(x, keep, depth + 1))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [redact(k.slice(0, 64), keep), redactDeep(x, keep, depth + 1)]))
    return typeof v === 'number' || typeof v === 'boolean' || v === null ? v : null
}

// ---- the report ---------------------------------------------------------------
export interface Cause {kind: string, message?: string, ext?: string, frame?: string}

export interface ParsedReport {
    type: ReportType
    surface: string
    route: string
    text: string
    /** As typed, not verified. */
    email?: string
    cause?: Cause
    versions: Record<string, string>
    environment: unknown
    context: unknown
    log: string[]
    image?: {bytes: Uint8Array, type: string, ext: string}
}

type Parsed = {ok: true, report: ParsedReport} | {ok: false, status: number, error: string, field?: string}
const fail = (field: string, error: string, status = 400): Parsed => ({ok: false, status, error, field})

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).byteLength

function decodeImage(s: string): ParsedReport['image'] | null {
    const m = s.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/)
    if (!m) return null
    let bin: string
    try { bin = atob(m[2]) } catch { return null }
    if (bin.length > REPORT_IMAGE_MAX) return null
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    // The declared type must match the bytes, so a stored "image" is one.
    const magic = m[1] === 'jpeg' ? bytes[0] === 0xFF && bytes[1] === 0xD8
        : m[1] === 'png' ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
            : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    if (!magic) return null
    return {bytes, type: `image/${m[1]}`, ext: m[1] === 'jpeg' ? 'jpg' : m[1]}
}

/** Checks the report JSON of POST /reports and redacts it. */
export function parseReport(body: any): Parsed {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body', 'the report is a JSON object')
    if (!TYPES.includes(body.type)) return fail('type', `type is one of ${TYPES.join(', ')}`)
    if (typeof body.surface !== 'string' || !WORD.test(body.surface)) return fail('surface', 'surface is a short lower-case word')
    if (body.text !== undefined && typeof body.text !== 'string') return fail('text', 'text is a string')
    if ((body.text || '').length > REPORT_TEXT_MAX) return fail('text', `text is at most ${REPORT_TEXT_MAX} characters`)

    let email: string | undefined
    if (body.email !== undefined && body.email !== '' && body.email !== null) {
        if (typeof body.email !== 'string' || !EMAIL.test(body.email.trim())) return fail('email', 'email is not an email address')
        email = body.email.trim().toLowerCase()
    }

    let cause: Cause | undefined
    if (body.cause !== undefined && body.cause !== null) {
        const c = body.cause
        if (typeof c !== 'object' || typeof c.kind !== 'string' || !WORD.test(c.kind)) return fail('cause', 'cause.kind is a short lower-case word')
        cause = {kind: c.kind}
        if (typeof c.message === 'string' && c.message) cause.message = redact(c.message.slice(0, 300), email)
        if (typeof c.ext === 'string' && EXT.test(c.ext.toLowerCase())) cause.ext = c.ext.toLowerCase()
        if (typeof c.frame === 'string' && c.frame) cause.frame = redact(c.frame.slice(0, 200), email)
    }

    // The card shows some versions, so anything that is not a plain version is dropped.
    if (body.versions !== undefined && (typeof body.versions !== 'object' || body.versions === null || Array.isArray(body.versions))) return fail('versions', 'versions is an object')
    const versions: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.versions ?? {}).slice(0, REPORT_VERSIONS_MAX)) {
        if (VERSION_KEY.test(k) && typeof v === 'string' && VERSION.test(v)) versions[k] = v
    }

    for (const [field, max] of [['environment', REPORT_ENVIRONMENT_MAX], ['context', REPORT_CONTEXT_MAX]] as const) {
        const v = body[field]
        if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v))) return fail(field, `${field} is an object`)
        if (jsonBytes(v) > max) return fail(field, `${field} is at most ${max} bytes of JSON`, 413)
    }
    if (body.log !== undefined && (!Array.isArray(body.log) || body.log.some((l: unknown) => typeof l !== 'string'))) return fail('log', 'log is an array of strings')
    const log = ((body.log || []) as string[]).slice(-REPORT_LOG_LINES_MAX).map(l => redact(l.slice(0, REPORT_LOG_LINE_MAX), email))

    let image: ParsedReport['image']
    if (body.image !== undefined && body.image !== null) {
        const img = typeof body.image === 'string' ? decodeImage(body.image) : null
        if (!img) return fail('image', `image is a JPEG, PNG or WebP data URL of at most ${sizeText(REPORT_IMAGE_MAX)}`)
        image = img
    }

    return {ok: true, report: {
        type: body.type,
        surface: body.surface,
        route: typeof body.route === 'string' ? redact(body.route.replace(/[?#].*$/, '').slice(0, 300)) : '',
        text: redactTokens(body.text || ''),
        email,
        cause,
        versions,
        environment: redactDeep(body.environment ?? {}, email),
        context: redactDeep(body.context ?? {}, email),
        log,
        image,
    }}
}

/** A sent file: a name and its bytes. */
export interface SentFile {name: string, bytes: Uint8Array}

/** Checks the files of a multipart report. */
export function checkFiles(files: SentFile[]): {error: string, status: number} | null {
    if (files.length > REPORT_FILES_MAX) return {error: `at most ${REPORT_FILES_MAX} files`, status: 400}
    for (const f of files) {
        if (!f.name.trim() || f.name.length > NAME_MAX) return {error: 'each file has a name', status: 400}
        if (!f.bytes.byteLength) return {error: `the file ${safeName(f.name)} is empty`, status: 400}
    }
    if (files.reduce((n, f) => n + f.bytes.byteLength, 0) > REPORT_FILES_BYTES_MAX) return {error: `the files are at most ${sizeText(REPORT_FILES_BYTES_MAX)} together`, status: 413}
    return null
}

// ---- small helpers --------------------------------------------------------------

async function hmac(key: string, msg: string): Promise<string> {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
    return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))
}

/** The /64 of an IPv6 address — one home or one server gets that much — or the IPv4 address. */
export function ipSender(ip: string): string {
    if (!ip.includes(':')) return ip
    const [head, tail = ''] = ip.split('::')
    const left = head ? head.split(':') : []
    const right = tail ? tail.split(':') : []
    const full = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
    return full.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/**
 * Who the daily caps count: the user id of a signed-in sender, else a keyed hash of the IP (its /64 for
 * IPv6), never the IP in clear: a plain hash of an IPv4 address is reversed by trying all of them. The key
 * is derived from REPORTS_RATE_SECRET; rotating it resets the counts. A delete keeps it, so deleting spam
 * does not refill the sender's quota.
 */
export async function senderOf(env: CloudflareBindings, req: Request, userId?: string): Promise<string> {
    if (userId) return `u:${userId}`
    if (!env.REPORTS_RATE_SECRET) throw new Error('REPORTS_RATE_SECRET is not set')
    const k = await hmac(env.REPORTS_RATE_SECRET, 'reports-rate-key')
    return 'ip:' + (await hmac(k, `ip:${ipSender(req.headers.get('cf-connecting-ip') || 'unknown')}`)).slice(0, 32)
}

/** A file name with no path, quotes or control characters: for the object key and the download. */
export function safeName(name: string): string {
    return name.replace(/[^\w. -]+/g, '_').replace(/^[. ]+/, '').slice(-120) || 'file'
}

const fileKey = (key: string, idx: number, name: string) => `reports/${key}/files/${idx}-${safeName(name)}`
const bundleKey = (key: string) => `reports/${key}/report.json`
const imageKey = (key: string, ext: string) => `reports/${key}/image.${ext}`
const IMAGE_EXTS = ['jpg', 'png', 'webp']

type Row = Record<string, any>
export type Result = {status: number, body: unknown}

/** A project's report: reports are only ever looked up inside their project. */
async function rowById(env: CloudflareBindings, project: string, id: string): Promise<Row | null> {
    return env.PRIMARY_DB.prepare('SELECT * FROM reports WHERE id = ?1 AND project_id = ?2').bind(id, project).first()
}

async function filesOf(env: CloudflareBindings, id: string): Promise<Row[]> {
    return (await env.PRIMARY_DB.prepare('SELECT * FROM report_files WHERE report_id = ?1 ORDER BY idx').bind(id).all<Row>()).results
}

// ---- intake -------------------------------------------------------------------

export interface Project {id: string, slug: string, name: string, discord_webhook: string | null}

export interface CreateOptions {
    env: CloudflareBindings
    req: Request
    project: Project
    /** the signed-in sender, if any (no Turnstile for them) */
    user?: CloudUser
    clientKey: string
    report: unknown
    files: SentFile[]
    /** where to open the report, for the Discord card */
    reportsUrl: string
    ctx?: {waitUntil(p: Promise<unknown>): void}
}

/** POST /api/v1/projects/<slug>/reports, after the gate (signed in, or a Turnstile pass). */
export async function createReport(o: CreateOptions): Promise<Result> {
    const {env, req, project, clientKey, files} = o
    const userId = o.user?.id
    const db = env.PRIMARY_DB
    const parsed = parseReport(o.report)
    if (!parsed.ok) return {status: parsed.status, body: {error: parsed.error, field: parsed.field}}
    const bad = checkFiles(files)
    if (bad) return {status: bad.status, body: {error: bad.error, field: 'files'}}
    const p = parsed.report
    const sender = await senderOf(env, req, userId)

    // A retry of the same dialog (its response was lost): the same report, never a second. Only the
    // same sender learns the id.
    const prior = await db.prepare('SELECT id, rate_key FROM reports WHERE project_id = ?1 AND client_key = ?2').bind(project.id, clientKey).first<Row>()
    if (prior) return prior.rate_key === sender ? {status: 200, body: {id: prior.id, repeat: true}} : {status: 409, body: {error: 'Idempotency-Key already used'}}

    // The caps over the last 24 hours: reports per sender, reports per project and in total (a flood of
    // Turnstile passes or accounts cannot fill the store), and attached bytes in total.
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const [mine, proj, all] = await db.batch([
        db.prepare('SELECT COUNT(*) AS n FROM reports WHERE rate_key = ?1 AND created_at >= ?2').bind(sender, since),
        db.prepare('SELECT COUNT(*) AS n FROM reports WHERE project_id = ?1 AND created_at >= ?2').bind(project.id, since),
        db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(files_bytes), 0) AS b FROM reports WHERE created_at >= ?1').bind(since),
    ]) as D1Result<{n: number, b: number}>[]
    // Checked here before anything is uploaded, and again by the INSERT itself (requests at the same time all pass here)
    const caps = {sender: o.user ? reportsDaily(env, o.user) : dailyCap(env, 'perSender'), project: dailyCap(env, 'perProject'),
        all: dailyCap(env, 'all'), fileBytes: dailyCap(env, 'fileBytes')}
    const tooMany = {status: 429, body: {error: 'too many reports today, try again tomorrow'}}
    if ((mine.results[0]?.n ?? 0) >= caps.sender) return tooMany
    if ((proj.results[0]?.n ?? 0) >= caps.project) return tooMany
    if ((all.results[0]?.n ?? 0) >= caps.all) {
        logError('reports: the daily cap for all reports is reached', {cap: caps.all})
        return tooMany
    }
    const bytes = files.reduce((n, f) => n + f.bytes.byteLength, 0)
    if (bytes && (all.results[0]?.b ?? 0) + bytes > caps.fileBytes) {
        return {status: 429, body: {error: 'too many file bytes today: send the report without the files, or try again tomorrow'}}
    }

    const key = crypto.randomUUID()
    const now = new Date().toISOString()
    const origin = originHost(req.headers.get('origin'))
    const imageName = p.image ? imageKey(key, p.image.ext) : null
    const written: string[] = []
    try {
        if (p.image && imageName) {
            await env.CLOUD_BUCKET.put(imageName, p.image.bytes, {httpMetadata: {contentType: p.image.type}})
            written.push(imageName)
        }
        for (const [idx, f] of files.entries()) {
            const k = fileKey(key, idx, f.name)
            await env.CLOUD_BUCKET.put(k, f.bytes, {httpMetadata: {contentType: 'application/octet-stream'}})
            written.push(k)
        }
        // The id is random; a collision is retried with a new one. A repeated client_key that raced
        // this request returns that report.
        for (let attempt = 0; ; attempt++) {
            const id = newReportId()
            const bundle = {
                v: 1, id, project: project.slug, created_at: now, origin: req.headers.get('origin'), user_id: userId ?? null,
                type: p.type, surface: p.surface, route: p.route, text: p.text, email: p.email ?? null,
                cause: p.cause ?? null, versions: p.versions, environment: p.environment, context: p.context,
                log: p.log,
                image: imageName ? imageName.split('/').pop() : null,
                files: files.map(f => ({name: f.name, size: f.bytes.byteLength})),
                request: {ray: req.headers.get('cf-ray'), country: (req as any).cf?.country ?? null, user_agent: (req.headers.get('user-agent') || '').slice(0, 300)},
            }
            const text = JSON.stringify(bundle)
            await env.CLOUD_BUCKET.put(bundleKey(key), text, {httpMetadata: {contentType: 'application/json'}})
            if (!written.includes(bundleKey(key))) written.push(bundleKey(key))
            let inserted: D1Result
            try {
                // One statement: the row goes in only while every cap still has room, so a burst of requests that all
                // passed the checks above cannot get past them; the report's files only with its row.
                [inserted] = await db.batch([
                    db.prepare(`INSERT INTO reports
                        (id, project_id, key, client_key, created_at, origin, type, surface, email, user_id, rate_key, summary, cause,
                         versions_json, has_image, bundle_bytes, files_count, files_bytes)
                        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
                        WHERE (SELECT COUNT(*) FROM reports WHERE rate_key = ?11 AND created_at >= ?19) < ?20
                          AND (SELECT COUNT(*) FROM reports WHERE project_id = ?2 AND created_at >= ?19) < ?21
                          AND (SELECT COUNT(*) FROM reports WHERE created_at >= ?19) < ?22
                          AND (?18 = 0 OR (SELECT COALESCE(SUM(files_bytes), 0) FROM reports WHERE created_at >= ?19) + ?18 <= ?23)`)
                        .bind(id, project.id, key, clientKey, now, origin, p.type, p.surface, p.email ?? null, userId ?? null, sender,
                            p.text.slice(0, SUMMARY_MAX) || null, p.cause?.kind ?? null, JSON.stringify(p.versions),
                            imageName ? 1 : 0, new TextEncoder().encode(text).byteLength, files.length, bytes,
                            since, caps.sender, caps.project, caps.all, caps.fileBytes),
                    ...files.map((f, idx) => db.prepare(`INSERT INTO report_files (id, report_id, idx, name, size, state)
                        SELECT ?1, ?2, ?3, ?4, ?5, 'done' WHERE EXISTS (SELECT 1 FROM reports WHERE id = ?2)`).bind(crypto.randomUUID(), id, idx, f.name, f.bytes.byteLength)),
                ])
            } catch (e: any) {
                const msg = String(e?.message || e)
                if (/UNIQUE.*reports\.id/.test(msg) && attempt < 4) continue
                if (/UNIQUE.*reports\.(project_id, reports\.)?client_key/.test(msg)) {
                    await cleanup(env, written)
                    const raced = await db.prepare('SELECT id, rate_key FROM reports WHERE project_id = ?1 AND client_key = ?2').bind(project.id, clientKey).first<Row>()
                    return raced && raced.rate_key === sender ? {status: 200, body: {id: raced.id, repeat: true}} : {status: 409, body: {error: 'try again'}}
                }
                throw e
            }
            if (!inserted.meta.changes) {
                await cleanup(env, written)
                return tooMany
            }
            const row: CardRow = {id, project: project.slug, origin, type: p.type, surface: p.surface, cause: p.cause?.kind ?? null, ext: p.cause?.ext ?? null,
                versions: p.versions, files_count: files.length, files_bytes: bytes, has_image: !!imageName, log_lines: p.log.length, signed_in: !!userId}
            const send = postCard(project.discord_webhook, row, o.reportsUrl).then(state => db.prepare('UPDATE reports SET discord_state = ?1 WHERE id = ?2').bind(state, id).run())
                .catch(e => logError('report card', {id, exception: String(e?.stack || e)}))
            if (o.ctx) o.ctx.waitUntil(send)
            else await send
            console.log('report', JSON.stringify({id, project: project.slug, bytes: text.length, image: !!imageName, files: files.length, ray: req.headers.get('cf-ray')}))
            return {status: 201, body: {id}}
        }
    } catch (e) {
        await cleanup(env, written)
        throw e
    }
}

/** The host of the Origin header, validated: it is shown on the card. */
function originHost(origin: string | null): string | null {
    if (!origin) return null
    try {
        const h = new URL(origin).host
        return /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(h) ? h.toLowerCase() : null
    } catch {
        return null
    }
}

/** A failed intake leaves nothing behind in R2. */
async function cleanup(env: CloudflareBindings, written: string[]) {
    for (const k of written) await env.CLOUD_BUCKET.delete(k).catch(() => undefined)
}

// ---- the Discord card -----------------------------------------------------------

export interface CardRow {
    id: string, project: string, origin: string | null, type: string, surface: string,
    cause: string | null, ext: string | null, versions: Record<string, string>,
    files_count: number, files_bytes: number, has_image: boolean,
    /** Lines of the log; 0 for a report sent without it. */
    log_lines: number
    signed_in: boolean
}

/** A size in decimal units: 21 B, 2 KB, 73 MB. */
export const sizeLabel = (bytes: number) =>
    bytes < 1e3 ? `${bytes} B` : bytes < 1e6 ? `${Math.round(bytes / 1e3)} KB` : `${Math.round(bytes / 1e6)} MB`

/** The card for the project's channel. Every value on it is an enum, a validated short string or a
 *  number; `allowed_mentions` is empty, so nothing on it can ping anyone. */
export function card(r: CardRow, reportsUrl: string): object {
    const versions = CARD_VERSION_KEYS.filter(k => r.versions[k]).map(k => `${k} ${r.versions[k]}`).join(' · ') || 'none sent'
    const attached = [
        r.has_image ? 'screenshot' : '',
        r.files_count ? `${r.files_count} file${r.files_count === 1 ? '' : 's'}, ${sizeLabel(r.files_bytes)}` : '',
    ].filter(Boolean).join(', ') || (r.log_lines ? 'log only' : 'nothing')
    const fields = [
        {name: 'cause', value: r.cause ? `${r.cause}${r.ext ? ` (.${r.ext})` : ''}` : 'none named', inline: true},
        {name: 'attached', value: attached, inline: true},
        {name: 'from', value: `${r.origin || 'no origin'}${r.signed_in ? ', signed in' : ''}`, inline: true},
        {name: 'versions', value: versions},
    ]
    return {
        username: 'threepipe reports',
        allowed_mentions: {parse: []},
        embeds: [{
            title: `${r.id} · ${r.project} · ${r.type} · ${r.surface}`,
            description: `Open it: ${reportsUrl}`,
            color: CARD_COLORS[r.type as ReportType] ?? CARD_COLORS.other,
            fields,
        }],
    }
}

async function postCard(hook: string | null, r: CardRow, reportsUrl: string): Promise<'sent' | 'failed' | 'off'> {
    if (!hook) return 'off'
    try {
        const res = await fetch(hook, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(card(r, reportsUrl))})
        if (!res.ok) logError('discord webhook failed', {id: r.id, project: r.project, status: res.status})
        return res.ok ? 'sent' : 'failed'
    } catch (e: any) {
        logError('discord webhook failed', {id: r.id, project: r.project, error: String(e?.message || e)})
        return 'failed'
    }
}

// ---- project members --------------------------------------------------------------

/** The columns the list shows. Never the keys or the rate key. */
const LIST_COLUMNS = `id, created_at, origin, type, surface, email, user_id, summary, cause, versions_json, has_image, bundle_bytes,
    files_count, files_bytes, status, status_by, status_at, note, discord_state, deleted_at, deleted_by`

export interface ListQuery {status?: string, type?: string, q?: string, deleted?: boolean, limit?: number, before?: string}

function rowOut(r: Row) {
    const {versions_json, has_image, ...rest} = r
    let versions = {}
    try { versions = JSON.parse(versions_json || '{}') } catch { /* an unreadable row shows no versions */ }
    return {...rest, versions, has_image: !!has_image}
}

/** Newest first. `before` is the created_at|id of the last row of the previous page. */
export async function listReports(env: CloudflareBindings, project: string, q: ListQuery): Promise<{rows: unknown[], next: string | null}> {
    const args: unknown[] = [project]
    const where: string[] = ['project_id = ?1']
    const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `?${args.length}`)) }
    if (!q.deleted) where.push('deleted_at IS NULL')
    if (q.status) add('status = ?', q.status)
    if (q.type) add('type = ?', q.type)
    if (q.q) {
        const id = normalizeReportId(q.q)
        if (id) add('id = ?', id)
        else add('email = ?', q.q.trim().toLowerCase())
    }
    if (q.before) {
        const [at, id] = q.before.split('|')
        args.push(at, id || '')
        where.push(`(created_at < ?${args.length - 1} OR (created_at = ?${args.length - 1} AND id < ?${args.length}))`)
    }
    const limit = Math.min(Math.max(1, q.limit || 50), REPORTS_LIST_MAX)
    args.push(limit + 1)
    const sql = `SELECT ${LIST_COLUMNS} FROM reports WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?${args.length}`
    const {results} = await env.PRIMARY_DB.prepare(sql).bind(...args).all<Row>()
    const more = results.length > limit
    const rows = results.slice(0, limit).map(rowOut)
    const last = rows[rows.length - 1] as Row | undefined
    return {rows, next: more && last ? `${last.created_at}|${last.id}` : null}
}

/** One report: the row, its files and the stored document. */
export async function getReport(env: CloudflareBindings, project: string, id: string): Promise<Result> {
    const row = await rowById(env, project, id)
    if (!row) return {status: 404, body: {error: 'no such report'}}
    const doc = row.deleted_at ? null : await env.CLOUD_BUCKET.get(bundleKey(row.key))
    const files = (await filesOf(env, id)).map(({report_id: _r, id: _i, ...f}) => f)
    const {key: _k, client_key: _c, rate_key: _rk, project_id: _p, ...visible} = row
    return {status: 200, body: {row: rowOut(visible), files, report: doc ? await doc.json() : null}}
}

const fileHeaders = (type: string, extra: Record<string, string> = {}) => ({
    'content-type': type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', ...extra,
})

/** The screenshot, streamed. */
export async function getImage(env: CloudflareBindings, project: string, id: string): Promise<Response | Result> {
    const row = await rowById(env, project, id)
    if (!row || row.deleted_at || !row.has_image) return {status: 404, body: {error: 'no image'}}
    for (const ext of IMAGE_EXTS) {
        const o = await env.CLOUD_BUCKET.get(imageKey(row.key, ext))
        if (o) return new Response(o.body, {headers: fileHeaders(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)})
    }
    return {status: 404, body: {error: 'no image'}}
}

/** Attached file `idx`, streamed as a download. */
export async function getFile(env: CloudflareBindings, project: string, id: string, idx: number): Promise<Response | Result> {
    const row = await rowById(env, project, id)
    if (!row || row.deleted_at) return {status: 404, body: {error: 'no such report'}}
    const f = await env.PRIMARY_DB.prepare('SELECT * FROM report_files WHERE report_id = ?1 AND idx = ?2').bind(id, idx).first<Row>()
    if (!f || f.state !== 'done') return {status: 404, body: {error: 'no such file'}}
    const o = await env.CLOUD_BUCKET.get(fileKey(row.key, idx, f.name))
    if (!o) return {status: 404, body: {error: 'no file'}}
    return new Response(o.body, {headers: fileHeaders('application/octet-stream', {'content-disposition': `attachment; filename="${safeName(f.name)}"`})})
}

/** PATCH {status?, note?}. `by` is the member's username, never a body field. */
export async function updateReport(env: CloudflareBindings, project: string, id: string, body: any, by: string): Promise<Result> {
    const row = await rowById(env, project, id)
    if (!row) return {status: 404, body: {error: 'no such report'}}
    if (row.deleted_at) return {status: 409, body: {error: 'the report is deleted'}}
    const sets: string[] = []
    const args: unknown[] = []
    if (body?.status !== undefined) {
        if (!STATUSES.includes(body.status)) return {status: 400, body: {error: `status is one of ${STATUSES.join(', ')}`}}
        args.push(body.status, by, new Date().toISOString())
        sets.push(`status = ?${args.length - 2}`, `status_by = ?${args.length - 1}`, `status_at = ?${args.length}`)
    }
    if (body?.note !== undefined) {
        if (body.note !== null && (typeof body.note !== 'string' || body.note.length > REPORT_NOTE_MAX)) return {status: 400, body: {error: `note is at most ${REPORT_NOTE_MAX} characters`}}
        args.push(body.note || null)
        sets.push(`note = ?${args.length}`)
    }
    if (!sets.length) return {status: 400, body: {error: 'nothing to change: status or note'}}
    args.push(id)
    await env.PRIMARY_DB.prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?${args.length} AND deleted_at IS NULL`).bind(...args).run()
    console.log('report update', JSON.stringify({id, by, status: body?.status}))
    return getReport(env, project, id)
}

/** DELETE the report: the R2 objects go, the personal columns are cleared, the row stays. The rate
 *  key (a keyed hash or the user id) stays too, so deleting spam does not refill the quota. */
export async function deleteReport(env: CloudflareBindings, project: string, id: string, by: string): Promise<Result> {
    const row = await rowById(env, project, id)
    if (!row) return {status: 404, body: {error: 'no such report'}}
    if (row.deleted_at) return {status: 200, body: {id, deleted_at: row.deleted_at}}
    const files = (await filesOf(env, id)).filter(f => f.name !== null).map(f => fileKey(row.key, f.idx, f.name))
    await env.CLOUD_BUCKET.delete([bundleKey(row.key), ...IMAGE_EXTS.map(ext => imageKey(row.key, ext)), ...files])
    const at = new Date().toISOString()
    await env.PRIMARY_DB.batch([
        env.PRIMARY_DB.prepare(`UPDATE reports SET deleted_at = ?1, deleted_by = ?2, email = NULL, summary = NULL, note = NULL,
            has_image = 0 WHERE id = ?3`).bind(at, by, id),
        env.PRIMARY_DB.prepare(`UPDATE report_files SET state = 'deleted', name = NULL WHERE report_id = ?1`).bind(id),
    ])
    console.log('report delete', JSON.stringify({id, by}))
    return {status: 200, body: {id, deleted_at: at}}
}
