/**
 * `AgentSocketPlugin` - lets an agent outside the page drive this page's modelling document.
 *
 * The page connects out to a relay (`threepipe-modelling relay`, or the MCP server, which embeds one) over a
 * WebSocket, with the relay's token, and runs every command it receives through {@link ModellingPlugin.run}.
 * So an agent's step is a command like any other: validated, undoable, in the editor's history beside the
 * person's own steps, and visible as it happens.
 *
 * Nothing but commands crosses the socket - there is no eval and no other message that acts on the page.
 * The token keeps other local processes and pages out of a relay; the page only ever connects to the URL
 * it was given (a `?agent=ws://…&agentToken=…` query, or {@link connect}).
 *
 * ```js
 * const socket = viewer.addPluginSync(AgentSocketPlugin)
 * socket.connect('ws://127.0.0.1:9396', token)
 * socket.addEventListener('agentCommand', ({command, result}) => console.log(command.op, result.ok))
 * ```
 *
 * In `plugin-modelling` rather than the editor packages because it needs nothing but `ModellingPlugin`:
 * the headless page the CLI and MCP server render with uses it without any editor UI.
 */

import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from 'threepipe'
import type {Command, CommandResult} from '../commands/types'
import type {ModellingPlugin} from '../ModellingPlugin'
import {AGENT_PROTOCOL_VERSION, AgentCloseCode, AgentMessage, CallMessage, PageInfo} from './protocol'

export type AgentSocketStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface AgentActivity {
    command: Command
    result: CommandResult
    /** The agent's name, as it introduced itself to the relay. */
    agent: string | null
    time: number
}

export interface AgentSocketPluginEventMap extends AViewerPluginEventMap {
    /** Status, connected agents or the error changed. */
    statusChanged: {status: AgentSocketStatus}
    /** A command from an agent finished. */
    agentCommand: AgentActivity
}

const PAGE_ID_KEY = 'threepipe-agent-page-id'

export class AgentSocketPlugin extends AViewerPluginSync<AgentSocketPluginEventMap> {
    public static readonly PluginType = 'AgentSocketPlugin'

    enabled = true
    dependencies = []
    toJSON: any = undefined

    /** Connect on add when the page URL carries `?agent=<ws url>&agentToken=<token>`. */
    autoConnect = true

    status: AgentSocketStatus = 'idle'
    /** Why the last connection failed or closed, for the indicator. */
    error: string | null = null
    url: string | null = null
    /** Names of the agents connected to the relay. */
    agents: string[] = []
    /** The most recent agent commands, newest last. */
    readonly activity: AgentActivity[] = []
    activityLimit = 50
    /** A command is running. */
    busy = false

    private _token: string | null = null
    private _socket: WebSocket | null = null
    private _retry: ReturnType<typeof setTimeout> | null = null
    private _retryDelay = 500
    private _wanted = false
    private _pageId: string = stablePageId()

    get pageId(): string {
        return this._pageId
    }

    get lastActivity(): AgentActivity | null {
        return this.activity[this.activity.length - 1] ?? null
    }

    private get _modelling(): ModellingPlugin | undefined {
        return this._viewer?.getPlugin<ModellingPlugin>('ModellingPlugin')
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        if (!this.autoConnect || typeof location === 'undefined' || !location.search) return
        const params = new URLSearchParams(location.search)
        const url = params.get('agent')
        if (url) this.connect(url, params.get('agentToken') ?? '')
    }

    onRemove(viewer: ThreeViewer): void {
        this.disconnect()
        super.onRemove(viewer)
    }

    /** Connect to a relay, and keep reconnecting until {@link disconnect} or the relay refuses the token. */
    connect(url: string, token: string): void {
        this.disconnect()
        this.url = url
        this._token = token
        this._wanted = true
        this._retryDelay = 500
        this._open()
    }

