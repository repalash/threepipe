/**
 * A modelling session in a headless browser, for what a Node session cannot do: draw.
 *
 * Starts a relay on a free port, serves the bundled session page (`dist/page/`), opens it in headless
 * Chromium with the relay's address and token, and talks to it over the agent socket - the same path a
 * live editor takes, so every headless `look` also exercises the socket.
 *
 * Chromium comes from Playwright (`npx playwright install chromium`), or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
 * `wsEndpoint` connects to a browser server elsewhere instead (a GPU machine); the page must then be
 * reachable from there, so pass `pageUrl`/`relayHost` to match.
 */

import {createServer, Server} from 'node:http'
import {readFile, stat} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname, extname, join, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {Browser, Page} from 'playwright-core'
import type {Command, CommandResult} from '@threepipe/plugin-modelling'
import {AgentRelay} from '../relay/AgentRelay'
import {ModellingSession} from '../session/types'
import {runWithFiles} from '../session/files'

export interface BrowserSessionOptions {
    /** Viewport size. Default 1000 x 700. */
    width?: number
    height?: number
    /** Directory with the bundled page. Default: `dist/page` beside this module. */
    pageDir?: string
    /** Fix the page's document id (determinism). */
    documentId?: string
    /** Connect to a running Playwright browser server instead of launching one. */
    wsEndpoint?: string
    /** Show the browser. */
    headed?: boolean
    log?: (message: string) => void
}

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
}

/** The package's `dist/page`, from the built bundle (`dist/` or `dist/chunks/`) or from `src/browser/`. */
export function defaultPageDir(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [join(here, 'page'), resolve(here, '../page'), resolve(here, '../../dist/page')]
    return candidates.find(d => existsSync(join(d, 'index.html'))) ?? candidates[candidates.length - 1]
}

export class BrowserSession implements ModellingSession {
    readonly kind = 'browser' as const
    readonly relay: AgentRelay
    private _http: Server | null = null
    private _browser: Browser | null = null
    private _page: Page | null = null
    private _pageId: string | null = null
    private readonly _log: (m: string) => void
    /** Errors the page printed: surfaced in failures so a broken page is not a mystery. */
    readonly pageErrors: string[] = []

    private constructor(private readonly options: BrowserSessionOptions) {
        this._log = options.log ?? (() => undefined)
        this.relay = new AgentRelay({port: 0, log: this._log})
    }

    static async start(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
        const s = new BrowserSession(options)
        try {
            await s._start()
        } catch (e) {
            await s.close()
            throw e
        }
        return s
    }

    private async _start(): Promise<void> {
        const pageDir = this.options.pageDir ?? defaultPageDir()
        try {
            await stat(join(pageDir, 'index.html'))
        } catch {
            throw new Error(`the session page is not built (${pageDir}/index.html) - run \`npm run build:page\` in plugins/modelling-cli`)
        }
        await this.relay.start()
        const httpPort = await this._serve(pageDir)
        const {chromium} = await import('playwright-core')
        if (this.options.wsEndpoint) {
            this._browser = await chromium.connect(this.options.wsEndpoint)
        } else {
            this._browser = await chromium.launch({
                headless: !this.options.headed,
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
                args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
            })
        }
        const context = await this._browser.newContext({
            viewport: {width: this.options.width ?? 1000, height: this.options.height ?? 700}, deviceScaleFactor: 1,
        })
        const page = await context.newPage()
        page.on('pageerror', e => this.pageErrors.push(e.message.slice(0, 300)))
        page.on('console', m => {
            if (m.type() === 'error') this.pageErrors.push(m.text().slice(0, 300))
        })
        this._page = page
        const query = new URLSearchParams({agent: this.relay.url, agentToken: this.relay.token})
        if (this.options.documentId) query.set('documentId', this.options.documentId)
        const url = `http://127.0.0.1:${httpPort}/index.html?${query}`
        this._log(`opening ${url.replace(this.relay.token, '…')}`)
        await page.goto(url, {waitUntil: 'domcontentloaded'})
        const info = await this.relay.waitForPage(60000).catch(e => {
            throw new Error(`${(e as Error).message}${this.pageErrors.length ? ` - page errors: ${this.pageErrors.slice(0, 3).join(' | ')}` : ''}`)
        })
        this._pageId = info.pageId
    }

    private _serve(dir: string): Promise<number> {
        const root = resolve(dir)
        return new Promise((resolvePort, reject) => {
            const server = createServer(async(req, res) => {
                const path = normalize(join(root, decodeURIComponent((req.url ?? '/').split('?')[0])))
                if (!path.startsWith(root)) {
                    res.writeHead(403).end()
                    return
                }
                try {
                    const file = (await stat(path)).isDirectory() ? join(path, 'index.html') : path
                    const body = await readFile(file)
                    res.writeHead(200, {'content-type': MIME[extname(file)] ?? 'application/octet-stream'}).end(body)
                } catch {
                    res.writeHead(404).end()
                }
            })
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => {
                this._http = server
                const address = server.address()
                resolvePort(typeof address === 'object' && address ? address.port : 0)
            })
        })
    }

    /** The Playwright page, for callers that need more than commands (screenshots of the page itself). */
    get page(): Page | null {
        return this._page
    }

    run(command: Command): Promise<CommandResult> {
        return runWithFiles(c => this.relay.call(c, {pageId: this._pageId ?? undefined, agent: 'threepipe-modelling'}), command)
    }

    async close(): Promise<void> {
        await this._browser?.close().catch(() => undefined)
        this._browser = null
        await this.relay.stop()
        await new Promise<void>(r => this._http ? this._http.close(() => r()) : r())
        this._http = null
    }
}
