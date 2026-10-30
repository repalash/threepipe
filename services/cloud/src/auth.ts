import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'

export type Role = 'member' | 'staff' | 'admin'

export interface CloudUser {
    id: string
    username: string
    email: string
    role: Role
    /** id of the access link when the request uses an access key (src/access.ts) */
    link?: string
}

export const isStaff = (u: CloudUser) => u.role === 'staff' || u.role === 'admin'

/**
 * The signed-in user of a request (teenybase session JWT, cookie, or access key), or a 401.
 * An access key carries `meta.link`: the link must still exist, so deleting the link revokes the key here.
 */
export async function requireUser(c: Context<CloudEnv>): Promise<CloudUser> {
    const db = c.get('$db')
    await db.initAuth()
    const auth = db.auth
    if (!auth.uid || auth.cid !== 'users') throw new HTTPException(401, {message: 'sign in, or send an access key (Authorization: Bearer <key>)'})
    const link = typeof auth.meta?.link === 'string' ? auth.meta.link as string : undefined
    if (link) {
        const row = await c.env.PRIMARY_DB.prepare('SELECT id FROM access_links WHERE id = ? AND owner_id = ?').bind(link, auth.uid).first()
        if (!row) throw new HTTPException(401, {message: 'access link revoked'})
        c.executionCtx.waitUntil(c.env.PRIMARY_DB.prepare('UPDATE access_links SET last_used = ? WHERE id = ?').bind(new Date().toISOString(), link).run())
    }
    const user = await c.env.PRIMARY_DB.prepare('SELECT id, username, email, role FROM users WHERE id = ?').bind(auth.uid).first<{id: string, username: string, email: string, role: string | null}>()
    if (!user) throw new HTTPException(401, {message: 'unknown user'})
    const role: Role = user.role === 'admin' || user.role === 'staff' ? user.role : 'member'
    return {id: user.id, username: user.username, email: user.email, role, link}
}
