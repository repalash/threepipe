/**
 * `threepipe-modelling` - the modelling command API from a shell. Every verb prints exactly one JSON object
 * on stdout (`relay` prints one and then keeps serving); diagnostics go to stderr; failures are
 * `{ok: false, error, hint}` with a non-zero exit code.
 *
 * State lives in a file: `--doc model.glb` is loaded before a verb and written back after one that changed
 * it, with editable topology kept in `THREEPIPE_mesh_topology`, so a sequence of calls is a sequence of
 * edits. Commands run in a Node session (fast, no pixels); `look` starts a headless browser; `--connect`
 * drives a live editor through the agent socket instead.
 */

import '../node/polyfill'
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises'
import {basename, extname, isAbsolute, join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Command, CommandResult, parseCommands} from '@threepipe/plugin-modelling'
import {ThreeViewer} from 'threepipe'
import {routeViewerLogsToStderr} from './stdio'
import {parseArgs, ParsedArgs} from './args'
import {failure, nearest} from './hints'
import {ModellingSession} from '../session/types'

export interface CliIO {
    stdout(text: string): void
    stderr(text: string): void
    readStdin(): Promise<string>
    cwd: string
    /** Resolves when the process should stop a long-running verb (`relay`). */
    untilSignal?: () => Promise<void>
}

export const VERBS: Record<string, string> = {
    run: 'run <cmd.json | transcript.json | - | \'{"op": ...}\'> - run commands in order; prints {ok, ran, failed, results}',
    session: 'session <build.mjs> - run a build script ({run, runAll, look, inspect, log}); writes transcript.json and looks to --out-dir',
    look: 'look [params] - render (angles sheet by default) to --out (look.jpg) and describe it; needs --doc or --connect',
    measure: 'measure [params] - bounds, overlaps, or --mode topology',
    validate: 'validate [params] - Blender\'s BM_mesh_is_valid and a spec (--spec {...}); PASS / FAIL / UNVERIFIED',
    diff: 'diff --object <name> [--from <checkpoint|start|previous>] [--claim {...}] - claimed vs collateral changes',
    inspect: 'inspect [--object <name>] [--detail true] - counts, bounds, vertices, edges, faces',
    export: 'export --out <file.glb> - write the document',
    import: 'import <file.glb|gltf|obj|stl> - add a model to the document as editable objects',
    help: 'help [op] - the commands, or one command\'s parameters',
    relay: 'relay [--port 9396] [--host 127.0.0.1] [--token t] - serve the agent socket for live editors; prints its url and token',
}

const OP_VERBS = new Set(['look', 'measure', 'validate', 'diff', 'inspect', 'export'])

export async function runCli(argv: string[], io: CliIO): Promise<number> {
    routeViewerLogsToStderr(ThreeViewer)
    const args = parseArgs(argv)
    const pretty = args.flags.has('pretty')
    const print = (obj: unknown) => io.stdout(JSON.stringify(obj, null, pretty ? 2 : undefined) + '\n')
    const log = (msg: string) => io.stderr(msg + '\n')

    if (!args.verb || args.verb === '--help' || args.flags.has('help') && !args.verb) {
        print({ok: true, usage: 'threepipe-modelling <verb> [args] [--doc model.glb] [--connect [ws://...]]', verbs: VERBS})
        return 0
    }
    if (!(args.verb in VERBS)) {
        const near = nearest(args.verb, Object.keys(VERBS))
        print({ok: false, error: `unknown verb "${args.verb}"`, hint: near ? `did you mean "${near}"?` : 'run `threepipe-modelling help`'})
        return 1
    }

    if (args.verb === 'relay') return relayVerb(args, io, print, log)

    let session: ModellingSession | null = null
    try {
        const needsPixels = args.verb === 'look'
        session = await openSession(args, needsPixels, io, log)
        const output = await runVerb(args, session, io, log)
        print(output)
        return (output as {ok?: boolean}).ok === false ? 1 : 0
    } catch (e) {
        print(failure((e as Error).message))
        return 1
    } finally {
        await session?.close().catch(() => undefined)
    }
}

// region sessions

