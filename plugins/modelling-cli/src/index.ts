/**
 * `@threepipe/modelling-cli` - threepipe's modelling command API outside a page.
 *
 * - {@link NodeSession}: a viewer and `ModellingPlugin` in Node, no browser (every command but the ones
 *   that draw).
 * - {@link BrowserSession}: a headless page for `look` and `capture`, driven over the agent socket.
 * - {@link AgentRelay} / {@link RelayClient} / {@link EditorSession}: the agent socket, to drive a live
 *   editor.
 * - {@link runCli}: the `threepipe-modelling` executable.
 *
 * Import this package before anything that imports `threepipe` in Node: the session installs the DOM
 * stubs threepipe needs (`src/node/polyfill.ts`).
 */

import './node/polyfill'
export * from './node/NodeSession'
export * from './node/NodeModellingSession'
export * from './browser/BrowserSession'
export * from './relay/AgentRelay'
export * from './relay/RelayClient'
export * from './session/types'
export * from './session/files'
export * from './session/EditorSession'
export * from './cli/main'
export {failure} from './cli/hints'
