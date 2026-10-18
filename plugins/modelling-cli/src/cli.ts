/**
 * The `threepipe-modelling` executable. See `cli/main.ts`.
 */

import {quietViewerConsole} from './cli/stdio'
import './node/polyfill'
import {ThreeViewer} from 'threepipe'
import {runCli} from './cli/main'

quietViewerConsole(ThreeViewer as never)

const code = await runCli(process.argv.slice(2), {
    stdout: t => process.stdout.write(t),
    stderr: t => process.stderr.write(t),
    cwd: process.cwd(),
    readStdin: async() => {
        const chunks: Buffer[] = []
        for await (const c of process.stdin) chunks.push(c as Buffer)
        return Buffer.concat(chunks).toString('utf8')
    },
    untilSignal: () => new Promise(r => {
        process.once('SIGINT', () => r())
        process.once('SIGTERM', () => r())
    }),
})
// Let stdout drain before exiting: the one JSON object is the whole point.
process.stdout.write('', () => process.exit(code))
