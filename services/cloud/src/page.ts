import type {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {requireUser} from './auth'
import {DRIVE_QUOTA} from './drive'
import UI_CSS from './page/ui.css'
import UI_SCRIPT from './page/ui.client.js'
import DRIVE from './page/drive.html'
import DRIVE_SCRIPT from './page/drive.client.js'
import REPORTS from './page/reports.html'
import REPORTS_SCRIPT from './page/reports.client.js'

const HEADERS = {
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}
const html = {'content-type': 'text/html; charset=utf-8', ...HEADERS}
const js = {'content-type': 'text/javascript; charset=utf-8', ...HEADERS}
const css = {'content-type': 'text/css; charset=utf-8', ...HEADERS}

/**
 * The pages on the API host, with the session cookie: the drive (src/drive.ts) and the reports of your projects
 * (src/projects.ts, from #104's staff page). One look for all of them, also the consent page (src/connect.ts) and the
 * local sign-in (src/devLogin.ts): /ui.css, the clean colour mode of @threepipe/plugin-tweakpane.
 */
export function pageRoutes(app: Hono<CloudEnv>) {
    app.get('/ui.css', c => c.body(UI_CSS, 200, css))
    app.get('/ui.js', c => c.body(UI_SCRIPT, 200, js))
    app.get('/drive', c => c.body(DRIVE, 200, html))
    app.get('/drive/page.js', c => c.body(DRIVE_SCRIPT, 200, js))
    app.get('/reports', c => c.body(REPORTS, 200, html))
    app.get('/reports/page.js', c => c.body(REPORTS_SCRIPT, 200, js))

    /** The signed-in user, for the pages' side bar: the handle, the name, the role and the drive's use of its quota. */
    app.get('/api/v1/me', async c => {
        const user = await requireUser(c)
        if (user.scope) throw new HTTPException(403, {message: 'an app key can only use the drive'})
        const [row, use] = await c.env.PRIMARY_DB.batch([
            c.env.PRIMARY_DB.prepare('SELECT name FROM users WHERE id = ?').bind(user.id),
            c.env.PRIMARY_DB.prepare(`SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE owner_id = ? AND prefix = 'd' AND deleted_at IS NULL`).bind(user.id),
        ]) as [D1Result<{name: string | null}>, D1Result<{used: number}>]
        return c.json({username: user.username, name: row.results[0]?.name || user.username, role: user.role,
            drive: {used: use.results[0]?.used ?? 0, quota: DRIVE_QUOTA[user.role]}})
    })
}
