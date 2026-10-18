/**
 * Write the report page (`index.html`) and a trimmed `transcript.json` from a session run.
 *
 *     node demos/haussmann/make-report.mjs [demos/haussmann/shots]
 *
 * Reads `<shots>/transcript.json` (written by `scripts/modelling-session.mjs`) and `<shots>/report.json`
 * (written by `build.mjs`: the dimension checks and topology counts). The page is plain HTML and CSS;
 * every image is a file in `shots/` or `refs/`.
 */

import {readFile, writeFile, stat} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {dirname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DATA} from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shotsDir = process.argv[2] ?? join(here, 'shots')
const rel = p => relative(here, p).split('\\').join('/')
const transcript = JSON.parse(await readFile(join(shotsDir, 'transcript.json'), 'utf8'))
const report = JSON.parse(await readFile(join(shotsDir, 'report.json'), 'utf8'))

// --- transcript: the commands as run, without the bulky inspect payloads -------------------------
const trimmed = {
    summary: transcript.summary,
    note: 'inspect {detail} payloads (vertex, face and edge lists) are elided to keep this file small; '
        + 'counts are kept. Every command is listed in the order it ran.',
    operations: transcript.operations.map(o => {
        const r = {...o.result}
        if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
            const d = {...r.data}
            for (const k of ['vertices', 'faceVerts', 'edgeVerts', 'dataUrl']) if (d[k]) d[k] = `[${d[k].length ?? ''} elided]`
            r.data = d
        }
        const c = {...o.command}
        if (Array.isArray(c.verts) && c.verts.length > 12) c.verts = `[${c.verts.length} computed vertex positions elided]`
        if (Array.isArray(c.path) && c.path.length > 40) c.path = `[${c.path.length} path points elided]`
        return {command: c, ok: r.ok, data: r.data, error: r.error, warnings: r.warnings, ms: r.ms, capture: o.capture}
    }),
}
await writeFile(join(here, 'transcript.json'), JSON.stringify(trimmed, null, 1))

// The session writes PNGs (34 MB for this build); the page uses JPEG copies, which are what is committed.
const captures = transcript.operations.filter(o => o.capture).map(o => {
    const jpg = o.capture.replace(/\.png$/, '.jpg')
    const r = spawnSync('convert', [join(shotsDir, o.capture), '-quality', '86', join(shotsDir, jpg)])
    if (r.status !== 0) throw new Error(`could not convert ${o.capture}: ${r.stderr}`)
    return {file: rel(join(shotsDir, jpg)), label: o.command.label}
})
const shot = start => {
    const c = captures.find(x => x.label.startsWith(start))
    if (!c) throw new Error(`no capture labelled "${start}…"`)
    return c
}
const presentationStart = captures.findIndex(c => c.label.startsWith('hero'))
const strip = captures.slice(0, presentationStart)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const s = transcript.summary
const t = report.totals
const allFaces = report.topo.reduce((a, o) => a + o.faces, 0)
const allQuads = report.topo.reduce((a, o) => a + o.quads, 0)
const passed = report.checks.filter(c => c.ok).length
const glb = await stat(join(here, 'haussmann.glb')).then(x => (x.size / 1e6).toFixed(1) + ' MB').catch(() => null)

const pairs = [
    ['refs/photo-rue-monge-corner-thbz.jpg', 'Rue Monge, a Haussmann corner (Thierry Bézecourt, CC BY-SA 3.0)',
        shot('three-quarter on the cut corner'), 'The model from the same side of its cut corner'],
    ['refs/daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg', 'Daly 1870, Exemple M2 Pl. 1: the boulevard elevation, 1:100',
        shot('orthographic, wireframe over'), 'Orthographic, registered on the drawing: wireframe over the engraving'],
    ['refs/daly-1870-m2-pl1-elevation-77-bd-sebastopol.jpg', 'The same elevation',
        shot('orthographic, the model alone'), 'The model alone, same camera'],
    ['refs/daly-1870-m2-pl3-plans-77-bd-sebastopol.jpg', 'Daly 1870, Exemple M2 Pl. 3: plans of the upper floors, 1:200',
        shot('top, wireframe over'), 'Top view, wireframe over the plan'],
    ['refs/photo-typical-paris-corner-7e-flyer84.jpg', 'A Paris corner, 7e (Flyer84, CC BY 3.0): mansard, dormers, stacks',
        shot('rue Palestro'), 'Rue Palestro and the upper cut corner'],
    ['refs/photo-rue-de-la-glaciere-corner-vvvcffrance.jpg', 'Rue de la Glacière (VVVCFFrance, CC BY-SA 4.0): balconies round a cut corner',
        shot('hero'), 'Street level, from the rue Greneta corner'],
]

