/**
 * The MCP server against a headless Node session, through the SDK's own client over an in-memory
 * transport - the same requests Claude Code sends over stdio.
 */

import '@threepipe/modelling-cli'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {CallToolRequestSchema, ListToolsRequestSchema, ToolListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js'
import {ModellingMcp} from '../src/ModellingMcp'
import {createMcpServer, SERVER_INSTRUCTIONS} from '../src/createServer'

let mcp: ModellingMcp
let client: Client
let listChanged = 0

const call = async(name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({name, arguments: args}) as {content: any[], isError?: boolean}
    return {json: JSON.parse(r.content[0].text), content: r.content, isError: !!r.isError}
}

beforeAll(async() => {
    mcp = new ModellingMcp({port: 0, headless: 'node'})
    await mcp.start()
    const server = createMcpServer(mcp, {Server, CallToolRequestSchema, ListToolsRequestSchema})
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    client = new Client({name: 'test', version: '1.0.0'})
    client.setNotificationHandler(ToolListChangedNotificationSchema, async() => {
        listChanged++
    })
    await client.connect(b)
})

afterAll(async() => {
    await client?.close()
    await mcp?.close()
})

describe('threepipe-modelling MCP server', () => {
    it('lists ten tools, generated from the registry', async() => {
        const {tools} = await client.listTools()
        expect(tools.map(t => t.name)).toEqual(['run', 'batch', 'look', 'measure', 'validate', 'diff', 'inspect', 'export', 'help', 'enableToolGroup'])
        const run = tools.find(t => t.name === 'run')!
        const ops = (run.inputSchema.properties as any).command.oneOf.map((s: any) => s.properties.op.const)
        expect(ops).toEqual(expect.arrayContaining(['primitive', 'extrude', 'inset', 'bevel', 'undo', 'checkpoint']))
        expect(ops).not.toContain('subdivide') // `loop` group, not enabled by default
        expect(ops).not.toContain('look') // its own tool
        // a command's schema is the registry's, verbatim
        const inset = (run.inputSchema.properties as any).command.oneOf.find((s: any) => s.title === 'inset')
        expect(inset.properties.thickness.type).toBe('number')
        expect(tools.find(t => t.name === 'validate')!.inputSchema.properties).toHaveProperty('spec')
        expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS)
    })

    it('runs commands on the headless session and returns results with locality', async() => {
        const made = await call('run', {command: {op: 'primitive', type: 'cube', name: 'box', size: 2}})
        expect(made.isError).toBe(false)
        expect(made.json).toMatchObject({ok: true, op: 'primitive', objects: ['box'], changed: true})
        const b = await call('batch', {commands: [{op: 'checkpoint', name: 'a'}, {op: 'inset', object: 'box', faces: [0], thickness: 0.2}]})
        expect(b.json).toMatchObject({ok: true, ran: 2, failed: 0})
        expect(b.json.results[1].locality.local).toBe(true)
        const d = await call('diff', {object: 'box', from: 'a', claim: {faces: [0]}})
        expect(d.json.data.local).toBe(true)
        const v = await call('validate', {object: 'box', spec: {manifold: {closed: true}}})
        expect(v.json.data.conforms).toBe(true)
        const i = await call('inspect', {object: 'box'})
        expect(i.json.data.faces).toBe(10)
    })

    it('fails with isError and the registry\'s hint', async() => {
        const r = await call('run', {command: {op: 'inset', object: 'box', thicknes: 0.1}})
        expect(r.isError).toBe(true)
        expect(r.json.error).toContain('did you mean "thickness"')
        const unknown = await call('run', {command: {op: 'bevl'}})
        expect(unknown.json.error).toContain('did you mean "bevel"')
    })

    it('discloses groups progressively and announces the new tool list', async() => {
        const before = await call('run', {command: {op: 'subdivide', object: 'box'}})
        expect(before.isError).toBe(true)
        expect(before.json.error).toContain('enableToolGroup')
        const on = await call('enableToolGroup', {group: 'loop'})
        expect(on.json).toMatchObject({ok: true, group: 'loop', ops: ['subdivide']})
        await expect.poll(() => listChanged).toBe(1)
        const {tools} = await client.listTools()
        const ops = (tools.find(t => t.name === 'run')!.inputSchema.properties as any).command.oneOf.map((s: any) => s.properties.op.const)
        expect(ops).toContain('subdivide')
        expect((await call('run', {command: {op: 'subdivide', object: 'box', cuts: 1}})).isError).toBe(false)
    })

    it('says where commands run and how to connect an editor', async() => {
        const h = await call('help')
        expect(h.json.target).toEqual({kind: 'headless', mode: 'node', started: true})
        expect(h.json.connect).toContain('agentToken=')
        expect(h.json.groups.loop.enabled).toBe(true)
        const one = await call('help', {op: 'bevel'})
        expect(one.json.data.inputSchema.type).toBe('object')
    })

    it('refuses look in a Node session with a pointer to a browser', async() => {
        const r = await call('look')
        expect(r.isError).toBe(true)
        expect(r.json.error).toContain('cannot render')
    })
})
