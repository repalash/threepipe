/**
 * The camera demo's film: the build story of the Canon EOS 5D Mark IV, every command arriving in the modelling
 * example page on the GPU, directed per direction.md. Frame-exact (demos/shared/film.mjs), H.264 with faststart.
 *
 *     node demos/camera/build.mjs --out tmp/demo/camera          # the command list
 *     node demos/camera/record.mjs [--out tmp/demo/camera/film] [--views]
 *
 * On the GPU VM: `tpvm run 'node demos/camera/build.mjs && node demos/camera/record.mjs'`, then pull
 * tmp/demo/camera/film/{video.mp4,film.json,transcript.json,stills/*}. `--views` renders only the storyboard's camera
 * positions on the finished model (framing check, no video).
 *
 * Photographs (Wikimedia Commons, CC BY-SA, credited on screen and in the report) are read from demos/camera/refs/,
 * which is not committed - SOURCES.md lists them. The reference GLB is never loaded.
 */
import {readFileSync} from 'node:fs'
import {openFilm} from '../shared/film.mjs'

const args = process.argv.slice(2)
const flag = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d
const out = flag('out', 'tmp/demo/camera/film')
const viewsOnly = args.includes('--views')
const cmds = JSON.parse(readFileSync(flag('commands', 'tmp/demo/camera/camera-dress.json'), 'utf8'))

// ------------------------------------------------------------------------------------------- storyboard views (mm)
const LENS = [15.5, 48]
const V = {
    lens: {position: [LENS[0] + 250, LENS[1] + 120, 330], target: [LENS[0], LENS[1], 125], fov: 30},
    front: {position: [210, 150, 470], target: [5, 55, 50], fov: 30},
    frontOrtho: {position: [5, 58, 700], target: [5, 58, 0], fov: 18},
    rear: {position: [-230, 190, -380], target: [0, 55, 30], fov: 30},
    grip: {position: [-360, 150, 300], target: [-40, 55, 45], fov: 30},
    top: {position: [90, 430, 210], target: [0, 75, 40], fov: 28},
    ports: {position: [340, 120, 110], target: [70, 45, 30], fov: 28},
    rearClose: {position: [-120, 120, -230], target: [-15, 55, 10], fov: 30},
    lensFront: {position: [120, 110, 420], target: [LENS[0], LENS[1], 160], fov: 26},
    hero: {position: [228.2, 329.0, 552.1], target: [8, 52, 80], fov: 26},
}

// ------------------------------------------------------------------------------------------- chapters by content
const idx = pred => cmds.findIndex(pred)
const at = {
    body: idx(c => c.op === 'primitive' && c.name === 'body'),
    bodySubsurf: idx(c => c.op === 'modifier' && c.object === 'body' && c.add?.type === 'subsurf'),
    gripCage: idx(c => c.op === 'primitive' && c.name === 'grip'),
    gripSubsurf: idx(c => c.op === 'modifier' && c.object === 'grip' && c.add?.type === 'subsurf'),
    prismCage: idx(c => c.op === 'primitive' && c.name === 'body-prism'),
    prismSubsurf: idx(c => c.op === 'modifier' && c.object === 'body-prism' && c.add?.type === 'subsurf'),
    shoe: idx(c => c.op === 'primitive' && c.name === 'shoe'),
    parts: idx(c => c.op === 'part'),
    grooves: idx(c => c.op === 'groove'),
    shade: idx(c => c.op === 'shade'),
    uv: idx(c => c.op === 'uv'),
    decals: idx(c => c.op === 'decal'),
}
for (const [k, v] of Object.entries(at)) if (v < 0) throw new Error(`storyboard: no "${k}" command in the list`)
const frontLensParts = new Set(['lens-focus-ring', 'lens-zoom-ring'])
const quiet = new Set(['inspect', 'measure', 'validate'])
const framesFor = c => quiet.has(c.op) ? 0
    // the first demo's x-ray flash (opacity 0.28 then 1) is in the list; it shows nothing in the film
    : c.op === 'material' && c.opacity !== undefined ? 0
        : c.op === 'part' || c.op === 'decal' || c.op === 'groove' || c.op === 'boolean' ? 5 : 3

