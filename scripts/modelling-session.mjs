/**
 * Run a modelling build script against a real viewer, and keep a transcript of what happened.
 *
 * This is the harness the SU-152 lab report describes: send a command, render, look at the result,
 * send the next one. Commands go through `ModellingPlugin.run` in the page - the same entry point
 * the console in the example page uses - so a build script here and a person typing commands are
 * doing exactly the same thing.
 *
 *     npm run modelling:session -- examples/modelling-api/builds/tank.mjs --out tmp/tank
 *
 * The build script default-exports an async function taking a session:
 *
 *     export default async ({run, runAll, capture, inspect, log}) => {
 *         await run({op: 'primitive', type: 'cube', name: 'hull', width: 2.45})
 *         await capture('hull blocked in', {view: 'front'})
 *     }
 *
 * Output: numbered PNG captures, `transcript.json` with every command and result, and a summary on
 * stdout. The transcript is replayable - it is a list of the same JSON commands.
 */

import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir, writeFile, appendFile, readFile, stat} from 'node:fs/promises'
import {resolve, isAbsolute, join, dirname} from 'node:path'
import {pathToFileURL} from 'node:url'

const args = process.argv.slice(2)
const flags = new Map()
const positional = []
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
        const key = args[i].slice(2)
        const next = args[i + 1]
        if (next === undefined || next.startsWith('--')) flags.set(key, true)
        else (flags.set(key, next), i++)
    } else positional.push(args[i])
}

const watchDir = flags.get('watch')
const buildPath = positional[0]
if (!buildPath && !watchDir) {
    console.error('usage: npm run modelling:session -- <build-script.mjs> [--out dir] [--port 9229]'
        + '\n   or: npm run modelling:session -- --watch <dir>  (live session; append JSON commands'
        + ' to <dir>/commands.jsonl, read <dir>/results.jsonl)'
        + ' [--width 1280] [--height 800] [--headed] [--keep-open] [--no-serve]'
        + ' [--command-timeout 60000] [--keep-ui]')
    process.exit(1)
}

const port = Number(flags.get('port') ?? 9229)
const outDir = resolve(flags.get('out') ?? (watchDir ? watchDir : 'tmp/modelling-session'))
const width = Number(flags.get('width') ?? 1280)
const height = Number(flags.get('height') ?? 800)
const url = flags.get('url')
    ?? `http://127.0.0.1:${port}/examples/modelling-api/index.html`

await mkdir(outDir, {recursive: true})

// --- static server ----------------------------------------------------------------------------

let server = null
async function reachable() {
    try {
        const res = await fetch(url, {method: 'HEAD'})
        return res.ok
    } catch {
        return false
    }
}

if (!flags.get('no-serve') && !await reachable()) {
    console.log(`starting a static server on ${port}`)
    server = spawn('npx', ['ws', '-d', '.', '-p', String(port)], {stdio: 'ignore', detached: false})
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && !await reachable()) await sleep(250)
    if (!await reachable()) {
        console.error(`could not reach ${url} - is the example built? `
            + 'Run: npm run build && npm run build-plugins && npm run build-examples')
        server?.kill()
        process.exit(1)
    }
}

// --- browser ----------------------------------------------------------------------------------

const browser = await chromium.launch({
    headless: !flags.get('headed'),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
})
const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1})
const page = await context.newPage()

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message.slice(0, 300)))
page.on('console', m => {
    if (m.type() === 'error') pageErrors.push(m.text().slice(0, 300))
})

console.log(`opening ${url}`)
await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000})
// The viewer renders continuously, so `networkidle` never settles. Wait for the plugin instead.
await page.waitForFunction(() => !!window.modelling, {timeout: 90000})
// Captures are of the model, not of the tool - unless you are documenting the tool itself.
if (!flags.get('keep-ui')) {
    await page.evaluate(() => {
        for (const sel of ['#console', '#side', '#tweakpaneUiContainer', '.code-preview',
            '#example-code-preview', '#example-code-btn']) {
            document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
        }
        // The viewport was one cell of a grid; with the panels gone it should take the lot.
        document.body.style.gridTemplateColumns = '1fr'
        document.body.style.gridTemplateRows = '1fr'
        document.body.style.gridTemplateAreas = '"view"'
        window.dispatchEvent(new Event('resize'))
    })
    await sleep(300)
}

