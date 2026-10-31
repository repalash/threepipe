// From #104 (services/cloud/src/common/turnstile.ts), copied from ijewel-mono services/ops-worker/src/lib/reporter.ts
// @ 54d43285 (IJ-564). Only anonymous reports go through it: signed-in senders skip it (src/projects.ts).
/**
 * The gate of POST /reports: a Cloudflare Turnstile pass in `cf-turnstile-response`, checked once
 * with siteverify. A Turnstile token is valid for 300 s and only once.
 *
 * Cloudflare documents three test secrets (developers.cloudflare.com/turnstile/troubleshooting/testing/):
 * 1x… always passes, 2x… always fails, 3x… answers "token already spent". siteverify answers them
 * the same way for any token. They are answered here without the network call, with the answers
 * siteverify gives, so `wrangler dev --local` and the tests run offline. A real secret always goes to
 * siteverify.
 */

import {logError} from './env'

/** The action the widget is rendered with (`@threepipe/plugin-cloud`). */
export const TURNSTILE_ACTION = 'threepipe-report'
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const TEST_SECRETS: Record<string, {success: boolean, 'error-codes': string[]}> = {
    '1x0000000000000000000000000000000AA': {success: true, 'error-codes': []},
    '2x0000000000000000000000000000000AA': {success: false, 'error-codes': ['invalid-input-response']},
    '3x0000000000000000000000000000000AA': {success: false, 'error-codes': ['timeout-or-duplicate']},
}

const list = (s: string | undefined) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)

export type TurnstileCheck = {ok: true} | {ok: false, status: number, error: string}

/** Never throws; a failed upstream is a 503 the page can retry. */
export async function checkTurnstile(env: CloudflareBindings, req: Request): Promise<TurnstileCheck> {
    const token = (req.headers.get('cf-turnstile-response') || '').trim()
    if (!token) return {ok: false, status: 401, error: 'pass the check (cf-turnstile-response)'}
    if (!env.TURNSTILE_SECRET) return {ok: false, status: 503, error: 'TURNSTILE_SECRET not configured'}
    if (token.length > 2048) return {ok: false, status: 403, error: 'check failed'}
    const test = TEST_SECRETS[env.TURNSTILE_SECRET]
    if (test) return test.success ? {ok: true} : {ok: false, status: 403, error: 'check failed'}
    const form = new FormData()
    form.set('secret', env.TURNSTILE_SECRET)
    form.set('response', token)
    const ip = req.headers.get('cf-connecting-ip')
    if (ip) form.set('remoteip', ip)
    form.set('idempotency_key', crypto.randomUUID())
    let data: any
    try {
        const res = await fetch(SITEVERIFY, {method: 'POST', body: form})
        data = await res.json()
    } catch {
        return {ok: false, status: 503, error: 'could not run the check'}
    }
    if (!data?.success) {
        // a bad or missing secret fails every check: the reports form is shut until someone fixes it
        const codes: string[] = data?.['error-codes'] ?? []
        if (codes.some(code => code.includes('secret') || code === 'internal-error')) logError('turnstile', {codes})
        return {ok: false, status: 403, error: 'check failed'}
    }
    // The site key is bound to our hostnames by Cloudflare. These two checks keep a token that was
    // solved for another widget or another form from passing here.
    if (data.action !== TURNSTILE_ACTION) return {ok: false, status: 403, error: 'check failed'}
    const hosts = list(env.TURNSTILE_HOSTNAMES)
    if (hosts.length && !hosts.includes(String(data.hostname || ''))) return {ok: false, status: 403, error: 'check failed'}
    return {ok: true}
}
