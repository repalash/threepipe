import type {Context} from 'hono'
import type {CloudEnv} from './env'
import {createFolder, freeName} from './drive'

/** Who serves an app (src/connect.ts): its owner's id and handle; none for localhost. */
export type AppOwner = {id: string, username: string} | null

/** What marks an app's folder: the app and who serves it, so a new owner of the same scope never gets the old app's folder. */
const appMark = (app: string, owner: AppOwner) => `${owner?.id ?? 'local'} ${app}`
/** The label of an app's folder, under Apps/: one path segment (`p/demo` → `p-demo`), so the drive finds it by its path. */
export const appLabel = (app: string, owner: AppOwner) => {
    const name = app.replace(/\//g, '-')
    return owner ? `${name} (@${owner.username})` : name
}

/**
 * The id of the drive folder an app's key may use: `Apps/<app>` in the user's drive, made on the first approval and
 * found again by its mark later (after a revoke and a new approval, or when the user deleted it). Names are labels:
 * the user may rename or move it.
 */
export async function appFolder(c: Context<CloudEnv>, userId: string, app: string, owner: AppOwner): Promise<string> {
    const db = c.env.PRIMARY_DB
    const find = (mark: string) => db.prepare('SELECT id FROM drive_folders WHERE owner_id = ? AND app = ?').bind(userId, mark).first<{id: string}>()
    // made here, or found: an approval at the same time may have made it first (the name is then taken: 409)
    const make = async (parent: string, label: string, mark: string) => {
        const found = await find(mark)
        if (found) return found.id
        try {
            return (await createFolder(c, userId, parent, await freeName(c, userId, parent, label, false), mark)).id
        } catch (e) {
            const made = await find(mark)
            if (made) return made.id
            throw e
        }
    }
    return make(await make('', 'Apps', 'apps'), appLabel(app, owner), appMark(app, owner))
}

/**
 * The folder of the app grant `grantId`, made again when it is gone (the user deleted it), and the grant pointed at it.
 * Returns the folder id, or '*' for a whole-drive grant.
 */
export async function grantFolder(c: Context<CloudEnv>, userId: string, grantId: string): Promise<string> {
    const db = c.env.PRIMARY_DB
    const g = await db.prepare(`SELECT l.app, l.scope, u.id AS owner_id, u.username AS owner_name FROM access_links l LEFT JOIN users u ON u.id = l.app_owner
            WHERE l.id = ? AND l.owner_id = ?`).bind(grantId, userId).first<{app: string, scope: string, owner_id: string | null, owner_name: string | null}>()
    if (!g?.app || !g.scope) throw new Error('not an app grant')
    if (g.scope === '*') return '*'
    if (await db.prepare('SELECT 1 FROM drive_folders WHERE id = ? AND owner_id = ?').bind(g.scope, userId).first()) return g.scope
    const id = await appFolder(c, userId, g.app, g.owner_id ? {id: g.owner_id, username: g.owner_name!} : null)
    await db.prepare('UPDATE access_links SET scope = ? WHERE id = ?').bind(id, grantId).run()
    return id
}
