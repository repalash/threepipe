/**
 * Render GLBs in the benchmark's plain viewer (render/index.html) from calibrated views, one PNG per
 * model x style x view. Meant for the GPU VM (`tpvm run`): Chromium with ANGLE on Metal. Locally it falls
 * back to whatever GL Chromium finds, and says so in the output.
 *
 *     npm run benchmark:render -- <job.json>
 *
 * job.json: {out, width, height, port, models: [{id, url, matrix?, exclude?}], styles: ['full'|'notex'|'clay'],
 *            views: [{name, position, target, fov}]}
 * `url` is relative to the repo root (the static server's root). Writes <out>/<id>-<style>-<view>.png and
 * <out>/render.json (renderer string, per-model load info, timings).
 */

import {spawn} from 'node:child_process'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jobPath = process.argv[2]
if (!jobPath) { console.error('usage: npm run benchmark:render -- <job.json>'); process.exit(1) }
const job = JSON.parse(await readFile(jobPath, 'utf8'))
const out = resolve(root, job.out)
await mkdir(out, {recursive: true})
const port = job.port ?? 9381
const width = job.width ?? 1200, height = job.height ?? 800

async function reachable() {
    try { return (await fetch(`http://127.0.0.1:${port}/demos/benchmark/render/index.html`)).ok } catch { return false }
}
let server = null
if (!await reachable()) {
    server = spawn(join(root, 'node_modules/.bin/ws'), ['-d', root, '-p', String(port)], {stdio: 'ignore', detached: true})
    for (let i = 0; i < 100 && !await reachable(); i++) await new Promise(r => setTimeout(r, 100))
}
const stop = () => { if (server) { try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill() } server = null } }
process.on('exit', stop)

const metal = process.platform === 'darwin'
const browser = await chromium.launch(metal ? {channel: 'chromium', args: ['--use-angle=metal']} : {})
const result = {renderer: null, width, height, renders: [], loads: {}}
const t0 = Date.now()
try {
    for (const model of job.models) for (const style of job.styles) {
        const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1})
        const errors = []
        page.on('pageerror', e => errors.push(e.message))
        await page.goto(`http://127.0.0.1:${port}/demos/benchmark/render/index.html`)
        await page.waitForFunction(() => window.benchReady, null, {timeout: 60000})
        result.renderer ??= await page.evaluate(() => window.bench.renderer())
        const tl = Date.now()
        const load = await page.evaluate(([url, o]) => window.bench.load(url, o),
            ['/' + model.url, {matrix: model.matrix, exclude: model.exclude, style}])
        result.loads[`${model.id}-${style}`] = {...load, ms: Date.now() - tl, errors}
        for (const view of job.views) {
            await page.evaluate(v => window.bench.view(v), view)
            const file = `${model.id}-${style}-${view.name}.png`
            await page.locator('#mcanvas').screenshot({path: join(out, file)})
            result.renders.push({model: model.id, style, view: view.name, file})
        }
        await page.close()
    }
} finally {
    await browser.close()
    stop()
}
result.ms = Date.now() - t0
await writeFile(join(out, 'render.json'), JSON.stringify(result, null, 1))
console.log(JSON.stringify({renderer: result.renderer, renders: result.renders.length, ms: result.ms,
    errors: Object.values(result.loads).flatMap(l => l.errors).slice(0, 5)}))
