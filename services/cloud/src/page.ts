import type {Hono} from 'hono'
import type {CloudEnv} from './env'
import DRIVE from './page/drive.html'
import DRIVE_SCRIPT from './page/drive.client.js'

const HEADERS = {
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}
const html = {'content-type': 'text/html; charset=utf-8', ...HEADERS}
const js = {'content-type': 'text/javascript; charset=utf-8', ...HEADERS}

/** The pages on the API host. The drive page reads and changes the drive through src/drive.ts with the session cookie. */
export function pageRoutes(app: Hono<CloudEnv>) {
    app.get('/drive', c => c.body(DRIVE, 200, html))
    app.get('/drive/page.js', c => c.body(DRIVE_SCRIPT, 200, js))
}
