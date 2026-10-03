// A/B visual diff of two served threepipe checkouts on the host GPU browser (see README.md).
//
//   npm run test:e2e:ab -- <baseUrlA> <baseUrlB> <outDir> [--filter <regex>] [--limit <n>] [--batch <n>]
//   e.g. npm run test:e2e:ab -- http://9313.$AIBOX_URL_BASE http://9312.$AIBOX_URL_BASE tmp/ab/r163-vs-r168
//
// For every e2e test (the names in tests/*.spec.ts) it renders the example's initial state three times in
// isolated contexts — A, A again (repeat noise) and B — with the same deterministic injection, waits and
// pre-screenshot steps as tests/helpers.ts, then compares the pixels. Output: <outDir>/<example>/{a,a2,b,diff,noise}.png,
// results.json, summary.json and index.html (side-by-side for every changed example, console differences,
// examples that did not finish). Resumable: examples already in results.json are skipped.
//
// Serve both trees from the container on 0.0.0.0 (e.g. `npm run test:e2e:serve -- -p <port>` or
// `npm run vite -- --host 0.0.0.0 --port <port>`) and pass their http://<port>.$AIBOX_URL_BASE urls.
// Pixel comparison uses sharp (already installed for the e2e helpers): a pixel differs when any channel differs by
// more than 25/255 — close to Playwright's threshold 0.1, not identical to it.
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {connectHostBrowser} from './connect.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const root = path.join(import.meta.dirname, '..', '..')

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const [baseA, baseB, outDir] = positional
if (!baseA || !baseB || !outDir) { console.error('usage: ab-compare.mjs <baseUrlA> <baseUrlB> <outDir> [--filter <regex>] [--limit <n>] [--batch <n>]'); process.exit(2) }
const filter = opt('filter') ? new RegExp(opt('filter')) : null
const limit = opt('limit') ? parseInt(opt('limit')) : Infinity
const BATCH = parseInt(opt('batch', '5')) // examples per browser connection (the server ends the browser on any page close)

const injection = fs.readFileSync(path.join(root, 'tests', 'deterministic-injection.js'), 'utf8')
const names = [...new Set(['tests/extras.spec.ts', 'tests/interactive.spec.ts']
    .flatMap(f => [...fs.readFileSync(path.join(root, f), 'utf8').matchAll(/^test\('([^']+)'/gm)].map(m => m[1])))]
    .filter(n => !filter || filter.test(n)).slice(0, limit)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// Mirrors tests/helpers.ts: beforeEach + screenshotMatch('initial'). The page is parked on about:blank
// afterwards instead of closed (closing any page ends the shared browser).
async function render(browser, base, name, file) {
    const context = await browser.newContext({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1})
    const res = {finished: true, logs: [], title: null, renderer: null}
    let page = null
    try {
        page = await context.newPage()
        page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') res.logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`) })
        page.on('pageerror', e => res.logs.push(`[pageerror] ${e.message.slice(0, 300)}`))
        page.on('response', r => { if (r.status() >= 400) res.logs.push(`[http ${r.status()}] ${r.url().replace(base, '').slice(0, 200)}`) })
        await page.addInitScript(injection)
        await page.goto(`${base}/examples/${name}/`, {timeout: 120000})
        await page.waitForSelector('body._testFinish', {state: 'attached', timeout: 120000}).catch(() => { res.finished = false })
        await page.evaluate(() => {
            const viewer = window.threeViewers?.[0]
            viewer?.getPlugin('GLTFAnimation')?.setTime(0)
        }).catch(() => {})
        await page.addStyleTag({content: '#stats-js {display: none !important;} .show-code-btn {display: none !important;} .code-block {display: none !important;}'})
        await page.waitForTimeout(1000)
        res.renderer = await page.evaluate(async() => {
            const viewer = window.threeViewers?.[0]
            if (!viewer) return null
            viewer.getPlugin('GLTFAnimation')?.pauseAnimation()
            const popmotion = viewer.getPlugin('PopmotionPlugin')
            if (popmotion?.animations) for (const a of Object.values(popmotion.animations)) a.stop?.()
            const timeout = ms => new Promise(r => setTimeout(r, ms))
            const progressive = viewer.getPlugin('ProgressivePlugin')
            if (progressive?.convergedPromise) await Promise.race([progressive.convergedPromise, timeout(5000)])
            else await Promise.race([new Promise(r => viewer.doOnce('postFrame', () => r())), timeout(500)])
            const gl = viewer.renderManager?.renderer?.getContext?.()
            const ext = gl?.getExtension('WEBGL_debug_renderer_info')
            return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
        }).catch(e => 'eval-error: ' + e.message.slice(0, 100))
        res.title = await page.title()
        let prev = null, buf = null // like toHaveScreenshot: two consecutive identical captures
        for (let i = 0; i < 6; i++) {
            buf = await page.screenshot({animations: 'disabled', caret: 'hide', timeout: 60000})
            if (prev && buf.equals(prev)) break
            prev = buf
            await page.waitForTimeout(250)
            if (i === 5) res.unstable = true
        }
        fs.writeFileSync(file, buf)
    } catch (e) {
        res.error = e.message.split('\n')[0].slice(0, 300)
    } finally {
        await page?.goto('about:blank').catch(() => {})
    }
    return res
}

async function diff(fa, fb, fout) {
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) return null
    const [a, b] = await Promise.all([fa, fb].map(f => sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject: true})))
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) return {pixels: -1, ratio: 1}
    const {width, height} = a.info
    const out = Buffer.alloc(width * height * 4)
    let pixels = 0
    for (let i = 0; i < width * height; i++) {
        const o = i * 4
        const differs = Math.abs(a.data[o] - b.data[o]) > 25 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 25 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 25
        if (differs) { pixels++; out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255 } else {
            const g = Math.round(255 - (255 - (a.data[o] + a.data[o + 1] + a.data[o + 2]) / 3) * 0.1)
            out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255
        }
    }
    if (fout && pixels > 0) await sharp(out, {raw: {width, height, channels: 4}}).png().toFile(fout)
    return {pixels, ratio: pixels / (width * height)}
}

