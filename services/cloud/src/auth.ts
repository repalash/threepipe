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

/** The owner of an upload scope (`s/<slug>`, `b/<repo>/<ref>`, `p/<name>`) as read with the user, or null when unclaimed. */
export interface ScopeRow {owner: string, expires: string | null}

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
    return (await requireUserAndScope(c)).user
}

/**
 * requireUser, and the owner of the upload scope `uploadScope` in the same D1 query (src/uploads.ts): one read per request.
 */
export async function requireUserAndScope(c: Context<CloudEnv>, uploadScope?: string): Promise<{user: CloudUser, scopeRow: ScopeRow | null}> {
    const cached = c.get('cloudUser')
    if (cached && !uploadScope) return {user: cached, scopeRow: null}
    const db = c.get('$db')
    await db.initAuth()
    const auth = db.auth
    if (!auth.uid || auth.cid !== 'users') throw new HTTPException(401, {message: 'sign in, or send an access key (Authorization: Bearer <key>)'})
    const link = typeof auth.meta?.link === 'string' ? auth.meta.link as string : undefined
    // one query: the user, its limits, (a key) its link and (an upload) the scope's owner
    const row = await c.env.PRIMARY_DB.prepare(`SELECT u.id, u.username, u.email, u.role, u.handle_set, l.drive_quota, l.projects, l.reports_daily,
                a.id AS link_id, a.app, a.scope, a.last_used, s.owner_id AS scope_owner, s.expires_at AS scope_expires
            FROM users u LEFT JOIN user_limits l ON l.user_id = u.id LEFT JOIN access_links a ON a.id = ?1 AND a.owner_id = u.id
                LEFT JOIN scopes s ON s.scope = ?3
            WHERE u.id = ?2`).bind(link ?? null, auth.uid, uploadScope ?? null)
        .first<{id: string, username: string, email: string, role: string | null, handle_set: string | null, link_id: string | null, app: string | null, scope: string | null,
            last_used: string | null, scope_owner: string | null, scope_expires: string | null} & {[k in keyof UserLimits]: number | null}>()
    if (!row) throw new HTTPException(401, {message: 'unknown user'})
    if (link && !row.link_id) throw new HTTPException(401, {message: 'access link revoked'})
    // last used: written at most once a day per link, not on every request
    if (link && (!row.last_used || Date.parse(row.last_used) < Date.now() - 86_400_000)) touchLink(c, link)
    const scopeRow = row.scope_owner ? {owner: row.scope_owner, expires: row.scope_expires} : null
    if (cached) return {user: cached, scopeRow}
    const app = row.app ?? undefined, scope = row.scope ?? undefined
    // an admin sets role 'blocked' (admin panel or API) to stop an account; its files stay, owned by it (files.owner_id)
    if (row.role === 'blocked') throw new HTTPException(403, {message: 'this account is blocked'})
    const role: Role = row.role === 'admin' || row.role === 'staff' ? row.role : 'member'
    const limits: UserLimits = {}
    for (const k of ['drive_quota', 'projects', 'reports_daily'] as const) if (row[k] !== null) limits[k] = row[k]
    const user: CloudUser = {id: row.id, username: row.username, email: row.email, role, handlePending: !row.handle_set, limits, link, app, scope}
    if (user.handlePending && !HANDLE_FREE.test(c.req.path)) throw new HandlePending()
    c.set('cloudUser', user)
    return {user, scopeRow}
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

/**
 * Runs before every route (teenybase's onRequest hook):
 * - CSRF: a request that changes something with the session cookie (no Authorization header) must come from this origin.
 *   The cookie is SameSite=Lax, and files.threepipe.org is the same site, so Lax alone does not stop it.
 * - Password accounts only with DEV_LOGIN (PASSWORD_ROUTES).
 * - Access and app keys never use teenybase's own routes (one could set a password there and become a session that
 *   outlives its link): our routes are their API.
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
    if (typeof db.auth?.meta?.link === 'string') throw new HTTPException(403, {message: 'a key works on /api/v1/uploads, /drive and the routes in its agents.md'})
}
