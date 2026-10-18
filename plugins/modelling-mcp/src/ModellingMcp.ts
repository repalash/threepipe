/**
 * The MCP server's logic, apart from its transport: which session a call goes to, the tool list, and
 * turning `CommandResult`s into MCP tool results.
 *
 * Calls go to a live editor when one is connected to the embedded relay (the agent socket - every step
 * lands in that editor's undo history), and otherwise to a headless session started on first use: a
 * headless browser page by default, so `look` works; a Node session (`headless: 'node'`) when there is
 * no Chromium, which does everything but draw.
 */

import {
    AgentRelay,
    BrowserSession,
    ModellingSession,
    NodeModellingSession,
    NodeSession,
    runWithFiles,
} from '@threepipe/modelling-cli'
import type {Command, CommandResult} from '@threepipe/plugin-modelling'
import {buildTools, CommandInfo, DEDICATED, DEFAULT_GROUPS, groupsOf, runnable, ToolDef} from './tools'

export interface ModellingMcpOptions {
    /** Relay port for live editors. Default 9396; falls back to a free port when taken. */
    port?: number
    host?: string
    token?: string
    /** `browser` (default) or `node`. */
    headless?: 'browser' | 'node'
    /** Groups `run` offers at start. */
    groups?: string[]
    /** The editor's URL, for the connect hint. */
    editorUrl?: string
    /** Name pages show for this agent. */
    agentName?: string
    log?: (message: string) => void
}

export interface ToolResult {
    content: ({type: 'text', text: string} | {type: 'image', data: string, mimeType: string})[]
    isError?: boolean
    [key: string]: unknown
}

export class ModellingMcp {
    readonly relay: AgentRelay
    readonly commands: CommandInfo[]
    readonly enabled: Set<string>
    private _headless: ModellingSession | null = null
    private _starting: Promise<ModellingSession> | null = null
    private readonly _log: (m: string) => void
    /** Called when the tool list changed (an enabled group). The server sends `tools/list_changed`. */
    onToolsChanged: () => void = () => undefined

    constructor(readonly options: ModellingMcpOptions = {}) {
        this._log = options.log ?? (() => undefined)
        this.relay = new AgentRelay({port: options.port ?? 9396, host: options.host, token: options.token, log: this._log})
        // The table, from a registry - the same one every page builds - read once from a Node session.
        const registry = new NodeSession()
        this.commands = registry.modelling.describeCommands() as CommandInfo[]
        registry.dispose()
        const groups = groupsOf(this.commands)
        this.enabled = new Set((options.groups ?? DEFAULT_GROUPS).filter(g => groups[g]))
    }

    async start(): Promise<void> {
        try {
            await this.relay.start()
        } catch (e) {
            if ((e as {code?: string}).code !== 'EADDRINUSE') throw e
            this._log(`port ${this.options.port ?? 9396} is taken (another relay?) - using a free port instead`)
            ;(this as {relay: AgentRelay}).relay = new AgentRelay({port: 0, host: this.options.host, token: this.relay.token, log: this._log})
            await this.relay.start()
        }
        this.relay.setInProcessAgents([this.options.agentName ?? 'MCP agent'])
        this._log(`agent socket: ${this.relay.url}  token: ${this.relay.token}`)
        this._log(`connect an editor: ${this.connectHint()}`)
    }

    async close(): Promise<void> {
        await this._headless?.close()
        await this.relay.stop()
    }

    connectHint(): string {
        const base = this.options.editorUrl ?? '<editor url>'
        return `${base}${base.includes('?') ? '&' : '?'}${this.relay.pageQuery}  (or File > Connect Agent… with url ${this.relay.url} and token ${this.relay.token})`
    }

    /** Where calls go right now. */
    target(): {kind: 'editor', pageId: string, title: string} | {kind: 'headless', mode: string, started: boolean} {
        const pages = this.relay.pages()
        if (pages.length) return {kind: 'editor', pageId: pages[pages.length - 1].pageId, title: pages[pages.length - 1].title}
        return {kind: 'headless', mode: this.options.headless ?? 'browser', started: !!this._headless}
    }

    private async _headlessSession(): Promise<ModellingSession> {
        if (this._headless) return this._headless
        this._starting ??= (async() => {
            const s = this.options.headless === 'node'
                ? new NodeModellingSession({documentId: 'mcp'})
                : await BrowserSession.start({documentId: 'mcp', log: this._log})
            this._headless = s
            return s
        })()
        return this._starting
    }

    /** Run one command where calls go now. Never throws: failures are failed results. */
    async run(command: Command): Promise<CommandResult> {
        const pages = this.relay.pages()
        try {
            if (pages.length) {
                // The most recently connected editor: an agent that reconnects a tab gets the tab it sees.
                const pageId = pages[pages.length - 1].pageId
                return await runWithFiles(c => this.relay.call(c, {pageId, agent: this.options.agentName ?? 'MCP agent'}), command)
            }
            return await (await this._headlessSession()).run(command)
        } catch (e) {
            return {ok: false, op: command?.op ?? '(none)', index: -1, documentId: '', ms: 0, error: (e as Error).message}
        }
    }

