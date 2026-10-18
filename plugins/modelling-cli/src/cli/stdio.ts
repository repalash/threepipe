/**
 * Keep stdout for the one JSON object a verb prints (and, in the MCP server, for the protocol): anything
 * the libraries log - threepipe announces every viewer it creates with `console.log` - goes to stderr.
 *
 * Imported first by the executables, so it is in place before any module that logs at load time.
 */

import {format} from 'node:util'

for (const level of ['log', 'info', 'debug'] as const) {
    console[level] = (...args: unknown[]) => {
        process.stderr.write(format(...args) + '\n')
    }
}

/**
 * threepipe's own logger, `ThreeViewer.Console`, binds `console.log` when it loads - before the lines
 * above run - so it is pointed at stderr through its own hook as well.
 */
export function routeViewerLogsToStderr(viewerClass: {Console: {log: (...a: unknown[]) => void}}): void {
    viewerClass.Console.log = (...args: unknown[]) => {
        process.stderr.write(format(...args) + '\n')
    }
}
