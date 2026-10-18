// Small HTTP helpers shared by the routes.
import type {Env} from '../env.ts'
import {envOf, sha256, timingSafeEqual} from './compare.ts'

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data, null, 2) + '\n', {status, headers: {'content-type': 'application/json; charset=utf-8', ...headers}})
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(body, {status, headers: {'content-type': 'text/html; charset=utf-8', ...headers}})
}

export function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!))
}

/** The Bearer token of a request (or ?token=, for curl users of /share only). */
export function presentedToken(req: Request, url?: URL): string {
    const m = /^Bearer (.+)$/i.exec(req.headers.get('authorization') || '')
    return m ? m[1].trim() : url?.searchParams.get('token') || ''
}

/**
 * The name a token belongs to in a 'name=token,name2=token2' secret, or null. Every entry is compared
 * (by hash, in constant time), so the answer takes the same time whichever entry matches.
 */
export async function tokenOwner(list: string | undefined, presented: string): Promise<string | null> {
    if (!presented) return null
    const given = await sha256(presented)
    let found: string | null = null
    for (const entry of String(list || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const i = entry.indexOf('=')
        if (i < 1) continue
        const name = entry.slice(0, i).trim()
        const token = entry.slice(i + 1).trim()
        if (token.length < 16) continue // a short token is a misconfiguration, never a credential
        if (timingSafeEqual(given, await sha256(token)) && !found) found = name
    }
    return found
}

/** CORS for a browser route: the origins in ORIGINS and local ones. CORS is not the gate. */
export function cors(req: Request, env: Env, res: Response, methods: string): Response {
    const o = req.headers.get('origin')
    if (!o || !envOf(env, o)) return res
    const h = new Headers(res.headers)
    h.set('access-control-allow-origin', o)
    h.set('access-control-allow-headers', 'authorization, content-type, idempotency-key, cf-turnstile-response')
    h.set('access-control-allow-methods', methods)
    h.set('access-control-max-age', '600')
    h.append('vary', 'origin')
    return new Response(res.body, {status: res.status, headers: h})
}
