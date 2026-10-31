import type {Hono} from 'hono'
import {setCookie} from 'hono/cookie'
import type {CloudEnv} from './env'

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
        return c.html(page(redirect, c.req.query('error')), 200, {'cache-control': 'no-store', 'x-frame-options': 'DENY',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"})
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

const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

const page = (redirect: string, error?: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>threepipe cloud (local)</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:24rem;margin:4rem auto;padding:0 1rem}
input,button{font:inherit;display:block;width:100%;margin:.5rem 0;padding:.5rem;box-sizing:border-box}.err{color:#c43d3d}.note{color:#666;font-size:.875rem}</style></head>
<body><h1>threepipe cloud</h1><p class="note">Local development sign-in (DEV_LOGIN). A new username is created on the first sign-in.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login"><input type="hidden" name="redirect" value="${esc(redirect)}">
<input name="username" placeholder="username" autocomplete="username" required><input name="password" type="password" placeholder="password (8+ characters)" autocomplete="current-password" required>
<button type="submit">Sign in</button></form></body></html>`
