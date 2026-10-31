import type {Context} from 'hono'
import {getCookie} from 'hono/cookie'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import type {UserLimits} from './limits'
import {HANDLE_FREE, HandlePending} from './handle'

export type Role = 'member' | 'staff' | 'admin'

export interface CloudUser {
    id: string
    username: string
    email: string
    role: Role
    /** a Google sign-up that has not picked its handle yet (src/handle.ts): only HANDLE_FREE routes */
    handlePending: boolean
    /** the user's own limits (user_limits), where an admin set them */
    limits: UserLimits
    /** id of the access link when the request uses an access key (src/access.ts) or an app key (src/connect.ts) */
    link?: string
    /** app keys only: the app (`p/<name>`, `localhost:5173`, ...) */
    app?: string
    /** app keys only: the id of the drive folder the key may use (and below it), or `*` for the whole drive; nothing else */
    scope?: string
}

export const isStaff = (u: CloudUser) => u.role === 'staff' || u.role === 'admin'

/** Records when a link (an access link or an app grant) was last used, after the response. */
export const touchLink = (c: Context<CloudEnv>, id: string) =>
    c.executionCtx.waitUntil(c.env.PRIMARY_DB.prepare('UPDATE access_links SET last_used = ? WHERE id = ?').bind(new Date().toISOString(), id).run())

/** Whether the request carries a key (Authorization) or the session cookie. */
export function hasSession(c: Context<CloudEnv>): boolean {
    const name = c.get('$db').settings.authCookie?.name
    return !!(c.req.header('Authorization') || c.req.header('X-Authorization') || name && getCookie(c, name))
}

/**
 * The signed-in user of a request (teenybase session JWT, cookie, or access key), or a 401.
 * An access key carries `meta.link`: the link must still exist, so deleting the link revokes the key here.
 * The link row (not the JWT) says whether it is an app key and which folder it may use.
 */
export async function requireUser(c: Context<CloudEnv>): Promise<CloudUser> {
    const cached = c.get('cloudUser')
    if (cached) return cached
    const db = c.get('$db')
    await db.initAuth()
    const auth = db.auth
    if (!auth.uid || auth.cid !== 'users') throw new HTTPException(401, {message: 'sign in, or send an access key (Authorization: Bearer <key>)'})
    const link = typeof auth.meta?.link === 'string' ? auth.meta.link as string : undefined
    let app: string | undefined, scope: string | undefined
    if (link) {
        const row = await c.env.PRIMARY_DB.prepare('SELECT app, scope FROM access_links WHERE id = ? AND owner_id = ?').bind(link, auth.uid)
            .first<{app: string | null, scope: string | null}>()
        if (!row) throw new HTTPException(401, {message: 'access link revoked'})
        app = row.app ?? undefined
        scope = row.scope ?? undefined
        touchLink(c, link)
    }
    const row = await c.env.PRIMARY_DB.prepare(`SELECT u.id, u.username, u.email, u.role, u.handle_set, l.drive_quota, l.projects, l.reports_daily
            FROM users u LEFT JOIN user_limits l ON l.user_id = u.id WHERE u.id = ?`).bind(auth.uid)
        .first<{id: string, username: string, email: string, role: string | null, handle_set: string | null} & {[k in keyof UserLimits]: number | null}>()
    if (!row) throw new HTTPException(401, {message: 'unknown user'})
    const role: Role = row.role === 'admin' || row.role === 'staff' ? row.role : 'member'
    const limits: UserLimits = {}
    for (const k of ['drive_quota', 'projects', 'reports_daily'] as const) if (row[k] !== null) limits[k] = row[k]
    const user: CloudUser = {id: row.id, username: row.username, email: row.email, role, handlePending: !row.handle_set, limits, link, app, scope}
    if (user.handlePending && !HANDLE_FREE.test(c.req.path)) throw new HandlePending()
    c.set('cloudUser', user)
    return user
}

/** 403 for an app key outside the drive routes (they check the folder themselves, src/drive.ts). */
export function assertScope(user: CloudUser) {
    if (user.scope) throw new HTTPException(403, {message: 'an app key can only use the drive'})
}

/** A key that acts as the user while the access link `linkId` exists (src/access.ts, src/connect.ts). */
export async function mintKey(c: Context<CloudEnv>, user: {id: string, email: string}, linkId: string, seconds: number): Promise<string> {
    const db = c.get('$db')
    const secret = await db.secretResolver.resolve('$JWT_SECRET_USERS')
    return db.jwt.createJwtToken({id: user.id, sub: user.email, cid: 'users', verified: true, meta: {link: linkId}}, secret, seconds)
}

/** Our routes: they call requireUser and check scopes themselves. Everything else under /api/ is teenybase. */
const OWN_ROUTES = /^\/api\/v1\/(uploads|access|access-links|connect|drive|buckets|projects|me|handle|sign-in-options)(\/|$)/
/**
 * teenybase's password accounts: local development only (DEV_LOGIN). Elsewhere accounts come from GitHub and Google,
 * which sign in to the account with the same email, so a password sign-up with someone's email would be waiting for them.
 */
const PASSWORD_ROUTES = /^\/api\/v1\/table\/users\/(insert|auth\/(sign-up|login-password|change-password|request-password-reset|confirm-password-reset))$/
/** The teenybase routes an access key may use (agents.md): reading its files. A key changes nothing else there. */
const KEY_ROUTES = /^\/api\/v1\/table\/files\/(select|list)$/

/**
 * Runs before every route (teenybase's onRequest hook):
 * - CSRF: a request that changes something with the session cookie (no Authorization header) must come from this origin.
 *   The cookie is SameSite=Lax, and files.threepipe.org is the same site, so Lax alone does not stop it.
 * - Password accounts only with DEV_LOGIN (PASSWORD_ROUTES).
 * - Keys on teenybase's own routes: the link must still exist (revocation); access keys only read their files there
 *   (KEY_ROUTES; otherwise one could set a password and become a session that outlives its link), app keys nothing.
 */
export async function guardRequest(c: Context<CloudEnv>): Promise<Response | undefined> {
    const url = new URL(c.req.url)
    if (!url.pathname.startsWith('/api/')) return
    if (PASSWORD_ROUTES.test(url.pathname) && c.env.DEV_LOGIN !== 'true') throw new HTTPException(404, {message: 'not found'})
    const db = c.get('$db')
    const header = !!(c.req.header('Authorization') || c.req.header('X-Authorization'))
    const cookieName = db.settings.authCookie?.name
    const cookie = !!cookieName && !!getCookie(c, cookieName)
    if (!header && cookie && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== url.origin)
        throw new HTTPException(403, {message: 'cross-origin request with the session cookie'})
    if (OWN_ROUTES.test(url.pathname) || !header && !cookie) return
    await db.initAuth()
    if (typeof db.auth?.meta?.link !== 'string') return
    const user = await requireUser(c)
    if (user.scope) throw new HTTPException(403, {message: 'an app key can only use the drive routes (/api/v1/drive…)'})
    if (!KEY_ROUTES.test(url.pathname)) throw new HTTPException(403, {message: 'an access key can only read its files here (/api/v1/table/files/select)'})
    return
}
