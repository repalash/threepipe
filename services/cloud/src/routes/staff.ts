// Copied from ijewel-mono services/ops-worker/src/routes/supportStaff.ts @ 54d43285 (IJ-564), with a staff-token gate
// in place of the CRM's Google gate.
/**
 * /staff — the staff side of the reports, behind STAFF_TOKENS (`Authorization: Bearer <token>`).
 * src/reports.ts does the work.
 *
 *   GET    /staff                              the staff page (no data; it asks for the token)
 *   GET    /staff/reports?status=&type=&q=&deleted=1&limit=&before=
 *                                              newest first; q is a report id or an email
 *                                              → {rows, next} (next is the `before` of the next page)
 *   GET    /staff/reports/<id>                 {row, files, report}: the row, its files and the stored document
 *   GET    /staff/reports/<id>/image           the screenshot
 *   GET    /staff/reports/<id>/files/<i>       attached file i, as a download
 *   PATCH  /staff/reports/<id>                 {status?, note?} → {row, files, report}
 *   DELETE /staff/reports/<id>                 deletes the document, the screenshot and the files;
 *                                              the row stays with its dates and who deleted it
 *
 * The actor of a change is the name of the token, never a body field. Everything a report holds is
 * user input: the page escapes all of it, and shows the screenshot only as a blob from an authorised
 * fetch. Anything not listed is a 404.
 */
import type {Env} from '../env.ts'
import {json, presentedToken, tokenOwner} from '../common/http.ts'
import {deleteReport, FILES_MAX, getFile, getImage, getReport, LIST_MAX, listReports, normalizeReportId, STATUSES, TYPES, updateReport} from '../reports.ts'
import PAGE from '../staff/page.html'
import SCRIPT from '../staff/page.client.js'

const ONE = /^\/staff\/reports\/([^/]+)(?:\/(image|files\/(\d)))?$/

function allowed(path: string, method: string): boolean {
    if (path === '/staff/reports') return method === 'GET'
    const m = path.match(ONE)
    if (!m) return false
    if (m[2]) return method === 'GET'
    return method === 'GET' || method === 'PATCH' || method === 'DELETE'
}

const PAGE_HEADERS = {
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

export async function handleStaff(req: Request, env: Env, url: URL): Promise<Response> {
    const path = url.pathname
    if ((path === '/staff' || path === '/staff/') && req.method === 'GET') return new Response(PAGE, {headers: {'content-type': 'text/html; charset=utf-8', ...PAGE_HEADERS}})
    if (path === '/staff/page.js' && req.method === 'GET') return new Response(SCRIPT, {headers: {'content-type': 'text/javascript; charset=utf-8', ...PAGE_HEADERS}})
    if (!allowed(path, req.method)) return json({error: 'not found'}, 404)
    const me = await tokenOwner(env.STAFF_TOKENS, presentedToken(req))
    if (!me) return json({error: 'unauthorized'}, 401)

    if (path === '/staff/reports') {
        const q = url.searchParams
        const limit = q.get('limit') ? parseInt(q.get('limit')!, 10) : undefined
        if (q.get('limit') && (!Number.isInteger(limit) || (limit as number) <= 0)) return json({error: `limit is a positive integer, at most ${LIST_MAX}`}, 400)
        const status = q.get('status') || undefined
        if (status && !(STATUSES as readonly string[]).includes(status)) return json({error: `status is one of ${STATUSES.join(', ')}`}, 400)
        const type = q.get('type') || undefined
        if (type && !(TYPES as readonly string[]).includes(type)) return json({error: `type is one of ${TYPES.join(', ')}`}, 400)
        return json(await listReports(env, {status, type, limit, q: q.get('q') || undefined, deleted: q.get('deleted') === '1', before: q.get('before') || undefined}))
    }

    const m = path.match(ONE)!
    let raw = m[1]
    try { raw = decodeURIComponent(raw) } catch { return json({error: 'not a report id'}, 400) }
    const id = normalizeReportId(raw)
    if (!id) return json({error: 'not a report id'}, 400)

    if (m[2] === 'image') {
        const r = await getImage(env, id)
        return r instanceof Response ? r : json(r.body, r.status)
    }
    if (m[3] !== undefined) {
        const idx = Number(m[3])
        if (idx >= FILES_MAX) return json({error: 'no such file'}, 404)
        const r = await getFile(env, id, idx)
        if (r instanceof Response) {
            console.log('report file', JSON.stringify({id, file: idx, by: me}))
            return r
        }
        return json(r.body, r.status)
    }
    if (req.method === 'GET') {
        const r = await getReport(env, id)
        return json(r.body, r.status)
    }
    if (req.method === 'PATCH') {
        let body: unknown
        try { body = await req.json() } catch { return json({error: 'body must be JSON'}, 400) }
        const r = await updateReport(env, id, body, me)
        return json(r.body, r.status)
    }
    const r = await deleteReport(env, id, me)
    return json(r.body, r.status)
}
