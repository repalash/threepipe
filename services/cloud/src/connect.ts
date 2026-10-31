import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {BUCKET, filesOrigin, likePrefix, randomCode, sha256Hex} from './env'
import {CloudUser, mintKey, requireUser} from './auth'

/** App keys are short: the app gets a new one on every page load (no screen once approved). */
export const APP_KEY_SECONDS = 24 * 60 * 60

/**
 * "Sign in with threepipe" for apps hosted on the files host (or running on localhost while being developed).
 * No app registration: the app is identified by where it is served from, `s/<slug>`, `b/<repo>/<ref>`, `p/<name>`,
 * `d/<handle>/<app>` (owned by whoever uploaded there) or `localhost:<port>`.
 *
 *   GET  /api/v1/connect?return=<app page url>[&access=drive][&prompt=consent]
 *        signed out → sign-in page; approved before → redirect back with a key; else → consent page
 *   POST /api/v1/connect (the consent form)  → 303 to `<return>#tp_cloud_key=<key>&tp_cloud_user=<handle>&tp_cloud_folder=<folder>&tp_cloud_api=<api origin>`
 *
 * The key works only on the drive routes, inside the granted folder: `d/<you>/apps/<app owner>/<app>/` (default) or, with
 * `access=drive`, all of `d/<you>/`. The grant is an `access_links` row (app, scope); deleting it revokes the keys.
 * Denying redirects back with `#tp_cloud_error=denied`.
 */
export function connectRoutes(app: Hono<CloudEnv>) {
    app.get('/api/v1/connect', async (c) => {
        const target = appTarget(c, c.req.query('return'), c.req.query('access'))
        let user: CloudUser
        try {
            user = await requireUser(c)
        } catch (e) {
            if (e instanceof HTTPException && e.status === 401) return page(c, signInPage(c, target))
            throw e
        }
        if (user.link) throw new HTTPException(403, {message: 'approve apps in the browser, signed in to threepipe cloud'})
        const owner = await appOwner(c, target)
        const folder = appFolder(target, user.username, owner)
        if (c.req.query('prompt') !== 'consent') {
            const grant = await findGrant(c, user, target.app, folder, owner)
            if (grant) return redirectWithKey(c, target, user, grant, folder)
        }
        return page(c, consentPage(target, user, owner, folder))
    })

    app.post('/api/v1/connect', async (c) => {
        // a form post with the session cookie: guardRequest (src/auth.ts) already checked it comes from this origin
        const form = await c.req.parseBody()
        const target = appTarget(c, form.return, form.access)
        const user = await requireUser(c)
        if (user.link) throw new HTTPException(403, {message: 'approve apps in the browser, signed in to threepipe cloud'})
        const owner = await appOwner(c, target)
        const folder = appFolder(target, user.username, owner)
        let grant = await findGrant(c, user, target.app, folder, owner)
        if (!grant) {
            grant = crypto.randomUUID()
            // code_hash is required and unique; app grants have no link to copy, so it is the hash of a code nobody keeps
            await c.env.PRIMARY_DB.prepare('INSERT INTO access_links (id, owner_id, name, code_hash, app, scope, app_owner) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(grant, user.id, `app ${target.app}`, await sha256Hex(randomCode()), target.app, folder, owner?.id ?? null).run()
        }
        return redirectWithKey(c, target, user, grant, folder, 303)
    })
}

interface AppTarget {
    /** `p/<name>`, `d/<handle>/<app>`, `localhost:5173`, ... */
    app: string
    /** the files-host scope the app is served from (to find its owner); none for localhost */
    scope?: string
    /** the return URL without its fragment */
    returnUrl: string
    access: 'app' | 'drive'
}

/**
 * The drive folder an app's key may use: `d/<you>/apps/<owner>/<scope>/` (`d/<you>/apps/localhost/<port>/`), or all of
 * `d/<you>/` for access=drive. The owner is part of it, so a new owner of the same scope never sees the old app's files.
 */
function appFolder(t: AppTarget, handle: string, owner: {username: string} | null): string {
    if (t.access === 'drive') return `d/${handle}/`
    return owner ? `d/${handle}/apps/${owner.username}/${t.scope}/` : `d/${handle}/apps/${t.app.replace(':', '/')}/`
}

function appTarget(c: Context<CloudEnv>, ret: unknown, access: unknown): AppTarget {
    if (typeof ret !== 'string' || !ret) throw new HTTPException(400, {message: 'return: the URL of the app page to come back to'})
    if (access !== undefined && access !== '' && access !== 'app' && access !== 'drive') throw new HTTPException(400, {message: 'access is app (default) or drive'})
    const acc = access === 'drive' ? 'drive' : 'app'
    let u: URL
    try {
        u = new URL(ret)
    } catch {
        throw new HTTPException(400, {message: 'return is not a URL'})
    }
    u.hash = ''
    const returnUrl = u.href
    const files = filesOrigin(c.env, new URL(c.req.url).origin) + '/'
    let app: string, scope: string | undefined
    if (returnUrl.startsWith(files)) {
        const segs = decodeURIComponent(u.pathname.slice(new URL(files).pathname.length)).split('/')
        const n = {s: 2, p: 2, b: 3, d: 3}[segs[0]]
        if (!n || segs.length <= n - 1 || segs.slice(0, n).some(s => !s || s.startsWith('.'))) throw new HTTPException(400, {message: 'return must be an app page under s/, p/, b/ or d/ on the files host'})
        app = scope = segs.slice(0, n).join('/')
    } else if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
        app = `localhost:${u.port || '80'}`
    } else {
        throw new HTTPException(400, {message: `return must be a page on ${files} or on localhost`})
    }
    return {app, scope, returnUrl, access: acc}
}

