/**
 * A live editor, reached through a running relay over the agent socket (`threepipe-modelling --connect`).
 */

import type {Command, CommandResult} from '@threepipe/plugin-modelling'
import {RelayClient} from '../relay/RelayClient'
import {runWithFiles} from './files'
import {ModellingSession} from './types'

export const DEFAULT_RELAY_URL = 'ws://127.0.0.1:9396'

export class EditorSession implements ModellingSession {
    readonly kind = 'editor' as const

    private constructor(private readonly client: RelayClient, readonly pageId: string | undefined) {}

    /**
     * Connect to the relay and wait for a page. `url` and `token` default to `THREEPIPE_AGENT_URL` and
     * `THREEPIPE_AGENT_TOKEN`, which `threepipe-modelling relay` prints.
     */
    static async connect(options: {url?: string, token?: string, pageId?: string, name?: string, waitMs?: number} = {}): Promise<EditorSession> {
        const url = options.url ?? process.env.THREEPIPE_AGENT_URL ?? DEFAULT_RELAY_URL
        const token = options.token ?? process.env.THREEPIPE_AGENT_TOKEN ?? ''
        const client = new RelayClient(url, token, options.name ?? 'threepipe-modelling')
        await client.connect()
        if (!options.pageId) await client.waitForPage(options.waitMs ?? 15000)
        return new EditorSession(client, options.pageId)
    }

    get pages() {
        return this.client.pages
    }

    run(command: Command): Promise<CommandResult> {
        return runWithFiles(c => this.client.run(c, this.pageId), command)
    }

    async close(): Promise<void> {
        this.client.close()
    }
}
