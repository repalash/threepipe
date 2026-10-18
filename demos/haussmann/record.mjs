/**
 * Record the Haussmann video: run `build.mjs` live in the modelling page, with the camera moves,
 * title cards and reference images of `direction.md`, and cut the recording to the storyboard.
 *
 *     node demos/haussmann/record.mjs                        # local Chromium (SwiftShader)
 *     node demos/haussmann/record.mjs --ws ws://host:port/…  # a remote browser, e.g. a GPU one on a Mac
 *
 * Options:
 *   --url   page with the modelling plugin (default http://127.0.0.1:9371/examples/modelling-api/index.html;
 *           a remote browser needs a URL it can reach, e.g. http://9371.threepipe.aibox.localhost/…)
 *   --out   finished video (default demos/haussmann/video.webm)
 *   --size  1280x720 (default) or 1920x1080
 *   --raw   keep the unedited recording beside the output
 *
 * How the cut works. The page is recorded in real time from start to finish. Every storyboard shot
 * (a title card, a camera move, a hold on a capture) is wrapped in `shot()`, which notes when it
 * started and ended. Everything between shots is the model being built - commands running - and is
 * time-lapsed to at most `LAPSE` seconds, so a slow machine and a fast one give the same film. The
 * shots themselves are kept at real speed. ffmpeg does the cut from those timestamps.
 */

import {chromium} from 'playwright'
import {spawnSync} from 'node:child_process'
import {mkdir, rm, writeFile, stat} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import build, {DATA} from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (k, d) => {
    const i = args.indexOf(`--${k}`)
    return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true)
}
const ws = flag('ws', null)
const url = flag('url', 'http://127.0.0.1:9371/examples/modelling-api/index.html')
const out = resolve(flag('out', join(here, 'video.webm')))
const [W, H] = String(flag('size', '1280x720')).split('x').map(Number)
const LAPSE = 1.6 // seconds a stretch of building may take on screen
const work = join(here, '..', '..', 'tmp', 'haussmann-video')

await rm(work, {recursive: true, force: true})
await mkdir(work, {recursive: true})

const browser = ws
    ? await chromium.connect(ws)
    : await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
        '--hide-scrollbars']})
const context = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 1,
    recordVideo: {dir: work, size: {width: W, height: H}}})
const page = await context.newPage()
const t0 = Date.now()
const now = () => (Date.now() - t0) / 1000
page.on('pageerror', e => console.error('page error:', e.message.slice(0, 200)))

console.log(`recording ${url} at ${W}x${H}${ws ? ` on ${ws}` : ''}`)
await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000})
await page.waitForFunction(() => !!window.modelling, undefined, {timeout: 180000})

// The film is of the model, not the tool: hide the panels, give the viewport the page, add the overlay.
await page.evaluate(({W, H}) => {
    for (const sel of ['#console', '#side', '#tweakpaneUiContainer', '.code-preview', '#example-code-preview',
        '#example-code-btn']) document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
    document.body.style.gridTemplateColumns = '1fr'
    document.body.style.gridTemplateRows = '1fr'
    document.body.style.gridTemplateAreas = '"view"'
    const css = document.createElement('style')
    css.textContent = `
        #hm-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 1000;
            font: 500 ${Math.round(H / 32)}px/1.25 Georgia, 'Times New Roman', serif; color: #fff; }
        #hm-card { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end;
            padding: 6% 7%; background: #000 center/cover no-repeat; opacity: 0; transition: opacity 0.8s; }
        #hm-card.on { opacity: 1; }
        #hm-card.contain { background-size: contain; background-color: #f4efe6; }
        #hm-card h1 { margin: 0; font-size: 2.1em; font-weight: 400; text-shadow: 0 2px 18px #000a; }
        #hm-card p { margin: .3em 0 0; font-size: .9em; text-shadow: 0 2px 12px #000c; }
        #hm-card.contain h1, #hm-card.contain p { color: #241d16; text-shadow: none; }
        #hm-caption { position: absolute; left: 4%; bottom: 5%; max-width: 70%; padding: .45em .8em;
            background: #0b0d10c0; border-left: 3px solid #c9a36b; font-size: .75em; opacity: 0; transition: opacity .5s; }
        #hm-caption.on { opacity: 1; }
        #hm-caption small { display: block; color: #c9c2b4; font: 400 .72em/1.4 ui-monospace, Menlo, monospace; margin-top: .2em; }
        #hm-side { position: absolute; top: 0; bottom: 0; left: 0; width: 50%; background: #f4efe6 center/contain no-repeat;
            opacity: 0; transition: opacity .6s; border-right: 2px solid #c9a36b; }
        #hm-side.on { opacity: 1; }
        #hm-table { position: absolute; right: 4%; top: 7%; width: 44%; background: #0b0d10d8; padding: .8em 1em;
            font: 400 ${Math.round(H / 56)}px/1.45 ui-monospace, Menlo, monospace; opacity: 0; transition: opacity .6s; }
        #hm-table.on { opacity: 1; }
        #hm-table b { color: #c9a36b; font-weight: 500; }
    `
    document.head.appendChild(css)
    const o = document.createElement('div')
    o.id = 'hm-overlay'
    o.innerHTML = '<div id="hm-side"></div><div id="hm-card"></div><div id="hm-caption"></div><div id="hm-table"></div>'
    document.body.appendChild(o)
    window.dispatchEvent(new Event('resize'))
}, {W, H})

