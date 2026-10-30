/**
 * The geometry-nodes report data: report.json from the film's metrics.json and the parity status files, then the shared
 * report page. Buildify and flower-field stills are written to shots/ for a local look but are gitignored (third-party
 * assets); the hero and the committed stills are the terrain's.
 *
 *     node demos/geometry-nodes/make-report.mjs [--local]   # after record.mjs, the film pulled to demos/geometry-nodes/film/;
 *                                                          # --local adds the Buildify / flower stills (never commit that page)
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'

const read = (p, d) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d
const M = read('demos/geometry-nodes/film/metrics.json', {assets: {}})
const assets = read('plugins/procedural/tests/parity/assets.status.json', {})
const mean = k => A[k] ? Math.round(A[k].runs.reduce((s, r) => s + r.ms, 0) / A[k].runs.length) : '-'
const exact = o => Object.values(o ?? {}).filter(v => v === 'exact').length
const A = M.assets
const fmt = a => a ? `load ${Math.round(a.loadMs)} ms · panel edit ${a.uiEdit.ms} ms · updates ${a.runs.map(r => Math.round(r.ms)).join(' / ')} ms · ${a.verts.toLocaleString('en')} verts` : 'not recorded'
const line = (k, title) => [title, A[k] ? `${Math.round(A[k].runs.reduce((s, r) => s + r.ms, 0) / A[k].runs.length)} ms / update` : '-', fmt(A[k])]

const report = {
    title: 'Geometry nodes, edited live',
    kicker: 'threepipe modelling demo · geometry nodes',
    accent: '#4f8cff',
    blurb: 'Buildify, a flower field and a DSL terrain as geometry-nodes modifiers, edited live in the editor.',
    line: A.buildify ? `Buildify ${mean('buildify')} ms · flowers ${mean('flowers')} ms · terrain ${mean('terrain')} ms per input change (mean of 4, GPU VM)` : undefined,
    intro: 'Blender 5.2.2 geometry-nodes groups evaluated in TypeScript on the mesh kernel, as modifiers in the threepipe modelling editor. Buildify 1.0\'s building generator and Blender Studio\'s flower field come from their .blend files through the <code>blendAsset</code> command (node groups, inputs and the objects they read - nothing Blender evaluated); the terrain is a group written in the TypeScript DSL. Each is edited twice: in Properties > Modifiers with the mouse and keyboard, and through the <code>modifier update</code> command an agent sends - every edit one undo step, re-running only what it reaches.',
    recordCommand: 'node demos/geometry-nodes/record.mjs',
    hero: {file: 'terrain-edited', caption: 'The DSL terrain after its Height was typed into the modifier panel'},
    stills: [
        {file: 'terrain-loaded', caption: 'Terrain: the DSL group on a plane, as loaded'},
        {file: 'terrain-final', caption: 'Terrain after four more input changes (resolution, seed)'},
        // third-party asset renders only in a local page (`--local`); the committed page shows ours
        ...['buildify-loaded', 'buildify-edited', 'flowers-loaded', 'flowers-edited'].filter(f => process.argv.includes('--local') && existsSync(`demos/geometry-nodes/film/stills/${f}.jpg`))
            .map(f => ({file: f, caption: `${f.startsWith('buildify') ? 'Buildify 1.0' : 'Flower field'}, ${f.endsWith('loaded') ? 'as loaded' : 'after the panel edit'} (local only: third-party asset)`})),
    ],
    commandsNote: 'the input changes the film timed',
    metricsFirst: [line('buildify', 'Buildify update'), line('flowers', 'flower field update'), line('terrain', 'terrain update')].filter(Boolean),
    metrics: [
        ['parity (Blender 5.2.2)', `${exact(assets['buildify_1.0'])} / ${Object.keys(assets['buildify_1.0'] ?? {}).length}`, `buildify_1.0 objects bit-exact; flower field: ${assets.flower_scattering?.['EN-ground_plane_NEW'] ?? 'see the parity tests'}`],
        ['agent (track 2, the port)', '712 min', 'claude-opus-5-5 · 2,742 tool calls · 2.3M output / 1.36G input tokens (mostly cache reads)'],
    ],
    checks: [['asset', 'load ms', 'panel edit', 'updates (ms)', 'evaluated', 'drawn'], ...Object.entries(A).map(([k, a]) => [k, Math.round(a.loadMs), `${a.uiEdit.field} = ${a.uiEdit.value}: ${a.uiEdit.ms} ms`,
        a.runs.map(r => `${Object.entries(r.inputs).map(([x, v]) => `${x}=${v}`).join(',')}: ${Math.round(r.ms)}`).join('; '), `${a.verts.toLocaleString('en')} verts, ${a.faces.toLocaleString('en')} faces`,
        a.drawn ? `${a.drawn.draws} draws, ${a.drawn.instancedMeshes} instanced` : 'mesh'])],
    how: '<p><code>record.mjs</code> opens <code>examples/procedural-editor-assets</code> once per asset on the GPU VM, clicks the Modifiers tab, types the new value into the field and presses Enter (real Playwright input), waits for the object\'s evaluated mesh to change and records that time, then sends four timed <code>modifier update</code> commands. <code>demos/shared/film.mjs</code> renders and captures every frame, so an evaluation that takes seconds shows as its number on screen rather than a frozen picture. Times are wall time in the page on the VM (6 cores, Apple Paravirtual GPU).</p><p>Re-run: put the bundles in <code>tmp/bundles/</code> (<code>plugins/procedural/tests/fixtures/ASSETS.md</code>), <code>node demos/geometry-nodes/record.mjs</code>, pull <code>tmp/demo/geometry-nodes/film/</code> to <code>demos/geometry-nodes/film/</code>, <code>node demos/geometry-nodes/make-report.mjs</code>. The track-2 acceptance record (<code>scripts/procedural-acceptance-video.mjs</code>) is the same run in real time.</p>',
    weak: [
        'Buildify and the flower field are third-party assets: their renders and this film cannot be committed or published until their use in launch material is decided.',
        'The editor viewport lighting is the editor default; the flower field\'s grass reads as flat colour at 1080p.',
        'The editor frames each asset with its own frame-all, so the terrain sits small in the viewport, and the selection box (red) stays on throughout, because the modifier panel needs the object selected.',
    ],
    credits: 'Buildify 1.0 by Pavel Oliva (free for commercial use, not for resale of the graph). flower_scattering.blend by Simon Thommes and Andy Goralczyk, Blender Studio (CC0). See plugins/procedural/tests/fixtures/ASSETS.md.',
}
writeFileSync('demos/geometry-nodes/report.json', JSON.stringify(report, null, 1))
execFileSync(process.execPath, ['demos/shared/report.mjs', 'demos/geometry-nodes'], {stdio: 'inherit'})
