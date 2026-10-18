/**
 * The stair demo's film: build.mjs (a cast-iron spiral stair and a Gothic arcade) runs live in the modelling example
 * page on the GPU, directed per direction.md, frame-exact (demos/shared/film.mjs), H.264 with faststart.
 *
 *     node demos/stair/record.mjs [--out tmp/demo/stair/film] [--no-realism]
 *
 * On screen: HABS drawings of the Church of the Ascension, New York (public domain). The dealer photographs of the
 * stair (UK Architectural Antiques, all rights reserved) are local modelling references only and never shown.
 */
import {openFilm} from '../shared/film.mjs'
import {filmSession} from '../shared/session.mjs'
import build from './build.mjs'

const args = process.argv.slice(2)
const flag = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d
const out = flag('out', 'tmp/demo/stair/film')
const REF = '/demos/stair/refs/'

const film = await openFilm({out, accent: '#c8a25a', background: '#5b6068'})
const session = filmSession(film, {shadowFrustum: 45, chapters: 10, captureHold: 1.2, glide: 0.9, holdMs: true})
session.realism = !args.includes('--no-realism')
const credit = t => `<div style="position:absolute;right:16px;bottom:12px;font:14px system-ui;color:#c8c8cc">${t}</div>`

film.chapter('Open')
film.ticker(false)
await film.layer(`<div style="position:absolute;inset:0;background:#f4f1ea url(${REF}habs-ny-ascension-sheet8-interior-elevation.png) center/contain no-repeat"></div>${credit('HABS NY-1259, Church of the Ascension, New York - Library of Congress, public domain')}`, 1)
await film.hold(1)
await film.title('Cast iron and stone', 'A spiral stair and a Gothic arcade, built live by JSON commands', {kicker: 'threepipe · modelling', sec: 2.2})
await film.caption('The arcade is read off HABS sheet 8 at its scale bar; the stair off a dealer\'s catalogue numbers (53" diameter, 8" rise)')
await film.hold(2.2)
await film.caption('')
await film.layerOpacity(0, 0.5)
film.ticker(true)

const t0 = Date.now()
await build(session)
const buildWallMs = Date.now() - t0

film.ticker(false)
await film.caption('')
await film.step('')
const stats = await film.stats()
const frameMs = await film.frameMs(60)
await film.still('hero')
await film.panel(['the model', ['objects', String(stats.objects)], ['triangles', stats.tris.toLocaleString('en')], ['commands', `${film.transcript.filter(t => !t.film).length} · ${film.transcript.filter(t => !t.ok).length} failed`], ['frame (GPU)', `${frameMs.median} ms`]])
await film.hold(2.5)
await film.panel(null)
await film.title('Cast iron and stone', `${film.transcript.filter(t => !t.film).length} commands · ${stats.tris.toLocaleString('en')} triangles · threepipe on Apple Metal`, {kicker: 'threepipe.org', sec: 2.4})
const info = await film.finish({stats, frameMs, buildWallMs, result: session.result, realism: session.realism})
console.log(JSON.stringify({renderer: info.renderer, seconds: info.seconds, stats, frameMs, checks: session.result?.checks?.filter(c => c.ok).length}))
