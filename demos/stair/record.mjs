/**
 * Record `video.webm`: the stair-and-arcade build run live, directed as `direction.md` describes.
 *
 *     node demos/stair/record.mjs [--ws <playwright endpoint>] [--url <modelling-api page>]
 *         [--out demos/stair/video.webm] [--width 1280] [--height 720]
 *
 * Nothing is pre-baked: the page is the `modelling-api` example, every piece of geometry comes from
 * `demos/stair/build.mjs` sending JSON commands to `window.modelling.run`, exactly as the session
 * harness does. This file only directs: title cards and captions are DOM overlays, the build's camera
 * jumps become eased moves (a stream of `camera` commands, one a frame), and each of the build's
 * captures becomes a held, captioned shot.
 *
 * `--ws` connects to a remote Playwright browser server (a GPU machine) with `chromium.connect`;
 * without it a local headless Chromium renders with SwiftShader.
 */

import {chromium} from 'playwright'
import {copyFile, mkdir, rm, stat} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {dirname, resolve, join} from 'node:path'
import {tmpdir} from 'node:os'
import build from './build.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = args.indexOf('--' + name)
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const ws = flag('ws', null)
const url = flag('url', 'http://127.0.0.1:9373/examples/modelling-api/index.html')
const out = resolve(flag('out', 'demos/stair/video.webm'))
const width = Number(flag('width', 1280))
const height = Number(flag('height', 720))
const origin = new URL(url).origin

const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = ws
    ? await chromium.connect(ws)
    : await chromium.launch({headless: true,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars']})
const videoDir = join(tmpdir(), 'stair-record-' + Date.now())
const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1,
    recordVideo: {dir: videoDir, size: {width, height}}})
const page = await context.newPage()
const videoStart = Date.now()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const started = Date.now()

// The video starts with the page, so the loading screen and the example's own UI would open the
// film. A curtain goes up before any of the page's content and comes down once the overlays exist.
await page.addInitScript(() => {
    const curtain = () => {
        if (document.getElementById('rec-curtain')) return
        const c = document.createElement('div')
        c.id = 'rec-curtain'
        c.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#16181c;color:#f2efe8;display:flex;'
            + 'align-items:center;justify-content:center;font:600 44px Georgia,serif'
        c.textContent = 'Cast iron and stone'
        document.documentElement.appendChild(c)
    }
    if (document.documentElement) curtain()
    document.addEventListener('DOMContentLoaded', curtain)
})
await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000})
await page.waitForFunction(() => !!window.modelling, null, {timeout: 180000})

// The page shows only the viewport, plus the director's overlays.
await page.evaluate(({origin}) => {
    for (const sel of ['#console', '#side', '#tweakpaneUiContainer', '.code-preview', '#example-code-preview',
        '#example-code-btn']) document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
    document.body.style.gridTemplateColumns = '1fr'
    document.body.style.gridTemplateRows = '1fr'
    document.body.style.gridTemplateAreas = '"view"'
    window.dispatchEvent(new Event('resize'))
    const css = document.createElement('style')
    css.textContent = `
      #rec-card { position: fixed; inset: 0; background: #16181c; color: #f2efe8; display: flex;
        flex-direction: column; justify-content: center; align-items: center; z-index: 50;
        font: 600 44px/1.2 Georgia, 'Times New Roman', serif; text-align: center; transition: opacity .35s; }
      #rec-card small { display: block; margin-top: 18px; font: 400 20px/1.4 ui-monospace, Menlo, monospace;
        color: #b9b3a6; max-width: 70%; }
      #rec-card.hidden { opacity: 0; pointer-events: none; }
      #rec-caption { position: fixed; left: 32px; bottom: 28px; z-index: 40; padding: 8px 14px;
        background: rgba(18,20,24,.78); color: #f2efe8; font: 500 20px/1.3 Georgia, serif; border-radius: 3px;
        transition: opacity .3s; }
      #rec-cmd { position: fixed; left: 32px; top: 22px; z-index: 40; padding: 6px 10px; max-width: 70%;
        background: rgba(18,20,24,.7); color: #c9e3b5; font: 13px/1.35 ui-monospace, Menlo, monospace;
        border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #rec-refs { position: fixed; inset: 0; z-index: 45; background: #16181c; display: none; gap: 14px;
        padding: 64px 28px 28px; box-sizing: border-box; }
      #rec-refs figure { margin: 0; flex: 1; display: flex; flex-direction: column; min-width: 0; }
      #rec-refs img { flex: 1; min-height: 0; object-fit: contain; background: #fff; }
      #rec-refs figcaption { color: #e8e3d8; font: 15px/1.35 ui-monospace, Menlo, monospace; padding-top: 8px; }
      #rec-refs h2 { position: absolute; top: 16px; left: 28px; margin: 0; color: #f2efe8; font: 600 26px Georgia, serif; }
      body.rec-split #canvas-container { position: fixed !important; left: 50% !important; top: 0; width: 50% !important;
        height: 100% !important; }
      /* threepipe's loading screen comes back whenever a command loads something; the cards say it all. */
      div:has(> .loadingScreenLoadingElement) { display: none !important; }
      #rec-splitref { position: fixed; left: 0; top: 0; width: 50%; height: 100%; z-index: 30; display: none;
        background: #fff; object-fit: contain; }
    `
    document.head.appendChild(css)
    const el = (id, tag = 'div') => {
        const n = document.createElement(tag)
        n.id = id
        document.body.appendChild(n)
        return n
    }
    el('rec-card').classList.add('hidden')
    el('rec-caption').style.opacity = '0'
    el('rec-cmd')
    el('rec-refs')
    el('rec-splitref', 'img')
    window.__recOrigin = origin
}, {origin})

