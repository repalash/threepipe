#!/usr/bin/env node
/**
 * procedural-acceptance-report.mjs - the track 2 acceptance report page: the three assets in the modelling editor
 * (GPU screenshots, the directed video, eval timings from `procedural-acceptance-video.mjs`), the parity numbers
 * (`plugins/procedural/tests/parity/**.status.json`) and the agent metrics passed in `<dir>/agent.json`.
 *
 * Usage: `npm run procedural:acceptance-report -- <dir>`; `<dir>` holds metrics.json, the screenshots and video.mp4
 * from the GPU VM. Writes `<dir>/index.html`. The renders show third-party .blend assets (licences undecided), so the
 * report lives under tmp/ and is served by the dev server, not committed.
 */
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const dir = process.argv[2] ?? 'tmp/acceptance'
const parity = 'plugins/procedural/tests/parity'
const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback)
const metrics = read(join(dir, 'metrics.json'), {renderer: 'not recorded', assets: {}})
const agent = read(join(dir, 'agent.json'), {})
const assetsStatus = read(join(parity, 'assets.status.json'), {})
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))

// Own case sets: counts by status kind.
const kinds = {exact: 0, ulp: 0, blocked: 0, blenderBug: 0, other: 0}
let cases = 0, sets = 0
for (const f of readdirSync(join(parity, 'cases')).filter(f => f.endsWith('.status.json'))) {
    sets++
    for (const v of Object.values(read(join(parity, 'cases', f), {}))) {
        cases++
        if (v === 'exact') kinds.exact++
        else if (String(v).startsWith('pass (')) kinds.ulp++
        else if (String(v).startsWith('blocked')) kinds.blocked++
        else if (String(v).startsWith('blender-bug')) kinds.blenderBug++
        else kinds.other++
    }
}
const kit = Object.values(read(join(parity, 'geonodes-kit.status.json'), {}))
const kitPass = kit.filter(v => v.status === 'pass').length, kitSkip = kit.filter(v => v.status === 'skip').length
const libmProof = existsSync('tmp/libm-proof/batch.result.txt') ? readFileSync('tmp/libm-proof/batch.result.txt', 'utf8').trim().split('\n') : []
const libmExact = libmProof.filter(l => l.includes('exact with the platform libm')).length

const ASSETS = [
    {key: 'terrain', title: 'Terrain', what: 'A geometry-nodes group written in the TypeScript DSL (grid, 4D noise, set position), as a modifier on a plane.', parity: 'demos set: 3/3 bit-exact against Blender 5.2.2 (defaults and two other input sets)'},
    {key: 'buildify', title: 'Buildify 1.0 (building_base)', what: 'The Buildify node groups from buildify_1.0.blend, loaded from a runtime bundle with the blendAsset command.', parity: `buildify_1.0: ${Object.values(assetsStatus['buildify_1.0'] ?? {}).filter(v => v === 'exact').length}/${Object.keys(assetsStatus['buildify_1.0'] ?? {}).length} objects bit-exact; building_base: ${esc(assetsStatus['buildify_1.0']?.building_base ?? '')}`},
    {key: 'flowers', title: 'Flower field (EN-ground_plane_NEW)', what: 'flower_scattering.blend\'s Flower Field System: grass and two flower collections scattered as instances.', parity: `flower_scattering: ${esc(assetsStatus.flower_scattering?.['EN-ground_plane_NEW'] ?? '')} (count, order, references exact; matrices within 1e-5)`},
]

const row = a => {
    const m = metrics.assets[a.key]
    const runs = m?.runs?.map(r => `${Object.entries(r.inputs).map(([k, v]) => `${k}=${v}`).join(', ')}: ${r.ms} ms`).join('<br>') ?? 'not recorded'
    return `<section>
  <h2>${esc(a.title)}</h2>
  <div class="cols">
    ${existsSync(join(dir, `${a.key}.png`)) ? `<img src="${a.key}.png" alt="${esc(a.title)} in the editor">` : '<div class="missing">no screenshot</div>'}
    <table>
      <tr><th>What</th><td>${esc(a.what)}</td></tr>
      <tr><th>Parity</th><td>${a.parity}</td></tr>
      <tr><th>Load (command)</th><td>${m ? `${m.loadMs} ms (page ready ${m.pageMs} ms)` : '-'}</td></tr>
      <tr><th>Input changes</th><td>${runs}</td></tr>
      <tr><th>Evaluated mesh</th><td>${m ? `${m.verts} verts, ${m.faces} faces` : '-'}</td></tr>
      <tr><th>Drawn</th><td>${m?.drawn ? `${m.drawn.draws} draws of ${m.drawn.uniqueMeshes} meshes (${m.drawn.instancedMeshes} instanced)` : 'mesh only'}</td></tr>
    </table>
  </div>
</section>`
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Track 2 acceptance: geometry nodes in the editor</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#111216;color:#e7e7ec}
main{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:22px} h2{font-size:17px;margin-top:28px}
.cols{display:grid;grid-template-columns:640px 1fr;gap:18px;align-items:start}
img,video{width:100%;border-radius:6px;border:1px solid #2b2c34}
table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #2b2c34;padding:6px 8px;text-align:left;vertical-align:top}
th{color:#9a9aab;font-weight:600;width:150px}
.stats{display:flex;flex-wrap:wrap;gap:10px} .stat{background:#1b1c22;border:1px solid #2b2c34;border-radius:6px;padding:10px 14px}
.stat b{display:block;font-size:20px} .missing{padding:40px;border:1px dashed #444;text-align:center;color:#888}
</style></head><body><main>
<h1>Geometry nodes in the modelling editor: track 2 acceptance</h1>
<p>Blender 5.2.2's geometry nodes, ported from Blender's C++ source to TypeScript, run as <code>geometryNodes</code>
modifiers in the modelling editor. Their inputs are editable in Properties &gt; Modifiers: each edit is one undoable command,
and it re-runs only the nodes it reaches. GPU: ${esc(metrics.renderer)}.</p>
${existsSync(join(dir, 'video.mp4')) ? '<video src="video.mp4" controls></video>' : '<div class="missing">no video</div>'}
<h2>Parity with Blender 5.2.2</h2>
<div class="stats">
  <div class="stat"><b>${cases}</b>own cases in ${sets} sets</div>
  <div class="stat"><b>${kinds.exact}</b>bit-exact</div>
  <div class="stat"><b>${kinds.ulp}</b>within ulps (libm / limit surface)</div>
  <div class="stat"><b>${libmExact}/${libmProof.length}</b>ulp cases proven exact with Apple's libm</div>
  <div class="stat"><b>${kinds.blocked + kinds.blenderBug}</b>blocked / Blender bug</div>
  <div class="stat"><b>${kitPass}/${kit.length}</b>geonodes-kit pass (${kitSkip} skip)</div>
</div>
${ASSETS.map(row).join('\n')}
<h2>Agent metrics</h2>
<table>${Object.entries(agent).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') || '<tr><td>not recorded</td></tr>'}</table>
</main></body></html>
`
writeFileSync(join(dir, 'index.html'), html)
console.log('wrote', join(dir, 'index.html'))
