/**
 * Keep stdout for the one JSON object a verb prints (and, in the MCP server, for the protocol): anything
 * the libraries log - threepipe announces every viewer it creates with `console.log` - goes to stderr.
 *
 * Imported first by the executables, so it is in place before any module that logs at load time.
 */

import {format} from 'node:util'

const toStderr = (...args: unknown[]) => {
    process.stderr.write(format(...args) + '\n')
}

for (const level of ['log', 'info', 'debug'] as const) console[level] = toStderr

/**
 * threepipe binds `console.log` into `ThreeViewer.Console` when it loads - before this module's body can
 * run in a bundle that hoists its imports - so point that at stderr too. `ThreeViewer.Console` is the
 * documented place to redirect the viewer's logging.
 */
export function quietViewerConsole(viewer: {Console: {log: unknown, warn: unknown, error: unknown}}): void {
    viewer.Console = {log: toStderr, warn: toStderr, error: toStderr}
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