function writeReport(results) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
    const rows = Object.entries(results).map(([name, r]) => ({name, ...r}))
    const errored = rows.filter(r => r.error || r.a?.error || r.b?.error || !r.change)
    const ok = rows.filter(r => !errored.includes(r))
    const changed = ok.filter(r => r.change.pixels !== 0).sort((x, y) => y.change.ratio - x.change.ratio)
    const noisy = ok.filter(r => r.noise && r.noise.pixels !== 0)
    const newLogs = ok.filter(r => r.logsOnlyB.length), goneLogs = ok.filter(r => r.logsOnlyA.length)
    const summary = {
        a: baseA, b: baseB, total: rows.length, compared: ok.length, identical: ok.length - changed.length, changed: changed.length,
        overThreshold: changed.filter(r => r.change.ratio > 0.003).length, noisy: noisy.length, errored: errored.length,
        unfinished: ok.filter(r => !r.a.finished || !r.b.finished).map(r => r.name), renderer: ok[0]?.a.renderer,
        changedList: changed.map(r => ({name: r.name, pixels: r.change.pixels, ratio: +r.change.ratio.toFixed(5), noise: r.noise?.pixels})),
        erroredList: errored.map(r => ({name: r.name, error: r.error || r.a?.error || r.b?.error || 'no screenshot'})),
    }
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1))
    const pct = r => (r * 100).toFixed(3) + '%'
    const imgs = r => ['a.png', 'b.png', 'diff.png'].map((f, i) => `<figure><a href="${esc(r.name)}/${f}"><img loading="lazy" src="${esc(r.name)}/${f}"></a><figcaption>${esc([baseA, baseB, 'diff'][i])}</figcaption></figure>`).join('')
    const table = (title, list, col) => `<h2>${title}</h2><table><tr><th>example</th><th>lines</th></tr>${list.map(r => `<tr><td>${esc(r.name)}</td><td><pre>${esc(r[col].join('\n'))}</pre></td></tr>`).join('')}</table>`
    fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>A/B ${esc(baseA)} vs ${esc(baseB)}</title>
