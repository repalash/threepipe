/**
 * threepipe-cloud: the one Worker behind `@threepipe/plugin-cloud`, with one D1 database and one R2
 * bucket. Three route groups, each with its own credential; anything else is a 404.
 *
 *   POST /reports, OPTIONS /reports       a Turnstile pass          src/routes/reports.ts
 *   /staff, /staff/*                      STAFF_TOKENS              src/routes/staff.ts
 *   POST /share, DELETE /share/<slug>     SHARE_TOKENS              src/routes/share.ts
 *   GET /<slug>/…, GET /a/<id>/<name>     none: shared files        src/routes/share.ts
 *
 * See README.md for what each stores, the privacy rules and the deploy steps.
 */
import type {Env} from './env.ts'
import {html} from './common/http.ts'
import {handleReports} from './routes/reports.ts'
import {handleStaff} from './routes/staff.ts'
import {ASSET_PATH_RE, handleShareApi, serveAsset, serveShare} from './routes/share.ts'

const landingPage = (origin: string) => `<!doctype html><meta charset="utf-8"><title>threepipe-cloud</title>
<body style="font-family:system-ui;max-width:640px;margin:3rem auto;padding:0 1rem">
<h2>threepipe-cloud</h2>
<p>The backend of <code>@threepipe/plugin-cloud</code>: reports from threepipe apps, and file sharing for the team.</p>
<pre style="background:#f4f4f4;padding:1rem;overflow-x:auto">curl -F "file=@page.html" -H "Authorization: Bearer &lt;share-token&gt;" ${origin}/share</pre>
<p>Staff: <a href="/staff">/staff</a>. Source: <a href="https://github.com/repalash/threepipe/tree/master/services/cloud">services/cloud</a>.</p></body>`

export default {
    async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url)
        // A browser visit to the workers.dev name goes to the custom domain; the APIs answer on both.
        if (env.CANONICAL_HOST && url.hostname.endsWith('.workers.dev') && req.method === 'GET'
            && !url.pathname.startsWith('/staff') && url.pathname !== '/reports') {
            const to = new URL(url)
            to.hostname = env.CANONICAL_HOST
            to.protocol = 'https:'
            to.port = ''
            return Response.redirect(to.toString(), 301)
        }
        try {
            if (url.pathname === '/reports') return await handleReports(req, env, url, ctx)
            if (url.pathname === '/staff' || url.pathname.startsWith('/staff/')) return await handleStaff(req, env, url)
            if (url.pathname === '/share' || url.pathname.startsWith('/share/')) return await handleShareApi(req, env, url)
            if (req.method !== 'GET' && req.method !== 'HEAD') return html('method not allowed', 405)
            if (url.pathname === '/' || url.pathname === '') return html(landingPage(url.origin))
            const asset = url.pathname.match(ASSET_PATH_RE)
            if (asset) return await serveAsset(req, env, asset[1], asset[2])
            return await serveShare(req, env, url)
        } catch (e: any) {
            console.error('threepipe-cloud', e?.stack || e)
            return html('<h1>500</h1>', 500)
        }
    },
}
