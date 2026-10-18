/**
 * The Haussmann demo's film: build.mjs runs live in the modelling example page on the GPU, directed per
 * direction.md, frame-exact (demos/shared/film.mjs), H.264 with faststart.
 *
 *     node demos/haussmann/record.mjs [--out tmp/demo/haussmann/film] [--no-realism]
 *
 * References (refs/, not committed except SOURCES.md): Daly 1870 plates (public domain) and two street photographs
 * (CC BY-SA 3.0, CC BY 3.0), credited on screen and in the report.
 */
import {openFilm} from '../shared/film.mjs'
import {filmSession} from '../shared/session.mjs'
import build, {DATA} from './build.mjs'

const args = process.argv.slice(2)
const flag = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d
const out = flag('out', 'tmp/demo/haussmann/film')
const REF = '/demos/haussmann/refs/'
const {SEB_LENGTH: X, DEPTH: Z, L} = DATA
const centre = [X / 2 - 1.5, 10, -Z / 2]
const around = (deg, r, y) => [centre[0] + r * Math.sin(deg * Math.PI / 180), y, centre[2] + r * Math.cos(deg * Math.PI / 180)]

const film = await openFilm({out, accent: '#b08d57', background: '#d6dde4'})
const credit = (t, side = 'right') => `<div style="position:absolute;${side}:16px;bottom:12px;font:14px system-ui;color:#c8c8cc">${t}</div>`
const photo = (file, c) => `<div style="position:absolute;inset:0;background:#0d0e10 url(${REF}${file}) center/contain no-repeat"></div>${credit(c)}`

/** A camera path round the building: `from`..`to` degrees off the boulevard axis at radius r, height y. */
async function orbit(from, to, r, y, target, sec) {
    await film.glide({position: around(from, r, y), target}, 1.0)
    const n = Math.round(sec * 30)
    await film.animate(sec, (t, [from, to, r, y, target, c]) => {
        const a = (from + (to - from) * t) * Math.PI / 180
        window.__film.setCamera({position: [c[0] + r * Math.sin(a), y, c[2] + r * Math.cos(a)], target})
    }, [from, to, r, y, target, centre])
    return n
}

let session
const chapter = (title, sub, caption) => async () => { await session.section(title, sub); if (caption) await film.caption(caption) }
const beats = {
    references: chapter('The drawings, registered', 'Daly 1870, Exemple M2: elevation at 1:100, plans at 1:200', 'reference {calibrate}: 72.8 px/m, pavement at y = 0'),
    walls: async () => {
        await session.section('Walls', 'The plan outline, extruded storey by storey')
        await film.caption('48 plan vertices, one per corner and window jamb; 12 extrudes, one per storey line')
        await orbit(35, 125, 46, 18, centre, 6)
    },
    openings: async () => {
        await session.section('Openings', '105 windows, 17 shop fronts, 2 doors')
        await film.caption('inset (individual) → extrude per front → inset → separate the panes')
        await film.glide({position: [6, 6, 15], target: [6, 7, 0]}, 1.4)
        await film.glide({position: [11, 9, 9], target: [6, 9, 0]}, 3)
    },
    cornices: async () => {
        await session.section('Cornices', 'One region inset, mitred round both cut corners')
        await film.glide({position: [-9, 18.5, 7], target: [-0.9, 19.3, -0.8]}, 1.4)
        await film.glide({position: [-5, 21, 9], target: [-0.9, 19.3, -0.8]}, 2.5)
    },
    roof: async () => {
        await session.section('The mansard', 'A 45° brisis - the 1859 decree - and a shallow terrasson, by inset')
        await film.caption(`cornice ${L.eave.toFixed(2)} m, brisis top ${L.brisisTop.toFixed(2)} m`)
        await orbit(-50, -10, 46, 30, [centre[0], 20, centre[2]], 4)
    },
    balconies: async () => {
        await session.section('Balconies', 'One 30 cm cast-iron module on a live curve array')
        await film.glide({position: [-12, 9, 9], target: [-1.5, 8, -1.2]}, 1.4)
        await orbit(-60, -20, 16, 10, [-1.5, 9, -1.5], 4)
    },
    dormers: async () => {
        await session.section('Dormers', 'Two live arrays and eight singles')
        await film.glide({position: [4, 27, 14], target: [5, 21, -2]}, 1.4)
        await film.glide({position: [-12, 27, 2], target: [-3, 21, -8]}, 3)
    },
    chimneys: async () => {
        await film.caption('Chimney stacks where the elevation draws them; lathed pots on a live array')
        await film.glide({position: [X + 8, 27, 4], target: [X - 1, 23, -6]}, 2)
    },
    street: chapter('The street', 'Pavement, road and the neighbour to the same 20 m cornice'),
    realism: chapter('Realism pass', 'The realism kit on the parts as built: stone, zinc, wrought iron, glass, joints'),
    checks: async (film, report) => {
        if (!report) return
        await session.section('Checks', 'Measured off the model, against the 1870 drawings')
        await film.panel(['model / drawing (m)', ...report.checks.slice(0, 12).map(c => [`${c.ok ? '✓' : '✗'} ${c.what.slice(0, 38)}`, `${c.got.toFixed(2)} / ${c.want.toFixed(2)}`])])
        await film.hold(5)
        await film.panel(null)
    },
}
session = filmSession(film, {shadowFrustum: 80, beats, chapters: 11, captureHold: 1.3, glide: 1.1})
session.realism = !args.includes('--no-realism')