    disconnect(): void {
        this._wanted = false
        if (this._retry) clearTimeout(this._retry)
        this._retry = null
        const socket = this._socket
        this._socket = null
        if (socket && socket.readyState <= 1) socket.close(1000, 'disconnect')
        this.agents = []
        this._setStatus('idle', null)
    }

    private _setStatus(status: AgentSocketStatus, error: string | null): void {
        this.status = status
        this.error = error
        this.dispatchEvent({type: 'statusChanged', status})
    }

    private _open(): void {
        if (!this.url || typeof WebSocket === 'undefined') {
            this._setStatus('error', 'this page has no WebSocket')
            return
        }
        this._setStatus('connecting', this.error)
        let socket: WebSocket
        try {
            socket = new WebSocket(this.url)
        } catch (e) {
            this._setStatus('error', (e as Error).message)
            return
        }
        this._socket = socket
        socket.onopen = () => {
            const modelling = this._modelling
            const page: PageInfo = {
                pageId: this._pageId,
                documentId: modelling?.document?.documentId ?? '',
                title: typeof document !== 'undefined' ? document.title : '',
                url: typeof location !== 'undefined' ? location.href.split('?')[0] : '',
                ops: modelling?.commands.ops ?? [],
            }
            socket.send(JSON.stringify({type: 'hello', role: 'page', token: this._token ?? '', version: AGENT_PROTOCOL_VERSION, page}))
            this._retryDelay = 500
            this._setStatus('connected', null)
        }
        socket.onmessage = e => {
            let msg: AgentMessage
            try {
                msg = JSON.parse(String(e.data))
            } catch {
                return
            }
            if (msg.type === 'call') void this._call(socket, msg)
            else if (msg.type === 'status' && msg.agents) {
                this.agents = msg.agents
                this.dispatchEvent({type: 'statusChanged', status: this.status})
            }
        }
        socket.onclose = e => {
            if (this._socket !== socket) return
            this._socket = null
            this.agents = []
            if (e.code === AgentCloseCode.Unauthorized || e.code === AgentCloseCode.Version || e.code === AgentCloseCode.Replaced) {
                this._wanted = false
                this._setStatus('error', e.reason || `the relay closed the connection (${e.code})`)
                return
            }
            if (!this._wanted) return
            this._setStatus('connecting', `lost the relay at ${this.url}; retrying`)
            this._retry = setTimeout(() => this._open(), this._retryDelay)
            this._retryDelay = Math.min(this._retryDelay * 2, 8000)
        }
        socket.onerror = () => {
            // `onclose` follows with the code; nothing to add here but the message.
            this.error = `cannot reach ${this.url}`
        }
    }

    private async _call(socket: WebSocket, msg: CallMessage): Promise<void> {
        const modelling = this._modelling
        let result: CommandResult
        this.busy = true
        this.dispatchEvent({type: 'statusChanged', status: this.status})
        if (!modelling) {
            result = {ok: false, op: msg.command?.op ?? '(none)', index: -1, documentId: '', ms: 0,
                error: 'this page has no ModellingPlugin'}
        } else {
            result = await modelling.run(msg.command)
        }
        this.busy = false
        const activity: AgentActivity = {command: msg.command, result, agent: msg.agent ?? null, time: Date.now()}
        this.activity.push(activity)
        if (this.activity.length > this.activityLimit) this.activity.shift()
        if (socket.readyState === 1) socket.send(JSON.stringify({type: 'result', id: msg.id, result}))
        this.dispatchEvent({type: 'agentCommand', ...activity})
        this.dispatchEvent({type: 'statusChanged', status: this.status})
    }
}

function stablePageId(): string {
    const fresh = () => 'page-' + Math.random().toString(36).slice(2, 10)
    try {
        const stored = sessionStorage.getItem(PAGE_ID_KEY)
        if (stored) return stored
        const id = fresh()
        sessionStorage.setItem(PAGE_ID_KEY, id)
        return id
    } catch {
        return fresh()
    }
}