const film = await openFilm({out, accent: '#c0101c', background: '#e4e5e8'})
await film.stage({op: 'lighting', environmentIntensity: 1.1})
await film.stage({op: 'light', name: 'key', type: 'directional', position: [-260, 420, 520], target: [5, 50, 50], intensity: 2.2})
await film.stage({op: 'light', name: 'rim', type: 'directional', position: [380, 260, -420], target: [5, 50, 50], intensity: 1.4})

let i = 0
/** Run the list up to (not including) `end`, a few frames per edit; read-only checks show in the ticker only. */
async function runTo(end, extra = {}) {
    for (; i < end; i++) {
        const c = cmds[i]
        await film.run(c, {frames: extra.frames ?? framesFor(c)})
    }
}

if (viewsOnly) {
    film.ticker(false)
    await runTo(cmds.length, {frames: 0})
    for (const [name, v] of Object.entries(V)) {
        await film.stage({op: 'camera', projection: 'perspective'})
        await film.camera(v)
        await film.still(`view-${name}`)
    }
    await film.clay(true)
    await film.camera(V.hero)
    await film.still('view-hero-clay')
    await film.abort()
    process.exit(0)
}

const credit = 'Photo: CEphoto, Uwe Aranas, CC BY-SA 3.0, Wikimedia Commons'
const heroCredit = 'Photo: 根川孝太郎, CC BY-SA 4.0, Wikimedia Commons'

// ------------------------------------------------------------------------------------------- 0 cold open
film.chapter('Open')
film.ticker(false)
await film.layer(`<div style="position:absolute;inset:0;background:#0d0e10 url(/demos/camera/refs/hero-5d4-ef24-105.jpg) center/contain no-repeat"></div>
  <div style="position:absolute;right:16px;bottom:12px;font:14px system-ui;color:#9a9ca4">${heroCredit}</div>`, 1)
await film.hold(1.2)
await film.title('Canon EOS 5D Mark IV + EF 24-105mm f/4L', 'From published measurements to a dressed product model - 220 JSON commands, threepipe modelling', {kicker: 'threepipe · modelling', sec: 2.4})
await film.hold(0.6)

// ------------------------------------------------------------------------------------------- 1 measure
film.chapter('1 Measure')
const mm = 0.11008, ax = 914.5, ay = 1151, X = x => ax + (x - 0.375) / mm, Y = y => ay - y / mm
const lbl = (x, y, t, anchor = 'middle') => `<text x="${x}" y="${y}" fill="#fff" font-size="34" font-family="ui-monospace,Menlo,monospace" font-weight="600" text-anchor="${anchor}" paint-order="stroke" stroke="#0d0e10" stroke-width="7">${t}</text>`
const measure = stage => `<svg viewBox="0 0 1920 1298" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;width:100%;height:100%;background:#0d0e10">
  <image href="/demos/camera/refs/body-mount.jpg" width="1920" height="1298"/>
  <g stroke="#e0202c" stroke-width="5" fill="none">
   ${stage >= 1 ? `<path d="M${X(-75.35)} ${Y(-6)} V${Y(-14)} M${X(75.35)} ${Y(-6)} V${Y(-14)} M${X(-75.35)} ${Y(-10)} H${X(75.35)}"/>` : ''}
   ${stage >= 2 ? `<path d="M${X(84)} ${Y(0)} H${X(92)} M${X(84)} ${Y(116.4)} H${X(92)} M${X(88)} ${Y(0)} V${Y(116.4)}"/>` : ''}
   ${stage >= 3 ? `<circle cx="${X(LENS[0])}" cy="${Y(LENS[1])}" r="${27 / mm}"/>` : ''}
   ${stage >= 4 ? `<path d="M${X(16.4 - 12.05)} ${Y(121)} V${Y(125)} H${X(16.4 + 12.05)} V${Y(121)}"/>` : ''}
  </g>
  ${stage >= 1 ? lbl(X(0), Y(-10) - 16, '150.7 mm  Canon spec') : ''}
  ${stage >= 2 ? lbl(X(94), Y(58), '116.4 mm', 'start') : ''}
  ${stage >= 3 ? lbl(X(LENS[0]), Y(LENS[1]) + 12, 'EF throat 54 mm') : ''}
  ${stage >= 4 ? lbl(X(16.4) + 150, Y(118) + 10, 'shoe 24.1 mm · ISO 518', 'start') : ''}
</svg><div style="position:absolute;right:16px;bottom:12px;font:14px system-ui;color:#9a9ca4">${credit}</div>`
await film.layer(measure(0))
await film.step('1 / 8  Measure')
await film.caption('Measure first: published dimensions, standard interfaces, and a level front photograph at 0.110 mm/px')
await film.hold(1.2)
for (let s = 1; s <= 4; s++) { await film.layer(measure(s)); await film.hold(1.1) }
await film.panel(['measurement set', ['body (Canon)', '150.7 × 116.4 × 75.9'], ['EF mount', '54 mm · flange 44'], ['hot shoe', 'ISO 518'], ['front photo', '0.110 mm/px'], ['photos', '3 · CC BY-SA']])
await film.hold(1.6)
await film.panel(null)

