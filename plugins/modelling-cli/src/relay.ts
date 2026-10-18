/**
 * The agent socket on its own: the relay pages connect to and the client agents use. Imports neither
 * threepipe nor the DOM stubs, so a process that only routes commands (the MCP server, a test runner)
 * can load it without a viewer.
 */

export * from './relay/AgentRelay'
export * from './relay/RelayClient'
export {AGENT_PROTOCOL_VERSION, AgentCloseCode, transportFailure} from '@threepipe/plugin-modelling/agent-protocol'
export type {PageInfo, AgentMessage} from '@threepipe/plugin-modelling/agent-protocol'
