/**
 * The worker under test: src/worker.ts bundled by esbuild as wrangler bundles it (the staff page and
 * its script as text), run in Miniflare with a local D1 (the migrations applied) and a local R2.
 * Every outbound fetch goes to `outbound`, which records it and answers as siteverify or Discord do.
 */
import {Miniflare} from 'miniflare'
import {build} from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const TEST_TURNSTILE = '1x0000000000000000000000000000000AA'
export const STAFF = 'ana=staff-token-ana-0001,ben=staff-token-ben-0002'
export const SHARE = 'pat=share-token-pat-0001,admin=share-token-admin-01'

let bundled: string | null = null
async function bundle(): Promise<string> {
    if (bundled) return bundled
    const out = await build({
        entryPoints: [path.join(ROOT, 'src/worker.ts')],
        bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false,
        conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'],
        loader: {'.html': 'text'},
        plugins: [{name: 'client-js-as-text', setup(b) {
            b.onLoad({filter: /\.client\.js$/}, a => ({contents: fs.readFileSync(a.path, 'utf8'), loader: 'text'}))
        }}],
        logLevel: 'silent',
    })
    bundled = out.outputFiles[0].text
    return bundled
}

export interface Call {url: string, method: string, body: string, headers: Record<string, string>}

export interface Harness {
    mf: Miniflare
    calls: Call[]
    /** What the stubs answer. */
    stub: {siteverify: Record<string, unknown> | null, discordStatus: number}
    fetch(path: string, init?: RequestInit & {headers?: Record<string, string>}): Promise<Response>
    sql<T = any>(query: string, ...args: unknown[]): Promise<T[]>
    r2Keys(): Promise<string[]>
    r2Text(key: string): Promise<string | null>
    dispose(): Promise<void>
}

export async function startWorker(bindings: Record<string, string> = {}): Promise<Harness> {
    const calls: Call[] = []
    const stub = {siteverify: null as Record<string, unknown> | null, discordStatus: 204}
    const mf = new Miniflare({
        modules: true,
        script: await bundle(),
        compatibilityDate: '2026-03-01',
        d1Databases: ['DB'],
        r2Buckets: ['BUCKET'],
        bindings: {
            ORIGINS: 'https://threepipe.org=prod,https://dev.threepipe.org=dev',
            TURNSTILE_SECRET: TEST_TURNSTILE,
            STAFF_TOKENS: STAFF,
            SHARE_TOKENS: SHARE,
            DISCORD_WEBHOOK: '123/abc',
            STAFF_URL: 'https://cloud.example/staff',
            ...bindings,
        },
        outboundService: async (req: Request) => {
            const body = req.method === 'GET' ? '' : await req.text()
            calls.push({url: req.url, method: req.method, body, headers: Object.fromEntries(req.headers)})
            const u = new URL(req.url)
            if (u.hostname === 'discord.com') return new Response(null, {status: stub.discordStatus})
            if (u.href === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return Response.json(stub.siteverify ?? {success: false})
            return new Response('unexpected outbound fetch', {status: 599})
        },
    })
    const db = await mf.getD1Database('DB')
    for (const f of fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8').replace(/--.*$/gm, '')
        for (const stmt of sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) await db.prepare(stmt).run()
    }
    const bucket = await mf.getR2Bucket('BUCKET')
    return {
        mf, calls, stub,
        // Over HTTP with Node's own fetch, as a browser or curl reaches `wrangler dev`.
        fetch: async(p, init) => fetch(new URL(p, await mf.ready), {...init, ...(init?.body instanceof ReadableStream ? {duplex: 'half'} : {})} as RequestInit),
        sql: async (q, ...args) => (await db.prepare(q).bind(...args).all()).results as never,
        r2Keys: async () => (await bucket.list()).objects.map(o => o.key),
        r2Text: async key => { const o = await bucket.get(key); return o ? o.text() : null },
        dispose: () => mf.dispose(),
    }
}