const issues = [
    ['command-array-curve-frames-z-up.md', 'Curve array keeps Blender\'s Z-up frames in a Y-up scene',
        'Railings on a ground-plane path came out upside down on some runs; built Z-up and stood up by hand.'],
    ['command-material-no-face-slots.md', 'No per-face material slots',
        'Glass had to be separated from the stone, leaving a hole per window in the façade mesh.'],
    ['command-inset-individual-ignores-outset.md', 'Individual inset silently ignores outset',
        'Balcony slabs grow outward only with a negative thickness, which nothing tells you.'],
    ['session-wait-timeout-ignored.md', 'Session harness waited 30 s, not 90 s, for the page (fixed here)',
        'On a loaded machine every session died before the build began.'],
    ['command-no-edge-listing.md', 'Edges could not be addressed (fixed on modelling-editor, cherry-picked)',
        'Bevelling the cornice soffit and the balcony noses needs edge indices; `inspect` now lists them.'],
    ['command-sweep-profile-orientation.md', 'Sweep profile orientation (open, from the Eiffel build)',
        'Avoided: mouldings are made by region inset rather than swept profiles.'],
    ['03-agent-modelling-api.md', 'No booleans yet (waits on manifold-3d)',
        'Shop fronts and dormer cheeks would be cut cleanly into the wall and the roof; here the dormers simply sit in the brisis.'],
]

