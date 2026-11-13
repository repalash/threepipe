// Renders the thumbnail and the turntable video of each model in catalog.json with threepipe, on a browser with a real GPU.
//
//   aibox browser                                  on the Mac: the GPU browser (its URL is in ~/.aibox/host/browser.url)
//   npm run dev -- --host 0.0.0.0 --port 8805      here: serves examples/_render-model
//   npm run assets:render -- --out /tmp/models-out --page <dev server URL> --models <URL of --out, with CORS> [--only A,B] [--force]
//   (without a GPU: --browser launch --chromium <path> --video 0, for the stills only)
//
//   ffmpeg                                         here: encodes the frames
//
// Writes to the row's folder in <out>/p/samples/, and adds the URLs to catalog.json; rerun to continue:
//   thumb-512.webp, thumb-1024.webp
//   video-<size>-black.mp4, video-<size>-white.mp4, video-<size>-alpha.webm    a model with no background of its own
//   video-<size>-alpha.mov                                                     the same, for Safari, with --hevc-host
//   video-<size>.mp4                                                           a model with its own background
// `video_url` is video-512-black.mp4 or video-512.mp4; for the light version replace `-black` with `-white`. All are in
// `metadata.videos` and `metadata.thumbnails`. Frames come as PNG from a render with twice the pixels of the largest video.
// The driver uses one tab: closing a page restarts the server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {parseArgs} from 'node:util'
import sharp from 'sharp'

const {values: args} = parseArgs({options: {
    out: {type: 'string', default: 'tmp/models'},
    page: {type: 'string'},
    models: {type: 'string'},
    only: {type: 'string'},
    force: {type: 'boolean', default: false},
    size: {type: 'string', default: '512'},
    video: {type: 'string', default: '3'},
    'video-sizes': {type: 'string', default: '512'}, // `512,1024` is the long render
    'hevc-host': {type: 'string'}, // adds video-<size>-alpha.mov, for Safari: `local` on a Mac, or a Mac on the iJewel relay
    browser: {type: 'string', default: 'connect'}, // `launch`: a Chromium here (on a Mac, with Metal), `connect`: the aibox GPU browser
    // `launch` elsewhere: the Chromium at this path (e.g. /opt/pw-browsers/chromium in a cloud session), with SwiftShader on the
    // CPU: slow, so for the stills (`--video 0`) only
    chromium: {type: 'string'},
    ffmpeg: {type: 'string', default: 'ffmpeg'}, // one with libx264 and libvpx
    timeout: {type: 'string', default: '600'},
    pw: {type: 'string', default: '/tmp/pw'}, // Playwright of the server's version: npm i --prefix /tmp/pw playwright@<version>
}})
const FILES = 'https://files.threepipe.org'
const SAMPLES = 'https://samples.threepipe.org'
const FRAME_RATE = 24
const THUMBS = [512, 1024]
const {chromium} = createRequire(import.meta.url)(path.resolve(args.pw, 'node_modules/playwright'))

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

const ffmpeg = (...a) => execFileSync(args.ffmpeg, ['-v', 'error', '-y', ...a], {stdio: ['ignore', 'ignore', 'inherit']})
const FRAMES = ['-framerate', String(FRAME_RATE), '-start_number', '1', '-i']
// a keyframe every second and the index first: a browser can seek without the whole file
const MP4 = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryslow', '-g', String(FRAME_RATE), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']

/** The videos of one model, from its transparent frames: one encode per file. */
function encodeVideos(frames, dir, sizes, hasBackground) {
    const input = path.join(frames, 'frame_%05d.png')
    for (const s of sizes) {
        const scale = `scale=${s}:${s}:flags=lanczos`
        if (hasBackground) {
            ffmpeg(...FRAMES, input, '-vf', scale, ...MP4, path.join(dir, `video-${s}.mp4`))
            continue
        }
        for (const [name, color] of [['black', '000000'], ['white', 'ffffff']]) {
            ffmpeg(...FRAMES, input, '-filter_complex', `color=0x${color}:s=${s}x${s}:r=${FRAME_RATE}[b];[0]${scale}[f];[b][f]overlay=shortest=1`, ...MP4, path.join(dir, `video-${s}-${name}.mp4`))
        }
        ffmpeg(...FRAMES, input, '-vf', scale, '-pix_fmt', 'yuva420p', '-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', '-auto-alt-ref', '0', '-row-mt', '1', '-cpu-used', '1', '-g', String(FRAME_RATE), path.join(dir, `video-${s}-alpha.webm`))
    }
}