// --- the session --------------------------------------------------------------------------------

const transcript = []
let captureIndex = 0
const commandTimeout = Number(flags.get('command-timeout') ?? 60000)

/**
 * Fail a stuck command instead of hanging the whole session.
 *
 * A build script is a long chain, and one command that never settles - a texture that will not load,
 * a render waiting on a frame that never comes - otherwise takes the transcript, the captures and
 * every diagnostic with it. This turns that into one visible failure with the command printed.
 */
function withTimeout(promise, ms, command) {
    let timer
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`command timed out after ${ms}ms: ${JSON.stringify(command)}`)),
                ms)
        }),
    ])
}

async function run(command) {
    const started = Date.now()

    // `export {path}` runs in the page, which cannot write files. Ask for the bytes instead and
    // write them here, then keep the base64 out of the transcript so it stays readable.
    const wantsFile = command.op === 'export' && command.path
    const sent = wantsFile
        ? {...command, path: undefined, includeData: true}
        : command

    const result = await withTimeout(
        page.evaluate(c => window.modelling.run(c), sent),
        commandTimeout,
        command)

    if (wantsFile && result.ok && result.data?.base64) {
        await mkdir(dirname(resolve(command.path)), {recursive: true})
        await writeFile(resolve(command.path), Buffer.from(result.data.base64, 'base64'))
        console.log(`  💾 ${command.path}  ${result.data.bytes} bytes`)
        delete result.data.base64
        result.data.path = command.path
    }

    transcript.push({command, result, wallMs: Date.now() - started})
    if (!result.ok) {
        console.error(`  ✗ ${command.op}: ${result.error}`)
    } else {
        for (const w of result.warnings ?? []) console.warn(`  ! ${command.op}: ${w}`)
    }
    return result
}

async function runAll(commands, options = {}) {
    const out = []
    for (const command of commands) {
        const result = await run(command)
        out.push(result)
        if (!result.ok && !options.continueOnError) break
    }
    return out
}

/**
 * Render and save a frame. `view` and `fit` are passed to the `camera` command first, so a capture
 * can name the framing it wants without the caller juggling camera state.
 */
