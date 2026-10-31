import type {Context, Hono} from 'hono'
import type {CloudEnv} from './env'
import {assertScope, requireUser} from './auth'
import {driveUsage} from './drive'
import {DRIVE_QUOTA} from './limits'
import UI_CSS from './page/ui.css'
import UI_SCRIPT from './page/ui.client.js'
import DRIVE from './page/drive.html'
import DRIVE_SCRIPT from './page/drive.client.js'
import REPORTS from './page/reports.html'
import REPORTS_SCRIPT from './page/reports.client.js'

/** The project the pages' own "Report a problem" goes to (made by staff; the button shows once it exists). */
export const FEEDBACK_PROJECT = 'threepipe'

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
 * (src/projects.ts, from #104's staff page). One look for all of them, also the server-rendered cards (the consent page,
 * src/connect.ts, and the local sign-in, src/devLogin.ts): /ui.css, the clean colour mode of @threepipe/plugin-tweakpane.
 */
export function pageRoutes(app: Hono<CloudEnv>) {
    app.get('/ui.css', c => c.body(UI_CSS, 200, css))
    app.get('/ui.js', c => c.body(UI_SCRIPT, 200, js))
    app.get('/drive', c => c.body(DRIVE, 200, html))
    app.get('/drive/page.js', c => c.body(DRIVE_SCRIPT, 200, js))
    app.get('/reports', c => c.body(REPORTS, 200, html))
    app.get('/reports/page.js', c => c.body(REPORTS_SCRIPT, 200, js))

    /** The signed-in user, for the pages' side bar: handle, name, role, the drive's use of its quota, where feedback goes. */
    app.get('/api/v1/me', async c => {
        const user = await requireUser(c)
        assertScope(user)
        const [row, feedback, {used}] = await Promise.all([
            c.env.PRIMARY_DB.prepare('SELECT name FROM users WHERE id = ?').bind(user.id).first<{name: string | null}>(),
            c.env.PRIMARY_DB.prepare('SELECT 1 FROM projects WHERE slug = ?').bind(FEEDBACK_PROJECT).first(),
            driveUsage(c, user.id),
        ])
        return c.json({username: user.username, name: row?.name || user.username, role: user.role,
            drive: {used, quota: DRIVE_QUOTA[user.role]}, feedback: feedback ? FEEDBACK_PROJECT : null})
    })
}

// ---- server-rendered cards ----

export const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

const icon = (paths: string) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`
/** The few icons of the cards (the pages draw theirs in ui.client.js). */
export const ICONS = {
    cube: icon('<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>'),
    folder: icon('<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/>'),
    github: icon('<path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>'),
}

/**
 * A page with one card in the middle (`body` is HTML: escape what goes in it). No scripts; styles from /ui.css only.
 * Referrer same-origin, not no-referrer: with no-referrer the browser sends `Origin: null` on a form post, and
 * guardRequest rejects it. `formAction` limits where its form may post (none: the consent form redirects to the app,
 * and Chrome applies form-action to that redirect too).
 */
export function cardPage(c: Context<CloudEnv>, body: string, o: {wide?: boolean, formAction?: string} = {}) {
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>threepipe cloud</title><link rel="stylesheet" href="/ui.css"></head>
<body><div class="center"><div class="card${o.wide ? ' wide' : ''}"><div class="brand"><span class="mark">${ICONS.cube}</span>threepipe cloud</div>${body}</div></div></body></html>`, 200, {
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
        'content-security-policy': `default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'${o.formAction ? `; form-action ${o.formAction}` : ''}`,
        'referrer-policy': 'same-origin',
    })
}
