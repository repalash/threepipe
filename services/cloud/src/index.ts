import {Hono} from 'hono'
import {$Database, D1Adapter, OpenApiExtension, PocketUIExtension, teenyHono} from 'teenybase/worker'
import config from 'virtual:teenybase'
import {CloudEnv, logError} from './env'
import {filesHost} from './files'
import {accessRoutes} from './access'
import {uploadRoutes} from './uploads'
import {driveRoutes} from './drive'
import {connectRoutes} from './connect'
import {bucketRoutes} from './buckets'
import {devLoginRoutes} from './devLogin'
import {projectRoutes} from './projects'
import {handleRoutes, markHandleSet} from './handle'
import {pageRoutes} from './page'
import {guardRequest} from './auth'
import {deleteExpired} from './cron'

/**
 * threepipe cloud: one Worker for the API (teenybase at /api/v1 plus the routes below) and the files host.
 * See README.md.
 */
const app = new Hono<CloudEnv>()
// Every 5xx, and every sign-in that failed at the provider (a wrong or expired client secret, the provider down, an
// email it would not give), is logged for a person (logError). Cancelling at the provider is not an error.
app.use('*', async (c, next) => {
    await next()
    const status = c.res.status
    const signIn = /\/auth\/oauth\/[^/]+\/callback$/.test(c.req.path)
    if (status < 500 && !(signIn && status >= 400 && c.req.query('error') !== 'access_denied')) return
    const body = await c.res.clone().text().catch(() => '')
    logError(signIn ? 'sign-in failed' : 'server error', {status, method: c.req.method, path: c.req.path, error: body.slice(0, 500),
        exception: status >= 500 && c.error ? String(c.error.stack || c.error) : undefined, ray: c.req.header('cf-ray')})
})
app.use('*', markHandleSet)
app.use('*', filesHost) // before teenybase: file reads never touch the database

teenyHono<CloudEnv>(async (c) => {
    const db = new $Database(c, config, new D1Adapter(c.env.PRIMARY_DB))
    db.extensions.push(new OpenApiExtension(db, true))
    db.extensions.push(new PocketUIExtension(db))
    return db
}, app, {logger: true, cors: true}, guardRequest)

accessRoutes(app)
uploadRoutes(app)
driveRoutes(app)
connectRoutes(app)
bucketRoutes(app)
devLoginRoutes(app)
projectRoutes(app)
handleRoutes(app)
pageRoutes(app)

export default {
    fetch: app.fetch,
    async scheduled(_event: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {
        ctx.waitUntil(deleteExpired(env).catch(e => logError('cron failed', {exception: String(e?.stack || e)})))
    },
} satisfies ExportedHandler<CloudflareBindings>