async function capture(label, {view, fit, padding} = {}) {
    if (view || fit) await run({op: 'camera', ...(view ? {view} : {}), ...(fit ? {fit} : {}),
        ...(padding ? {padding} : {})})
    const index = ++captureIndex
    const name = `${String(index).padStart(3, '0')}-${slug(label)}.png`
    const result = await run({op: 'capture', mimeType: 'image/png', label})
    if (!result.ok) return null
    const dataUrl = result.data.dataUrl
    await writeFile(join(outDir, name),
        Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    transcript[transcript.length - 1].capture = name
    console.log(`  📷 ${name}  ${label}`)
    return name
}

async function inspect(object, detail = false) {
    const result = await run({op: 'inspect', ...(object ? {object} : {}), ...(detail ? {detail} : {})})
    return result.ok ? result.data : null
}

const log = (...parts) => console.log(' ', ...parts)

// --- live session -------------------------------------------------------------------------------

/**
 * Watch a file of commands and answer them as they arrive.
 *
 * This is the loop the SU-152 report describes and the one a build script cannot reproduce: send a
 * command, look at what it did, decide the next one. An agent - or a person with a text editor -
 * appends a JSON command per line to `commands.jsonl` and reads the matching line from
 * `results.jsonl`; a `capture` writes a numbered PNG beside them.
 *
 *     npm run modelling:session -- --watch tmp/session &
 *     echo '{"op":"primitive","type":"cube","name":"hull","width":2.4}' >> tmp/session/commands.jsonl
 *     echo '{"op":"capture","label":"hull"}' >> tmp/session/commands.jsonl
 *     tail -2 tmp/session/results.jsonl
 */
async function watchSession(dir) {
    const commandsPath = join(dir, 'commands.jsonl')
    const resultsPath = join(dir, 'results.jsonl')
    await appendFile(commandsPath, '')
    await appendFile(resultsPath, '')

    let consumed = (await readFile(commandsPath, 'utf8')).split('\n').filter(Boolean).length
    console.log(`watching ${commandsPath} (${consumed} lines already there, skipping them)`)
    console.log(`results   ${resultsPath}`)
    console.log(`captures  ${dir}`)
    console.log('ready')

    let lastSize = -1
    for (;;) {
        let size = 0
        try {
            size = (await stat(commandsPath)).size
        } catch {
            await sleep(300)
            continue
        }
        if (size === lastSize) {
            await sleep(250)
            continue
        }
        lastSize = size

        const lines = (await readFile(commandsPath, 'utf8')).split('\n').filter(Boolean)
        for (const line of lines.slice(consumed)) {
            consumed++
            let command
            try {
                command = JSON.parse(line)
            } catch (e) {
                await appendFile(resultsPath,
                    JSON.stringify({ok: false, error: `not valid JSON: ${e.message}`, line}) + '\n')
                continue
            }
            if (command.op === 'quit') {
                await appendFile(resultsPath, JSON.stringify({ok: true, op: 'quit'}) + '\n')
                return
            }

            const isCapture = command.op === 'capture'
            const result = isCapture
                ? await captureToFile(command)
                : await run(command).catch(e => ({ok: false, op: command.op, error: e.message}))

            // The data URL is megabytes; the caller wants the filename, not the pixels.
            if (result?.data?.dataUrl) delete result.data.dataUrl
            await appendFile(resultsPath, JSON.stringify(result) + '\n')
        }
    }
}

/** A `capture` in watch mode writes a PNG and reports its name. */
async function captureToFile(command) {
    const label = command.label ?? `capture-${captureIndex + 1}`
    const name = await capture(label, {view: command.view, fit: command.fit, padding: command.padding})
    const last = transcript[transcript.length - 1]
    return {...last?.result, capture: name, file: name ? join(outDir, name) : null}
}

// --- execute ------------------------------------------------------------------------------------

if (watchDir) {
    await watchSession(outDir)
    await writeFile(join(outDir, 'transcript.json'),
        JSON.stringify({operations: transcript}, null, 2))
    console.log('session ended')
    await context.close()
    await browser.close()
    server?.kill()
    process.exit(0)
}

const modulePath = isAbsolute(buildPath) ? buildPath : resolve(buildPath)
const build = (await import(pathToFileURL(modulePath).href)).default
if (typeof build !== 'function') {
    throw new Error(`${buildPath} must default-export an async function taking the session`)
}

console.log(`running ${buildPath}`)
let failure = null
try {
    await build({run, runAll, capture, inspect, log, page, outDir})
} catch (e) {
    failure = e
    console.error('build script threw:', e.message)
}

// --- report -------------------------------------------------------------------------------------

const failed = transcript.filter(t => !t.result.ok)
const times = transcript.map(t => t.result.ms).sort((a, b) => a - b)
const summary = {
    url,
    build: buildPath,
    commands: transcript.length,
    failed: failed.length,
    captures: captureIndex,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : 0,
    p90Ms: times.length ? times[Math.floor(times.length * 0.9)] : 0,
    maxMs: times.length ? times[times.length - 1] : 0,
    pageErrors,
}
await writeFile(join(outDir, 'transcript.json'),
    JSON.stringify({summary, operations: transcript}, null, 2))

console.log('\n' + JSON.stringify(summary, null, 2))
if (failed.length) {
    console.log('\nfailures:')
    for (const t of failed.slice(0, 20)) console.log(`  ${t.command.op}: ${t.result.error}`)
}
console.log(`\ntranscript and captures: ${outDir}`)

if (flags.get('keep-open')) {
    console.log('holding the browser open - Ctrl+C to finish')
    await new Promise(() => {})
}

await context.close()
await browser.close()
server?.kill()
process.exit(failure || failed.length ? 1 : 0)

function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}
