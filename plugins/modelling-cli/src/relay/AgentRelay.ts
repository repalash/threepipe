/**
 * The agent socket relay: pages running `AgentSocketPlugin` connect to it, agents send it commands, and it
 * routes each command to one page and its result back.
 *
 * A browser page cannot accept connections, so both sides dial in. The relay is in the MCP server (which
 * calls {@link AgentRelay.call} in-process) and runs standalone as `threepipe-modelling relay`, where the
 * CLI's `--connect` reaches it as a WebSocket agent.
 *
 * Kept from the blueprint editor's bridge (`experiments/threepipe-blueprint-editor/scripts/mcp-bridge-common.mjs`):
 * the page dials a fixed local port and keeps redialling. Not kept: no auth (here a token, checked before
 * anything else), first-socket routing (here a page id, and an error naming the pages when it is
 * ambiguous), requests left to time out when a page drops (here failed at once), errors as `{error}`
 * strings (here always a `CommandResult`), and `EADDRINUSE` swallowed (here `start()` rejects).
 */

import '../node/polyfill'
import {EventEmitter} from 'node:events'
import {randomBytes, timingSafeEqual} from 'node:crypto'
import {WebSocket, WebSocketServer} from 'ws'
import {
    AGENT_PROTOCOL_VERSION,
    AgentCloseCode,
    AgentMessage,
    Command,
    CommandResult,
    PageInfo,
    transportFailure,
} from '@threepipe/plugin-modelling'

export interface AgentRelayOptions {
    /** Port to listen on. 0 picks a free one. Default 9396. */
    port?: number
    /** Interface. Default 127.0.0.1; use 0.0.0.0 when the browser is on another machine or container. */
    host?: string
    /** Shared secret pages and agents must present. Default: random, see {@link AgentRelay.token}. */
    token?: string
    /** How long a call may take before it fails. Default 10 minutes (a big build step under SwiftShader). */
    callTimeout?: number
    /** Diagnostics. Never stdout: the CLI and the MCP server own stdout. */
    log?: (message: string) => void
}

interface PageConnection {
    info: PageInfo
    socket: WebSocket
    connectedAt: number
}

interface Pending {
    page: PageConnection
    resolve: (r: CommandResult) => void
    command: Command
    timer: ReturnType<typeof setTimeout>
}

export class AgentRelay extends EventEmitter {
    readonly token: string
    private _server: WebSocketServer | null = null
    private _pages = new Map<string, PageConnection>()
    private _agents = new Map<WebSocket, string>()
    private _pending = new Map<number, Pending>()
    private _nextId = 1
    private _port = 0
    private readonly _host: string
    private readonly _requestedPort: number
    private readonly _timeout: number
    private readonly _log: (m: string) => void

    constructor(options: AgentRelayOptions = {}) {
        super()
        this.token = options.token ?? randomBytes(18).toString('base64url')
        this._host = options.host ?? '127.0.0.1'
        this._requestedPort = options.port ?? 9396
        this._timeout = options.callTimeout ?? 600000
        this._log = options.log ?? (() => undefined)
    }

    get port(): number {
        return this._port
    }

    /** `ws://host:port`, with `0.0.0.0` shown as `127.0.0.1`. */
    get url(): string {
        return `ws://${this._host === '0.0.0.0' ? '127.0.0.1' : this._host}:${this._port}`
    }

    /** The query a page needs to connect: append to the editor's URL. */
    get pageQuery(): string {
        return `agent=${encodeURIComponent(this.url)}&agentToken=${encodeURIComponent(this.token)}`
    }

