import type {Hono} from 'hono'
import {setCookie} from 'hono/cookie'
import type {CloudEnv} from './env'
import {cardPage, esc} from './page'

/**
 * Local development only (`DEV_LOGIN=true` in .dev.vars): sign in with a username and a password instead of GitHub,
 * to try the pages (consent, reports) without an OAuth app. A new username is signed up on the first try.
 *
 *   GET  /login?redirect=/reports   the form
 *   POST /login                     sets the session cookie, back to `redirect` (a path on this host)
 */
export function devLoginRoutes(app: Hono<CloudEnv>) {
    app.get('/login', c => {
        if (c.env.DEV_LOGIN !== 'true') return c.notFound()
        const redirect = safeRedirect(c.req.query('redirect'))
        // form-action 'self': the form posts here and is sent back to a path on this host
        return cardPage(c, page(redirect, c.req.query('error')), {formAction: "'self'"})
    })

    app.post('/login', async c => {
        if (c.env.DEV_LOGIN !== 'true') return c.notFound()
        const form = await c.req.parseBody()
        const username = String(form.username || '').trim().toLowerCase(), password = String(form.password || '')
        const redirect = safeRedirect(String(form.redirect || ''))
        const back = (error: string) => c.redirect(`/login?redirect=${encodeURIComponent(redirect)}&error=${encodeURIComponent(error)}`, 303)
        if (!/^[a-z0-9][a-z0-9_-]{2,30}$/.test(username) || password.length < 8) return back('a username (3 to 31 lower-case letters, digits, - or _) and a password of 8 or more characters')
        const call = (path: string, body: object) => app.fetch(new Request(new URL(`/api/v1/table/users/auth/${path}`, c.req.url), {
            method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}), c.env, c.executionCtx)
        let res = await call('login-password', {identity: username, password})
        if (!res.ok) {
            const exists = await c.env.PRIMARY_DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()
            if (exists) return back('wrong password')
            res = await call('sign-up', {username, email: `${username}@dev.local`, name: username, password, passwordConfirm: password})
            if (!res.ok) return back(`sign-up failed: ${((await res.json().catch(() => ({}))) as {message?: string}).message ?? res.status}`)
        }
        const {token} = await res.json() as {token: string}
        setCookie(c, c.get('$db').settings.authCookie!.name, token, {httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 24 * 60 * 60})
        return c.redirect(redirect, 303)
    })
}

/** A path on this host, never another site. */
const safeRedirect = (r: string | undefined) => r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/\\') ? r : '/reports'

/** The form, in a card (src/page.ts). */
const page = (redirect: string, error?: string) => `<h1>Local sign-in</h1><p>Development only (DEV_LOGIN). A new username is created on the first sign-in.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login"><input type="hidden" name="redirect" value="${esc(redirect)}"><div class="stack">
<input class="lg" name="username" placeholder="Username" autocomplete="username" required autofocus><input class="lg" name="password" type="password" placeholder="Password (8+ characters)" autocomplete="current-password" required>
<button type="submit" class="primary lg">Sign in</button></div></form>`