const ui = {
    async card(title, sub = '', ms = 2200) {
        await page.evaluate(({title, sub}) => {
            const c = document.getElementById('rec-card')
            c.innerHTML = ''
            c.append(title)
            if (sub) {
                const s = document.createElement('small')
                s.textContent = sub
                c.append(s)
            }
            c.classList.remove('hidden')
        }, {title, sub})
        await sleep(ms)
    },
    async uncard() {
        await page.evaluate(() => document.getElementById('rec-card').classList.add('hidden'))
        await sleep(350)
    },
    async caption(text) {
        await page.evaluate(t => {
            const c = document.getElementById('rec-caption')
            c.textContent = t
            c.style.opacity = t ? '1' : '0'
        }, text)
    },
    async command(c) {
        const text = JSON.stringify(c, (k, v) => Array.isArray(v) && v.length > 6 ? `[…${v.length}]` : v)
        await page.evaluate(t => (document.getElementById('rec-cmd').textContent = t), text)
    },
}

/** Ease the camera from where it is to an explicit view: one `camera` command a frame. */
async function moveCamera(c, ms = 800) {
    await page.evaluate(async({c, ms}) => {
        const cam = window.viewer.scene.mainCamera
        if (c.fov !== undefined && !cam.isOrthographicCamera) await window.modelling.run({op: 'camera', fov: c.fov})
        const p0 = cam.position.toArray(), t0 = cam.target.toArray()
        const p1 = c.position ?? p0, t1 = c.target ?? t0
        const start = performance.now()
        const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
        for (;;) {
            const k = Math.min(1, (performance.now() - start) / ms)
            const e = ease(k)
            const lerp = (a, b) => a.map((v, i) => v + (b[i] - v) * e)
            await window.modelling.run({op: 'camera', position: lerp(p0, p1), target: lerp(t0, t1)})
            await new Promise(r => requestAnimationFrame(r))
            if (k >= 1) break
        }
    }, {c, ms})
}

let failures = 0
const session = {
    page,
    outDir: null,
    recording: true,
    log: (...parts) => console.log(' ', ...parts),
    async run(command) {
        if (command.op === 'export' || command.op === 'capture') return {ok: true, op: command.op, data: {}}
        await ui.command(command)
        const smooth = command.op === 'camera' && command.position && command.projection !== 'orthographic'
            && command.frustumSize === undefined
        if (smooth) {
            const {fov, position, target} = command
            // Switch lens first (a no-op when it is already perspective), then ease into the view.
            if (command.projection) await page.evaluate(c => window.modelling.run(c), {op: 'camera', projection: command.projection})
            await moveCamera({fov, position, target})
            return {ok: true, op: 'camera', data: {}}
        }
        const result = await page.evaluate(c => window.modelling.run(c), command)
        if (!result.ok) {
            failures++
            console.error(`  ✗ ${command.op}: ${result.error}`)
        }
        return result
    },
    async capture(label) {
        await ui.caption(label)
        // SwiftShader can be a frame or two behind the command; hold long enough to see the result.
        await sleep(1400)
        return label
    },
    async inspect(object) {
        const r = await page.evaluate(c => window.modelling.run(c), {op: 'inspect', object})
        return r.ok ? r.data : null
    },
    async section(title, sub) {
        await ui.caption('')
        await ui.card(title, sub, 1600)
        await ui.uncard()
    },
    hold: ms => sleep(ms),
    async orbit({center, radius, height, seconds}) {
        await ui.caption('')
        await page.evaluate(async({center, radius, height, seconds}) => {
            await window.modelling.run({op: 'camera', projection: 'perspective', fov: 45})
            const start = performance.now()
            for (;;) {
                const k = Math.min(1, (performance.now() - start) / (seconds * 1000))
                const a = 0.6 + k * Math.PI * 2
                await window.modelling.run({op: 'camera', target: center,
                    position: [center[0] + radius * Math.cos(a), height, center[2] + radius * Math.sin(a)]})
                await new Promise(r => requestAnimationFrame(r))
                if (k >= 1) break
            }
        }, {center, radius, height, seconds})
    },
}