// --- overlay helpers ----------------------------------------------------------------------------

const REF = '/demos/haussmann/refs/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const card = (html, image, {contain = false} = {}) => page.evaluate(({html, image, contain}) => {
    const c = document.getElementById('hm-card')
    c.innerHTML = html ?? ''
    c.classList.toggle('contain', contain)
    if (image) c.style.backgroundImage = `url("${image}")`
    c.classList.toggle('on', html !== null)
}, {html, image, contain})
const caption = (text, small = '') => page.evaluate(({text, small}) => {
    const c = document.getElementById('hm-caption')
    c.innerHTML = text ? `${text}${small ? `<small>${small}</small>` : ''}` : ''
    c.classList.toggle('on', !!text)
}, {text, small})
const side = image => page.evaluate(image => {
    const s = document.getElementById('hm-side')
    if (image) s.style.backgroundImage = `url("${image}")`
    s.classList.toggle('on', !!image)
    const v = document.getElementById('canvas-container') ?? document.querySelector('canvas')?.parentElement
    if (v) {
        v.style.position = image ? 'fixed' : ''
        v.style.left = image ? '50%' : ''
        v.style.top = image ? '0' : ''
        v.style.width = image ? '50%' : ''
        v.style.height = image ? '100%' : ''
    }
    window.dispatchEvent(new Event('resize'))
}, image)
const table = html => page.evaluate(html => {
    const t = document.getElementById('hm-table')
    t.innerHTML = html ?? ''
    t.classList.toggle('on', !!html)
}, html)

// --- the session the build runs against -------------------------------------------------------

let commands = 0
const send = command => (commands++, page.evaluate(c => window.modelling.run(c), command))
/**
 * An eased camera move. `camera {duration}` only animates saved views
 * (issues/open/modelling-tools/command-camera-duration-saved-views-only.md), so the move is tweened in
 * the page and the command is sent at the end to settle the camera (near/far, controls).
 */
async function tween(position, target, duration) {
    await page.evaluate(async ({position, target, duration}) => {
        const cam = window.viewer.scene.mainCamera
        const p0 = cam.position.clone(), t0 = cam.target.clone()
        const p1 = p0.clone().set(...position), t1 = t0.clone().set(...target)
        const start = performance.now()
        await new Promise(resolve => {
            const step = () => {
                const k = Math.min(1, (performance.now() - start) / duration)
                const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
                cam.position.lerpVectors(p0, p1, e)
                cam.target.lerpVectors(t0, t1, e)
                cam.lookAt(cam.target)
                cam.setDirty?.()
                if (k < 1) requestAnimationFrame(step)
                else resolve()
            }
            requestAnimationFrame(step)
        })
    }, {position, target, duration})
}
const run = async command => {
    if (command.op === 'camera' && command.duration > 0 && command.position && command.target) {
        const {duration, position, target, ...rest} = command
        if (Object.keys(rest).length > 1) await send({...rest}) // projection, fov
        await tween(position, target, duration)
        return send({op: 'camera', position, target})
    }
    return send(command)
}
const cam = (position, target, duration = 2000, extra = {}) =>
    run({op: 'camera', position, target, duration, ...extra})

/** A storyboard shot: kept at real speed in the cut. */
const shots = []
async function shot(name, fn) {
    const start = now()
    await fn()
    shots.push({name, start, end: now()})
    console.log(`  shot ${name.padEnd(28)} ${start.toFixed(1)}-${now().toFixed(1)} s`)
}

const {SEB_LENGTH: X, DEPTH: Z, L} = DATA
const centre = [X / 2 - 1.5, 10, -Z / 2]
/** A point on a circle round the building, `deg` from the boulevard axis (+z), at height `y`. */
const around = (deg, r, y) => [centre[0] + r * Math.sin(deg * Math.PI / 180), y, centre[2] + r * Math.cos(deg * Math.PI / 180)]

