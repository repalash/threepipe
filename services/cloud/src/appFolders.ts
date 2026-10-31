import type {Context} from 'hono'
import type {CloudEnv} from './env'
import {createFolder} from './drive'

/** Who serves an app (src/connect.ts): its owner's id and handle; none for localhost. */
export type AppOwner = {id: string, username: string} | null

/** What marks an app's folder: the app and who serves it, so a new owner of the same scope never gets the old app's folder. */
const appMark = (app: string, owner: AppOwner) => `${owner?.id ?? 'local'} ${app}`
/** The label of an app's folder, under Apps/. */
export const appLabel = (app: string, owner: AppOwner) => owner ? `${app} (@${owner.username})` : app

/**
 * The id of the drive folder an app's key may use: `Apps/<app>` in the user's drive, made on the first approval and
 * found again by its mark later (after a revoke and a new approval, or when the user deleted it). Names are labels:
 * the user may rename or move it.
 */
export async function appFolder(c: Context<CloudEnv>, userId: string, app: string, owner: AppOwner): Promise<string> {
    const db = c.env.PRIMARY_DB
    const find = (mark: string) => db.prepare('SELECT id FROM drive_folders WHERE owner_id = ? AND app = ?').bind(userId, mark).first<{id: string}>()
    const found = await find(appMark(app, owner))
    if (found) return found.id
    const apps = (await find('apps'))?.id ?? (await createFolder(c, userId, '', await freeLabel(c, userId, '', 'Apps'), 'apps')).id
    return (await createFolder(c, userId, apps, await freeLabel(c, userId, apps, appLabel(app, owner)), appMark(app, owner))).id
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

/** `name`, or `name (2)`, …: free among the folders and items of `parent`. */
async function freeLabel(c: Context<CloudEnv>, userId: string, parent: string, name: string): Promise<string> {
    for (let i = 1; ; i++) {
        const n = i === 1 ? name : `${name} (${i})`
        const taken = await c.env.PRIMARY_DB.prepare(`SELECT 1 FROM drive_folders WHERE owner_id = ?1 AND parent_id = ?2 AND name = ?3
                UNION ALL SELECT 1 FROM drive_items WHERE owner_id = ?1 AND folder_id = ?2 AND name = ?3 LIMIT 1`).bind(userId, parent, n).first()
        if (!taken) return n
    }
}
