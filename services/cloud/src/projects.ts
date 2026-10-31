import type {Context, Hono} from 'hono'
import {getCookie} from 'hono/cookie'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {CloudUser, isStaff, requireUser} from './auth'
import {checkTurnstile} from './turnstile'
import {
    BODY_MAX, createReport, deleteReport, FILES_MAX, getFile, getImage, getReport, LIST_MAX, listReports, normalizeReportId,
    Project, REPORT_MAX, SentFile, STATUSES, TYPES, updateReport,
} from './reports'

/**
 * Projects: where an app's reports go. Any member creates up to PROJECTS_MAX and adds members; our own apps report
 * to `threepipe` (slugs starting with `threepipe` are for staff). Staff manage every project (abuse, support).
 *
 *   POST   /api/v1/projects {slug, name}                           signed in (not an app key)
 *   GET    /api/v1/projects                                        mine → {projects: [{slug, name, role}]}
 *   PATCH  /api/v1/projects/<slug> {name?, discord_webhook?}       manager
 *   GET    /api/v1/projects/<slug>/members                         reader
 *   POST   /api/v1/projects/<slug>/members {username, role}        manager; role: reader, manager
 *   DELETE /api/v1/projects/<slug>/members/<username>              manager (never the owner)
 *
 *   POST   /api/v1/projects/<slug>/reports                         anyone: signed in (cookie, access or app key), or a
 *                                                                  Turnstile pass (cf-turnstile-response). Idempotency-Key:
 *                                                                  one per dialog. JSON, or multipart with `report` + `file`s.
 *                                                                  → 201 {id} · 200 {id, repeat}
 *   GET    /api/v1/projects/<slug>/reports?status=&type=&q=&deleted=1&limit=&before=   reader → {rows, next}
 *   GET    /api/v1/projects/<slug>/reports/<id>                    reader → {row, files, report}
 *   GET    /api/v1/projects/<slug>/reports/<id>/image              reader, the screenshot
 *   GET    /api/v1/projects/<slug>/reports/<id>/files/<i>          reader, attached file i as a download
 *   PATCH  /api/v1/projects/<slug>/reports/<id> {status?, note?}   manager
 *   DELETE /api/v1/projects/<slug>/reports/<id>                    manager; the row stays as a tombstone
 */
export const PROJECTS_MAX = 5
const SLUG = /^[a-z][a-z0-9-]{1,39}$/
const ROLES = ['reader', 'manager'] as const
type Role = typeof ROLES[number]

const json = <T>(c: Context<CloudEnv>) => c.req.json<T>().catch(() => ({} as Partial<T>))

async function projectBySlug(c: Context<CloudEnv>, slug: string): Promise<Project & {owner_id: string}> {
    const p = await c.env.PRIMARY_DB.prepare('SELECT id, slug, name, owner_id, discord_webhook FROM projects WHERE slug = ?').bind(slug)
        .first<Project & {owner_id: string}>()
    if (!p) throw new HTTPException(404, {message: 'no such project'})
    return p
}

/** The user's role in the project, or a 404 (a project you are not in does not exist for you). App keys: none. */
async function member(c: Context<CloudEnv>, need: Role): Promise<{user: CloudUser, project: Project & {owner_id: string}, role: Role}> {
    const user = await requireUser(c)
    if (user.scope) throw new HTTPException(403, {message: 'an app key cannot read reports'})
    const project = await projectBySlug(c, c.req.param('slug')!)
    let role: Role | undefined = isStaff(user) || project.owner_id === user.id ? 'manager' : undefined
    if (!role) {
        const m = await c.env.PRIMARY_DB.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').bind(project.id, user.id).first<{role: Role}>()
        role = m?.role
    }
    if (!role) throw new HTTPException(404, {message: 'no such project'})
    if (need === 'manager' && role !== 'manager') throw new HTTPException(403, {message: 'managers only'})
    return {user, project, role}
}

/** The body as bytes, or null when it is larger than `max` — also without Content-Length. (From #104.) */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
    if (Number(req.headers.get('content-length') || 0) > max) return null
    if (!req.body) return new Uint8Array(0)
    const reader = req.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > max) {
            await reader.cancel().catch(() => undefined)
            return null
        }
        chunks.push(value)
    }
    const all = new Uint8Array(size)
    let at = 0
    for (const ch of chunks) { all.set(ch, at); at += ch.byteLength }
    return all
}

const reportId = (c: Context<CloudEnv>) => {
    let raw = c.req.param('id')!
    try { raw = decodeURIComponent(raw) } catch { /* not encoded */ }
    const id = normalizeReportId(raw)
    if (!id) throw new HTTPException(400, {message: 'not a report id'})
    return id
}

const out = (c: Context<CloudEnv>, r: Response | {status: number, body: unknown}) =>
    r instanceof Response ? r : c.json(r.body as object, r.status as 200)

