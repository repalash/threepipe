// Renders the thumbnail and the turntable video of each model in catalog.json with threepipe, on a browser with a real GPU.
//
//   aibox browser                                  on the Mac: the GPU browser (its URL is in ~/.aibox/host/browser.url)
//   npm run dev -- --host 0.0.0.0 --port 8805      here: serves examples/_render-model
//   npm run assets:render -- --out /tmp/models-out --page <dev server URL> --models <URL of --out, with CORS> [--only A,B] [--force]
//
// Writes thumb.webp and preview.mp4 to the row's folder in <out>/p/samples/ and adds thumb_url and video_url to catalog.json; rerun to continue.
// The driver uses one tab: closing a page restarts the server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {parseArgs} from 'node:util'

const {values: args} = parseArgs({options: {
    out: {type: 'string', default: 'tmp/models'},
    page: {type: 'string'},
    models: {type: 'string'},
    only: {type: 'string'},
    force: {type: 'boolean', default: false},
    size: {type: 'string', default: '512'},
    video: {type: 'string', default: '3'},
    timeout: {type: 'string', default: '600'},
    pw: {type: 'string', default: '/tmp/pw'}, // Playwright of the server's version: npm i --prefix /tmp/pw playwright@<version>
}})
const FILES = 'https://files.threepipe.org'
const SAMPLES = 'https://samples.threepipe.org'
const {chromium} = createRequire(import.meta.url)(path.join(args.pw, 'node_modules/playwright'))

// The server restarts when a page closes, and its path may change: one connection per model, with the current path.
async function connect() {
    const base = fs.readFileSync(path.join(os.homedir(), '.aibox/host/browser.url'), 'utf8').split('\n')[0].trim().replace(/^ws:\/\/([^/]+).*/, '$1')
    let last
    for (let attempt = 0; attempt < 15; attempt++) {
        try {
            const {wsEndpointPath} = JSON.parse(execFileSync('curl', ['-s', '-m', '5', '-H', 'Host: 127.0.0.1:3145', `http://${base}/json`], {encoding: 'utf8'}))
            return await chromium.connect(`ws://${base}${wsEndpointPath}`, {headers: {Host: '127.0.0.1:3145'}, timeout: 10_000})
        } catch (e) {
            last = e
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }
    throw last
}

const catalogPath = path.join(args.out, 'catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const only = args.only?.split(',')
const decode = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
const failed = []
let done = 0
const size = parseInt(args.size)
// One tab for all models: closing a page restarts the server, so it stays open and goes to the next model.
const browser = await connect()
const context = await browser.newContext({viewport: {width: size, height: size}})
const page = await context.newPage()
let current = ''
page.on('pageerror', e => console.log(`  ${current}: page error: ${String(e.message).slice(0, 200)}`))
page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  ${current}: ${m.type()}: ${m.text().slice(0, 200)}`)
})
for (const row of catalog.rows) {
    if (row.kind !== 'model' || (only && !only.includes(row.name))) continue
    const dir = path.join(args.out, row.previews)
    fs.mkdirSync(dir, {recursive: true})
    const thumb = path.join(dir, 'thumb.webp'), video = path.join(dir, 'preview.mp4')
    const urls = () => {
        row.thumb_url = fs.existsSync(thumb) ? `${FILES}/${row.previews}/thumb.webp` : null
        row.video_url = fs.existsSync(video) ? `${FILES}/${row.previews}/preview.mp4` : null
    }
    if (!args.force && fs.existsSync(thumb) && fs.existsSync(video)) {
        urls() // a new catalog.json keeps what is rendered
        continue
    }
    current = row.name
    const start = Date.now()
    try {
        // a file already in the bucket, or one in the folder to upload
        const {views, animations, play} = JSON.parse(row.metadata ?? '{}')
        const view = views?.[0]
        const clips = play?.length ? `&play=${encodeURIComponent(JSON.stringify(play))}&playSeconds=${Math.max(...animations.filter(a => play.includes(a.name)).map(a => a.seconds))}` : ''
        const model = row.linked ? row.url : `${args.models}/samples/${row.url.slice(SAMPLES.length + 1)}`
        await page.goto(`${args.page}/examples/_render-model/?m=${encodeURIComponent(model)}&size=${size}&video=${args.video}${view ? `&view=${encodeURIComponent(JSON.stringify(view))}` : ''}${clips}`, {timeout: 120_000})
        const result = await page.evaluate(() => window.__render, undefined, {timeout: parseInt(args.timeout) * 1000})
        if (result.error) throw new Error(result.error)
        fs.writeFileSync(thumb, decode(result.thumb))
        if (result.video) fs.writeFileSync(video, decode(result.video))
        urls()
        console.log(`${row.name}: ${((Date.now() - start) / 1000).toFixed(1)} s, thumb ${(fs.statSync(thumb).size / 1024).toFixed(0)} KB${result.video ? `, video ${(fs.statSync(video).size / 1024).toFixed(0)} KB` : ', NO VIDEO'}${result.hasView ? ', a set view' : ''}`)
        fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
        done++
    } catch (e) {
        failed.push(row.name)
        console.log(`${row.name}: FAILED ${String(e.message ?? e).slice(0, 240)}`)
    }
    await page.goto('about:blank').catch(() => {}) // frees the model before the next one
}
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
await browser.close()
console.log(`rendered ${done}, failed ${failed.length}${failed.length ? ': ' + failed.join(' ') : ''}`)