// --- scene 1: the references ----------------------------------------------------------------------
await ui.card('Cast iron and stone', 'a spiral staircase and a Gothic arcade, to scale, from JSON modelling commands', 0)
await page.evaluate(() => document.getElementById('rec-curtain')?.remove())
// Everything before this moment is page load; the film starts here (trimmed off below).
const filmStart = (Date.now() - videoStart) / 1000
await sleep(2600)
await page.evaluate(() => {
    const r = document.getElementById('rec-refs')
    const fig = (src, cap) => `<figure><img src="${window.__recOrigin}/demos/stair/refs/${src}"><figcaption>${cap}</figcaption></figure>`
    r.innerHTML = '<h2>References</h2>'
        + fig('ukaa-24019-safety-stairways-elevation.jpg', 'Safety Stairways Ltd cast-iron spiral (UKAA 24019):<br>53" dia, 8" rise, 12 treads a turn, 33½" spindles')
        + fig('ukaa-24019-safety-stairways-top.jpg', 'the treads from above:<br>30° pierced castings on a 3" pole')
        + fig('habs-ascension-nave-bay-elevation.png', 'HABS, Church of the Ascension, NYC, sheet 8:<br>bay 14\'-3", springing 21\'-4", crown 30\'-5"')
    r.style.display = 'flex'
})
await ui.uncard()
await sleep(6500)
await page.evaluate(() => (document.getElementById('rec-refs').style.display = 'none'))

// --- scenes 2-9: the build itself -----------------------------------------------------------------
let buildError = null
try {
    await build(session)
} catch (e) {
    buildError = e
    console.error('build threw:', e.message)
}

// --- scene 10: split with the references ----------------------------------------------------------
await ui.caption('')
await ui.card('Against the references', '', 1500)
await page.evaluate(() => {
    document.body.classList.add('rec-split')
    const img = document.getElementById('rec-splitref')
    img.src = `${window.__recOrigin}/demos/stair/refs/ukaa-24019-safety-stairways-elevation.jpg`
    img.style.display = 'block'
    window.dispatchEvent(new Event('resize'))
})
await ui.uncard()
await session.run({op: 'camera', projection: 'perspective', fov: 50, position: [3.2, 2.6, 6.8], target: [0, 2.9, 0]})
await ui.caption('catalogue photograph | the model')
await sleep(6000)
await page.evaluate(() => {
    document.getElementById('rec-splitref').src = `${window.__recOrigin}/demos/stair/refs/habs-ascension-nave-bay-elevation.png`
})
await page.evaluate(async() => {
    await window.modelling.run({op: 'reference', name: 'habs', visible: false, plane: 'front'}).catch(() => {})
})
await session.run({op: 'camera', projection: 'perspective', fov: 40, position: [3.4 + 4.34, 5.6, -4.8 + 22], target: [3.4 + 4.34, 5.6, -4.8]})
await ui.caption('HABS sheet 8 | the model')
await sleep(6000)
await page.evaluate(() => {
    document.body.classList.remove('rec-split')
    document.getElementById('rec-splitref').style.display = 'none'
    window.dispatchEvent(new Event('resize'))
})
await ui.card('Every piece is still editable topology', 'lathe · sweep · radial and linear array · modifier · bridgeEdgeLoops · subdivide · bevel · mirror', 3000)

const video = page.video()
await context.close()
await mkdir(dirname(out), {recursive: true})
await rm(out, {force: true})
const raw = join(videoDir, 'raw.webm')
await video.saveAs(raw)
// Cut the page-load lead-in. Re-encoded (VP8, as Playwright writes it) so the cut is frame-accurate.
const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', filmStart.toFixed(2), '-i', raw, '-c:v', 'libvpx',
    '-b:v', '1400k', '-crf', '12', '-an', out], {stdio: 'inherit'})
if (ff.status !== 0) {
    console.error('ffmpeg failed; keeping the untrimmed recording')
    await copyFile(raw, out)
}
await browser.close()
await rm(videoDir, {recursive: true, force: true}).catch(() => {})
const size = (await stat(out)).size
console.log(JSON.stringify({out, seconds: Math.round((Date.now() - started) / 1000), trimmedLeadIn: +filmStart.toFixed(2), bytes: size, failures,
    buildError: buildError?.message ?? null, pageErrors: errors.slice(0, 5)}, null, 2))
process.exit(buildError || failures ? 1 : 0)