/**
 * The user who serves the app (who uploaded to its scope), or 400 for an unknown app. Localhost: none.
 * A scope can change hands once its files are gone (s/ expires): grants are tied to this owner (findGrant).
 */
async function appOwner(c: Context<CloudEnv>, t: AppTarget): Promise<{id: string, username: string} | null> {
    if (!t.scope) return null
    const row = await c.env.PRIMARY_DB.prepare(`SELECT u.id, u.username FROM files f JOIN users u ON u.id = f.owner_id
            WHERE f.bucket = ? AND f.path LIKE ? ESCAPE '\\' AND f.deleted_at IS NULL LIMIT 1`)
        .bind(BUCKET, likePrefix(t.scope + '/')).first<{id: string, username: string}>()
    if (!row) throw new HTTPException(400, {message: `no app at ${t.scope}`})
    return row
}

async function findGrant(c: Context<CloudEnv>, user: CloudUser, app: string, folder: string, owner: {id: string} | null): Promise<string | undefined> {
    const row = await c.env.PRIMARY_DB.prepare('SELECT id FROM access_links WHERE owner_id = ? AND app = ? AND scope = ? AND app_owner IS ?')
        .bind(user.id, app, folder, owner?.id ?? null).first<{id: string}>()
    return row?.id
}

async function redirectWithKey(c: Context<CloudEnv>, t: AppTarget, user: CloudUser, grant: string, folder: string, status: 302 | 303 = 302) {
    const key = await mintKey(c, user, grant, APP_KEY_SECONDS)
    c.executionCtx.waitUntil(c.env.PRIMARY_DB.prepare('UPDATE access_links SET last_used = ? WHERE id = ?').bind(new Date().toISOString(), grant).run())
    const hash = new URLSearchParams({tp_cloud_key: key, tp_cloud_user: user.username, tp_cloud_folder: folder, tp_cloud_api: new URL(c.req.url).origin})
    c.header('cache-control', 'no-store')
    c.header('referrer-policy', 'no-referrer')
    return c.redirect(`${t.returnUrl}#${hash}`, status)
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

function page(c: Context<CloudEnv>, body: string) {
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>threepipe cloud</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#222}
h1{font-size:1.25rem}code{background:#f2f2f2;padding:0 .25rem;border-radius:3px;word-break:break-all}
.row{display:flex;gap:.75rem;margin-top:1.5rem}button,a.btn{font:inherit;padding:.5rem 1rem;border-radius:6px;border:1px solid #222;background:#222;color:#fff;cursor:pointer;text-decoration:none}
a.btn.secondary{background:#fff;color:#222}.note{color:#666;font-size:.875rem}
</style></head><body>${body}</body></html>`, 200, {
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        // same-origin, not no-referrer: with no-referrer the browser sends `Origin: null` on the form post, and guardRequest rejects it
        'referrer-policy': 'same-origin',
    })
}

function signInPage(c: Context<CloudEnv>, t: AppTarget) {
    const back = new URL(c.req.url)
    const github = `/api/v1/table/users/auth/oauth/github?redirect=${encodeURIComponent(back.pathname + back.search)}`
    return `<h1>Sign in to threepipe cloud</h1>
<p><code>${esc(t.app)}</code> wants to use your threepipe cloud drive. Sign in first.</p>
<div class="row"><a class="btn" href="${esc(github)}">Sign in with GitHub</a>
<a class="btn secondary" href="${esc(t.returnUrl + '#tp_cloud_error=denied')}">Cancel</a></div>`
}

function consentPage(t: AppTarget, user: CloudUser, owner: {username: string} | null, folder: string) {
    const who = owner ? `served by <b>@${esc(owner.username)}</b> at <code>${esc(t.returnUrl)}</code>` : `running on your computer at <code>${esc(t.returnUrl)}</code>`
    const what = t.access === 'drive'
        ? `<b>all files in your drive</b> <code>${esc(folder)}</code>, including the files of other apps`
        : `the files in <code>${esc(folder)}</code>`
    return `<h1>Connect ${esc(t.app)}?</h1>
<p>The app ${who} wants to read, write, share and delete ${what}.</p>
<p class="note">Signed in as @${esc(user.username)}. It cannot use anything else in your account. Remove access any time from your access links.</p>
<form method="post" action="/api/v1/connect"><input type="hidden" name="return" value="${esc(t.returnUrl)}"><input type="hidden" name="access" value="${t.access}">
<div class="row"><button type="submit">Allow</button><a class="btn secondary" href="${esc(t.returnUrl + '#tp_cloud_error=denied')}">Cancel</a></div></form>`
}
