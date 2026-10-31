import type {Context, Hono, Next} from 'hono'
import {HTTPException} from 'hono/http-exception'
import {requireUser} from './auth'
import {CloudEnv, jsonBody} from './env'

/**
 * The handle (`users.username`) is in every drive URL (`d/<handle>/…`), so it is picked once, by the user:
 * - GitHub gives its login, and a password account named it at sign-up: `handle_set` is written when they sign in.
 * - A Google sign-up has no username (teenybase makes one from the email). Until the user picks one (`handle_set`
 *   empty), every route but these answers 403 `{handle: true}` and the pages show "Choose your handle":
 *
 *   GET  /api/v1/me                    → … `handle_pending: true`, `username` (the suggestion)
 *   POST /api/v1/handle {handle}       → the handle is set (only while it is pending; nothing of the user exists yet)
 *   GET  /api/v1/sign-in-options       → {google, dev}: the buttons of the sign-in cards
 */

const HANDLE = /^[a-z][a-z0-9_-]{2,31}$/
/** Names that would look like ours: anything starting with threepipe, and a few exact ones. */
const RESERVED = /^(threepipe.*|admin|staff|root|api|www|cloud|files|support|help|null|undefined)$/

/** Routes a user whose handle is pending may use. */
export const HANDLE_FREE = /^\/api\/v1\/(me|handle|sign-in-options)$/

/** The 403 of a user whose handle is pending; the pages show "Choose your handle" on it. */
export class HandlePending extends HTTPException {
    constructor() {
        super(403, {res: Response.json({code: 403, message: 'choose your handle first (POST /api/v1/handle)', handle: true}, {status: 403})})
    }
}

/**
 * After a GitHub sign-in, or a password sign-up or sign-in, succeeds: that user's handle is set (GitHub's login, or
 * the one typed at sign-up). The user is read from the session token this response just made.
 */
export async function markHandleSet(c: Context<CloudEnv>, next: Next) {
    await next()
    const path = c.req.path
    const github = /\/auth\/oauth\/github\/callback$/.test(path) && c.res.status === 302
    const signUp = /\/auth\/(sign-up|login-password)$/.test(path) && c.res.ok
    if (!github && !signUp) return
    let token: string | undefined
    if (github) {
        const name = c.get('$db').settings.authCookie?.name
        token = c.res.headers.getSetCookie().map(s => s.split(';')[0]).find(s => s.startsWith(name + '='))?.slice(name!.length + 1)
    } else token = (await c.res.clone().json().catch(() => ({})) as {token?: string}).token
    const id = token && jwtId(token)
    if (id) await c.env.PRIMARY_DB.prepare('UPDATE users SET handle_set = ? WHERE id = ? AND handle_set IS NULL').bind(new Date().toISOString(), id).run()
}

/** The `id` of a JWT this worker issued (read only, it was made in this request). */
function jwtId(token: string): string | undefined {
    try {
        const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const id = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4))).id
        return typeof id === 'string' ? id : undefined
    } catch {
        return undefined
    }
}

export function handleRoutes(app: Hono<CloudEnv>) {
    app.get('/api/v1/sign-in-options', c => c.json({google: !!c.env.GOOGLE_CLIENT_ID, dev: c.env.DEV_LOGIN === 'true'}))

    app.post('/api/v1/handle', async c => {
        const user = await requireUser(c)
        if (user.scope || user.link) throw new HTTPException(403, {message: 'sign in on the page to choose your handle'})
        if (!user.handlePending) throw new HTTPException(409, {message: 'your handle is set; it cannot change'})
        const body = await jsonBody<{handle?: string}>(c)
        const handle = String(body.handle ?? '').trim()
        if (!HANDLE.test(handle)) throw new HTTPException(400, {message: '3 to 32 lower-case letters, digits, - or _, starting with a letter'})
        if (RESERVED.test(handle)) throw new HTTPException(400, {message: `${handle} is reserved`})
        const taken = await c.env.PRIMARY_DB.prepare('SELECT 1 FROM users WHERE lower(username) = ? AND id != ?').bind(handle, user.id).first()
        if (taken) throw new HTTPException(409, {message: `${handle} is taken`})
        try {
            const r = await c.env.PRIMARY_DB.prepare('UPDATE users SET username = ?, handle_set = ? WHERE id = ? AND handle_set IS NULL')
                .bind(handle, new Date().toISOString(), user.id).run()
            if (!r.meta.changes) throw new HTTPException(409, {message: 'your handle is set; it cannot change'})
        } catch (e) {
            if (/UNIQUE/.test(String(e))) throw new HTTPException(409, {message: `${handle} is taken`})
            throw e
        }
        return c.json({username: handle})
    })
}

