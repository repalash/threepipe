/**
 * The report a dialog sends to `POST <endpoint>/api/v1/projects/<project>/reports` (services/cloud/src/projects.ts),
 * its limits (the worker's, so the page refuses what the worker would), and the request itself.
 */
import {redact, redactDeep, redactTokens} from './redact'

export const REPORT_TYPES = ['bug', 'question', 'idea', 'other'] as const
export type ReportType = typeof REPORT_TYPES[number]

/** The worker's limits (services/cloud/src/limits.ts): keep them the same. */
export const LIMITS = {
    text: 10_000,
    logLines: 500,
    logLine: 1000,
    environmentBytes: 8 * 1024,
    contextBytes: 16 * 1024,
    imageBytes: 3 * 1024 * 1024,
    files: 3,
    filesBytes: 10 * 1024 * 1024,
} as const

export interface ReportCause {
    /** A short lower-case word: 'error', 'unhandled-rejection', 'context-lost', 'operation', … */
    kind: string
    message?: string
    /** A file extension the problem concerns (an import that failed). */
    ext?: string
    /** The top stack frame. */
    frame?: string
}

/** The report JSON. Every string but `text` is redacted before it is built. */
export interface ReportJson {
    type: ReportType
    /** Where the dialog opened: 'modelling-editor', 'examples', … */
    surface: string
    /** The page's path, without query or fragment. */
    route?: string
    text: string
    email?: string
    cause?: ReportCause
    versions?: Record<string, string>
    environment?: Record<string, unknown>
    context?: Record<string, unknown>
    log?: string[]
    /** The screenshot as a JPEG, PNG or WebP data URL. */
    image?: string
}

export interface ReportFile {
    name: string
    blob: Blob
}

export interface ReportPayload {
    report: ReportJson
    files: ReportFile[]
}

const SLUG = /^[a-z][a-z0-9-]{0,31}$/
const EMAIL = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i
const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).byteLength

/** The redacted report: the sender's text loses token shapes only; everything else gets the full pass. */
export function redactReport(r: ReportJson): ReportJson {
    const own = r.email?.trim().toLowerCase() || undefined
    return {
        ...r,
        route: r.route !== undefined ? redact(r.route.replace(/[?#].*$/, '')) : undefined,
        text: redactTokens(r.text),
        cause: r.cause ? {...r.cause, message: r.cause.message !== undefined ? redact(r.cause.message, own) : undefined, frame: r.cause.frame !== undefined ? redact(r.cause.frame, own) : undefined} : undefined,
        environment: r.environment ? redactDeep(r.environment, own) as Record<string, unknown> : undefined,
        context: r.context ? redactDeep(r.context, own) as Record<string, unknown> : undefined,
        log: r.log?.slice(-LIMITS.logLines).map(l => redact(l, own).slice(0, LIMITS.logLine)),
    }
}

/** What the worker would refuse, as a sentence for the person; null when the payload is fine. */
export function checkPayload(p: ReportPayload): string | null {
    const r = p.report
    if (!REPORT_TYPES.includes(r.type)) return `The type is one of ${REPORT_TYPES.join(', ')}.`
    if (!SLUG.test(r.surface)) return 'The surface is a short lower-case word.'
    if (r.text.length > LIMITS.text) return `The text is at most ${LIMITS.text} characters.`
    if (r.email && !EMAIL.test(r.email.trim())) return 'The email address does not look like one.'
    if (r.cause && !SLUG.test(r.cause.kind)) return 'The cause is a short lower-case word.'
    if (r.environment && jsonBytes(r.environment) > LIMITS.environmentBytes) return 'The environment is too large.'
    if (r.context && jsonBytes(r.context) > LIMITS.contextBytes) return 'The app context is too large.'
    if (r.image) {
        if (!/^data:image\/(jpeg|png|webp);base64,/.test(r.image)) return 'The screenshot is not a JPEG, PNG or WebP image.'
        if (Math.floor((r.image.length - r.image.indexOf(',') - 1) * 3 / 4) > LIMITS.imageBytes) return 'The screenshot is too large.'
    }
    if (p.files.length > LIMITS.files) return `At most ${LIMITS.files} files.`
    const bytes = p.files.reduce((n, f) => n + f.blob.size, 0)
    if (bytes > LIMITS.filesBytes) return `The files are ${(bytes / 1e6).toFixed(1)} MB together; at most ${LIMITS.filesBytes / 1024 / 1024} MB.`
    return null
}

export interface SendOptions {
    /** One per dialog, the same on a retry: a retried send never makes a second report. */
    idempotencyKey: string
    /** The signed-in person's key (`cloud.auth.key`): no Turnstile pass is needed then. */
    key?: string
    /** The Turnstile pass, for a person who is not signed in. */
    turnstileToken?: string
    fetch?: typeof fetch
}

/** Thrown for a refused or failed send; `status` is the HTTP status (0: no answer). */
export class ReportError extends Error {
    constructor(message: string, public status: number, public field?: string) {
        super(message)
        this.name = 'ReportError'
    }
}

/** The reports URL of a project. */
export const reportsUrl = (endpoint: string, project: string) => `${endpoint.replace(/\/+$/, '')}/api/v1/projects/${encodeURIComponent(project)}/reports`

/** The request to `url` (reportsUrl): JSON, or multipart/form-data (`report` and the `file` parts) when files go with it. */
export function buildRequest(url: string, p: ReportPayload, o: SendOptions): {url: string, init: RequestInit} {
    const headers: Record<string, string> = {'idempotency-key': o.idempotencyKey}
    if (o.key) headers.authorization = `Bearer ${o.key}`
    else if (o.turnstileToken) headers['cf-turnstile-response'] = o.turnstileToken
    let body: BodyInit
    if (p.files.length) {
        const fd = new FormData()
        fd.set('report', JSON.stringify(p.report))
        for (const f of p.files) fd.append('file', f.blob, f.name)
        body = fd
    } else {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(p.report)
    }
    return {url, init: {method: 'POST', headers, body, credentials: 'omit'}}
}

/** Sends the report to `url` (reportsUrl); the public id (R-7K3F9Q) on success. */
export async function sendReport(url: string, p: ReportPayload, o: SendOptions): Promise<{id: string, repeat?: boolean}> {
    const bad = checkPayload(p)
    if (bad) throw new ReportError(bad, 400)
    const {init} = buildRequest(url, p, o)
    let res: Response
    try {
        res = await (o.fetch ?? fetch)(url, init)
    } catch (e) {
        throw new ReportError('Could not reach the report server. Check the connection and send again.', 0)
    }
    const body = await res.json().catch(() => null) as {id?: string, repeat?: boolean, error?: string, message?: string, field?: string} | null
    const reason = body?.error ?? body?.message
    if (!res.ok || !body?.id) throw new ReportError(reason ? `The server refused the report: ${reason}` : `The server answered ${res.status}.`, res.status, body?.field)
    return {id: body.id, repeat: body.repeat}
}
