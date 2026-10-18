/**
 * An agent's end of the agent socket: connect to a relay, send commands, get `CommandResult`s back.
 *
 * What `threepipe-modelling --connect` uses to drive a live editor through a running relay.
 */

import {WebSocket} from 'ws'
import {AGENT_PROTOCOL_VERSION, AgentMessage, Command, CommandResult, PageInfo, transportFailure} from '@threepipe/plugin-modelling'

export class RelayClient {
    pages: PageInfo[] = []
    private _socket: WebSocket | null = null
    private _pending = new Map<number, (r: CommandResult) => void>()
    private _nextId = 1
    private _pagesWaiters: (() => void)[] = []

    constructor(readonly url: string, readonly token: string, readonly name = 'threepipe-modelling') {}

    connect(timeoutMs = 10000): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.url)
            const timer = setTimeout(() => {
                socket.terminate()
                reject(new Error(`no relay answered at ${this.url} within ${timeoutMs / 1000} s`))
            }, timeoutMs)
            socket.on('open', () => {
                socket.send(JSON.stringify({type: 'hello', role: 'agent', token: this.token, version: AGENT_PROTOCOL_VERSION, name: this.name}))
            })
            socket.on('message', raw => {
                let msg: AgentMessage
                try {
                    msg = JSON.parse(String(raw))
                } catch {
                    return
                }
                if (msg.type === 'pages') {
                    this.pages = msg.pages
                    if (!this._socket) {
                        clearTimeout(timer)
                        this._socket = socket
                        resolve()
                    }
                    for (const w of this._pagesWaiters.splice(0)) w()
                } else if (msg.type === 'result') {
                    const done = this._pending.get(Number(msg.id))
                    this._pending.delete(Number(msg.id))
                    done?.(msg.result)
                }
            })
            socket.on('close', (code, reason) => {
                clearTimeout(timer)
                for (const [, done] of this._pending) done(transportFailure(undefined, `the relay closed the connection (${code} ${reason})`))
                this._pending.clear()
                if (!this._socket) reject(new Error(`the relay at ${this.url} refused the connection: ${code} ${String(reason) || ''}`.trim()))
                this._socket = null
            })
            socket.on('error', e => {
                if (!this._socket) {
                    clearTimeout(timer)
                    reject(new Error(`cannot reach the relay at ${this.url}: ${e.message}`))
                }
            })
        })
    }

    /** Resolve when at least one page is connected to the relay. */
    async waitForPage(timeoutMs = 30000): Promise<PageInfo> {
        const deadline = Date.now() + timeoutMs
        while (!this.pages.length) {
            if (Date.now() > deadline) throw new Error(`no editor page is connected to ${this.url}`)
            await new Promise<void>(r => {
                this._pagesWaiters.push(r)
                setTimeout(r, 500)
            })
        }
        return this.pages[0]
    }

    run(command: Command, pageId?: string): Promise<CommandResult> {
        const socket = this._socket
        if (!socket) return Promise.resolve(transportFailure(command, 'not connected to a relay'))
        const id = this._nextId++
        return new Promise(resolve => {
            this._pending.set(id, resolve)
            socket.send(JSON.stringify({type: 'call', id, pageId, command}))
        })
    }

    close(): void {
        this._socket?.close(1000)
        this._socket = null
    }
}
