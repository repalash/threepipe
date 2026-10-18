/**
 * Record the camera demo's video: the build runs live in the page, with the camera moves, titles
 * and reference cut-ins from `direction.md`.
 *
 *     node demos/camera/record.mjs                      # local Chromium (SwiftShader)
 *     node demos/camera/record.mjs --ws ws://host:port/ # a remote Playwright browser (GPU)
 *
 * Flags: --url (the modelling example page, default the vite dev server on 9372), --out
 * (default demos/camera/video.webm), --width/--height (1280x720), --pace (ms after each edit, 260).
 *
 * The build is `build.mjs`, unchanged: it is handed a session whose `run` goes to the page, whose
 * `capture` becomes a held shot with a caption instead of a PNG, and whose `beat` (a no-op in the
 * session harness) cuts to the section's title card and camera. Nothing about the model is
 * scripted here - the video shows exactly the commands the transcript lists.
 */

import {chromium} from 'playwright'
import {mkdtemp, rm, stat, rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve, dirname} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const ws = flag('ws', null)
const url = flag('url', 'http://127.0.0.1:9372/examples/modelling-api/index.html')
const out = resolve(flag('out', join(here, 'video.webm')))
const width = Number(flag('width', 1280))
const height = Number(flag('height', 720))
const pace = Number(flag('pace', 150))
/** Longest the finished video may run; a slower recording is time-lapsed to fit (and says so). */
const maxSeconds = Number(flag('max-seconds', 178))
const refBase = flag('refs', new URL('/demos/camera/refs/', url).href)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const AX = 15.5, AY = 48, L = z => 73 + z
/** The hero photograph's viewpoint, as build.mjs has it: 25° right of the lens axis, 28° up, 590 mm out. */
const HERO = [228.2, 329.0, 552.1]

/**
 * The storyboard, keyed by the build's beats. `camera` is set when the beat starts; `continuous`
 * keeps it there through the section's captures (one unbroken shot); `drift` orbits it slowly
 * round its target while the section builds. See direction.md for the why of each.
 */
const DIRECTION = {
    references: {title: 'Calibrate', sub: 'Three photographs on world planes, scaled by a published dimension',
        caption: 'reference {calibrate: two points + 150.7 mm} → 9.08 px/mm'},
    lens: {title: 'Lathe the lens', sub: 'EF 24-105mm f/4L IS USM · 83.5 × 107 mm · one shot',
        camera: {position: [AX + 250, AY + 150, L(230)], target: [AX, AY, L(52)], fov: 30},
        continuous: true, drift: {deg: 38, ms: 26000}},
    body: {title: 'Block, bevel, cut', sub: 'A box, three bevels, four bisects and an inset',
        camera: {position: [-250, 210, -330], target: [0, 45, 30], fov: 30}, continuous: true, drift: {deg: 25, ms: 12000}},
    grip: {title: 'Sweep the grip', sub: 'A measured top-view section, swept up the body',
        camera: {position: [-330, 170, 330], target: [-30, 48, 40], fov: 30}, continuous: true},
    top: {title: 'Prism, top LCD, hot shoe', sub: 'ISO 518 channel: inset 2.7 mm, sunk 2 mm',
        camera: {position: [210, 330, 330], target: [10, 80, 40], fov: 30}, continuous: true},
    controls: {title: 'Dials and buttons', sub: 'Lathed, knurled with inset, arrayed at the measured pitch',
        camera: {position: [-120, 170, -360], target: [5, 55, 0], fov: 30}, continuous: true, drift: {deg: 30, ms: 14000}},
    eyecup: {title: 'Eyecup', sub: 'A section swept round a closed rounded rectangle',
        camera: {position: [90, 190, -210], target: [AX, 88, 0], fov: 30}, continuous: true},
    mount: {title: 'Mount and lugs', sub: 'EF throat 54 mm · lugs mirrored live',
        camera: {position: [150, 120, 420], target: [0, 58, 60], fov: 30}, continuous: true},
    assembled: {title: null, camera: {position: HERO, target: [8, 52, 80], fov: 26}, hold: 2500},
    compare: {title: 'Against the photographs', sub: 'Orthographic, registered to each calibrated plane',
        hold: 1600},
    closeups: {title: 'Close-ups', sub: 'Bevelled edges and knurling - every mesh edge drawn in red', hold: 1700},
    hero: {title: null, camera: {position: HERO, target: [8, 52, 80], fov: 22}, continuous: true, hold: 2500},
}

