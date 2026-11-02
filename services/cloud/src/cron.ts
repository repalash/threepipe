import {BUCKET} from './env'

/**
 * Daily: delete expired files (s/ shares, b/ builds) from the bucket and mark them in the registry, then release the
 * scopes that have no files left.
 *
 * An upload can renew a path while this runs. So a row is first marked deleted only if it is still expired (one
 * conditional UPDATE … RETURNING), and its object is deleted only if it was written before this run started; an object
 * written later belongs to that upload, whose registry upsert has cleared the mark again.
 */
export async function deleteExpired(env: CloudflareBindings, now = new Date()): Promise<number> {
    const iso = now.toISOString()
    const db = env.PRIMARY_DB
    let total = 0
    for (;;) {
        const {results} = await db.prepare(`UPDATE files SET deleted_at = ?1, deleted_by = 'system', deleted_reason = 'expired'
                WHERE id IN (SELECT id FROM files WHERE bucket = ?2 AND expires_at IS NOT NULL AND expires_at < ?1 AND deleted_at IS NULL LIMIT 500)
                RETURNING path`).bind(iso, BUCKET).all<{path: string}>()
        if (!results.length) break
        const heads = await Promise.all(results.map(r => env.CLOUD_BUCKET.head(r.path)))
        const stale = results.filter((_, i) => heads[i] && heads[i]!.uploaded.getTime() < now.getTime()).map(r => r.path)
        if (stale.length) await env.CLOUD_BUCKET.delete(stale)
        total += results.length
    }
    // scopes with no live files, claimed more than a day ago (an upload that just claimed one has not written its row yet)
    await db.prepare(`DELETE FROM scopes WHERE created < datetime(?1, '-1 day') AND NOT EXISTS (SELECT 1 FROM files
            WHERE files.bucket = ?2 AND files.path >= scopes.scope || '/' AND files.path < scopes.scope || '0' AND files.deleted_at IS NULL)`)
        .bind(iso, BUCKET).run()
    return total
}