async function orbit(from, to, r, y, target, seconds, steps = 6) {
    for (let i = 1; i <= steps; i++) {
        const a = from + (to - from) * i / steps
        await cam(around(a, r, y), target, seconds * 1000 / steps)
    }
}

/** The build's captures become shots: the caption is the capture's label. */
const NOTES = {
    'the 1870 elevation, registered': 'reference {calibrate} - 72.8 px/m, pavement at y = 0',
    'the plan, registered': 'reference {plane: top} - the plot: boulevard, rue Greneta, rue Palestro',
    'blockout: the plan pushed up to the first floor': 'circle → vertices (48 plan points) → extrude',
    'one extrude per storey line: every bay is a quad': '12 extrudes, one per storey line of the elevation',
    'windows framed, recessed and glazed': 'inset (individual) → extrude per front → inset → separate',
    'cornice and string courses pushed out of the wall': 'inset {region, depth: 0.55} → bevel the soffit',
    'mansard: a 45° brisis and a shallow terrasson, by inset': 'inset {thickness: 2.65, depth: 2.65} = 45°',
    '2nd-floor balcony: outset, bisected, solidified, railing on a curve array':
        'inset −0.5 → bisect → solidify → bevel; railing: array {path, live}',
    'balconettes and window guards: one master, placed on every bay': 'duplicate × 21 bays → join',
    'dormer master': 'cube → inset → extrude → separate the pane',
    'dormers on live arrays': 'array {step, live: true} - edit one dormer, all follow',
    'the street': 'pavement: the outline outset 4 m; neighbour to the same 20 m cornice',
}
async function capture(label, {view, fit} = {}) {
    await shot(label, async () => {
        await caption(label, NOTES[label] ?? '')
        if (view || fit) await run({op: 'camera', ...(view ? {view} : {}), ...(fit ? {fit} : {}), duration: 1800})
        await sleep(2600)
    })
}

/** Extra camera work at the build's milestones (see direction.md, scenes 3-9). */
async function beat(name, report) {
    if (name === 'walls') {
        await shot('walls orbit', async () => {
            await caption('Walls: the plan outline, extruded storey by storey', '48 vertices - one per corner and window jamb')
            await orbit(35, 125, 46, 18, centre, 7)
        })
    } else if (name === 'openings') {
        await shot('openings close-up', async () => {
            await caption('105 windows, 17 shop fronts, 2 doors', 'every opening is the same three commands')
            await cam([6, 6, 15], [6, 7, 0], 2200)
            await cam([11, 9, 9], [6, 9, 0], 4000)
        })
    } else if (name === 'cornices') {
        await shot('cornice at the cut corner', async () => {
            await caption('The cornice turns both cut corners: one region inset, mitred')
            await cam([-9, 18.5, 7], [-0.9, 19.3, -0.8], 2200)
            await cam([-5, 21, 9], [-0.9, 19.3, -0.8], 3500)
        })
    } else if (name === 'roof') {
        await shot('roof pitch side view', async () => {
            await caption('The brisis at 45°: the 1859 decree, drawn', `cornice ${L.eave.toFixed(2)} m, brisis top ${L.brisisTop.toFixed(2)} m`)
            await cam([X + 26, 21, -2.6], [X - 2, 20.6, -2.6], 2500, {fov: 30})
            await sleep(2500)
            await cam(around(40, 48, 26), centre, 2500, {fov: 40})
        })
    } else if (name === 'balconies') {
        await shot('balconies orbit', async () => {
            await caption('Balconies on the 2nd, 4th and 5th floors', 'one 30 cm cast-iron module, arrayed live along the outline')
            await cam([-12, 9, 9], [-1.5, 8, -1.2], 2500)
            await orbit(-60, -20, 16, 10, [-1.5, 9, -1.5], 5, 4)
        })
    } else if (name === 'dormers') {
        await shot('roofline', async () => {
            await caption('19 dormers: two live arrays and eight singles', 'the rue Palestro bays are irregular, so they are placed one by one')
            await cam([4, 27, 14], [5, 21, -2], 2500)
            await cam([-12, 27, 2], [-3, 21, -8], 4000)
        })
    } else if (name === 'chimneys') {
        await shot('chimneys', async () => {
            await caption('Chimney stacks where the elevation draws them; lathed pots on a live array')
            await cam([X + 8, 27, 4], [X - 1, 23, -6], 3000)
        })
    } else if (name === 'street') {
        await shot('street hero', async () => {
            await caption(null)
            await cam([-16, 1.7, 26], [3, 12, -6], 3000, {fov: 45})
            await sleep(2500)
        })
    } else if (name === 'checks' && report) {
        await shot('checks card', async () => {
            const rows = report.checks.slice(0, 14).map(c =>
                `${c.ok ? '✓' : '✗'} ${c.what.padEnd(46).slice(0, 46)} <b>${c.got.toFixed(2)}</b> / ${c.want.toFixed(2)}`)
            await table(`<b>Measured from the model / read off the 1870 drawings</b><br>${rows.join('<br>')}`)
            await sleep(7000)
            await table(null)
        })
    }
}