const browser = ws
    ? await chromium.connect(ws)
    : await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
        '--hide-scrollbars']})
const videoDir = await mkdtemp(join(tmpdir(), 'camera-video-'))
const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1,
    recordVideo: {dir: videoDir, size: {width, height}}})
const recordStart = Date.now()
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))

await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 900000})
await page.waitForFunction(() => !!window.modelling, {timeout: 900000})

// The stage: the viewport alone, plus the overlays the storyboard uses.
await page.evaluate(({refBase}) => {
    for (const sel of ['#console', '#side', '#tweakpaneUiContainer', '.code-preview', '#example-code-preview',
        '#example-code-btn']) document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
    document.body.style.gridTemplateColumns = '1fr'
    document.body.style.gridTemplateRows = '1fr'
    document.body.style.gridTemplateAreas = '"view"'
    const css = document.createElement('style')
    css.textContent = `
      #rec-card, #rec-photo { position: fixed; inset: 0; z-index: 50; transition: opacity .6s ease; }
      #rec-card { background: #0d0e10; color: #f2f2f4; display: flex; flex-direction: column;
        align-items: center; justify-content: center; font: 300 46px/1.2 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: .01em; opacity: 0; pointer-events: none; }
      #rec-card small { font-size: 19px; color: #9a9ca4; margin-top: 14px; font-weight: 400; }
      #rec-card .k { font: 500 13px ui-monospace, monospace; letter-spacing: .2em; color: #c0101c; margin-bottom: 18px; }
      #rec-photo { background: #0d0e10 center/contain no-repeat; opacity: 0; pointer-events: none; }
      #rec-photo.half { right: 50%; }
      #rec-caption { position: fixed; left: 32px; bottom: 28px; z-index: 40; padding: 7px 12px;
        background: rgba(13,14,16,.78); color: #eee; font: 15px ui-sans-serif, system-ui, sans-serif;
        border-left: 3px solid #c0101c; opacity: 0; transition: opacity .3s; max-width: 70%; }
      #rec-log { position: fixed; right: 24px; bottom: 24px; z-index: 40; width: 470px;
        font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: #2b2d33;
        background: rgba(255,255,255,.72); padding: 8px 10px; border-radius: 4px; white-space: pre; }
      #rec-count { position: fixed; right: 24px; top: 20px; z-index: 40; font: 12px ui-monospace, monospace;
        color: #555; background: rgba(255,255,255,.7); padding: 3px 8px; border-radius: 3px; }
      #rec-split { position: fixed; left: 50%; top: 0; bottom: 0; width: 2px; background: #c0101c; z-index: 60; display: none; }
    `
    document.head.appendChild(css)
    for (const id of ['rec-card', 'rec-photo', 'rec-caption', 'rec-log', 'rec-count', 'rec-split']) {
        const d = document.createElement('div')
        d.id = id
        document.body.appendChild(d)
    }
    window.__refBase = refBase
    window.dispatchEvent(new Event('resize'))

    /** Tween the camera by sending one `camera` command a frame - the command itself cuts. */
    window.__tween = async (from, to, ms, ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) => {
        const t0 = performance.now()
        for (;;) {
            const k = Math.min(1, (performance.now() - t0) / ms)
            const e = ease(k)
            const lerp = (a, b) => a.map((v, i) => v + (b[i] - v) * e)
            await window.modelling.run({op: 'camera', position: lerp(from.position, to.position),
                target: lerp(from.target, to.target)})
            if (k >= 1) break
            await new Promise(r => requestAnimationFrame(r))
        }
    }
    /** Orbit round the current target by `deg` degrees about Y over `ms`, until stopped. */
    window.__drift = (deg, ms) => {
        const token = {stop: false}
        window.__driftToken = token
        ;(async () => {
            const cam = window.viewer.scene.mainCamera
            const p0 = cam.position.toArray(), t = cam.target.toArray()
            const dx = p0[0] - t[0], dz = p0[2] - t[2]
            const t0 = performance.now()
            while (!token.stop) {
                const k = Math.min(1, (performance.now() - t0) / ms)
                const a = deg * Math.PI / 180 * k
                await window.modelling.run({op: 'camera', position: [t[0] + dx * Math.cos(a) - dz * Math.sin(a), p0[1],
                    t[2] + dx * Math.sin(a) + dz * Math.cos(a)], target: t})
                if (k >= 1) break
                await new Promise(r => requestAnimationFrame(r))
            }
        })()
    }
    window.__stopDrift = () => { if (window.__driftToken) window.__driftToken.stop = true }
}, {refBase})