// ------------------------------------------------------------------------------------------- 2 block out
film.chapter('2 Block out cages')
await film.camera(V.lens)
await film.clay(true)
await film.layerOpacity(0, 0.5)
await film.step('2 / 8  Block out')
await film.caption('Lens: lathed profiles read off the side photograph, scaled to 83.5 × 107 mm')
film.ticker(true)
await film.move({deg: 28, steps: 120})
await runTo(at.body)
await film.stopMove()
await film.glide(V.front, 1.2)
await film.caption('Body: a 64-point cage solved so its subdivision limit lands on the measured front outline')
await runTo(at.bodySubsurf, {frames: 6})
await film.cage('body')
await film.hold(0.5)
await film.glide(V.frontOrtho, 1.4)
await film.caption('The cage, front view: outline from the photograph, support loops 4 mm in, grid-filled quad caps')
await film.hold(1.6)
await film.still('02-cage')

// ------------------------------------------------------------------------------------------- 3 subdivision
film.chapter('3 Subdivision')
await film.step('3 / 8  Subdivision')
await film.caption('subsurf, level 2: Catmull-Clark limit surface (OpenSubdiv rules), the red cage still drawn')
await runTo(at.bodySubsurf + 2, {frames: 10})
await film.hold(1.0)
await film.glide(V.front, 1.2)
for (let k = 1; k <= 8; k++) { await film.cageOpacity(1 - k / 8); await film.shoot(1) }
await film.cage(null)
await film.caption('Monitor, top LCD and port recesses: Manifold booleans into the smooth body')
await film.move({deg: -150, rise: 40, steps: 80})
await runTo(at.gripCage)
await film.stopMove()
await film.glide(V.grip, 1.2)
await film.caption('Grip: plan from the top photograph, top falling at the shutter\'s 35° tilt')
await runTo(at.gripSubsurf, {frames: 5})
await film.cage('grip')
await film.hold(0.8)
await runTo(at.gripSubsurf + 2, {frames: 10})
for (let k = 1; k <= 8; k++) { await film.cageOpacity(1 - k / 8); await film.shoot(1) }
await film.cage(null)
await runTo(at.prismCage)
await film.glide(V.front, 1.0)
await film.caption('Prism: measured flanks and 114 mm top, rims creased so they stay crisp under subdivision')
await runTo(at.prismSubsurf, {frames: 4})
await film.cage('body-prism')
await film.hold(0.8)
await runTo(at.prismSubsurf + 1, {frames: 10})
for (let k = 1; k <= 8; k++) { await film.cageOpacity(1 - k / 8); await film.shoot(1) }
await film.cage(null)
await film.caption('Shoe, shutter, eyepiece, mount - then every published number measured back off the model')
await film.move({deg: 40, rise: 30, steps: 70})
await runTo(at.parts)
await film.stopMove()
await film.still('03-subdivision')

// ------------------------------------------------------------------------------------------- 4 parts
film.chapter('4 Parts')
await film.step('4 / 8  Parts')
await film.glide(V.rear, 1.4)
await film.caption('42 parametric parts from @threepipe/modelling-parts: dials, buttons, knurled rings, pad, eyecup, lugs')
await film.move({deg: 50, rise: 20, steps: 150})
await runTo(at.grooves)
await film.stopMove()
await film.hold(0.6)
await film.still('04-parts')

