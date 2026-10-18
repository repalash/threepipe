/**
 * The edit-chain demo's film: the 30-step main chain (a cylinder edited into a chess rook), each step's resolved
 * commands replayed from results.json in the modelling example page on the GPU, with the step's scores beside it.
 * Frame-exact (demos/shared/film.mjs), H.264 with faststart.
 *
 *     npm run modelling:session -- demos/edit-chain/run.mjs --port 9479 --out tmp/edit-chain-session   # scores, results.json
 *     node demos/edit-chain/record.mjs [--out tmp/demo/edit-chain/film]                                 # the film
 *
 * The edit-mode look: clay surface, the master mesh's edges drawn over it (hidden ones faint), so each edit shows
 * as what it did to the topology.
 */
import {readFileSync} from 'node:fs'
import {openFilm} from '../shared/film.mjs'

const args = process.argv.slice(2)
const flag = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d
const out = flag('out', 'tmp/demo/edit-chain/film')
const results = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'))
const main = results.steps.filter(s => s.chain === 'main').sort((a, b) => a.n - b.n)
if (main.length !== 30) throw new Error(`expected 30 main steps, got ${main.length}`)

const film = await openFilm({out, accent: '#e8a33d', background: '#2b2d33'})
await film.stage({op: 'lighting', environmentIntensity: 1})
await film.stage({op: 'light', name: 'key', type: 'directional', position: [3, 5, 4], intensity: 2})
const mark = st => st === 'PASS' ? '✓' : st === 'N/A' ? '–' : st === 'FAIL' ? '✗' : '?'

film.chapter('Open')
film.ticker(false)
await film.camera({position: [2.3, 1.5, 2.7], target: [0, 0.05, 0], fov: 32})
await film.title('30 edits, one mesh', 'A cylinder edited into a chess rook with Blender\'s edit-mode operators, every step scored: did it, and nothing else', {kicker: 'threepipe · modelling · edit chain', sec: 2.6})
film.ticker(true)
await film.clay(true)
await film.move({deg: 330, rise: 0.4, steps: main.length * 54})
let name = 'body'
for (const s of main) {
    if (s.n === 1 || s.n === 10 || s.n === 19 || s.n === 25) film.chapter(`Step ${s.n}`)
    await film.step(`${s.n} / 30  ${s.title}`)
    await film.caption(s.claimText ?? '')
    for (const c of s.commands) {
        await film.run(c, {frames: 0})
        if (c.op === 'rename') name = c.name
    }
    if (s.n === 25) await film.clay(false)
    if (s.n < 25) await film.cage(name, '#ffb347', {occlude: true, width: 1.4})
    else await film.cage(null)
    const ch = s.checks
    await film.panel([`step ${s.n}: ${s.commandOps.join(', ')}`, ...['did', 'locality', 'manifold', 'undo', 'determinism'].map(k => [k, `${mark(ch[k]?.status)} ${ch[k]?.status ?? ''}`])])
    for (let i = 0; i < 54; i++) { await page_step(); }
    if ([6, 12, 17, 21, 24].includes(s.n)) await film.still(`step-${String(s.n).padStart(2, '0')}`)
}
async function page_step() { await film.page.evaluate(() => window.__film.step()); await film.shoot(1) }
await film.stopMove()
await film.panel(null)
await film.caption('')
await film.step('')
film.ticker(false)
film.chapter('Result')
await film.still('hero')
const stats = await film.stats()
const frameMs = await film.frameMs(60)
await film.orbit({deg: 360, sec: 9, easing: false})
const S = results.summary
await film.panel(['121 scored steps (all chains)', ['main chain', `${S.main.byStatus.PASS} / ${S.main.steps} PASS`],
    ['locality', `${S.byCheck.locality.PASS} PASS`], ['manifold', `${S.byCheck.manifold.PASS} PASS`], ['undo / redo exact', `${S.byCheck.undo.PASS} PASS`],
    ['determinism', `${S.byCheck.determinism.PASS} / ${S.steps}`], ['controls caught', `${S.controls.detected} / ${S.controls.steps}`]])
await film.hold(3.2)
await film.panel(null)
await film.title('Edit chain', `30 steps · ${film.transcript.length} commands · every edit local, manifold and undoable - threepipe on Apple Metal`, {kicker: 'threepipe.org', sec: 2.4})
const info = await film.finish({stats, frameMs, summary: S})
console.log(JSON.stringify({renderer: info.renderer, seconds: info.seconds, stats, frameMs}))
