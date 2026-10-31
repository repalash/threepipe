import type {Context, Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {BUCKET, filesOrigin, prefixRange, randomCode, sha256Hex} from './env'
import {CloudUser, mintKey, requireUser} from './auth'
import {appFolder, appLabel, grantFolder} from './appFolders'

/** App keys are short: the app gets a new one on every page load (no screen once approved). */
export const APP_KEY_SECONDS = 24 * 60 * 60

/**
 * "Sign in with threepipe" for apps hosted on the files host (or running on localhost while being developed).
 * No app registration: the app is identified by where it is served from, `s/<slug>`, `b/<repo>/<ref>`, `p/<name>`,
 * `d/<handle>/<app>` (owned by whoever uploaded there), `localhost:<port>` or `<name>.localhost:<port>`.
 *
 *   GET  /api/v1/connect?return=<app page url>[&access=drive][&prompt=consent]
 *        signed out → sign-in page; approved before → redirect back with a key; else → consent page
 *   POST /api/v1/connect (the consent form)  → 303 to `<return>#tp_cloud_key=<key>&tp_cloud_user=<handle>&tp_cloud_folder=<folder>&tp_cloud_api=<api origin>`
 *
 * The key works only on the drive routes, inside the app's folder (default; `Apps/<app>` in the user's drive, made on the
 * first approval; `tp_cloud_folder` is its id) or, with `access=drive`, the whole drive (`*`). The grant is an
 * `access_links` row (app, scope = the folder id or `*`); deleting it revokes the keys.
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
        if (c.req.query('prompt') !== 'consent') {
            const grant = await findGrant(c, user, target, owner)
            if (grant) return redirectWithKey(c, target, user, grant.id, await grantFolder(c, user.id, grant.id))
        }
        return page(c, consentPage(target, user, owner))
    })

    app.post('/api/v1/connect', async (c) => {
        // a form post with the session cookie: guardRequest (src/auth.ts) already checked it comes from this origin
        const form = await c.req.parseBody()
        const target = appTarget(c, form.return, form.access)
        const user = await requireUser(c)
        if (user.link) throw new HTTPException(403, {message: 'approve apps in the browser, signed in to threepipe cloud'})
        const owner = await appOwner(c, target)
        let grant = await findGrant(c, user, target, owner)
        if (!grant) {
            grant = {id: crypto.randomUUID(), scope: target.access === 'drive' ? '*' : await appFolder(c, user.id, target.app, owner)}
            // code_hash is required and unique; app grants have no link to copy, so it is the hash of a code nobody keeps
            await c.env.PRIMARY_DB.prepare('INSERT INTO access_links (id, owner_id, name, code_hash, app, scope, app_owner) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(grant.id, user.id, `app ${target.app}`, await sha256Hex(randomCode()), target.app, grant.scope, owner?.id ?? null).run()
        }
        return redirectWithKey(c, target, user, grant.id, await grantFolder(c, user.id, grant.id), 303)
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
        let segs: string[]
        try {
            segs = decodeURIComponent(u.pathname.slice(new URL(files).pathname.length)).normalize('NFC').split('/')
        } catch {
            throw new HTTPException(400, {message: 'return is not a valid URL'})
        }
        const n = {s: 2, p: 2, b: 3, d: 3}[segs[0]]
        if (!n || segs.length <= n - 1 || segs.slice(0, n).some(s => !s || s.startsWith('.'))) throw new HTTPException(400, {message: 'return must be an app page under s/, p/, b/ or d/ on the files host'})
        app = scope = segs.slice(0, n).join('/')
    } else if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
        app = `localhost:${u.port || '80'}`
    } else if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.endsWith('.localhost')) {
        // *.localhost always resolves to this machine (RFC 6761), e.g. a dev server behind a local proxy
        app = `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`
    } else {
        throw new HTTPException(400, {message: `return must be a page on ${files} or on localhost`})
    }
    return {app, scope, returnUrl, access: acc}
}

/**
 * The user who serves the app (who uploaded to its scope), or 400 for an unknown app. Localhost: none.
 * A scope can change hands once its files are gone (the cron releases it): grants are tied to this owner (findGrant).
 */
async function appOwner(c: Context<CloudEnv>, t: AppTarget): Promise<{id: string, username: string} | null> {
    if (!t.scope) return null
    const row = t.scope.startsWith('d/')
        ? await c.env.PRIMARY_DB.prepare(`SELECT u.id, u.username FROM files f JOIN users u ON u.id = f.owner_id
            WHERE f.bucket = ? AND f.path >= ? AND f.path < ? AND f.deleted_at IS NULL LIMIT 1`)
            .bind(BUCKET, ...prefixRange(t.scope + '/')).first<{id: string, username: string}>()
        : await c.env.PRIMARY_DB.prepare('SELECT u.id, u.username FROM scopes s JOIN users u ON u.id = s.owner_id WHERE s.scope = ?')
            .bind(t.scope).first<{id: string, username: string}>()
    if (!row) throw new HTTPException(400, {message: `no app at ${t.scope}`})
    return row
}

/** The grant for this app, served by this owner, with this access (the whole drive or the app's folder). */
async function findGrant(c: Context<CloudEnv>, user: CloudUser, t: AppTarget, owner: {id: string} | null): Promise<{id: string, scope: string} | undefined> {
    const row = await c.env.PRIMARY_DB.prepare(`SELECT id, scope FROM access_links WHERE owner_id = ? AND app = ? AND app_owner IS ? AND ${t.access === 'drive' ? "scope = '*'" : "scope != '*'"}`)
        .bind(user.id, t.app, owner?.id ?? null).first<{id: string, scope: string}>()
    return row ?? undefined
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

/** A card in the look of the other pages (/ui.css, src/page.ts). */
function page(c: Context<CloudEnv>, body: string) {
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>threepipe cloud</title><link rel="stylesheet" href="/ui.css"></head>
<body><div class="center"><div class="card wide">${BRAND}${body}</div></div></body></html>`, 200, {
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        // same-origin, not no-referrer: with no-referrer the browser sends `Origin: null` on the form post, and guardRequest rejects it
        'referrer-policy': 'same-origin',
    })
}

const icon = (paths: string) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`
const BRAND = `<div class="brand"><span class="mark">${icon('<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>')}</span>threepipe cloud</div>`
const FOLDER = icon('<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/>')
const GITHUB = icon('<path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>')

function signInPage(c: Context<CloudEnv>, t: AppTarget) {
    const back = new URL(c.req.url)
    const github = `/api/v1/table/users/auth/oauth/github?redirect=${encodeURIComponent(back.pathname + back.search)}`
    const dev = c.env.DEV_LOGIN === 'true' ? `<a class="btn lg" href="${esc(`/login?redirect=${encodeURIComponent(back.pathname + back.search)}`)}">Local sign-in (development)</a>` : ''
    return `<h1>Sign in to continue</h1>
<p><code>${esc(t.app)}</code> wants to use your threepipe cloud drive. Sign in first.</p>
<div class="stack"><a class="btn dark lg" href="${esc(github)}">${GITHUB}Continue with GitHub</a>${dev}
<a class="btn ghost lg" href="${esc(t.returnUrl + '#tp_cloud_error=denied')}">Cancel</a></div>`
}

function consentPage(t: AppTarget, user: CloudUser, owner: {id: string, username: string} | null) {
    const folder = t.access === 'drive' ? 'your whole drive' : `Apps/${appLabel(t.app, owner)}`
    const who = owner ? `served by <b>@${esc(owner.username)}</b> at <code>${esc(t.returnUrl)}</code>` : `running on your computer at <code>${esc(t.returnUrl)}</code>`
    const what = t.access === 'drive'
        ? `<b>All files in your drive</b>, including the files of other apps`
        : `The files in <b>${esc(folder)}</b>`
    return `<h1>Connect ${esc(t.app)}?</h1>
<p>The app ${who} wants to read, write, share and delete:</p>
<div class="scope${t.access === 'drive' ? ' all' : ''}">${FOLDER}<span>${what}</span></div>
<p>It cannot use anything else in your account. Remove access any time from your access links.</p>
<form method="post" action="/api/v1/connect"><input type="hidden" name="return" value="${esc(t.returnUrl)}"><input type="hidden" name="access" value="${t.access}">
<div class="row"><a class="btn lg" href="${esc(t.returnUrl + '#tp_cloud_error=denied')}">Cancel</a><button type="submit" class="primary lg">Allow</button></div></form>
<p class="foot">Signed in as @${esc(user.username)}</p>`
}