// ------------------------------------------------------------------------------------------- open
film.chapter('Open')
film.ticker(false)
await film.layer(photo('photo-rue-monge-corner-thbz.jpg', 'Photo: Thierry Bézecourt (Thbz), CC BY-SA 3.0, Wikimedia Commons'), 1)
await film.hold(1)
await film.title('Haussmann, by command', 'A Paris apartment block, modelled to scale through the threepipe modelling API', {kicker: 'threepipe · modelling', sec: 2.2})
await film.layer(photo('daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg', 'César Daly, L\'architecture privée au XIXe siècle, 1870 - public domain'))
await film.caption('N° 77 boulevard de Sébastopol - Paul Mesnard, architect: every dimension is read off this plate')
await film.hold(2.4)
await film.caption('')
await film.layerOpacity(0, 0.5)
film.ticker(true)

const t0 = Date.now()
await build(session)
const buildWallMs = Date.now() - t0

// ------------------------------------------------------------------------------------------- final
film.chapter('Turntable')
film.ticker(false)
await film.caption('')
await film.step('')
await film.glide({position: around(-40, 52, 24), target: [centre[0], 9, centre[2]]}, 1.2)
const stats = await film.stats()
const frameMs = await film.frameMs(60)
await film.panel(['the model', ['objects', String(stats.objects)], ['triangles', stats.tris.toLocaleString('en')], ['commands', `${film.transcript.filter(t => !t.film).length} · ${film.transcript.filter(t => !t.ok).length} failed`], ['frame (GPU)', `${frameMs.median} ms`]])
await film.orbit({deg: 360, sec: 14, easing: false})
await film.panel(null)
await film.still('hero-turntable')
await film.glide({position: [-16, 1.7, 26], target: [3, 12, -6], fov: 45}, 1.2)
await film.still('hero')
await film.layer(`<div style="position:absolute;inset:0;display:flex"><div style="flex:1;background:#0d0e10 url(${REF}photo-rue-monge-corner-thbz.jpg) center/cover no-repeat"></div><div style="width:4px;background:#b08d57"></div><div style="flex:1"></div></div>${credit('Thbz, CC BY-SA 3.0', 'left')}`, 0)
await film.shift(-0.25)
await film.layerOpacity(1, 0.5)
await film.caption('The type, and the model at street level')
await film.hold(2.4)
await film.caption('')
await film.layerOpacity(0, 0.4)
await film.title('Haussmann, by command', `${film.transcript.filter(t => !t.film).length} commands · ${stats.tris.toLocaleString('en')} triangles · threepipe on Apple Metal`, {kicker: 'threepipe.org', sec: 2.4})
const info = await film.finish({stats, frameMs, buildWallMs, report: session.report, realism: session.realism})
console.log(JSON.stringify({renderer: info.renderer, seconds: info.seconds, stats, frameMs, checks: session.report?.checks?.filter(c => c.ok).length}))
