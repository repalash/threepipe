/**
 * The agent socket relay, with stand-in pages speaking the protocol over real WebSockets.
 */

import '../src/node/polyfill'
import {afterEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'
import {AGENT_PROTOCOL_VERSION} from '@threepipe/plugin-modelling'
import {AgentRelay} from '../src/relay/AgentRelay'
import {RelayClient} from '../src/relay/RelayClient'

const relays: AgentRelay[] = []
const sockets: WebSocket[] = []
afterEach(async() => {
    for (const s of sockets.splice(0)) s.terminate()
    for (const r of relays.splice(0)) await r.stop()
})

async function relay(): Promise<AgentRelay> {
    const r = new AgentRelay({port: 0, token: 'secret', callTimeout: 2000})
    await r.start()
    relays.push(r)
    return r
}

/** A page that answers every call with `{ok: true, op, data: {echo: command}}`, unless `silent`. */
function fakePage(r: AgentRelay, pageId: string, token = 'secret', silent = false): Promise<{socket: WebSocket, closed: Promise<number>, calls: any[]}> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(r.url)
        sockets.push(socket)
        const calls: any[] = []
        const closed = new Promise<number>(res => socket.on('close', code => res(code)))
        socket.on('open', () => {
            socket.send(JSON.stringify({type: 'hello', role: 'page', token, version: AGENT_PROTOCOL_VERSION,
                page: {pageId, documentId: `doc-${pageId}`, title: pageId, url: 'http://x/', ops: ['inspect']}}))
            setTimeout(() => resolve({socket, closed, calls}), 100)
        })
        socket.on('message', raw => {
            const msg = JSON.parse(String(raw))
            if (msg.type !== 'call') return
            calls.push(msg)
            if (!silent) socket.send(JSON.stringify({type: 'result', id: msg.id, result: {ok: true, op: msg.command.op, index: 1, documentId: `doc-${pageId}`, ms: 0, data: {page: pageId}}}))
        })
        socket.on('error', reject)
    })
}

describe('AgentRelay', () => {
    it('routes a call to the one page and its result back', async() => {
        const r = await relay()
        const page = await fakePage(r, 'p1')
        const result = await r.call({op: 'inspect'}, {agent: 'test'})
        expect(result).toMatchObject({ok: true, op: 'inspect', data: {page: 'p1'}})
        expect(page.calls[0]).toMatchObject({type: 'call', command: {op: 'inspect'}, agent: 'test'})
    })

    it('refuses a wrong token before anything else', async() => {
        const r = await relay()
        const page = await fakePage(r, 'p1', 'wrong')
        expect(await page.closed).toBe(4001)
        expect(r.pages()).toEqual([])
    })

    it('answers with a failed CommandResult when there is no page, or the page is ambiguous', async() => {
        const r = await relay()
        const none = await r.call({op: 'inspect'})
        expect(none).toMatchObject({ok: false, op: 'inspect'})
        expect(none.error).toContain('no editor is connected')
        await fakePage(r, 'p1')
        await fakePage(r, 'p2')
        const two = await r.call({op: 'inspect'})
        expect(two.error).toContain('2 pages are connected')
        expect(two.error).toContain('p1')
        expect((await r.call({op: 'inspect'}, {pageId: 'p2'})).data).toEqual({page: 'p2'})
    })

    it('fails calls in flight at once when their page drops', async() => {
        const r = await relay()
        const page = await fakePage(r, 'p1', 'secret', true)
        const pending = r.call({op: 'inspect'})
        await new Promise(res => setTimeout(res, 100))
        page.socket.terminate()
        const result = await pending
        expect(result.ok).toBe(false)
        expect(result.error).toContain('the page disconnected before answering')
    })

    it('replaces a page that reconnects with the same id', async() => {
        const r = await relay()
        const first = await fakePage(r, 'p1')
        await fakePage(r, 'p1')
        expect(await first.closed).toBe(4003)
        expect(r.pages().map(p => p.pageId)).toEqual(['p1'])
    })

    it('serves WebSocket agents through RelayClient', async() => {
        const r = await relay()
        await fakePage(r, 'p1')
        const client = new RelayClient(r.url, 'secret', 'cli-test')
        await client.connect()
        expect(client.pages.map(p => p.pageId)).toEqual(['p1'])
        expect(await client.run({op: 'inspect'})).toMatchObject({ok: true, data: {page: 'p1'}})
        client.close()
        const bad = new RelayClient(r.url, 'nope')
        await expect(bad.connect()).rejects.toThrow(/refused the connection: 4001/)
    })
})
