import type {Context} from 'hono'
import {getCookie} from 'hono/cookie'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'

export type Role = 'member' | 'staff' | 'admin'

export interface CloudUser {
    id: string
    username: string
    email: string
    role: Role
    /** id of the access link when the request uses an access key (src/access.ts) or an app key (src/connect.ts) */
    link?: string
    /** app keys only: the app (`p/<name>`, `localhost:5173`, ...) */
    app?: string
    /** app keys only: the id of the drive folder the key may use (and below it), or `*` for the whole drive; nothing else */
    scope?: string
}

export const isStaff = (u: CloudUser) => u.role === 'staff' || u.role === 'admin'

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
        c.executionCtx.waitUntil(c.env.PRIMARY_DB.prepare('UPDATE access_links SET last_used = ? WHERE id = ?').bind(new Date().toISOString(), link).run())
    }
    const row = await c.env.PRIMARY_DB.prepare('SELECT id, username, email, role FROM users WHERE id = ?').bind(auth.uid).first<{id: string, username: string, email: string, role: string | null}>()
    if (!row) throw new HTTPException(401, {message: 'unknown user'})
    const role: Role = row.role === 'admin' || row.role === 'staff' ? row.role : 'member'
    const user: CloudUser = {id: row.id, username: row.username, email: row.email, role, link, app, scope}
    c.set('cloudUser', user)
    return user
}

/** 403 for an app key outside the drive routes (they check the folder themselves, src/drive.ts). */
export function assertScope(user: CloudUser, _path: string) {
    if (user.scope) throw new HTTPException(403, {message: 'an app key can only use the drive'})
}

/** A key that acts as the user while the access link `linkId` exists (src/access.ts, src/connect.ts). */
export async function mintKey(c: Context<CloudEnv>, user: {id: string, email: string}, linkId: string, seconds: number): Promise<string> {
    const db = c.get('$db')
    const secret = await db.secretResolver.resolve('$JWT_SECRET_USERS')
    return db.jwt.createJwtToken({id: user.id, sub: user.email, cid: 'users', verified: true, meta: {link: linkId}}, secret, seconds)
}

/** Our routes: they call requireUser and check scopes themselves. Everything else under /api/ is teenybase. */
const OWN_ROUTES = /^\/api\/v1\/(uploads|access|access-links|connect|drive|buckets|projects)(\/|$)/

/**
 * Runs before every route (teenybase's onRequest hook):
 * - CSRF: a request that changes something with the session cookie (no Authorization header) must come from this origin.
 *   The cookie is SameSite=Lax, and files.threepipe.org is the same site, so Lax alone does not stop it.
 * - Keys on teenybase's own routes: the link must still exist (revocation), and app keys cannot use them at all.
 */
export async function guardRequest(c: Context<CloudEnv>): Promise<Response | undefined> {
    const url = new URL(c.req.url)
    if (!url.pathname.startsWith('/api/')) return
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
    return
}