// Everything before this is the page loading - minutes, on a busy machine - and is cut from the film.
const stageReady = Date.now()

const ui = {
    card: (title, sub, kicker) => page.evaluate(([title, sub, kicker]) => {
        const c = document.getElementById('rec-card')
        c.innerHTML = `${kicker ? `<div class="k">${kicker}</div>` : ''}<div>${title}</div>${sub ? `<small>${sub}</small>` : ''}`
        c.style.opacity = 1
    }, [title, sub, kicker]),
    uncard: () => page.evaluate(() => { document.getElementById('rec-card').style.opacity = 0 }),
    photo: (file, half = false) => page.evaluate(([file, half]) => {
        const p = document.getElementById('rec-photo')
        p.style.backgroundImage = `url(${window.__refBase}${file})`
        p.classList.toggle('half', half)
        p.style.opacity = 1
    }, [file, half]),
    unphoto: () => page.evaluate(() => { document.getElementById('rec-photo').style.opacity = 0 }),
    caption: text => page.evaluate(text => {
        const c = document.getElementById('rec-caption')
        c.textContent = text
        c.style.opacity = text ? 1 : 0
    }, text),
    log: lines => page.evaluate(lines => { document.getElementById('rec-log').textContent = lines.join('\n') }, lines),
    count: n => page.evaluate(n => { document.getElementById('rec-count').textContent = `command ${n}` }, n),
}

// --- the session the build runs against -------------------------------------------------------

const READ_ONLY = new Set(['inspect', 'measure', 'help', 'history', 'selftest', 'capture', 'camera'])
let commands = 0
let failedCommands = 0
let beatName = null
const logLines = []

async function run(command) {
    if (command.op === 'export') return {ok: true, op: 'export', data: {skipped: 'not recorded'}}
    // Inside a continuous shot the director's camera holds; the build's still-framing moves are
    // for its PNG captures, not for the film.
    if (command.op === 'camera' && DIRECTION[beatName]?.continuous) {
        return {ok: true, op: 'camera', data: {skipped: 'continuous shot'}}
    }
    const result = await page.evaluate(c => window.modelling.run(c), command)
    commands++
    if (!READ_ONLY.has(command.op)) {
        await ui.count(commands)
        await sleep(pace)
    }
    if (!result.ok) {
        failedCommands++
        console.error(`  ✗ ${command.op}: ${result.error}`)
    }
    return result
}

async function capture(label, {view, fit, padding} = {}) {
    const d = DIRECTION[beatName] ?? {}
    if (label.startsWith('turntable')) return null
    if (!d.continuous && (view || fit)) {
        await run({op: 'camera', ...(view ? {view} : {}), ...(fit ? {fit} : {}), ...(padding ? {padding} : {})})
    }
    await ui.caption(label)
    await sleep(d.hold ?? 1300)
    return label
}

async function beat(name) {
    await page.evaluate(() => window.__stopDrift())
    beatName = name
    const d = DIRECTION[name] ?? {}
    console.log(`beat: ${name}`)
    if (name === 'references') {
        // Cold open on the product photograph.
        await ui.photo('hero-5d4-ef24-105.jpg')
        await ui.card('Canon EOS 5D Mark IV<br>+ EF 24-105mm f/4L IS USM',
            'modelled to scale, entirely through @threepipe/plugin-modelling JSON commands', 'THREEPIPE · MODELLING')
        await sleep(3500)
        await ui.uncard()
        await sleep(3000)
        await ui.unphoto()
    }
    if (d.title) {
        await ui.caption('')
        await ui.card(d.title, d.sub, 'STEP')
        await sleep(1700)
    }
    if (d.camera) {
        await run({op: 'camera', projection: 'perspective', fov: d.camera.fov ?? 30,
            position: d.camera.position, target: d.camera.target})
    }
    if (d.title) await ui.uncard()
    if (d.caption) await ui.caption(d.caption)
    if (d.drift) await page.evaluate(([deg, ms]) => window.__drift(deg, ms), [d.drift.deg, d.drift.ms])
}