    start(): Promise<{url: string, port: number, token: string}> {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({host: this._host, port: this._requestedPort, maxPayload: 256 * 1024 * 1024})
            server.once('error', reject)
            server.once('listening', () => {
                server.off('error', reject)
                server.on('error', e => this._log(`relay error: ${(e as Error).message}`))
                this._server = server
                const address = server.address()
                this._port = typeof address === 'object' && address ? address.port : this._requestedPort
                this._log(`relay listening on ${this.url}`)
                resolve({url: this.url, port: this._port, token: this.token})
            })
            server.on('connection', socket => this._accept(socket))
        })
    }

    async stop(): Promise<void> {
        for (const p of this._pending.values()) {
            clearTimeout(p.timer)
            p.resolve(transportFailure(p.command, 'the relay stopped'))
        }
        this._pending.clear()
        const server = this._server
        this._server = null
        if (!server) return
        for (const c of server.clients) c.terminate()
        await new Promise<void>(r => server.close(() => r()))
    }

    pages(): PageInfo[] {
        return [...this._pages.values()].sort((a, b) => a.connectedAt - b.connectedAt).map(p => p.info)
    }

    /** Resolve when a page (optionally a specific one) is connected. */
    waitForPage(timeoutMs = 30000, pageId?: string): Promise<PageInfo> {
        const found = () => pageId ? this._pages.get(pageId)?.info : this.pages()[0]
        const now = found()
        if (now) return Promise.resolve(now)
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off('pages', check)
                reject(new Error(`no editor page connected to ${this.url} within ${Math.round(timeoutMs / 1000)} s`))
            }, timeoutMs)
            const check = () => {
                const p = found()
                if (!p) return
                clearTimeout(timer)
                this.off('pages', check)
                resolve(p)
            }
            this.on('pages', check)
        })
    }

    /**
     * Run one command on a page. Never rejects: a call that cannot be delivered, or that the page drops,
     * comes back as a failed `CommandResult` saying why.
     */
    call(command: Command, options: {pageId?: string, agent?: string} = {}): Promise<CommandResult> {
        const pick = this._pick(options.pageId)
        if ('error' in pick) return Promise.resolve(transportFailure(command, pick.error, pick.hint))
        const page = pick.page
        const id = this._nextId++
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this._pending.delete(id)
                resolve(transportFailure(command, `the page did not answer within ${Math.round(this._timeout / 1000)} s`,
                    'it may still be running the command; check `history` before repeating it'))
            }, this._timeout)
            this._pending.set(id, {page, resolve, command, timer})
            page.socket.send(JSON.stringify({type: 'call', id, command, agent: options.agent}))
        })
    }

    private _pick(pageId?: string): {page: PageConnection} | {error: string, hint?: string} {
        const pages = [...this._pages.values()]
        if (pageId) {
            const page = this._pages.get(pageId)
            return page ? {page} : {error: `no page "${pageId}" is connected`, hint: `connected: ${pages.map(p => p.info.pageId).join(', ') || 'none'}`}
        }
        if (!pages.length) {
            return {error: 'no editor is connected to the relay',
                hint: `open the editor with ?${this.pageQuery}, or use a headless session`}
        }
        if (pages.length > 1) {
            return {error: `${pages.length} pages are connected - say which with pageId`,
                hint: pages.map(p => `${p.info.pageId} (${p.info.title || p.info.url})`).join(', ')}
        }
        return {page: pages[0]}
    }

    private _checkToken(token: unknown): boolean {
        if (typeof token !== 'string') return false
        const a = Buffer.from(token)
        const b = Buffer.from(this.token)
        return a.length === b.length && timingSafeEqual(a, b)
    }

    private _accept(socket: WebSocket): void {
        let role: 'page' | 'agent' | null = null
        let pageId: string | null = null
        const helloTimer = setTimeout(() => socket.close(AgentCloseCode.Unauthorized, 'no hello'), 5000)

        socket.on('message', raw => {
            let msg: AgentMessage
            try {
                msg = JSON.parse(String(raw))
            } catch {
                return
            }
            if (!role) {
                if (msg.type !== 'hello') return socket.close(AgentCloseCode.Unauthorized, 'expected hello')
                clearTimeout(helloTimer)
                if (!this._checkToken(msg.token)) {
                    this._log('refused a connection with a wrong token')
                    return socket.close(AgentCloseCode.Unauthorized, 'wrong token')
                }
                if (msg.version !== AGENT_PROTOCOL_VERSION) {
                    return socket.close(AgentCloseCode.Version, `protocol ${msg.version}; this relay speaks ${AGENT_PROTOCOL_VERSION}`)
                }
                role = msg.role
                if (msg.role === 'page') {
                    pageId = msg.page.pageId
                    const old = this._pages.get(pageId)
                    if (old) {
                        this._failPending(old, 'the page reconnected')
                        old.socket.close(AgentCloseCode.Replaced, 'replaced by a newer connection from the same page')
                    }
                    this._pages.set(pageId, {info: msg.page, socket, connectedAt: Date.now()})
                    this._log(`page connected: ${pageId} ${msg.page.title} ${msg.page.url}`)
                    socket.send(JSON.stringify({type: 'status', agents: [...this._agents.values(), ...this._inProcessAgents]}))
                    this._pagesChanged()
                } else {
                    this._agents.set(socket, msg.name ?? 'agent')
                    this._log(`agent connected: ${msg.name ?? 'agent'}`)
                    socket.send(JSON.stringify({type: 'pages', pages: this.pages()}))
                    this._agentsChanged()
                }
                return
            }
            if (role === 'page' && msg.type === 'result') {
                const id = Number(msg.id)
                const pending = this._pending.get(id)
                if (!pending) return
                this._pending.delete(id)
                clearTimeout(pending.timer)
                pending.resolve(msg.result)
                return
            }
            if (role === 'agent' && msg.type === 'call') {
                const replyId = msg.id
                void this.call(msg.command, {pageId: msg.pageId, agent: this._agents.get(socket)}).then(result => {
                    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: 'result', id: replyId, result}))
                })
            }
        })

        socket.on('close', () => {
            clearTimeout(helloTimer)
            if (role === 'page' && pageId) {
                const current = this._pages.get(pageId)
                if (current?.socket === socket) {
                    this._pages.delete(pageId)
                    this._failPending(current, 'the page disconnected')
                    this._log(`page disconnected: ${pageId}`)
                    this._pagesChanged()
                }
            } else if (role === 'agent') {
                this._agents.delete(socket)
                this._agentsChanged()
            }
        })
        socket.on('error', () => undefined)
    }

    private _failPending(page: PageConnection, why: string): void {
        for (const [id, p] of this._pending) {
            if (p.page !== page) continue
            clearTimeout(p.timer)
            this._pending.delete(id)
            p.resolve(transportFailure(p.command, `${why} before answering`,
                'the command may or may not have run; check `history` before repeating it'))
        }
    }

    private _pagesChanged(): void {
        const msg = JSON.stringify({type: 'pages', pages: this.pages()})
        for (const s of this._agents.keys()) if (s.readyState === WebSocket.OPEN) s.send(msg)
        this.emit('pages', this.pages())
    }

    private _agentsChanged(): void {
        const msg = JSON.stringify({type: 'status', agents: [...this._agents.values(), ...this._inProcessAgents]})
        for (const p of this._pages.values()) if (p.socket.readyState === WebSocket.OPEN) p.socket.send(msg)
    }

    private _inProcessAgents: string[] = []

    /** Name an in-process agent (the MCP server), so pages show it as connected. */
    setInProcessAgents(names: string[]): void {
        this._inProcessAgents = names
        this._agentsChanged()
    }
}
