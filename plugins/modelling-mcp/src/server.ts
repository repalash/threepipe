/**
 * `threepipe-modelling-mcp` - the modelling command API as an MCP server (stdio).
 *
 *     claude mcp add threepipe-modelling -- npx -y @threepipe/modelling-mcp
 *
 * Flags: `--port 9396` (agent socket for live editors), `--host`, `--token`, `--headless browser|node`,
 * `--groups create,edit,shape,session`, `--editor-url <url>` (for the connect hint). Diagnostics on stderr.
 */

import {quietViewerConsole} from '@threepipe/modelling-cli'
import {ThreeViewer} from 'threepipe'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {ModellingMcp} from './ModellingMcp'
import {createMcpServer} from './createServer'

// stdout is the protocol: nothing else may write to it.
quietViewerConsole(ThreeViewer as never)

const argv = process.argv.slice(2)
const flag = (name: string) => {
    const i = argv.indexOf('--' + name)
    return i >= 0 ? argv[i + 1] : undefined
}
const log = (m: string) => process.stderr.write(`[threepipe-modelling-mcp] ${m}\n`)

const mcp = new ModellingMcp({
    port: flag('port') ? Number(flag('port')) : undefined,
    host: flag('host'),
    token: flag('token') ?? process.env.THREEPIPE_AGENT_TOKEN,
    headless: (flag('headless') as 'browser' | 'node' | undefined) ?? 'browser',
    groups: flag('groups')?.split(','),
    editorUrl: flag('editor-url'),
    log,
})
await mcp.start()
const server = createMcpServer(mcp, {Server, CallToolRequestSchema, ListToolsRequestSchema})
await server.connect(new StdioServerTransport())

const shutdown = async() => {
    await mcp.close().catch(() => undefined)
    process.exit(0)
}
process.stdin.on('close', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
