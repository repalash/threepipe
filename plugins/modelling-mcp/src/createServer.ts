/**
 * Wire {@link ModellingMcp} to an MCP `Server`.
 *
 * The low-level `Server` rather than `McpServer.registerTool`: the tool schemas are JSON Schema generated
 * from the command registry, and `registerTool` wants zod - a second copy of every schema, which is the
 * drift the registry exists to prevent. The SDK keeps `Server` for exactly this kind of advanced use.
 */

import type {Server} from '@modelcontextprotocol/sdk/server/index.js'
import type {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {ModellingMcp} from './ModellingMcp'

export const SERVER_INSTRUCTIONS = [
    'threepipe modelling: an editable n-gon mesh document, driven by JSON commands.',
    'Work in this order: build with run/batch -> measure -> validate -> look -> export.',
    'Every mutating command is one undo step; its result has `locality` - if `local` is false, something outside what you named changed: inspect or undo.',
    'Indices (verts/edges/faces) change after topology edits: `inspect {object, detail: true}` again before reusing them.',
    '`run` offers some command groups; `help` lists all of them and `enableToolGroup` adds a group.',
    'When an editor is connected (help shows target), commands run there and appear in its undo history.',
].join('\n')

export function createMcpServer(
    mcp: ModellingMcp,
    sdk: {Server: typeof Server, CallToolRequestSchema: typeof CallToolRequestSchema, ListToolsRequestSchema: typeof ListToolsRequestSchema},
): Server {
    const server = new sdk.Server(
        {name: 'threepipe-modelling', version: '0.1.0'},
        {capabilities: {tools: {listChanged: true}}, instructions: SERVER_INSTRUCTIONS},
    )
    server.setRequestHandler(sdk.ListToolsRequestSchema, async() => ({tools: mcp.listTools() as never}))
    server.setRequestHandler(sdk.CallToolRequestSchema, async request => {
        const {name, arguments: args} = request.params
        return await mcp.callTool(name, (args ?? {}) as Record<string, unknown>) as never
    })
    // Only after the client has initialised: sending before `connect` throws, and an unawaited throw
    // would end the process (the blueprint bridge's --test crash).
    mcp.onToolsChanged = () => {
        server.sendToolListChanged().catch(() => undefined)
    }
    return server
}