let checksOk = 0, checksAll = 0
function log(...parts) {
    const line = parts.join(' ')
    if (/^\s*(ok|FAIL)\s/.test(line)) { checksAll++; if (/^\s*ok/.test(line)) checksOk++ }
    console.log(' ', line)
    logLines.push(line.trim())
    ui.log(logLines.slice(-7)).catch(() => {})
}

const build = (await import(pathToFileURL(join(here, 'build.mjs')).href)).default
const scratch = await mkdtemp(join(tmpdir(), 'camera-rec-'))
const started = Date.now()
await build({run, capture, beat, log, page, outDir: join(scratch, 'shots')})

// --- ending: turntable, then the split with the photograph --------------------------------------
await page.evaluate(() => window.__stopDrift())
await ui.caption('')
await ui.log([])
await run({op: 'camera', projection: 'perspective', fov: 24, position: [AX + 520 * Math.sin(0.5), 190, 70 + 520 * Math.cos(0.5)],
    target: [AX, 58, 70]})
await page.evaluate(([AX]) => window.__drift(360, 16000), [AX])
await sleep(16500)
// Split: the photograph left, the model right, from the photograph's viewpoint.
await page.evaluate(() => {
    const c = document.getElementById('canvas-container') ?? document.querySelector('#mcanvas')?.parentElement
    if (c) { c.style.position = 'fixed'; c.style.left = '50%'; c.style.top = '0'; c.style.width = '50%'; c.style.height = '100%' }
    document.getElementById('rec-split').style.display = 'block'
    window.dispatchEvent(new Event('resize'))
})
await ui.photo('hero-5d4-ef24-105.jpg', true)
await run({op: 'camera', projection: 'perspective', fov: 34, position: HERO, target: [8, 52, 80]})
await ui.caption('photograph · model')
await sleep(6000)
await ui.caption('')
const checksLine = `${checksOk}/${checksAll} dimension checks within 2 %`
await ui.card(`${commands} commands · ${failedCommands} failed · ${checksLine}`,
    'demos/camera — build.mjs, transcript.json, camera.glb', 'THREEPIPE · MODELLING')
await sleep(3500)

const wallSeconds = (Date.now() - stageReady) / 1000
const headSeconds = (stageReady - recordStart) / 1000
const video = page.video()
await context.close()
const tmpOut = out + '.raw.webm'
await video.saveAs(tmpOut)
await browser.close()
await rm(videoDir, {recursive: true, force: true})
await rm(scratch, {recursive: true, force: true})

// Re-encode when ffmpeg is available: Playwright's VP8 is large; VP9 at a fixed rate keeps it under
// 25 MB. A recording longer than --max-seconds (a slow software renderer) is time-lapsed to fit.
const speed = Math.max(1, wallSeconds / maxSeconds)
const filters = speed > 1 ? ['-vf', `setpts=PTS/${speed.toFixed(4)}`, '-r', '25'] : []
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', headSeconds.toFixed(2), '-i', tmpOut, ...filters, '-c:v', 'libvpx-vp9',
    '-b:v', '900k', '-deadline', 'good', '-cpu-used', '4', '-an', out])
if (ff.status === 0) await rm(tmpOut)
else await rename(tmpOut, out)
const size = (await stat(out)).size
console.log(`\n${out}: ${(size / 1e6).toFixed(1)} MB, ${commands} commands, ${wallSeconds.toFixed(0)} s recorded`
    + ` (${headSeconds.toFixed(0)} s of page load cut)`
    + (speed > 1 && ff.status === 0 ? `, time-lapsed ${speed.toFixed(2)}x to ${(wallSeconds / speed).toFixed(0)} s` : '')
    + (errors.length ? `, page errors: ${errors.slice(0, 3).join(' | ')}` : ''))