<style>body{font:14px system-ui;margin:24px;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
.imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 28px}.imgs img{width:100%;border:1px solid #ccc}figure{margin:0}figcaption{font-size:12px;color:#555}pre{white-space:pre-wrap;font-size:12px;margin:0}</style>
<h1>${esc(baseA)} vs ${esc(baseB)}</h1>
<p>${summary.total} examples · ${summary.identical} pixel-identical · ${summary.changed} changed (${summary.overThreshold} over the 0.3% gate threshold) · ${summary.noisy} with non-zero repeat noise · ${summary.errored} errored · renderer: ${esc(summary.renderer)}</p>
<h2>Changed</h2>
${changed.map(r => `<h3 id="${esc(r.name)}">${esc(r.name)} — ${r.change.pixels} px (${pct(r.change.ratio)}), repeat noise ${r.noise?.pixels ?? '?'} px</h3><div class="imgs">${imgs(r)}</div>`).join('\n')}
${table('Console warnings/errors only in B', newLogs, 'logsOnlyB')}
${table('Console warnings/errors only in A', goneLogs, 'logsOnlyA')}
<h2>Errored / not compared</h2><table><tr><th>example</th><th>error</th></tr>${errored.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.error || r.a?.error || r.b?.error || 'no screenshot')}</td></tr>`).join('')}</table>
<h2>Did not reach _testFinish</h2><p>${summary.unfinished.map(esc).join(', ') || 'none'}</p>
`)
    return summary
}

fs.mkdirSync(outDir, {recursive: true})
const resultsFile = path.join(outDir, 'results.json')
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : {}
log(`${names.length} examples, A=${baseA} B=${baseB}`)
let browser = null, inBatch = 0
for (const name of names) {
    if (results[name] && !results[name].error) continue
    const dir = path.join(outDir, name)
    fs.mkdirSync(dir, {recursive: true})
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (browser && (inBatch >= BATCH || !browser.isConnected())) {
                await browser.close().catch(() => {})
                browser = null
                await sleep(6000) // the server restarts its browser after a close
            }
            if (!browser) { browser = await connectHostBrowser(); inBatch = 0 }
            inBatch++
            const [a, a2, b] = await Promise.all([
                render(browser, baseA, name, path.join(dir, 'a.png')),
                render(browser, baseA, name, path.join(dir, 'a2.png')),
                render(browser, baseB, name, path.join(dir, 'b.png')),
            ])
            if ([a, a2, b].some(r => r.error && /closed|disconnected|Target/i.test(r.error)) && attempt < 2) throw new Error('connection lost: ' + [a, a2, b].map(r => r.error).filter(Boolean)[0])
            const noise = await diff(path.join(dir, 'a.png'), path.join(dir, 'a2.png'), path.join(dir, 'noise.png'))
            const change = await diff(path.join(dir, 'a.png'), path.join(dir, 'b.png'), path.join(dir, 'diff.png'))
            const onlyB = b.logs.filter(l => !a.logs.includes(l)), onlyA = a.logs.filter(l => !b.logs.includes(l))
            results[name] = {a, a2, b, noise, change, logsOnlyB: onlyB.slice(0, 20), logsOnlyA: onlyA.slice(0, 20)}
            log(name, 'noise', noise?.pixels, 'change', change?.pixels, 'finished', a.finished, b.finished, onlyB.length ? `newLogs=${onlyB.length}` : '', [a, a2, b].map(r => r.error).filter(Boolean).join(' | '))
            break
        } catch (e) {
            log(name, 'retry', attempt, e.message.split('\n')[0].slice(0, 200))
            results[name] = {error: e.message.split('\n')[0].slice(0, 300)}
            await browser?.close().catch(() => {})
            browser = null
            await sleep(7000)
        }
    }
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 1))
}
await browser?.close().catch(() => {})
const summary = writeReport(results)
log(`done: ${summary.identical} identical, ${summary.changed} changed (${summary.overThreshold} over 0.3%), ${summary.noisy} noisy, ${summary.errored} errored — ${path.join(outDir, 'index.html')}`)
