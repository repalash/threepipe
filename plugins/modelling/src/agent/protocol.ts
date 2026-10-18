/**
 * The agent socket protocol: JSON text frames between a page running `ModellingPlugin`, a relay, and the
 * agents that drive the page through the relay.
 *
 * The page connects *out* to the relay - a browser cannot accept connections - with the relay's token,
 * and announces itself; an agent connects to the same relay and sends calls. A call carries exactly one
 * modelling command, and its answer is exactly one `CommandResult`: errors included, so an agent never has
 * to tell a transport failure from a command failure by shape (the blueprint editor's bridge answered
 * both as `{error}` strings). There is no code-execution message.
 *
 * One page is one document. An agent addresses a page by `pageId` when several are connected; with one,
 * it can leave it out.
 */

import type {Command, CommandResult} from '../commands/types'

export const AGENT_PROTOCOL_VERSION = 1

/** WebSocket close codes the relay uses; the page stops reconnecting on these. */
export const AgentCloseCode = {
    /** Wrong or missing token. */
    Unauthorized: 4001,
    /** The protocol version is not one the relay speaks. */
    Version: 4002,
    /** A newer connection with the same page id replaced this one. */
    Replaced: 4003,
} as const

export interface PageInfo {
    /** Stable for the page's lifetime, kept across reconnects (sessionStorage). */
    pageId: string
    /** `ModellingDocument.documentId`. */
    documentId: string
    title: string
    url: string
    /** The command names the page's registry has, so the agent side can check a call before sending it. */
    ops: string[]
}

// page -> relay
export interface PageHello {
    type: 'hello'
    role: 'page'
    token: string
    version: number
    page: PageInfo
}

// agent -> relay
export interface AgentHello {
    type: 'hello'
    role: 'agent'
    token: string
    version: number
    /** Shown in the editor's indicator: "Claude Code", "threepipe-modelling". */
    name?: string
}

// relay -> agent, after its hello and whenever the set of pages changes
export interface RelayPages {
    type: 'pages'
    pages: PageInfo[]
}

// agent -> relay -> page
export interface CallMessage {
    type: 'call'
    id: number | string
    /** Which page, when more than one is connected. */
    pageId?: string
    command: Command
    /** Relay -> page only: who sent it, for the page's indicator. */
    agent?: string
}

// page -> relay -> agent
export interface ResultMessage {
    type: 'result'
    id: number | string
    result: CommandResult
}

/** Either side, for anything that is not a reply to a call. */
export interface StatusMessage {
    type: 'status'
    /** relay -> page: how many agents are connected, and their names. */
    agents?: string[]
}

export type AgentMessage = PageHello | AgentHello | RelayPages | CallMessage | ResultMessage | StatusMessage

/** A failed `CommandResult` for a call that never reached a page, in the same shape as any other failure. */
export function transportFailure(command: Command | undefined, error: string, hint?: string): CommandResult {
    return {
        ok: false,
        op: typeof command?.op === 'string' ? command.op : '(none)',
        index: -1,
        documentId: '',
        error: hint ? `${error} - ${hint}` : error,
        ms: 0,
    }
}
