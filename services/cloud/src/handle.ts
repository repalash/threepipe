import type {Hono} from 'hono'
import type {SignInHook} from 'teenybase/worker'
import {HTTPException} from 'hono/http-exception'
import {requireUser} from './auth'
import {CloudEnv, jsonBody} from './env'

/**
 * The handle (`users.username`) is in every drive URL (`d/<handle>/…`), so it is picked once, by the user:
 * - GitHub gives its login: it is the handle (in lower case) of an account the GitHub sign-in made, when it is not
 *   reserved or taken in another case; else the user chooses one, as below. A password account (local development)
 *   named it at sign-up: `handle_set` is written when they sign in.
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
 * teenybase's sign-in hook (db.onSignIn, src/index.ts): a password sign-up or sign-in (local development) keeps the
 * handle typed at sign-up; an account a GitHub sign-in made takes the GitHub login, under the rules of /handle (lower
 * case, not reserved, not taken in another case). Anyone else (Google, a login that does not fit) picks one on the card.
 */
export const setHandleOnSignIn = (env: CloudflareBindings): SignInHook<CloudEnv> => async({provider, created, user, external}) => {
    const db = env.PRIMARY_DB, now = new Date().toISOString()
    if (provider === 'password') {
        await db.prepare('UPDATE users SET handle_set = ? WHERE id = ? AND handle_set IS NULL').bind(now, user.id).run()
        return
    }
    if (provider !== 'github' || !created) return
    const handle = String(external?.username ?? '').toLowerCase()
    if (!HANDLE.test(handle) || RESERVED.test(handle)) return
    try {
        // not taken in another case (the unique index only sees the exact case)
        await db.prepare(`UPDATE users SET username = ?1, handle_set = ?2 WHERE id = ?3 AND handle_set IS NULL
                AND NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = ?1 AND id != ?3)`).bind(handle, now, user.id).run()
    } catch (e) {
        if (!/UNIQUE/.test(String(e))) throw e // taken meanwhile: the user picks one
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

