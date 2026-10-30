/** Daily: delete expired files (s/ shares, b/ builds) from the bucket and mark them in the registry. */
export async function deleteExpired(env: CloudflareBindings, now = new Date()): Promise<number> {
    const iso = now.toISOString()
    let total = 0
    for (;;) {
        const {results} = await env.PRIMARY_DB.prepare('SELECT path FROM files WHERE bucket = ? AND expires_at IS NOT NULL AND expires_at < ? AND deleted_at IS NULL LIMIT 500')
            .bind('cloud', iso).all<{path: string}>()
        if (!results.length) return total
        const keys = results.map(r => r.path)
        await env.CLOUD_BUCKET.delete(keys)
        const marks = keys.map(k => env.PRIMARY_DB.prepare("UPDATE files SET deleted_at = ?, deleted_by = 'system', deleted_reason = 'expired' WHERE bucket = 'cloud' AND path = ?").bind(iso, k))
        await env.PRIMARY_DB.batch(marks)
        total += keys.length
    }
}
