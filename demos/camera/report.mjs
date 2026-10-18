/**
 * Write `index.html`, the visual report, from what the session run produced: `transcript.json`
 * (commands, results, capture file names), `checks.json` (dimension checks and per-object topology,
 * written by `build.mjs`) and the files in `shots/`. Nothing in the page is typed in by hand - rerun
 * the build and then this, and the numbers follow.
 *
 *     node demos/camera/report.mjs
 */

import {readFile, writeFile, stat} from 'node:fs/promises'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const transcript = JSON.parse(await readFile(join(here, 'transcript.json'), 'utf8'))
const {checks, photo = [], topology, total, parts} = JSON.parse(await readFile(join(here, 'checks.json'), 'utf8'))
const exists = async f => stat(join(here, f)).then(() => true, () => false)

const ops = transcript.operations
const shots = ops.filter(o => o.capture).map(o => ({file: `shots/${o.capture}`, label: o.command.label}))
const shot = label => shots.find(s => s.label === label)?.file
const failed = ops.filter(o => !o.result.ok).length
const opCounts = {}
for (const o of ops) opCounts[o.command.op] = (opCounts[o.command.op] ?? 0) + 1
const quadPct = (100 * total.quads / total.faces).toFixed(1)
const video = await exists('video.webm')

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
/** Escaped, with `code` spans. */
const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')
const fig = (file, caption, cls = '') => file
    ? `<figure class="${cls}"><img src="${file}" alt="${esc(caption)}" loading="lazy"><figcaption>${esc(caption)}</figcaption></figure>`
    : ''