// --- the film -----------------------------------------------------------------------------------

await shot('title over photo', async () => {
    await card('<h1>Haussmann, by command</h1><p>A Paris apartment block, modelled to scale through the threepipe modelling API</p>',
        REF + 'photo-rue-monge-corner-thbz.jpg')
    await sleep(6000)
})
await shot('elevation plate', async () => {
    await card('<h1>N° 77 boulevard de Sébastopol</h1><p>Paul Mesnard, architect. César Daly, <i>L\'architecture privée</i>, 1870 - elevation at 1:100</p>',
        REF + 'daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg', {contain: true})
    await sleep(6000)
    await card(null)
    await sleep(800)
})

const session = {run, log: (...a) => console.log(' ', ...a), page, capture, beat, present: false, cameraDuration: 1800}
await build(session)
const report = session.report

await shot('turntable', async () => {
    await caption(null)
    await run({op: 'camera', view: 'iso', fit: '*', duration: 1500})
    await orbit(20, 380, 52, 24, [centre[0], 9, centre[2]], 22, 18)
})
await shot('wireframe', async () => {
    await caption('Wireframe: quads where Blender would keep them', `${report.totals.faces} faces in the editable masters`)
    await run({op: 'display', mode: 'wireframe'})
    await orbit(20, 60, 40, 16, centre, 5, 3)
    await run({op: 'display', mode: 'material'})
})
await shot('x-ray', async () => {
    await caption('X-ray: the shell, the recesses, the roof structure')
    await run({op: 'material', object: '*', opacity: 0.28})
    await orbit(60, 100, 40, 16, centre, 5, 3)
    await run({op: 'material', object: '*', opacity: 1})
})
await shot('over the elevation', async () => {
    await caption('Registered on the 1870 elevation', 'orthographic, wireframe over the drawing')
    await run({op: 'reference', name: 'elevation', plane: 'front', visible: true})
    await run({op: 'camera', projection: 'orthographic', view: 'ref:elevation'})
    await run({op: 'display', mode: 'wireframe'})
    await sleep(4500)
    await run({op: 'display', mode: 'material'})
})
await shot('split with the reference', async () => {
    await caption(null)
    await run({op: 'camera', projection: 'perspective', fov: 40})
    await side(REF + 'photo-rue-monge-corner-thbz.jpg')
    await cam([-17, 4, 20], [3, 11, -6], 1500)
    await sleep(4000)
    await side(REF + 'daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg')
    await run({op: 'camera', projection: 'orthographic', view: 'front', fit: 'facade', padding: 1.05})
    await sleep(4500)
    await side(null)
})
await shot('end card', async () => {
    const passed = report.checks.filter(c => c.ok).length
    await card(`<h1>77 bd de Sébastopol</h1><p>${passed}/${report.checks.length} dimension checks within 2 % of the drawings · `
        + `${report.objects} objects · ${commands} modelling commands</p>`,
        REF + 'photo-typical-paris-corner-7e-flyer84.jpg')
    await sleep(4500)
})

const video = page.video()
await context.close()
const raw = join(work, 'raw.webm')
await video.saveAs(raw)
await browser.close()
await writeFile(join(work, 'shots.json'), JSON.stringify(shots, null, 2))

// --- the cut ------------------------------------------------------------------------------------
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw])
const total = parseFloat(String(probe.stdout))
const segments = []
let cursor = 0
for (const s of shots) {
    if (s.start > cursor + 0.05) {
        const len = s.start - cursor
        segments.push({start: cursor, end: s.start, speed: Math.max(1, len / LAPSE)})
    }
    segments.push({start: s.start, end: Math.min(s.end, total), speed: 1})
    cursor = s.end
}
const filters = segments.map((s, i) =>
    `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=(PTS-STARTPTS)/${s.speed.toFixed(4)}[v${i}]`)
const concat = `${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0,fps=25[out]`
await mkdir(dirname(out), {recursive: true})
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex', [...filters, concat].join(';'),
    '-map', '[out]', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', out],
{stdio: 'inherit'})
if (ff.status !== 0) throw new Error('ffmpeg failed')
const edited = parseFloat(String(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).stdout))
console.log(`raw ${total.toFixed(1)} s -> ${out}: ${edited.toFixed(1)} s, ${((await stat(out)).size / 1e6).toFixed(1)} MB`)
if (flag('raw', false)) console.log(`raw recording kept at ${raw}`)
else await rm(raw)
