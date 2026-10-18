/**
 * The geometry-nodes demo's film: Buildify, the flower field and the DSL terrain in the modelling editor
 * (`examples/procedural-editor-assets`), each a `geometryNodes` modifier whose inputs are edited live - typed into
 * Properties > Modifiers with the real mouse and keyboard, then changed through the same `modifier update` command an
 * agent sends, timed. Frame-exact (demos/shared/film.mjs): a long evaluation does not show as a freeze, and its real
 * time is on screen and in metrics.json.
 *
 *     node demos/geometry-nodes/record.mjs [--out tmp/demo/geometry-nodes/film]
 *
 * Needs the asset bundles in tmp/bundles/ (made from the .blend files, see plugins/procedural/tests/fixtures/ASSETS.md).
 * Renders of the third-party assets (Buildify, the flower field) and the video are never committed; the terrain is
 * ours (the TypeScript DSL), so its stills are.
 * This is the GPU, frame-exact successor of scripts/procedural-acceptance-video.mjs (same assets, fields and timed inputs).
 */
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {openFilm} from '../shared/film.mjs'

const args = process.argv.slice(2)
const flag = (k, d) => args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d
const out = flag('out', 'tmp/demo/geometry-nodes/film')

const ASSETS = [
    {asset: 'buildify', object: 'building_base', field: 'Max number of floors', value: '12', title: 'Buildify 1.0',
        sub: 'building_base from buildify_1.0.blend: the node groups, run in TypeScript, bit-exact with Blender 5.2.2',
        credit: 'Buildify 1.0 by Pavel Oliva (see ASSETS.md for the licence)',
        timed: [{Input_6: 8, Input_7: 12}, {Input_6: 4, Input_7: 6}, {Input_3: 4}, {Input_3: 3}]},
    {asset: 'flowers', object: 'EN-ground_plane_NEW', field: 'Flower Density', value: '0.4', title: 'Flower field',
        sub: 'flower_scattering.blend\'s Flower Field System: grass and two flower collections, 30 740 instances',
        credit: 'flower_scattering.blend: Simon Thommes, Andy Goralczyk (Blender Studio), CC0',
        timed: [{Input_17: 3}, {Input_17: 0}, {Input_5: 2}, {Input_5: 3}]},
    {asset: 'terrain', object: 'terrain', field: 'Height', value: '8', title: 'Terrain',
        sub: 'A geometry-nodes group written in the TypeScript DSL: grid, 4D noise, set position',
        timed: [{Resolution: 140}, {Resolution: 96}, {Seed: 12}, {Seed: 0}]},
]
const page0 = a => `/examples/procedural-editor-assets/index.html?asset=${a}`
const ready = () => document.body.classList.contains('_testFinish') && !!window.acceptance

const film = await openFilm({out, page: page0('terrain'), ready, stage: false, accent: '#4f8cff', background: '#2b2d33'})
const page = film.page
film.ticker(false)
const metrics = {renderer: film.renderer, assets: {}}

/** Wait (real time) until the object's evaluated mesh changes revision, and say how long it took. */
async function settle(object, before, timeout = 120000) {
    const t0 = Date.now()
    await page.waitForFunction(([o, b]) => {
        const e = window.modelling.document.find(o)
        return e && (e.revision !== b) && !window.procedural?.busy
    }, [object, before], {timeout}).catch(() => null)
    return Date.now() - t0
}
const rev = object => page.evaluate(o => window.modelling.document.find(o)?.revision, object)

let first = true
for (const a of ASSETS) {
    const t0 = Date.now()
    if (!first) await film.load(page0(a.asset))
    first = false
    const pageMs = Date.now() - t0
    film.chapter(a.title)
    const loadMs = await page.evaluate(() => window.acceptance.loadMs)
    await film.title(a.title, a.sub, {kicker: 'threepipe · geometry nodes', sec: 2.2})
    await film.caption(`${a.title}: loaded and evaluated in the browser (${Math.round(loadMs)} ms), as a modifier in the editor`)
    if (a.credit) await film.panel(['asset', [a.credit, '']])
    await film.orbit({deg: 35, sec: 3})
    await film.panel(null)
    await film.still(`${a.asset}-loaded`)

    // A person's edit: Properties > Modifiers, type the new value, Enter.
    await page.getByRole('tab', {name: 'Modifiers'}).click()
    await film.hold(0.8)
    await film.caption(`Editing "${a.field}" in Properties > Modifiers: one undoable "modifier update", re-running only what it reaches`)
    const field = page.locator('.me-modifier[data-modifier-index="0"]').locator(`[id="me-prop-${a.field}"]`)
    await field.click()
    await film.hold(0.4)
    await field.fill('')
    await film.hold(0.2)
    for (const ch of a.value) { await field.press(ch); await film.hold(0.15) }
    const before = await rev(a.object)
    await field.press('Enter')
    const uiMs = await settle(a.object, before)
    await film.caption(`"${a.field}" = ${a.value}: re-evaluated in ${uiMs} ms (wall time in the page, GPU VM)`)
    await film.orbit({deg: 50, sec: 4})
    await film.still(`${a.asset}-edited`)

    // The same command an agent sends, timed.
    const runs = []
    for (const inputs of a.timed) {
        const r = await page.evaluate(async ({object, inputs}) => {
            const m = window.modelling, entry = m.document.find(object), spec = entry.modifiers[0]
            const r = await m.run({op: 'modifier', object, index: 0, update: {inputs: {...spec.inputs, ...inputs}}})
            return {ok: r.ok, ms: r.ms, error: r.error}
        }, {object: a.object, inputs})
        film.record({op: 'modifier', object: a.object, index: 0, update: {inputs}})
        runs.push({inputs, ...r})
        await film.caption(`modifier {update: {inputs: ${JSON.stringify(inputs)}}}  →  ${r.ok ? `${Math.round(r.ms)} ms` : r.error}`)
        await film.orbit({deg: 18, sec: 1.4})
    }
    const info = await page.evaluate(object => {
        const entry = window.modelling.document.find(object)
        return {verts: entry.evaluated.vertsNum, faces: entry.evaluated.facesNum, drawn: window.procedural?.drawn?.(object)}
    }, a.object)
    const frameMs = await film.frameMs(30)
    metrics.assets[a.asset] = {pageMs, loadMs, uiEdit: {field: a.field, value: a.value, ms: uiMs}, runs, ...info, frameMs}
    console.log(a.asset, JSON.stringify(metrics.assets[a.asset]))
    await film.caption('')
    await film.still(`${a.asset}-final`)
}
await film.title('Geometry nodes on the mesh kernel', 'Blender 5.2.2 node groups evaluated in TypeScript, edited live in the threepipe editor - on Apple Metal', {kicker: 'threepipe.org', sec: 2.4})
const info = await film.finish({metrics})
writeFileSync(join(out, 'metrics.json'), JSON.stringify(metrics, null, 1))
console.log(JSON.stringify({renderer: info.renderer, seconds: info.seconds}))
