import {Hono} from 'hono'
import {$Database, D1Adapter, OpenApiExtension, PocketUIExtension, teenyHono} from 'teenybase/worker'
import config from 'virtual:teenybase'
import type {CloudEnv} from './env'
import {filesHost} from './files'
import {accessRoutes} from './access'
import {uploadRoutes} from './uploads'
import {driveRoutes} from './drive'
import {connectRoutes} from './connect'
import {bucketRoutes} from './buckets'
import {devLoginRoutes} from './devLogin'
import {guardRequest} from './auth'
import {deleteExpired} from './cron'

/**
 * threepipe cloud: one Worker for the API (teenybase at /api/v1 plus the routes below) and the files host.
 * See README.md.
 */
const app = new Hono<CloudEnv>()
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

export default {
    fetch: app.fetch,
    async scheduled(_event: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {
        ctx.waitUntil(deleteExpired(env))
    },
} satisfies ExportedHandler<CloudflareBindings>