    listTools(): ToolDef[] {
        return buildTools(this.commands, this.enabled)
    }

    private _check(command: unknown): string | null {
        if (!command || typeof command !== 'object' || typeof (command as Command).op !== 'string') {
            return 'a command is an object with an "op"'
        }
        const op = (command as Command).op
        const info = this.commands.find(c => c.name === op)
        if (!info) return null // the registry answers with its own "did you mean"
        if ((DEDICATED as readonly string[]).includes(op)) return null
        if (!runnable(this.commands, this.enabled).includes(info)) {
            return `"${op}" is in the "${info.group}" group, which is not enabled - call enableToolGroup {group: "${info.group}"} first`
        }
        return null
    }

    async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
        if (name === 'run') {
            const problem = this._check(args.command)
            if (problem) return error(problem)
            return toToolResult(await this.run(args.command as Command))
        }
        if (name === 'batch') {
            const commands = args.commands
            if (!Array.isArray(commands) || !commands.length) return error('`commands` must be a non-empty list of commands')
            for (const c of commands) {
                const problem = this._check(c)
                if (problem) return error(problem)
            }
            const results: CommandResult[] = []
            for (const c of commands as Command[]) {
                const r = await this.run(c)
                results.push(stripImage(r))
                if (!r.ok && !args.continueOnError) break
            }
            const failed = results.filter(r => !r.ok)
            return {content: [{type: 'text', text: JSON.stringify({ok: !failed.length, ran: results.length, of: commands.length, failed: failed.length, results})}],
                isError: failed.length > 0}
        }
        if ((DEDICATED as readonly string[]).includes(name)) {
            return toToolResult(await this.run({...args, op: name} as Command))
        }
        if (name === 'help') {
            const groups = groupsOf(this.commands)
            if (typeof args.op === 'string') {
                const r = await this.run({op: 'help', command: args.op})
                return toToolResult(r)
            }
            const list = this.commands.filter(c => !args.group || c.group === args.group)
                .map(c => ({op: c.name, group: c.group, mutates: c.mutates, summary: c.description.split('\n')[0],
                    enabled: (DEDICATED as readonly string[]).includes(c.name) || this.enabled.has(c.group)}))
            return text({
                ok: true,
                target: this.target(),
                connect: this.connectHint(),
                workflow: 'build (run/batch) -> measure -> validate -> look -> export. Indices change after topology '
                    + 'edits: inspect again before reusing them. Every mutating result has `locality`; act on collateral.',
                groups: Object.fromEntries(Object.entries(groups).map(([g, ops]) => [g, {enabled: this.enabled.has(g), ops}])),
                commands: list,
            })
        }
        if (name === 'enableToolGroup') {
            const group = args.group as string
            const groups = groupsOf(this.commands)
            if (!groups[group]) return error(`no group "${group}" - have: ${Object.keys(groups).join(', ')}`)
            if (args.enable === false) this.enabled.delete(group)
            else this.enabled.add(group)
            this.onToolsChanged()
            return text({ok: true, group, enabled: args.enable !== false, ops: groups[group], runGroups: [...this.enabled].sort()})
        }
        return error(`no tool "${name}"`)
    }
}

function text(obj: unknown): ToolResult {
    return {content: [{type: 'text', text: JSON.stringify(obj)}]}
}

function error(message: string): ToolResult {
    return {content: [{type: 'text', text: JSON.stringify({ok: false, error: message})}], isError: true}
}

function stripImage(r: CommandResult): CommandResult {
    const data = r.data as Record<string, unknown> | undefined
    if (!data || typeof data !== 'object' || !('image' in data) && !('dataUrl' in data) && !('base64' in data)) return r
    const copy = {...data}
    delete copy.image
    delete copy.dataUrl
    delete copy.base64
    return {...r, data: copy}
}

/** A result as MCP content: the JSON, plus the picture as an image block when there is one. */
export function toToolResult(r: CommandResult): ToolResult {
    const data = r.data as Record<string, unknown> | undefined
    const image = typeof data?.image === 'string' ? data.image : typeof data?.dataUrl === 'string' ? data.dataUrl : null
    const content: ToolResult['content'] = [{type: 'text', text: JSON.stringify(stripImage(r))}]
    if (image) {
        const comma = image.indexOf(',')
        const mimeType = /^data:([^;]+)/.exec(image)?.[1] ?? 'image/jpeg'
        content.push({type: 'image', data: image.slice(comma + 1), mimeType})
    }
    return {content, isError: !r.ok}
}
