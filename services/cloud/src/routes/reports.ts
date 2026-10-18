// Copied from ijewel-mono services/ops-worker/src/routes/support.ts @ 54d43285 (IJ-564), simplified for threepipe.
/**
 * /reports — the intake of reports from threepipe apps. The one route a person's browser calls
 * without a token: src/reports.ts does the work; this file is the HTTP contract.
 *
 *   POST /reports    cf-turnstile-response: a Turnstile pass (src/lib/turnstile.ts).
 *                    Idempotency-Key: one per dialog, the same on a retry.
 *                    application/json: the report, the screenshot inline as a data URL; or
 *                    multipart/form-data: `report` (that JSON) and up to FILES_MAX `file` parts.
 *                    → 201 {id} · 200 {id, repeat} for a repeated key
 *
 * CORS: the origins in ORIGINS and local ones (localhost, *.localhost). CORS is not the gate;
 * Turnstile is. Nothing here reads a report: that is /staff (src/routes/staff.ts).
 */
import type {Env} from '../env.ts'
import {cors, json} from '../common/http.ts'
import {envOf} from '../common/compare.ts'
import {checkTurnstile} from '../common/turnstile.ts'
import {BODY_MAX, createReport, REPORT_MAX, SentFile} from '../reports.ts'

const METHODS = 'POST, OPTIONS'

/** The body as bytes, or null when it is larger than `max` — also without Content-Length. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
    if (Number(req.headers.get('content-length') || 0) > max) return null
    if (!req.body) return new Uint8Array(0)
    const reader = req.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > max) {
            await reader.cancel().catch(() => undefined)
            return null
        }
        chunks.push(value)
    }
    const all = new Uint8Array(size)
    let at = 0
    for (const c of chunks) { all.set(c, at); at += c.byteLength }
    return all
}

export async function handleReports(req: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
    if (url.pathname !== '/reports') return json({error: 'not found'}, 404)
    if (req.method === 'OPTIONS') return cors(req, env, new Response(null, {status: 204}), METHODS)
    if (req.method !== 'POST') return json({error: 'not found'}, 404)
    try {
        return cors(req, env, await intake(req, env, ctx), METHODS)
    } catch (e: any) {
        const ray = req.headers.get('cf-ray') || null
        console.error('reports', ray, e?.stack || e)
        return cors(req, env, json({error: 'internal', request_id: ray}, 500), METHODS)
    }
}

async function intake(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const envTag = envOf(env, req.headers.get('origin'))
    if (!envTag) return json({error: 'origin not allowed'}, 403)
    const clientKey = (req.headers.get('idempotency-key') || '').trim()
    if (!/^[\w-]{8,100}$/.test(clientKey)) return json({error: 'Idempotency-Key header required: one value per dialog, the same value on a retry'}, 400)
    const gate = await checkTurnstile(env, req)
    if (!gate.ok) return json({error: gate.error}, gate.status)

    const type = (req.headers.get('content-type') || '').toLowerCase()
    const multipart = type.startsWith('multipart/form-data')
    // Capped while it is read: a chunked body has no Content-Length to check first.
    const raw = await readCapped(req, multipart ? BODY_MAX : REPORT_MAX)
    if (raw === null) return json({error: 'body too large'}, 413)
    let report: unknown
    const files: SentFile[] = []
    if (multipart) {
        let form: FormData
        try { form = await new Response(raw, {headers: {'content-type': type}}).formData() } catch { return json({error: 'bad multipart body'}, 400) }
        const r = form.get('report')
        if (typeof r !== 'string') return json({error: 'the multipart body has a `report` field with the report JSON', field: 'report'}, 400)
        if (r.length > REPORT_MAX) return json({error: 'report too large'}, 413)
        try { report = JSON.parse(r) } catch { return json({error: 'report must be JSON', field: 'report'}, 400) }
        for (const [field, value] of form) {
            if (field !== 'file' || typeof value === 'string') continue
            files.push({name: value.name || 'file', bytes: new Uint8Array(await value.arrayBuffer())})
        }
    } else {
        try { report = JSON.parse(new TextDecoder().decode(raw)) } catch { return json({error: 'body must be JSON'}, 400) }
    }
    const r = await createReport({env, req, clientKey, report, files, envTag, ctx})
    return json(r.body, r.status)
}