const dims = [
    ['Cornice above the pavement', `${DATA.L.eave.toFixed(2)} m`, 'Pl. 1, rows 2345 → 893 at 72.8 px/m; the 1859 limit is 20 m'],
    ['Storey lines (floors 1-5)', ['F1', 'F2', 'F3', 'F4', 'F5'].map(k => DATA.L[k].toFixed(2)).join(' / ') + ' m', 'Pl. 1, rows 2050 / 1805 / 1550 / 1335 / 1110'],
    ['Top of the brisis; chimney tops', `${DATA.L.brisisTop.toFixed(2)} m; ${DATA.L.chimney.toFixed(2)} m`, 'Pl. 1, rows 700 and 640'],
    ['Boulevard front', `${DATA.SEB_LENGTH.toFixed(2)} m, 6 bays at ${DATA.BAY.toFixed(3)} m, windows ${DATA.WIN.toFixed(2)} m`, 'Pl. 1, columns 515-1602; window leaves of the 2nd floor'],
    ['Depth, boulevard to rue Palestro', `${DATA.DEPTH.toFixed(2)} m`, `Pl. 3, rows 682-1269, calibrated on the six bays (${DATA.PLAN.pxPerM.toFixed(2)} px/m)`],
    ['Rue Greneta', `${Math.hypot(DATA.D[0] - DATA.C[0], DATA.D[1] - DATA.C[1]).toFixed(2)} m at ${(Math.atan(0.4726) * 180 / Math.PI).toFixed(1)}° off square`, 'Pl. 3, line fitted to the six piers'],
    ['Cut corners', `${Math.hypot(DATA.E[0] - DATA.D[0], DATA.E[1] - DATA.D[1]).toFixed(2)} m (boulevard) and ${Math.hypot(DATA.C[0] - DATA.B[0], DATA.C[1] - DATA.B[1]).toFixed(2)} m (Palestro)`, 'Pl. 3'],
    ['Balconies', '0.50 m deep, on the 2nd, 4th and 5th floors; balconettes on the 3rd; guards on the 1st', 'Pl. 3 outline; Pl. 1'],
    ['Roof', '45° brisis, 2.65 m high; terrasson 3.2 m deep rising 0.35 m', '1859 decree (45° line from the eaves); Pl. 1'],
]

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Haussmann, by command - 77 boulevard de Sébastopol</title>
<style>
  :root { --paper: #f4efe6; --ink: #231d17; --muted: #6f6558; --brass: #a8814a; --stone: #ddd0b6; --line: #d8cdbb; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 Georgia, 'Times New Roman', serif; }
  header.hero { position: relative; min-height: 78vh; display: flex; align-items: flex-end; color: #fff;
    background: #222 url("${esc(shot('hero').file)}") center 40%/cover no-repeat; }
  header.hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(transparent 45%, #000b); }
  header.hero div { position: relative; z-index: 1; padding: 0 6vw 6vh; max-width: 1100px; }
  h1 { font-weight: 400; font-size: clamp(34px, 5vw, 64px); margin: 0 0 .2em; letter-spacing: -.01em; }
  header p { margin: 0; font-size: 18px; max-width: 760px; }
  .stats { display: flex; gap: 2.4em; flex-wrap: wrap; margin-top: 1.4em; font: 13px/1.3 ui-monospace, Menlo, monospace; }
  .stats b { display: block; font: 400 26px/1.1 Georgia, serif; color: #f1d9ad; }
  main { max-width: 1240px; margin: 0 auto; padding: 0 4vw 6em; }
  section { margin-top: 4.5em; }
  h2 { font-weight: 400; font-size: 30px; margin: 0 0 .2em; border-bottom: 1px solid var(--line); padding-bottom: .25em; }
  h2 small { font-size: 14px; color: var(--muted); margin-left: .6em; }
  .lede { color: var(--muted); max-width: 820px; margin: .4em 0 1.4em; }
  figure { margin: 0; }
  figure img, figure video { width: 100%; display: block; background: #ddd; border-radius: 3px; }
  figcaption { font-size: 13px; color: var(--muted); margin-top: .4em; line-height: 1.4; }
  .pairs { display: grid; gap: 2.2em; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; align-items: start; }
  .pair img { aspect-ratio: 3 / 2; object-fit: contain; background: #e9e2d4; }
  .strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 1.1em; counter-reset: step; }
  .strip figure figcaption::before { counter-increment: step; content: counter(step, decimal-leading-zero) '  '; color: var(--brass);
    font: 12px ui-monospace, Menlo, monospace; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: .45em .6em; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 400; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  td.num { font: 13px ui-monospace, Menlo, monospace; text-align: right; white-space: nowrap; }
  td.ok { color: #2f6b3a; } td.bad { color: #a12b1f; }
  tr.total td { border-top: 2px solid var(--ink); font-weight: 600; }
  .note { font-size: 14px; color: var(--muted); }
  ul.issues { list-style: none; padding: 0; display: grid; gap: .9em; }
  ul.issues li { border-left: 3px solid var(--brass); padding: .15em 0 .15em .9em; }
  ul.issues a { color: var(--ink); font-weight: 600; text-decoration-color: var(--brass); }
  code { font: 13px ui-monospace, Menlo, monospace; background: #e9e2d4; padding: .05em .3em; border-radius: 3px; }
  footer { max-width: 1240px; margin: 0 auto; padding: 2em 4vw 4em; font-size: 13px; color: var(--muted); border-top: 1px solid var(--line); }
  @media (max-width: 760px) { .pair, .two { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header class="hero"><div>
  <h1>Haussmann, by command</h1>
  <p>N° 77 boulevard de Sébastopol, Paris - Paul Mesnard, architect, published by César Daly in 1870 -
  modelled to scale from the engraved elevation and plans, entirely through <code>@threepipe/plugin-modelling</code>'s JSON commands.</p>
  <div class="stats">
    <span><b>${s.commands}</b>commands, ${s.failed} failed</span>
    <span><b>${passed}/${report.checks.length}</b>dimension checks within 2 %</span>
    <span><b>${DATA.L.eave.toFixed(2)} m</b>to the cornice (1859 limit: 20 m)</span>
    <span><b>${report.objects}</b>objects</span>
    <span><b>${t.faces.toLocaleString('en')}</b>editable faces, ${(100 * allQuads / allFaces).toFixed(0)} % quads</span>
  </div>
</div></header>
<main>

<section>
  <h2>Reference and result</h2>
  <p class="lede">Every dimension comes from Daly's plates, read in pixels and converted with the plates' own scale bars;
  the street photographs show what the drawings do not - how the balconies and the mansard turn a cut corner, the zinc, the stacks.</p>
  <div class="pairs">
  ${pairs.map(([ref, refCap, sh, shCap]) => `<div class="pair">
    <figure><img src="${esc(ref)}" alt="" loading="lazy"><figcaption>${esc(refCap)}</figcaption></figure>
    <figure><img src="${esc(sh.file)}" alt="" loading="lazy"><figcaption>${esc(shCap)}</figcaption></figure>
  </div>`).join('\n  ')}
  </div>
</section>

<section>
  <h2>The build <small>${strip.length} captures, in order</small></h2>
  <p class="lede">The plan outline (48 vertices: corners and window jambs) is extruded once per storey line; openings are inset,
  recessed and glazed; bands are pushed out of the wall by region inset; the mansard is the top face inset with a depth equal to its width.</p>
  <div class="strip">
  ${strip.map(c => `<figure><img src="${esc(c.file)}" alt="" loading="lazy"><figcaption>${esc(c.label)}</figcaption></figure>`).join('\n  ')}
  </div>
</section>

<section>
  <h2>Wireframe and x-ray</h2>
  <div class="two">
    <figure><img src="${esc(shot('wireframe').file)}" alt="" loading="lazy"><figcaption>Wireframe: the façade is quads, bay by bay and band by band.</figcaption></figure>
    <figure><img src="${esc(shot('x-ray').file)}" alt="" loading="lazy"><figcaption>X-ray (30 % opacity): window reveals, the two roof slopes, balcony slabs inside their railings.</figcaption></figure>
    <figure><img src="${esc(shot('mansard').file)}" alt="" loading="lazy"><figcaption>The roof end-on, from the party wall: a 45° brisis each side, as the 1859 decree allowed.</figcaption></figure>
    <figure><img src="${esc(shot('the boulevard front').file)}" alt="" loading="lazy"><figcaption>The boulevard front from across the street.</figcaption></figure>
  </div>
</section>

<section>
  <h2>Dimensions <small>measured from the finished model</small></h2>
  <p class="lede">The build measures the model after it is finished - wall vertices, object bounds, the glass panes - and throws if
  any value is more than 2 % off the drawing.</p>
  <table>
    <thead><tr><th>Check</th><th>Source</th><th class="num">Drawing</th><th class="num">Model</th><th class="num">Δ</th><th class="num">Δ %</th></tr></thead>
    <tbody>
    ${report.checks.map(c => `<tr><td>${esc(c.what)}</td><td class="note">${esc(c.source)}</td><td class="num">${c.want.toFixed(3)}</td>`
        + `<td class="num">${c.got.toFixed(3)}</td><td class="num">${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(3)}</td>`
        + `<td class="num ${c.ok ? 'ok' : 'bad'}">${c.want ? (100 * c.delta / c.want).toFixed(2) : '-'}</td></tr>`).join('\n    ')}
    </tbody>
  </table>
  <h3 style="font-weight:400;margin-top:2em">Readings</h3>
  <table>
    <thead><tr><th>Quantity</th><th>Value</th><th>Where it comes from</th></tr></thead>
    <tbody>${dims.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td class="note">${esc(c)}</td></tr>`).join('')}</tbody>
  </table>
  <p class="note">The plan's own scale bar (35.57 px/m) disagrees with the elevation by ${(100 * (DATA.PLAN.pxPerM / 35.57 - 1)).toFixed(1)} %: it
  would put the six boulevard bays ${(439.5 / 5 / 35.57).toFixed(2)} m apart against the elevation's ${DATA.BAY.toFixed(3)} m. The elevation is
  twice the scale and puts the cornice on the 20 m of the 1859 decree, so the plan is calibrated on the same six bays instead
  (${DATA.PLAN.pxPerM.toFixed(2)} px/m). Even so, the plan draws the party wall ${((1397 - DATA.PLAN.origin) / DATA.PLAN.pxPerM - DATA.SEB_LENGTH).toFixed(2)} m
  beyond the elevation's edge; the elevation stops at the wall's axis and the plan draws all of it, which explains about half of
  that. The model follows the elevation.</p>
</section>

<section>
  <h2>Counts and topology</h2>
  <p class="lede">Editable masters, as <code>inspect</code> reports them; live arrays (railings, dormers, pots) are counted once.
  ${report.evaluated ? `The viewer draws ${report.evaluated.triangles.toLocaleString('en')} triangles in ${report.evaluated.meshes} meshes.` : ''}
  ${glb ? `The exported <a href="haussmann.glb">haussmann.glb</a> is ${glb}.` : ''}</p>
  <table>
    <thead><tr><th>Object</th><th class="num">Verts</th><th class="num">Edges</th><th class="num">Faces</th><th class="num">Quads</th><th class="num">Tris</th><th class="num">N-gons</th><th class="num">Boundary edges</th><th class="num">Non-manifold</th></tr></thead>
    <tbody>
    ${report.topo.map(o => `<tr><td>${esc(o.name)}</td><td class="num">${o.verts}</td><td class="num">${o.edges}</td><td class="num">${o.faces}</td>`
        + `<td class="num">${o.quads}</td><td class="num">${o.tris}</td><td class="num">${o.ngons}</td><td class="num">${o.boundary}</td><td class="num">${o.nonManifold}</td></tr>`).join('\n    ')}
    <tr class="total"><td>Total</td><td class="num">${t.verts}</td><td class="num">${t.edges}</td><td class="num">${t.faces}</td>
      <td class="num">${allQuads} (${(100 * allQuads / allFaces).toFixed(1)} %)</td><td class="num">${report.topo.reduce((a, o) => a + o.tris, 0)}</td>
      <td class="num">${report.topo.reduce((a, o) => a + o.ngons, 0)}</td><td class="num">${report.topo.reduce((a, o) => a + o.boundary, 0)}</td>
      <td class="num">${report.topo.reduce((a, o) => a + o.nonManifold, 0)}</td></tr>
    </tbody>
  </table>
  <p class="note">Boundary edges are expected and accounted for: the façade's are exactly the rims of the holes the glass and
  the doors were separated from (one loop per pane; together the three objects are closed - see
  <a href="../../issues/open/modelling-tools/command-material-no-face-slots.md">no per-face materials</a>), the dormers' are
  their panes, the roof's is its eave, sitting on the wall, and the road is a plane. Nothing is non-manifold.</p>
</section>

<section>
  <h2>The film</h2>
  <p class="lede">The build run live in the page, cut to the storyboard in <a href="direction.md">direction.md</a> by
  <code>record.mjs</code>.</p>
  <figure><video src="video.webm" controls preload="metadata" poster="${esc(shot('hero').file)}"></video></figure>
</section>

<section>
  <h2>What the API lacked</h2>
  <ul class="issues">
  ${issues.map(([f, title, why]) => `<li><a href="../../issues/open/modelling-tools/${f}">${esc(title)}</a><br><span class="note">${esc(why)}</span></li>`).join('\n  ')}
  </ul>
</section>
</main>
<footer>
  Drawings: César Daly, <i>L'architecture privée au XIXe siècle</i>, série 1, t. 2, Paris 1870, Exemple M2 (N° 77 bd de Sébastopol, Paul Mesnard)
  and A2 - Heidelberg University Library, Public Domain Mark. Photographs: Wikimedia Commons, see <a href="refs/SOURCES.md">refs/SOURCES.md</a>.
  Build: <a href="build.mjs">build.mjs</a> · transcript: <a href="transcript.json">transcript.json</a> · median command ${s.medianMs} ms.
</footer>
</body>
</html>
`
await writeFile(join(here, 'index.html'), html)
console.log(`index.html: ${captures.length} captures, ${report.checks.length} checks; transcript.json trimmed`)