export function projectRoutes(app: Hono<CloudEnv>) {
    app.post('/api/v1/projects', async (c) => {
        const user = await requireUser(c)
        if (user.scope) throw new HTTPException(403, {message: 'an app key cannot create projects'})
        const body = await json<{slug?: string, name?: string}>(c)
        const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
        if (!SLUG.test(slug)) throw new HTTPException(400, {message: 'slug: 2 to 40 lower-case letters, digits and -, starting with a letter'})
        if (slug.startsWith('threepipe') && !isStaff(user)) throw new HTTPException(403, {message: 'slugs starting with threepipe are for threepipe apps'})
        const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : slug).slice(0, 100)
        const owned = await c.env.PRIMARY_DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?').bind(user.id).first<{n: number}>()
        if (!isStaff(user) && (owned?.n ?? 0) >= PROJECTS_MAX) throw new HTTPException(403, {message: `at most ${PROJECTS_MAX} projects`})
        try {
            await c.env.PRIMARY_DB.prepare('INSERT INTO projects (id, slug, name, owner_id) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), slug, name, user.id).run()
        } catch (e) {
            if (/UNIQUE/.test(String(e))) throw new HTTPException(409, {message: `${slug} is taken`})
            throw e
        }
        return c.json({slug, name, role: 'manager'}, 201)
    })

    app.get('/api/v1/projects', async (c) => {
        const user = await requireUser(c)
        if (user.scope) throw new HTTPException(403, {message: 'an app key cannot read projects'})
        const {results} = await c.env.PRIMARY_DB.prepare(`SELECT p.slug, p.name, CASE WHEN p.owner_id = ?1 THEN 'manager' ELSE m.role END AS role
                FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?1
                WHERE p.owner_id = ?1 OR m.user_id = ?1 ORDER BY p.slug`).bind(user.id).all()
        return c.json({projects: results})
    })

    app.patch('/api/v1/projects/:slug', async (c) => {
        const {project} = await member(c, 'manager')
        const body = await json<{name?: string, discord_webhook?: string | null}>(c)
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : project.name
        let hook = project.discord_webhook
        if (body.discord_webhook !== undefined) {
            if (body.discord_webhook !== null && body.discord_webhook !== '' &&
                (typeof body.discord_webhook !== 'string' || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(body.discord_webhook)))
                throw new HTTPException(400, {message: 'discord_webhook: a https://discord.com/api/webhooks/… URL, or null'})
            hook = body.discord_webhook || null
        }
        await c.env.PRIMARY_DB.prepare('UPDATE projects SET name = ?, discord_webhook = ? WHERE id = ?').bind(name, hook, project.id).run()
        return c.json({slug: project.slug, name, discord_webhook: !!hook})
    })

    app.get('/api/v1/projects/:slug/members', async (c) => {
        const {project} = await member(c, 'reader')
        const {results} = await c.env.PRIMARY_DB.prepare(`SELECT u.username, 'owner' AS role FROM users u WHERE u.id = ?1
                UNION ALL SELECT u.username, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?2`)
            .bind(project.owner_id, project.id).all()
        return c.json({members: results})
    })

    app.post('/api/v1/projects/:slug/members', async (c) => {
        const {project} = await member(c, 'manager')
        const body = await json<{username?: string, role?: Role}>(c)
        if (!ROLES.includes(body.role as Role)) throw new HTTPException(400, {message: `role is one of ${ROLES.join(', ')}`})
        const u = await c.env.PRIMARY_DB.prepare('SELECT id FROM users WHERE username = ?').bind(String(body.username || '')).first<{id: string}>()
        if (!u) throw new HTTPException(404, {message: 'no such user'})
        if (u.id === project.owner_id) throw new HTTPException(400, {message: 'the owner is a manager already'})
        await c.env.PRIMARY_DB.prepare(`INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)
                ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`).bind(crypto.randomUUID(), project.id, u.id, body.role).run()
        return c.json({username: body.username, role: body.role})
    })

    app.delete('/api/v1/projects/:slug/members/:username', async (c) => {
        const {project} = await member(c, 'manager')
        const u = await c.env.PRIMARY_DB.prepare('SELECT id FROM users WHERE username = ?').bind(c.req.param('username')).first<{id: string}>()
        if (!u) throw new HTTPException(404, {message: 'no such user'})
        await c.env.PRIMARY_DB.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').bind(project.id, u.id).run()
        return c.json({removed: c.req.param('username')})
    })

    // ---- reports ----

    app.post('/api/v1/projects/:slug/reports', async (c) => {
        const project = await projectBySlug(c, c.req.param('slug'))
        const clientKey = (c.req.header('idempotency-key') || '').trim()
        if (!/^[\w-]{8,100}$/.test(clientKey)) throw new HTTPException(400, {message: 'Idempotency-Key header required: one value per dialog, the same value on a retry'})
        // signed in (any key or the cookie): no check; a bad or revoked key is a 401, not a fallback to the check
        const cookieName = c.get('$db').settings.authCookie?.name
        const authed = !!(c.req.header('Authorization') || c.req.header('X-Authorization') || cookieName && getCookie(c, cookieName))
        let userId: string | undefined
        if (authed) userId = (await requireUser(c)).id
        else {
            const gate = await checkTurnstile(c.env, c.req.raw)
            if (!gate.ok) throw new HTTPException(gate.status as 401, {message: gate.error})
        }

        // The boundary is case-sensitive (a browser's is '----WebKitFormBoundaryAbC…'): only the check is lower-cased.
        const type = c.req.header('content-type') || ''
        const multipart = type.toLowerCase().startsWith('multipart/form-data')
        // Capped while it is read: a chunked body has no Content-Length to check first.
        const raw = await readCapped(c.req.raw, multipart ? BODY_MAX : REPORT_MAX)
        if (raw === null) throw new HTTPException(413, {message: 'body too large'})
        let report: unknown
        const files: SentFile[] = []
        if (multipart) {
            let form: FormData
            try { form = await new Response(raw, {headers: {'content-type': type}}).formData() } catch { throw new HTTPException(400, {message: 'bad multipart body'}) }
            const r = form.get('report')
            if (typeof r !== 'string') throw new HTTPException(400, {message: 'the multipart body has a `report` field with the report JSON'})
            if (r.length > REPORT_MAX) throw new HTTPException(413, {message: 'report too large'})
            try { report = JSON.parse(r) } catch { throw new HTTPException(400, {message: 'report must be JSON'}) }
            for (const [field, value] of form) {
                if (field !== 'file' || typeof value === 'string') continue
                files.push({name: (value as File).name || 'file', bytes: new Uint8Array(await (value as File).arrayBuffer())})
            }
        } else {
            try { report = JSON.parse(new TextDecoder().decode(raw)) } catch { throw new HTTPException(400, {message: 'body must be JSON'}) }
        }
        const reportsUrl = `${new URL(c.req.url).origin}/reports#${project.slug}`
        const r = await createReport({env: c.env, req: c.req.raw, project, userId, clientKey, report, files, reportsUrl, ctx: c.executionCtx})
        return out(c, r)
    })

    app.get('/api/v1/projects/:slug/reports', async (c) => {
        const {project} = await member(c, 'reader')
        const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined
        if (c.req.query('limit') && (!Number.isInteger(limit) || (limit as number) <= 0)) throw new HTTPException(400, {message: `limit is a positive integer, at most ${LIST_MAX}`})
        const status = c.req.query('status') || undefined
        if (status && !(STATUSES as readonly string[]).includes(status)) throw new HTTPException(400, {message: `status is one of ${STATUSES.join(', ')}`})
        const type = c.req.query('type') || undefined
        if (type && !(TYPES as readonly string[]).includes(type)) throw new HTTPException(400, {message: `type is one of ${TYPES.join(', ')}`})
        return c.json(await listReports(c.env, project.id, {status, type, limit, q: c.req.query('q') || undefined, deleted: c.req.query('deleted') === '1', before: c.req.query('before') || undefined}))
    })

    app.get('/api/v1/projects/:slug/reports/:id', async (c) => {
        const {project} = await member(c, 'reader')
        return out(c, await getReport(c.env, project.id, reportId(c)))
    })

    app.get('/api/v1/projects/:slug/reports/:id/image', async (c) => {
        const {project} = await member(c, 'reader')
        return out(c, await getImage(c.env, project.id, reportId(c)))
    })

    app.get('/api/v1/projects/:slug/reports/:id/files/:idx', async (c) => {
        const {project, user} = await member(c, 'reader')
        const idx = Number(c.req.param('idx'))
        if (!Number.isInteger(idx) || idx < 0 || idx >= FILES_MAX) throw new HTTPException(404, {message: 'no such file'})
        const id = reportId(c)
        const r = await getFile(c.env, project.id, id, idx)
        if (r instanceof Response) console.log('report file', JSON.stringify({id, file: idx, by: user.username}))
        return out(c, r)
    })

    app.patch('/api/v1/projects/:slug/reports/:id', async (c) => {
        const {project, user} = await member(c, 'manager')
        const body = await c.req.json().catch(() => { throw new HTTPException(400, {message: 'body must be JSON'}) })
        return out(c, await updateReport(c.env, project.id, reportId(c), body, user.username))
    })

    app.delete('/api/v1/projects/:slug/reports/:id', async (c) => {
        const {project, user} = await member(c, 'manager')
        return out(c, await deleteReport(c.env, project.id, reportId(c), user.username))
    })
}