const issues = [
    ['command-no-edge-listing.md', 'Edge indices could not be discovered — fixed here: `inspect {detail}` now lists `edgeVerts`'],
    ['command-camera-duration-ignored.md', '`camera {duration}` only animates saved views; every move in the video is tweened client-side'],
    ['command-inspect-no-topology-stats.md', '`inspect` gives no quad/tri/n-gon mix or manifoldness; the table below is computed from full detail dumps'],
    ['command-material-no-slots.md', 'One material per object: the monitor, top LCD and eyepiece glass are separate objects instead of face material slots'],
    ['command-reference-no-image-rotation.md', '`reference` cannot rotate an image; the lens elevation ships as a rotated copy'],
    ['command-reference-update-resets-plane.md', 'Bug, fixed here: `reference {name, visible}` moved the plane to `front`, so `ref:back` looked at the front'],
    ['command-display-wireframe-triangles.md', '`display {mode: "wireframe"}` draws the triangulation; the edge close-ups are `duplicate` + `wireframe` struts instead'],
    ['command-sweep-profile-orientation.md', '(known) sweep profile axes undocumented, no tilt; every sweep here uses a symmetric section'],
    ['03-agent-modelling-api.md', '(known) no booleans: the grip, prism and dials are separate closed shells that interpenetrate the body'],
]

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Canon EOS 5D Mark IV, to scale — threepipe modelling demo</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --ink: #16171a; --mute: #6b6e76; --line: #e2e4e8; --red: #c0101c; --bg: #f6f7f9; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; color: var(--ink); background: var(--bg); }
  header { background: #0d0e10; color: #f2f2f4; padding: 40px 6vw 28px; }
  header .k { font: 600 12px ui-monospace, monospace; letter-spacing: .2em; color: var(--red); }
  header h1 { font-weight: 300; font-size: 40px; margin: 8px 0 4px; letter-spacing: .01em; }
  header p { color: #9a9ca4; margin: 0; max-width: 70ch; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px 28px; margin-top: 22px; }
  .stats div { font: 13px ui-monospace, monospace; color: #c9cbd1; }
  .stats b { display: block; font: 300 26px ui-sans-serif, system-ui, sans-serif; color: #fff; }
  main { padding: 10px 6vw 60px; }
  h2 { font-weight: 400; font-size: 22px; margin: 44px 0 6px; border-top: 1px solid var(--line); padding-top: 18px; }
  h2 small { color: var(--mute); font-size: 14px; margin-left: 10px; }
  p.lead { color: var(--mute); margin: 0 0 14px; max-width: 80ch; }
  figure { margin: 0; background: #fff; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  figure img, figure video { display: block; width: 100%; height: auto; background: #e8eaee; }
  figcaption { font-size: 12.5px; color: var(--mute); padding: 6px 10px; }
  .hero { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
  .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
  .trio figure img { aspect-ratio: 3 / 2; object-fit: contain; }
  .strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .strip figcaption::before { content: attr(data-n) "  "; color: var(--red); font-family: ui-monospace, monospace; }
  .pair { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid var(--line); font-size: 13.5px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
  th { font-weight: 600; color: var(--mute); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  td.n { font-family: ui-monospace, monospace; text-align: right; }
  .ok { color: #11823b; font-weight: 600; } .bad { color: var(--red); font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
  ul.issues { padding-left: 18px; } ul.issues li { margin: 4px 0; } code { font-size: 12.5px; background: #eceef1; padding: 1px 4px; border-radius: 3px; }
  a { color: var(--red); }
  .note { font-size: 13px; color: var(--mute); }
  @media (max-width: 900px) { .hero, .cols, .trio, .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <div class="k">THREEPIPE · @threepipe/plugin-modelling · LAUNCH DEMO</div>
  <h1>Canon EOS 5D Mark IV + EF 24-105mm f/4L IS USM</h1>
  <p>Modelled to scale from product photographs and published dimensions, entirely through the JSON command API —
  no imported meshes, no typed-in vertices. Lathe for the lens, sweep for the grip, eyecup and lugs, inset and
  bisect for the recesses, bevel on every product edge.</p>
  <div class="stats">
    <div><b>${ops.length}</b>commands</div>
    <div><b>${failed}</b>failed</div>
    <div><b>${checks.filter(c => c.ok).length}/${checks.length}</b>dimension checks ≤ 2 %</div>
    <div><b>${topology.length}</b>objects</div>
    <div><b>${total.verts.toLocaleString('en')}</b>vertices</div>
    <div><b>${total.faces.toLocaleString('en')}</b>faces</div>
    <div><b>${quadPct} %</b>quads</div>
    <div><b>${total.manifold}/${topology.length}</b>closed manifolds</div>
  </div>
</header>
<main>

<h2>Hero <small>render vs. photograph</small></h2>
<div class="hero">
  ${fig(shot('hero, three-quarter front'), 'The model, from the photograph\'s viewpoint (fov 22°)')}
  ${fig('refs/hero-5d4-ef24-105.jpg', 'Photograph: 根川孝太郎, CC BY-SA 4.0 (refs/SOURCES.md)')}
</div>

<h2>Against the references <small>orthographic, registered to each calibrated plane</small></h2>
<p class="lead">Each photograph is placed on a world plane by two points and a published distance
(<code>reference {calibrate}</code>); <code>camera {view: "ref:…"}</code> then frames the model exactly as the photo frames the camera.</p>
<div class="trio">
  ${fig('refs/body-mount.jpg', 'Front photograph (CEphoto, Uwe Aranas)')}
  ${fig(shot('front over the photograph'), 'Model over the front photograph')}
  ${fig(shot('front, model only'), 'Model, front')}
</div>
<div class="trio">
  ${fig('refs/body-rear.jpg', 'Rear photograph (CEphoto, Uwe Aranas)')}
  ${fig(shot('back over the photograph'), 'Model over the rear photograph')}
  ${fig(shot('back, model only'), 'Model, back')}
</div>
<div class="trio">
  ${fig('refs/lens-side-rotated.jpg', 'Lens elevation (Jinho Jung), turned to lie along +Z')}
  ${fig(shot('side over the lens elevation'), 'Model over the lens elevation')}
  ${fig(shot('side, model only'), 'Model, side')}
</div>
<div class="trio">
  ${fig('refs/body-three-quarter.jpg', 'No CC top view exists; three-quarter photograph for the top plate')}
  ${fig(shot('top, model only'), 'Model, top')}
  ${fig('refs/lens-optical-diagram.png', 'Optical diagram of the lens (Alessio Facchin) - 18 elements, 13 groups; the front element is the only glass modelled')}
</div>

<h2>The build <small>captures in order, as the session took them</small></h2>
<div class="strip">
${shots.filter(s => !/^turntable|^hero|^front|^back|^side|^top|^bevelled|knurling|^x-ray/.test(s.label))
        .map((s, i) => fig(s.file, s.label).replace('<figcaption>', `<figcaption data-n="${String(i + 1).padStart(2, '0')}">`)).join('\n')}
</div>

<h2>Close-ups <small>wireframe and x-ray</small></h2>
<div class="pair">
  ${fig(shot('bevelled corners and grip, from behind'), 'Bevelled corners: 6-segment silhouette rounds, 3-segment edge rounds')}
  ${fig(shot('bevelled corners, mesh edges'), 'The same, every mesh edge drawn as a strut')}
  ${fig(shot('lens knurling, mesh edges'), 'Focus and zoom ribs: every other face inset and sunk')}
  ${fig(shot('mode dial knurling, mesh edges'), 'Mode dial knurl, mesh edges')}
  ${fig(shot('mode dial knurling'), 'Mode dial knurl')}
  ${fig(shot('x-ray: mount and bayonet inside the shell'), 'X-ray: the bayonet seated on the body flange at 73 mm')}
  ${fig(shot('turntable 1'), 'Turntable')}
  ${fig(shot('turntable 3'), 'Turntable, from behind')}
</div>

<h2>Video <small>direction.md</small></h2>
${video ? `<figure><video src="video.webm" controls preload="metadata"></video><figcaption>Recorded by record.mjs: the build running live, with the storyboard in direction.md.</figcaption></figure>`
        : '<p class="note">video.webm is not in this folder (it is not committed); run <code>node demos/camera/record.mjs</code>.</p>'}

<div class="cols">
<section>
<h2>Dimension checks <small>measured off the model; the build throws above 2 %</small></h2>
<table>
<tr><th>Check</th><th>Expected</th><th>Measured</th><th>Δ</th><th>%</th><th></th></tr>
${checks.map(c => `<tr><td>${esc(c.what)}<br><span class="note">${esc(c.source)}</span></td><td class="n">${c.expected.toFixed(2)}</td><td class="n">${c.measured.toFixed(2)}</td><td class="n">${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(2)}</td><td class="n">${c.pct.toFixed(2)}</td><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? 'ok' : 'FAIL'}</td></tr>`).join('\n')}
</table>
<p class="note">All lengths in mm. The checks pin the published numbers (body 150.7 × 116.4 × 75.9, lens 83.5 × 107,
77 mm filter, 54 mm EF throat, 3.2-inch 3:2 monitor, ISO 518 shoe channel). What is <em>read off photographs</em>
(axis offset, button positions, the prism slope) carries ±1–2 mm and is listed in refs/SOURCES.md, not here.
These numbers are inputs, so a pass means the operations kept them - bevel clamping, insets and
sweeps did not eat into a dimension - not that the shape is right. The shoe check caught a real error that way: an inset
wider than the corner bevel inverts the corners. Whether the <em>shape</em> is right is the next table.</p>
${photo.length ? `<h2>Against the photographs <small>readings the build was not given; reported, not enforced</small></h2>
<table>
<tr><th>Feature</th><th>Photo</th><th>Model</th><th>Δ</th><th>%</th></tr>
${photo.map(c => `<tr><td>${esc(c.what)}<br><span class="note">${esc(c.source)}</span></td><td class="n">${c.photo.toFixed(1)}</td><td class="n">${c.measured.toFixed(1)}</td><td class="n">${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(1)}</td><td class="n">${c.pct.toFixed(1)}</td></tr>`).join('\n')}
</table>
<p class="note">Read off the photographs at their calibrated scale (refs/SOURCES.md); both are perspective shots and the
front one is yawed a few degrees, so a few percent either way is within the reading.</p>` : ''}
</section>
<section>
<h2>Topology <small>per object, from inspect detail</small></h2>
<table>
<tr><th>Object</th><th>V</th><th>E</th><th>F</th><th>quads</th><th>tris</th><th>n-gons</th><th>closed</th></tr>
${topology.map(t => `<tr><td>${esc(t.name)}</td><td class="n">${t.verts}</td><td class="n">${t.edges}</td><td class="n">${t.faces}</td><td class="n">${t.quads}</td><td class="n">${t.tris}</td><td class="n">${t.ngons}</td><td class="${t.manifold ? 'ok' : 'bad'}">${t.manifold ? 'yes' : `${t.boundary} open`}</td></tr>`).join('\n')}
<tr><th>Total</th><th>${total.verts}</th><th>${total.edges}</th><th>${total.faces}</th><th>${total.quads}</th><th>${total.tris}</th><th>${total.ngons}</th><th>${total.manifold}/${topology.length}</th></tr>
</table>
<p class="note">N-gons are the caps Blender would also leave as n-gons (lathe and sweep caps, inset and bisect faces);
triangles are the apex fans of lathed buttons and the icosphere index mark.</p>
</section>
</div>

<h2>Commands used</h2>
<p class="lead">${Object.entries(opCounts).sort((a, b) => b[1] - a[1]).map(([op, n]) => `<code>${op}</code> ×${n}`).join(' · ')}</p>
<table>
<tr><th>Part</th><th>How</th></tr>
${parts.map(p => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.what)}</td></tr>`).join('\n')}
</table>

<h2>What the API lacked <small>issues filed while building</small></h2>
<ul class="issues">
${issues.map(([f, t]) => `<li><a href="../../issues/open/modelling-tools/${f}">${f}</a> — ${md(t)}</li>`).join('\n')}
</ul>

<p class="note">Files: <a href="build.mjs">build.mjs</a> · <a href="transcript.json">transcript.json</a> ·
<a href="camera.glb">camera.glb</a> · <a href="direction.md">direction.md</a> · <a href="record.mjs">record.mjs</a> ·
<a href="refs/SOURCES.md">refs/SOURCES.md</a> · <a href="report.mjs">report.mjs</a> (writes this page from the transcript).</p>
</main>
</body>
</html>
`
await writeFile(join(here, 'index.html'), html)
console.log(`index.html: ${shots.length} captures, ${checks.length} checks, ${topology.length} objects`)
