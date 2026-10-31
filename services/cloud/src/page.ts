import type {Hono} from 'hono'
import type {CloudEnv} from './env'
import DRIVE from './page/drive.html'
import DRIVE_SCRIPT from './page/drive.client.js'
import REPORTS from './page/reports.html'
import REPORTS_SCRIPT from './page/reports.client.js'

const HEADERS = {
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}
const html = {'content-type': 'text/html; charset=utf-8', ...HEADERS}
const js = {'content-type': 'text/javascript; charset=utf-8', ...HEADERS}

/**
 * The pages on the API host, with the session cookie: the drive (src/drive.ts) and the reports of your projects
 * (src/projects.ts, from #104's staff page).
 */
export function pageRoutes(app: Hono<CloudEnv>) {
    app.get('/drive', c => c.body(DRIVE, 200, html))
    app.get('/drive/page.js', c => c.body(DRIVE_SCRIPT, 200, js))
    app.get('/reports', c => c.body(REPORTS, 200, html))
    app.get('/reports/page.js', c => c.body(REPORTS_SCRIPT, 200, js))
}