function docPath(args: ParsedArgs, io: CliIO): string | null {
    const doc = args.flags.get('doc')
    if (typeof doc !== 'string') return null
    return isAbsolute(doc) ? doc : resolve(io.cwd, doc)
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

async function openSession(args: ParsedArgs, needsPixels: boolean, io: CliIO, log: (m: string) => void): Promise<ModellingSession> {
    const connect = args.flags.get('connect')
    const doc = docPath(args, io)
    if (connect !== undefined && doc) throw new Error('--doc and --connect do not mix: a live editor holds its own document')
    const documentId = (args.flags.get('document-id') as string | undefined)
        ?? (doc ? basename(doc, extname(doc)) : 'cli')
    let session: ModellingSession
    if (connect !== undefined) {
        const {EditorSession} = await import('../session/EditorSession')
        session = await EditorSession.connect({
            url: typeof connect === 'string' ? connect : undefined,
            token: args.flags.get('token') as string | undefined,
            pageId: args.flags.get('page') as string | undefined,
        })
    } else if (needsPixels || args.flags.has('browser')) {
        const {BrowserSession} = await import('../browser/BrowserSession')
        session = await BrowserSession.start({
            documentId, log,
            width: Number(args.flags.get('width') ?? 1000), height: Number(args.flags.get('height') ?? 700),
            wsEndpoint: args.flags.get('ws') as string | undefined, headed: args.flags.has('headed'),
        })
    } else {
        const {NodeModellingSession} = await import('../node/NodeModellingSession')
        session = new NodeModellingSession({documentId})
    }
    if (doc && await exists(doc)) {
        const data = (await readFile(doc)).toString('base64')
        const loaded = await session.run({op: 'import', data, format: extname(doc).slice(1).toLowerCase() || 'glb'})
        if (!loaded.ok) {
            await session.close()
            throw new Error(`could not load ${doc}: ${loaded.error}`)
        }
    }
    return session
}

/** Write the document back when a verb changed it. */
async function saveIfChanged(args: ParsedArgs, session: ModellingSession, results: CommandResult[], io: CliIO): Promise<string | null> {
    const doc = docPath(args, io)
    const out = args.flags.get('out')
    if (!doc || args.flags.has('no-save')) return null
    if (!results.some(r => r.ok && (r.changed ?? !!r.locality))) return null
    const target = typeof out === 'string' && args.verb === 'run' ? resolve(io.cwd, out) : doc
    const r = await session.run({op: 'export', path: target})
    if (!r.ok) throw new Error(`could not save ${target}: ${r.error}`)
    return target
}

// endregion

async function readCommandsArg(arg: string | undefined, io: CliIO): Promise<Command[]> {
    if (arg === undefined) throw new Error('`run` needs commands: a file, `-` for stdin, or inline JSON')
    const text = arg === '-' ? await io.readStdin()
        : /^\s*[[{]/.test(arg) ? arg
            : await readFile(isAbsolute(arg) ? arg : resolve(io.cwd, arg), 'utf8')
    return parseCommands(text)
}

function jsonArg(arg: string | undefined): Record<string, unknown> {
    if (arg === undefined) return {}
    if (!/^\s*\{/.test(arg)) throw new Error(`expected parameters as JSON ({...}), got "${arg}"`)
    return JSON.parse(arg)
}

async function runVerb(args: ParsedArgs, session: ModellingSession, io: CliIO, log: (m: string) => void): Promise<unknown> {
    const verb = args.verb!

    if (verb === 'run') {
        const commands = await readCommandsArg(args.positional[0], io)
        const results: CommandResult[] = []
        for (const c of commands) {
            const r = await session.run(c)
            results.push(r)
            if (!r.ok && !args.flags.has('continue-on-error')) break
        }
        const failed = results.filter(r => !r.ok)
        const saved = await saveIfChanged(args, session, results, io)
        const out: Record<string, unknown> = {ok: !failed.length, ran: results.length, of: commands.length, failed: failed.length, results, saved}
        if (failed.length) Object.assign(out, failure(failed[0].error ?? 'a command failed', {}), {ok: false, results, ran: results.length, saved})
        return out
    }

    if (verb === 'help') {
        const op = args.positional[0]
        const r = await session.run(op ? {op: 'help', command: op} : {op: 'help'})
        if (!r.ok) return failure(r.error ?? 'help failed')
        return op ? {ok: true, ...r.data as object} : {ok: true, verbs: VERBS, commands: r.data}
    }

    if (verb === 'import') {
        const file = args.positional[0]
        if (!file) throw new Error('`import` needs a file')
        const path = isAbsolute(file) ? file : resolve(io.cwd, file)
        const data = (await readFile(path)).toString('base64')
        const r = await session.run({op: 'import', data, format: extname(path).slice(1).toLowerCase() || 'glb', ...args.params} as Command)
        if (!r.ok) return failure(r.error ?? 'import failed', {result: r})
        const saved = await saveIfChanged(args, session, [r], io)
        return {...r, saved}
    }

    if (verb === 'session') {
        return sessionVerb(args, session, io, log)
    }

    if (OP_VERBS.has(verb)) {
        const command: Command = {op: verb, ...jsonArg(args.positional[0]), ...args.params}
        const out = args.flags.get('out')
        if (verb === 'look') {
            command.path = typeof out === 'string' ? resolve(io.cwd, out) : resolve(io.cwd, `look.${command.format === 'png' ? 'png' : 'jpg'}`)
        }
        if (verb === 'export') {
            if (typeof out !== 'string') throw new Error('`export` needs --out <file.glb>')
            command.path = resolve(io.cwd, out)
        }
        const r = await session.run(command)
        if (!r.ok) return failure(r.error ?? `${verb} failed`, {result: r})
        return r
    }

    throw new Error(`verb "${verb}" is not implemented`)
}

// region session (build scripts)

async function sessionVerb(args: ParsedArgs, session: ModellingSession, io: CliIO, log: (m: string) => void): Promise<unknown> {
    const script = args.positional[0]
    if (!script) throw new Error('`session` needs a build script (.mjs default-exporting an async function)')
    const outDir = resolve(io.cwd, (args.flags.get('out-dir') as string | undefined) ?? 'modelling-session')
    await mkdir(outDir, {recursive: true})
    const modulePath = isAbsolute(script) ? script : resolve(io.cwd, script)
    const build = (await import(pathToFileURL(modulePath).href)).default
    if (typeof build !== 'function') throw new Error(`${script} must default-export an async function taking the session`)

    const transcript: {command: Command, result: CommandResult, wallMs: number, image?: string}[] = []
    let lookIndex = 0
    const run = async(command: Command) => {
        const started = Date.now()
        const result = await session.run(command)
        transcript.push({command, result: stripLarge(result), wallMs: Date.now() - started})
        if (!result.ok) log(`  x ${command.op}: ${result.error}`)
        return result
    }
    const runAll = async(commands: Command[], {continueOnError = false} = {}) => {
        const out: CommandResult[] = []
        for (const c of commands) {
            const r = await run(c)
            out.push(r)
            if (!r.ok && !continueOnError) break
        }
        return out
    }
    const look = async(label: string, params: Record<string, unknown> = {}) => {
        const name = `${String(++lookIndex).padStart(3, '0')}-${slug(label)}.${params.format === 'png' ? 'png' : 'jpg'}`
        const r = await run({op: 'look', ...params, path: join(outDir, name)})
        if (r.ok) transcript[transcript.length - 1].image = name
        return r
    }
    const inspect = async(object?: string, detail = false) => {
        const r = await run({op: 'inspect', ...(object ? {object} : {}), ...(detail ? {detail} : {})})
        return r.ok ? r.data : null
    }
    let thrown: string | null = null
    // the build's own wall time, for the benchmark's run metrics (demos/benchmark/metrics/run.mjs)
    const buildStarted = Date.now()
    try {
        await build({run, runAll, look, capture: look, inspect, log: (...parts: unknown[]) => log(parts.join(' ')), outDir})
    } catch (e) {
        thrown = (e as Error).message
    }
    const failed = transcript.filter(t => !t.result.ok)
    const transcriptPath = join(outDir, 'transcript.json')
    await writeFile(transcriptPath, JSON.stringify({
        summary: {build: script, session: session.kind, commands: transcript.length, failed: failed.length, looks: lookIndex,
            wallMs: Date.now() - buildStarted, startedAt: new Date(buildStarted).toISOString()},
        operations: transcript,
    }, null, 2))
    const saved = await saveIfChanged(args, session, transcript.map(t => t.result), io)
    const out = {ok: !failed.length && !thrown, commands: transcript.length, failed: failed.length,
        looks: transcript.filter(t => t.image).map(t => join(outDir, t.image!)), transcript: transcriptPath, saved,
        firstFailure: failed[0] ? {op: failed[0].command.op, error: failed[0].result.error} : undefined}
    if (thrown) return {...failure(`the build script threw: ${thrown}`), ...out, ok: false}
    return out
}

/** Keep a transcript readable: no data URLs or base64 files in it. */
function stripLarge(r: CommandResult): CommandResult {
    const data = r.data as Record<string, unknown> | undefined
    if (!data || typeof data !== 'object' || Array.isArray(data)) return r
    if (!('image' in data) && !('dataUrl' in data) && !('base64' in data)) return r
    const copy = {...data}
    delete copy.image
    delete copy.dataUrl
    delete copy.base64
    return {...r, data: copy}
}

function slug(s: string): string {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'look'
}

// endregion

// region relay

async function relayVerb(args: ParsedArgs, io: CliIO, print: (o: unknown) => void, log: (m: string) => void): Promise<number> {
    const {AgentRelay} = await import('../relay/AgentRelay')
    const relay = new AgentRelay({
        port: args.flags.has('port') ? Number(args.flags.get('port')) : 9396,
        host: args.flags.get('host') as string | undefined,
        token: (args.flags.get('token') as string | undefined) ?? process.env.THREEPIPE_AGENT_TOKEN,
        log,
    })
    try {
        await relay.start()
    } catch (e) {
        print(failure(`could not start the relay: ${(e as Error).message}`,
            {hint: (e as {code?: string}).code === 'EADDRINUSE' ? 'the port is taken - another relay may already be running; pass --port' : null}))
        return 1
    }
    print({
        ok: true, url: relay.url, token: relay.token, pageQuery: relay.pageQuery,
        connect: `open the editor with ?${relay.pageQuery}`,
        env: {THREEPIPE_AGENT_URL: relay.url, THREEPIPE_AGENT_TOKEN: relay.token},
    })
    relay.on('pages', pages => log(`pages: ${JSON.stringify(pages.map((p: {pageId: string, title: string}) => `${p.pageId} ${p.title}`))}`))
    await (io.untilSignal?.() ?? new Promise(() => undefined))
    await relay.stop()
    return 0
}

// endregion