// ------------------------------------------------------------------------------------------- 5 grooves
film.chapter('5 Grooves')
await film.step('5 / 8  Grooves')
await film.glide(V.ports, 1.5)
await film.caption('groove: panel lines round the port doors, cut with the Manifold boolean, a dark gap strip in each')
await runTo(at.grooves + 2, {frames: 14})
await film.glide(V.rearClose, 1.5)
await runTo(at.shade, {frames: 14})
await film.caption('Shade by angle and weighted normals: fillets read as curves, corners above 30° stay sharp')
await runTo(at.uv, {frames: 4})
await film.hold(0.6)
await film.still('05-grooves')

// ------------------------------------------------------------------------------------------- 6 materials
film.chapter('6 Materials')
await film.step('6 / 8  Materials')
await film.glide(V.grip, 1.2)
await film.caption('uv at the relief tile size, then presets: leather, rubber, satin and gloss plastic, metal, coated glass')
await runTo(at.uv + 3, {frames: 2})
await film.clay(false)
await film.hold(0.8)
await film.move({deg: 60, rise: 10, dolly: 0.85, steps: 110})
await runTo(at.decals, {frames: 4})
await film.stopMove()
await film.hold(0.8)
await film.still('06-materials')

// ------------------------------------------------------------------------------------------- 7 prints
film.chapter('7 Prints')
await film.step('7 / 8  Prints')
await film.glide(V.rear, 1.3)
await film.caption('decal: word marks, the monitor screen, button legends - plane, projected and wrapped prints')
const lensDecal = idx(c => c.op === 'decal' && c.name?.startsWith('decal-lens'))
const topDecal = idx(c => c.op === 'decal' && c.name === 'decal-dial-mode')
await runTo(topDecal, {frames: 6})
await film.glide(V.top, 1.3)
await runTo(lensDecal, {frames: 10})
await film.glide(V.lensFront, 1.3)
await film.caption('Round the lens: a wrapped word mark, the focal-length scale, and the front legend embossed in silver')
await runTo(cmds.length, {frames: 12})
await film.hold(0.6)
await film.still('07-prints')

// ------------------------------------------------------------------------------------------- 8 final
film.chapter('8 Final')
film.ticker(false)
await film.caption('')
await film.step('8 / 8  Final')
await film.glide(V.hero, 1.6)
const stats = await film.stats()
const frameMs = await film.frameMs(60)
await film.still('hero')
await film.panel(['the model', ['objects', String(stats.objects)], ['triangles', stats.tris.toLocaleString('en')], ['commands', `${film.transcript.length} · ${film.transcript.filter(t => !t.ok).length} failed`], ['frame (GPU)', `${frameMs.median} ms`]])
await film.orbit({deg: 360, sec: 14, easing: false})
await film.panel(null)
await film.step('')
await film.hold(0.4)
await film.still('turntable-end')
await film.layer(`<div style="position:absolute;inset:0;display:flex;"><div style="flex:1;background:#0d0e10 url(/demos/camera/refs/hero-5d4-ef24-105.jpg) center/cover no-repeat"></div><div style="width:4px;background:#c0101c"></div><div style="flex:1"></div></div>
  <div style="position:absolute;left:16px;bottom:12px;font:14px system-ui;color:#ddd">${heroCredit}</div>`, 0)
await film.camera({...V.hero, fov: 21})
await film.shift(-0.25)
await film.layerOpacity(1, 0.5)
await film.caption('The photograph, and the model from the hero view')
await film.hold(2.2)
await film.caption('')
await film.layerOpacity(0, 0.4)
await film.title('Built through the modelling command API', `${film.transcript.length} commands · ${stats.tris.toLocaleString('en')} triangles · rendered in threepipe on Apple Metal`, {kicker: 'threepipe.org', sec: 2.6})
const info = await film.finish({stats, frameMs})
console.log(JSON.stringify({renderer: info.renderer, seconds: info.seconds, stats, frameMs}))