const ij = (...a) => execFileSync('ij', a, {encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe']})
const HEVC_DIR = '~/threepipe-hevc'

/** Runs a command on the Mac, also when the relay turns it into a background job. */
async function onMac(command, seconds = 280) {
    let out = ij('-t', String(seconds), '--wait', '25', command)
    const id = /job ([0-9a-f]{6,})/.exec(out)?.[1]
    while (id && /running/.test(out)) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        out = ij('job', id)
    }
    if (/exited [1-9]/.test(out)) throw new Error(`on the Mac: ${out.slice(-300)}`)
    return out
}

const localHevc = () => args['hevc-host'] === 'local'
const LOCAL_ENCODER = path.join(os.tmpdir(), 'encode-hevc-alpha')

/** The encoder on the Mac; it takes minutes to compile there, so once. */
async function prepareMac() {
    const source = path.join(import.meta.dirname, 'encode-hevc-alpha.swift')
    if (localHevc()) {
        if (!fs.existsSync(LOCAL_ENCODER) || fs.statSync(LOCAL_ENCODER).mtimeMs < fs.statSync(source).mtimeMs)
            execFileSync('swiftc', [source, '-o', LOCAL_ENCODER], {stdio: 'inherit'})
        return
    }
    ij('use', args['hevc-host'])
    await onMac(`mkdir -p ${HEVC_DIR}`)
    ijFile(['put', `${HEVC_DIR}/encode-hevc-alpha.swift`], source)
    await onMac(`cd ${HEVC_DIR} && { [ encode-hevc-alpha -nt encode-hevc-alpha.swift ] || swiftc encode-hevc-alpha.swift -o encode-hevc-alpha; }`, 600)
}

/** A verb that takes a file on stdin. */
function ijFile(verb, file) {
    const fd = fs.openSync(file, 'r')
    try {
        return execFileSync('ij', verb, {stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8'})
    } finally {
        fs.closeSync(fd)
    }
}

/** The alpha videos for Safari: the frames at each size go to the Mac, one model and size at a time, and the file comes back. */
async function encodeHevc(frames, dir, sizes) {
    for (const s of sizes) {
        const scaled = path.join(os.tmpdir(), `render-catalog-frames-${s}`)
        fs.rmSync(scaled, {recursive: true, force: true})
        fs.mkdirSync(scaled, {recursive: true})
        ffmpeg(...FRAMES, path.join(frames, 'frame_%05d.png'), '-vf', `scale=${s}:${s}:flags=lanczos`, '-start_number', '1', path.join(scaled, 'f%05d.png'))
        if (localHevc()) {
            execFileSync(LOCAL_ENCODER, [scaled, path.join(dir, `video-${s}-alpha.mov`), '0.7', '0.9'], {stdio: ['ignore', 'ignore', 'inherit']})
            // AVAssetWriter can leave its temporary copies (`.sb-…`) next to the file
            for (const f of fs.readdirSync(dir)) if (f.startsWith(`video-${s}-alpha.mov.sb-`)) fs.rmSync(path.join(dir, f))
            fs.rmSync(scaled, {recursive: true, force: true})
            continue
        }
        const tar = `${scaled}.tar`
        execFileSync('tar', ['cf', tar, '-C', scaled, '.'])
        // in parts: the relay refuses a large upload
        execFileSync('split', ['-b', '32m', tar, `${tar}.part-`])
        await onMac(`cd ${HEVC_DIR} && rm -rf frames frames.tar* out.mov* && mkdir frames`)
        const parts = fs.readdirSync(path.dirname(tar)).filter(f => f.startsWith(`${path.basename(tar)}.part-`)).sort()
        for (const part of parts) {
            ijFile(['put', `${HEVC_DIR}/frames.tar.${part.split('.part-')[1]}`], path.join(path.dirname(tar), part))
            fs.rmSync(path.join(path.dirname(tar), part))
        }
        await onMac(`cd ${HEVC_DIR} && cat frames.tar.* | tar xf - -C frames && ./encode-hevc-alpha frames out.mov 0.7 0.9 && rm -rf frames frames.tar.*`)
        const out = path.join(dir, `video-${s}-alpha.mov`)
        const fd = fs.openSync(out, 'w')
        try {
            execFileSync('ij', ['get', `${HEVC_DIR}/out.mov`], {stdio: ['ignore', fd, 'pipe']})
        } finally {
            fs.closeSync(fd)
        }
        fs.rmSync(scaled, {recursive: true, force: true})
        fs.rmSync(tar)
    }
}

const DONE = '.rendered'
const CODECS = {mp4: 'h264', webm: 'vp9', mov: 'hevc'}

/** The URLs of a row from the files in its folder, so a rebuilt catalog.json keeps what is rendered. */
function setUrls(row, dir) {
    const url = name => `${FILES}/${row.previews}/${name}`
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    const videos = names.flatMap(name => {
        const m = /^video-(\d+)(?:-(black|white|alpha))?\.(mp4|webm|mov)$/.exec(name)
        if (!m) return []
        const width = parseInt(m[1])
        return [{url: url(name), width, height: width, size: fs.statSync(path.join(dir, name)).size, codec: CODECS[m[3]], alpha: m[2] === 'alpha', ...['black', 'white'].includes(m[2]) ? {background: m[2]} : {}}]
    })
    const thumbnails = names.flatMap(name => {
        const m = /^thumb-(\d+)\.webp$/.exec(name)
        return m ? [{url: url(name), width: parseInt(m[1]), height: parseInt(m[1]), size: fs.statSync(path.join(dir, name)).size}] : []
    })
    const metadata = JSON.parse(row.metadata ?? '{}')
    if (videos.length) metadata.videos = videos
    if (thumbnails.length) metadata.thumbnails = thumbnails
    row.metadata = JSON.stringify(metadata)
    const named = list => list.find(n => names.includes(n))
    // thumb.webp and preview.mp4: an older render, until this model is rendered again
    const thumb = named(['thumb-512.webp', 'thumb.webp']), video = named(['video-512-black.mp4', 'video-512.mp4', 'preview.mp4'])
    row.thumb_url = thumb ? url(thumb) : null
    row.video_url = video ? url(video) : null
    // every file of the last render is there: it wrote the marker last (a dotfile: cloud:upload leaves it out)
    return names.includes(DONE)
}

const catalogPath = path.join(args.out, 'catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const only = args.only?.split(',')
const decode = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
const failed = []
let rendererChecked = false
const sizes = args['video-sizes'].split(',').map(Number)
const frames = path.join(os.tmpdir(), 'render-catalog-frames')
let done = 0
const size = parseInt(args.size)
// One tab for all models: closing a page restarts the server, so it stays open and goes to the next model.
if (args['hevc-host']) await prepareMac()
const browser = args.browser !== 'launch' ? await connect() :
    // Metal: without it Chromium on a Mac renders with SwiftShader, on the CPU
    process.platform === 'darwin' ? await chromium.launch({channel: 'chromium', args: ['--use-angle=metal']}) :
        await chromium.launch({executablePath: args.chromium, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
const context = await browser.newContext({viewport: {width: size, height: size}})
const page = await context.newPage()
let current = ''
await page.exposeFunction('__frame', (name, data) => fs.promises.writeFile(path.join(frames, name), decode(data)))
page.on('pageerror', e => console.log(`  ${current}: page error: ${String(e.message).slice(0, 200)}`))
page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  ${current}: ${m.type()}: ${m.text().slice(0, 200)}`)
})
for (const row of catalog.rows) {
    if (row.kind !== 'model') continue
    const dir = path.join(args.out, row.previews)
    const rendered = setUrls(row, dir) // for every row: a new catalog.json keeps what is rendered
    if (only && !only.includes(row.name)) continue
    if (!args.force && rendered) continue
    fs.mkdirSync(dir, {recursive: true})
    fs.rmSync(path.join(dir, DONE), {force: true})
    current = row.name
    const start = Date.now()
    try {
        // a file already in the bucket, or one in the folder to upload
        const {views, animations, play} = JSON.parse(row.metadata ?? '{}')
        const view = views?.[0]
        const clips = play?.length ? `&play=${encodeURIComponent(JSON.stringify(play))}&playSeconds=${Math.max(...animations.filter(a => play.includes(a.name)).map(a => a.seconds))}` : ''
        // the render has twice the pixels of the largest video, and 2048 px for the stills
        const stillScale = 2 * Math.max(...THUMBS) / size, videoScale = 2 * Math.max(...sizes) / size
        fs.rmSync(frames, {recursive: true, force: true})
        fs.mkdirSync(frames, {recursive: true})
        // the uploaded file, or the one in --out (served with CORS) before an upload
        const model = row.linked || !args.models ? row.url : `${args.models}/samples/${row.url.slice(SAMPLES.length + 1)}`
        await page.goto(`${args.page}/examples/_render-model/?m=${encodeURIComponent(model)}&size=${size}&video=${args.video}&stillScale=${stillScale}&videoScale=${videoScale}${view ? `&view=${encodeURIComponent(JSON.stringify(view))}` : ''}${clips}`, {timeout: 120_000})
        // a timeout of our own: older Playwright versions take no options here
        const result = await Promise.race([page.evaluate(() => window.__render), new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`no result in ${args.timeout} s`)), parseInt(args.timeout) * 1000))])
        if (result.error) throw new Error(result.error)
        const still = decode(result.still)
        for (const t of THUMBS) await sharp(still).resize(t, t, {kernel: 'lanczos3'}).webp({quality: 85, alphaQuality: 100}).toFile(path.join(dir, `thumb-${t}.webp`))
        const renderedAt = Date.now()
        if (result.frames) encodeVideos(frames, dir, sizes, result.hasBackground)
        if (result.frames && !result.hasBackground && args['hevc-host']) await encodeHevc(frames, dir, sizes)
        if (!rendererChecked) {
            rendererChecked = true
            console.log(`  WebGL: ${result.renderer}`)
        }
        fs.rmSync(frames, {recursive: true, force: true})
        fs.writeFileSync(path.join(dir, DONE), JSON.stringify({sizes, hevc: !!args['hevc-host'], at: new Date().toISOString()}))
        setUrls(row, dir)
        console.log(`${row.name}: render ${((renderedAt - start) / 1000).toFixed(1)} s, encode ${((Date.now() - renderedAt) / 1000).toFixed(1)} s, ${result.frames} frames${result.hasBackground ? ', own background' : ''}${result.hasView ? ', a set view' : ''}`)
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
process.exit(failed.length ? 1 : 0) // a launched browser can keep Node running after close
