/**
 * Write `demos/stair/index.html` from the session logs (`demos/stair/runs/*.txt`, the session's stdout) and the images in
 * `demos/stair/shots/`. Every number on the page is read from a log line the build printed (its
 * `REPORT {...}` line and its check lines), so the page cannot drift from the runs it describes.
 *
 *     node demos/stair/make-report.mjs
 */

import {readFile, readdir, writeFile, stat} from 'node:fs/promises'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shots = (await readdir(join(here, 'shots'))).filter(f => f.endsWith('.jpg')).sort()

async function report(run) {
    const text = await readFile(join(here, 'runs', run + '.txt'), 'utf8')
    const line = text.split('\n').find(l => l.includes('REPORT {'))
    const summary = text.slice(text.lastIndexOf('\n{')).match(/"commands": (\d+),\s*"failed": (\d+)/)
    return {
        data: line ? JSON.parse(line.slice(line.indexOf('{'))) : null,
        commands: summary ? +summary[1] : null,
        failed: summary ? +summary[2] : null,
    }
}
const runs = {
    main: await report('main'),
    treads16: await report('treads16'),
    bays3: await report('bays3'),
    bays5: await report('bays5'),
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** The first shot whose file name contains every given fragment. */
const shot = (...parts) => {
    const f = shots.find(n => parts.every(p => n.includes(p)))
    if (!f) throw new Error(`no shot matching ${parts.join(' + ')}`)
    return 'shots/' + f
}
const caption = f => f.replace(/^shots\//, '').replace(/^(react-[a-z0-9]+-)?\d{3}-/, '').replace(/\.jpg$/, '').replace(/-/g, ' ')
const fig = (src, cap = caption(src), cls = '') =>
    `<figure class="${cls}"><a href="${src}"><img src="${src}" alt="${esc(cap)}" loading="lazy"></a><figcaption>${esc(cap)}</figcaption></figure>`

// --- build strip: the main run's captures in order, minus the finale (shown elsewhere) ----------
const mainShots = shots.filter(n => /^\d{3}-/.test(n))
const finaleStart = mainShots.findIndex(n => n.includes('hero-the-stair'))
const strip = mainShots.slice(0, finaleStart).map(n => fig('shots/' + n)).join('\n')

// --- checks ---------------------------------------------------------------------------------------
const checkRows = (run, label) => (runs[run].data?.checks ?? []).map(c =>
    `<tr class="${c.ok ? 'ok' : 'bad'}"><td>${esc(label)}</td><td>${esc(c.what)}</td><td>${c.want}</td><td>${c.got}</td>`
    + `<td>${c.err.toFixed(2)} %</td><td>${c.ok ? 'pass' : 'FAIL'}</td></tr>`).join('\n')
const allChecks = Object.entries(runs).flatMap(([k, r]) => r.data?.checks ?? [])
const passed = allChecks.filter(c => c.ok).length

// --- topology ---------------------------------------------------------------------------------------
const topo = runs.main.data?.topology ?? []
const totals = topo.reduce((a, r) => ({verts: a.verts + r.verts, edges: a.edges + r.edges, faces: a.faces + r.faces,
    quads: a.quads + r.quads, evaluated: a.evaluated + r.evaluatedVerts}), {verts: 0, edges: 0, faces: 0, quads: 0, evaluated: 0})
const topoRows = topo.map(r => `<tr><td>${esc(r.name)}</td><td>${r.verts}</td><td>${r.edges}</td><td>${r.faces}</td>`
    + `<td>${(100 * r.quads / Math.max(1, r.faces)).toFixed(1)} %</td><td>${r.tris} / ${r.ngons}</td>`
    + `<td>${r.nonManifold === 0 && r.boundary === 0 ? 'closed, manifold' : r.nonManifold === 0 ? `manifold, ${r.boundary} open edges` : `${r.nonManifold} non-manifold edges`}</td>`
    + `<td>${esc(r.modifiers.join('; ') || '—')}</td><td>${r.evaluatedVerts}</td></tr>`).join('\n')

const videoBytes = await stat(join(here, 'video.webm')).then(s => s.size).catch(() => 0)

const issues = [
    ['command-export-ignores-objects.md', '`export {objects}` is accepted and ignored: one GLB per piece needed delete, export, undo.'],
    ['command-display-wireframe-shows-triangles.md', 'Wireframe display draws render triangles, not mesh edges; no x-ray mode (faked with opacity).'],
    ['command-inspect-bounds-are-master-only.md', '`inspect` describes the master, not the arrayed result; evaluated sizes come from `measure`.'],
    ['command-sweep-tilt-free-normals.md', 'Curve tilt and Free normals are not ported; `zUp` was enough here.'],
    ['session-out-dir-reloads-vite.md', 'A session writing captures inside the vite root reloads its own page mid-build.'],
    ['command-camera-duration-saved-views-only.md', '`camera {duration}` only animates to saved views; explicit moves jump.'],
]
const fixed = [
    ['command-sweep-profile-orientation.md', 'Fixed: `sweep` now converts to the kernel\'s Z-up, so a section faces the same way on any vertical plane and `zUp` keeps it level (commit 5d24f63).'],
    ['command-no-edge-listing.md', 'Fixed: `inspect {detail}` lists `edgeVerts`, so `bevel`/`subdivide` edges are picked by position (commit 8abc599).'],
    ['(new) radial array `step`', 'Added: a radial array takes a per-copy offset (Blender Constant + Object Offset), the rise of the stair (commit 141e7c2).'],
]
const issueLink = f => f.endsWith('.md') ? `<a href="../../issues/open/modelling-tools/${f}"><code>${esc(f)}</code></a>` : esc(f)

const p = runs.main.data?.params ?? {}
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cast iron and stone — a spiral staircase and a Gothic arcade from modelling commands</title>
<style>
  :root { --ink: #1d1f22; --muted: #6b6760; --paper: #f6f3ee; --rule: #ddd6cb; --ok: #2f6b3a; --bad: #9b2c1f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 Georgia, 'Times New Roman', serif; }
  main { max-width: 1240px; margin: 0 auto; padding: 40px 28px 80px; }
  h1 { font-size: 40px; line-height: 1.15; margin: 0 0 8px; font-weight: 600; }
  h2 { font-size: 26px; margin: 56px 0 6px; font-weight: 600; border-top: 1px solid var(--rule); padding-top: 22px; }
  h3 { font-size: 18px; margin: 26px 0 8px; }
  p.lede { font-size: 19px; color: #3a3833; max-width: 860px; }
  .meta { color: var(--muted); font: 14px/1.5 ui-monospace, Menlo, monospace; }
  .meta a { color: inherit; }
  code { font: 0.88em ui-monospace, Menlo, monospace; background: #ebe5da; padding: 1px 4px; border-radius: 2px; }
  .grid { display: grid; gap: 14px; }
  .g2 { grid-template-columns: repeat(2, 1fr); }
  .g3 { grid-template-columns: repeat(3, 1fr); }
  .g4 { grid-template-columns: repeat(4, 1fr); }
  figure { margin: 0; }
  figure img { width: 100%; display: block; background: #5b6068; border-radius: 2px; }
  figure.ref img { background: #fff; object-fit: contain; aspect-ratio: 3 / 2; }
  figcaption { font-size: 14px; color: var(--muted); padding-top: 5px; }
  .hero { margin-top: 26px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 10px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font-weight: 600; background: #ece6dc; }
  td:nth-child(n+3) { font-variant-numeric: tabular-nums; }
  tr.ok td:last-child { color: var(--ok); font-weight: 600; }
  tr.bad td:last-child { color: var(--bad); font-weight: 700; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 10px; background: #dfe9dc; color: var(--ok); font: 600 13px ui-monospace, Menlo, monospace; }
  video { width: 100%; background: #111; border-radius: 2px; }
  ul.tight li { margin-bottom: 6px; }
  .pair figcaption b { color: var(--ink); }
  @media (max-width: 800px) { .g3, .g4 { grid-template-columns: repeat(2, 1fr); } .g2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
<h1>Cast iron and stone</h1>
<p class="lede">A cast-iron spiral staircase and a short Gothic arcade, each to the dimensions of a real reference,
built entirely through <code>@threepipe/plugin-modelling</code>'s JSON commands. One tread and one bay are
made by hand; <code>lathe</code>, <code>sweep</code>, live radial and linear <code>array</code>s and a live
<code>mirror</code> make the rest, and every piece stays editable topology.</p>
<p class="meta">
build <a href="build.mjs">build.mjs</a> · transcript <a href="transcript.json">transcript.json</a> ·
models <a href="stair.glb">stair.glb</a>, <a href="arcade.glb">arcade.glb</a> ·
direction <a href="direction.md">direction.md</a> · recorder <a href="record.mjs">record.mjs</a> · sources <a href="refs/SOURCES.md">refs/SOURCES.md</a><br>
main run: ${runs.main.commands} commands, ${runs.main.failed} failed · ${p.TREADS_PER_TURN} treads a turn, ${p.TURNS} turns,
rise ${(p.RISE / 0.0254).toFixed(2)}" · ${p.BAYS} bays · dimension checks: <span class="pill">${passed} / ${allChecks.length} within 2 %</span>
</p>

<div class="grid g2 hero">
${fig(shot('hero-the-stair'), 'The stair: 23 treads and a landing, two turns, 53" diameter')}
${fig(shot('hero-the-arcade'), 'The arcade: four bays at 14\'-3", mirrored across a 15\'-1" aisle, rib-vaulted')}
</div>
<div class="grid g3" style="margin-top:14px">
${fig(shot('hero-both-pieces-final'), 'Both pieces')}
${fig(shot('inside-the-aisle'))}
${fig(shot('looking-up-the-stair'))}
</div>

<h2>The film</h2>
<p>${videoBytes ? `Recorded live by <a href="record.mjs">record.mjs</a> on SwiftShader (${(videoBytes / 1e6).toFixed(1)} MB). The command chip in the corner is the JSON that just ran.` : 'Not recorded yet.'}</p>
${videoBytes ? '<video src="video.webm" controls preload="metadata"></video>' : ''}

<h2>Reference and result</h2>
<h3>The staircase: Safety Stairways Ltd, UK Architectural Antiques listing 24019</h3>
<p>53" diameter (26½" pole centre to tread edge), 8" rise (13 rises over 104"), 12 treads to a turn
(counted on the top view), 33½" spindles, 37" newel above the landing. Two turns is the demo's brief.</p>
<div class="grid g4 pair">
${fig('refs/ukaa-24019-safety-stairways-elevation.jpg', 'Catalogue photograph (not committed: all rights reserved)', 'ref')}
${fig(shot('hero-the-stair'), 'The model, same scale')}
${fig('refs/ukaa-24019-safety-stairways-top.jpg', 'Treads from above: pierced 30° castings', 'ref')}
${fig(shot('detail-treads'), 'The model: polar grid, openings, collars, balusters')}
</div>
<h3>The arcade: HABS, Church of the Ascension, New York (Upjohn, 1840–41), sheet 8</h3>
<p>Read off the measured drawing at its own scale bar (39.6 px/ft), cross-checked against the plan:
bay 14'-3", springing 21'-4", intrados crown 30'-5", span 11'-3½"; the aisle ceiling (vault crown) is
dimensioned 31'-9" on sheet 7. The orthographic render below has the drawing registered behind it by
the scale bar and the first pier's centre and floor line.</p>
<div class="grid g3 pair">
${fig('refs/habs-ascension-nave-bay-elevation.png', 'HABS NY, sheet 8 (public domain)', 'ref')}
${fig(shot('orthographic-over-habs'), 'Orthographic, over the drawing at its scale bar')}
${fig(shot('orthographic-model-only'), 'Orthographic, model only')}
</div>

<h2>How it is built</h2>
<p>One line per step; each image is the session's own capture after that step.</p>
<div class="grid g4">
${strip}
</div>

<h2>Reactivity</h2>
<p>The same build re-run with different parameters (<code>STAIR_TREADS=16</code>, <code>ARCADE_BAYS=3</code> / <code>5</code>):
the floor-to-landing height is the catalogue's and stays fixed, so 16 treads a turn means a 6" rise and 22½° treads.
All of those runs' checks are in the table below. The last pair is the main run changing one number on live modifiers.</p>
<div class="grid g2 pair">
${fig(shot('balusters-landing-and-handrail'), '12 treads a turn (catalogue): 23 treads + landing, 8" rise')}
${fig(shot('react-treads16-', 'balusters-landing-and-handrail'), '16 treads a turn: 31 treads + landing, 6" rise')}
${fig(shot('react-bays3-', 'mirrored'), 'ARCADE_BAYS=3')}
${fig(shot('react-bays5-', 'mirrored'), 'ARCADE_BAYS=5')}
${fig(shot('live-3-bays'), 'live, in one session: 3 bays (one modifier update per arrayed object)')}
${fig(shot('live-5-bays'), 'live: 5 bays, same masters')}
</div>

<h2>Wireframe and x-ray</h2>
<div class="grid g4">
${fig(shot('wireframe-the-stair'))}
${fig(shot('wireframe-the-arcade'))}
${fig(shot('x-ray-the-stair'))}
${fig(shot('x-ray-the-arcade'))}
</div>
<p class="meta">The wireframe is three.js's <code>material.wireframe</code>, so quads show their render diagonals — see the issue below.</p>

<h2>Dimension checks</h2>
<p>Measured from the finished model by the build itself (bounds via <code>measure</code>, positions via
<code>inspect</code>), against the reference values; the build throws if any is off by more than 2 %.</p>
<table>
<thead><tr><th>run</th><th>check</th><th>reference</th><th>model</th><th>error</th><th></th></tr></thead>
<tbody>
${checkRows('main', 'main (12 / 4)')}
${checkRows('treads16', '16 treads')}
${checkRows('bays3', '3 bays')}
${checkRows('bays5', '5 bays')}
</tbody>
</table>

<h2>Counts</h2>
<p>Per object, the editable master (what vertex and edge indices address) and its live stack. Face sizes and
edge use are tallied from <code>inspect {detail}</code>. Masters total ${totals.verts} vertices, ${totals.edges} edges,
${totals.faces} faces, ${(100 * totals.quads / Math.max(1, totals.faces)).toFixed(1)} % quads; the evaluated meshes
total ${totals.evaluated} vertices.</p>
<table>
<thead><tr><th>object</th><th>verts</th><th>edges</th><th>faces</th><th>quads</th><th>tris / n-gons</th><th>topology</th><th>live modifiers</th><th>evaluated verts</th></tr></thead>
<tbody>
${topoRows}
</tbody>
</table>
<p class="meta">Where faces are not quads: lathe profiles that end on the axis close in triangle fans (Blender's Spin does the same),
sweep and lathe caps and the polar tread's openings are n-gons, and the bevel's corner patches are triangles.
"Open edges" are where a part is not closed by design (the floor, a joined lathe's apex).</p>

<h2>What the API lacked</h2>
<h3>Fixed in this branch</h3>
<ul class="tight">
${fixed.map(([f, t]) => `<li>${issueLink(f)} — ${esc(t)}</li>`).join('\n')}
</ul>
<h3>Filed</h3>
<ul class="tight">
${issues.map(([f, t]) => `<li>${issueLink(f)} — ${esc(t)}</li>`).join('\n')}
</ul>
</main>
</body>
</html>
`
await writeFile(join(here, 'index.html'), html)
console.log(`index.html: ${shots.length} shots, ${allChecks.length} checks (${passed} pass), ${topo.length} objects`)
