/**
 * report.mjs - a demo's visual report page (demos/<name>/index.html) from its film and build data.
 *
 *     node demos/shared/report.mjs demos/<name> [--film <dir with film.json, transcript.json, stills/>]
 *
 * Reads `demos/<name>/report.json` (written by hand or by the demo's scripts: title, intro, stills to show, metrics,
 * notes) and the film's `film.json` + `transcript.json`; writes `shots/*.jpg` (1600 px stills, small enough to
 * commit), `transcript.json` (the commands the film ran) and `index.html`. The video (`video.mp4`) is not committed;
 * the page plays it when it is next to it, with chapter links that seek.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import sharp from 'sharp'

const dir = process.argv[2]
const args = process.argv.slice(3)
const filmDir = args.includes('--film') ? args[args.indexOf('--film') + 1] : join(dir, 'film')
const R = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))
const film = JSON.parse(readFileSync(join(filmDir, 'film.json'), 'utf8'))
const transcript = existsSync(join(filmDir, 'transcript.json')) ? JSON.parse(readFileSync(join(filmDir, 'transcript.json'), 'utf8')) : []

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])
const fmtS = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// ------------------------------------------------------------------------------------------- stills
mkdirSync(join(dir, 'shots'), {recursive: true})
const shots = []
for (const s of [R.hero, ...(R.stills ?? []), ...(R.compare ?? []).flat()].filter(Boolean)) {
    const file = typeof s === 'string' ? s : s.file
    const src = join(filmDir, 'stills', `${file}.jpg`)
    if (!existsSync(src)) { console.warn('missing still', src); continue }
    const dst = join(dir, 'shots', `${file}.jpg`)
    await sharp(src).resize({width: 1600}).jpeg({quality: 86, mozjpeg: true}).toFile(dst)
    shots.push(dst)
}

// ------------------------------------------------------------------------------------------- transcript (commands only)
const commands = transcript.filter(t => !t.film)
writeFileSync(join(dir, 'transcript.json'), JSON.stringify({summary: {renderer: film.renderer, commands: commands.length,
    failed: commands.filter(t => !t.ok).length, commandMs: film.commandMs, generated: new Date().toISOString().slice(0, 10)},
operations: commands.map(t => ({command: t.command, ok: t.ok, ms: t.ms, ...(t.error ? {error: t.error} : {}), ...(t.warnings ? {warnings: t.warnings} : {})}))}))
const opCounts = {}
for (const t of commands) opCounts[t.command.op] = (opCounts[t.command.op] ?? 0) + 1

// dimension checks the build measured off the model (haussmann: film.report.checks, stair: film.result.checks)
const fc = film.report?.checks ?? film.result?.checks
if (!R.checks && fc?.length) R.checks = [['check', 'reference', 'model', 'off', ''], ...fc.map(c => [c.what, c.want, c.got,
    c.delta !== undefined ? c.delta : `${c.err}%`, c.ok ? 'PASS' : 'FAIL'])]
if (fc?.length) (R.metrics ??= []).push(['dimension checks', `${fc.filter(c => c.ok).length} / ${fc.length}`, R.checksNote ?? 'measured off the finished model against the drawings; a miss over 2 % fails the build'])

// ------------------------------------------------------------------------------------------- page
// Measured by the film on the GPU, then the demo's own (build wall time, agent cost, checks).
const st = film.stats ?? {}
const nCmd = commands.length, nFail = commands.filter(t => !t.ok).length
const m = [
    ...(R.metricsFirst ?? []),
    ['commands', `${nCmd}`, `${nFail} failed${R.commandsNote ? ' · ' + R.commandsNote : ''}`],
    ...(st.tris ? [['triangles', st.tris.toLocaleString('en'), `${st.objects} objects · ${(st.verts ?? 0).toLocaleString('en')} verts evaluated`]] : []),
    ['command time (GPU page)', `${(film.commandMs / 1000).toFixed(2)} s`, 'sum of the commands\' own ms in the browser'],
    ...(film.frameMs ? [['frame (GPU)', `${film.frameMs.median} ms`, `median of 60 forced renders + gl.finish; p90 ${film.frameMs.p90} ms`]] : []),
    ['video', fmtS(film.seconds), `${film.width}×${film.height}, ${film.fps} fps, H.264`],
    ...(R.metrics ?? []),
]
const metric = ([k, v, note]) => `<div class="m"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${note ? `<div class="n">${esc(note)}</div>` : ''}</div>`
const still = s => {
    const file = typeof s === 'string' ? s : s.file
    const cap = typeof s === 'string' ? '' : s.caption
    return `<figure><a href="shots/${file}.jpg"><img loading="lazy" src="shots/${file}.jpg" alt="${esc(cap)}"></a>${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`
}
const chapters = (film.chapters ?? []).map(c => `<button onclick="seek(${c.t})">${esc(c.name)} <span>${fmtS(c.t)}</span></button>`).join('')
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(R.title)} - threepipe modelling demo</title>
<style>
:root { --bg: #0f1012; --fg: #ececee; --mut: #9a9ca4; --line: #26282d; --acc: ${R.accent ?? '#c0101c'}; }
* { box-sizing: border-box } body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif }
main { max-width: 1240px; margin: 0 auto; padding: 32px 24px 80px }
a { color: inherit } .back { color: var(--mut); text-decoration: none; font-size: 14px }
h1 { font-weight: 300; font-size: 44px; margin: 10px 0 6px; letter-spacing: -.01em } h2 { font-weight: 500; font-size: 22px; margin: 48px 0 14px; padding-top: 18px; border-top: 1px solid var(--line) }
.kick { font: 600 13px ui-monospace, Menlo, monospace; letter-spacing: .2em; text-transform: uppercase; color: var(--acc) }
.intro { color: #c9cad0; max-width: 860px; font-size: 18px }
.hero img { width: 100%; display: block; border-radius: 6px; margin-top: 22px }
video { width: 100%; border-radius: 6px; background: #000; display: block }
.chapters { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 } .chapters button { background: #1a1b1f; color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 5px 10px; font: 13px system-ui; cursor: pointer } .chapters span { color: var(--mut); margin-left: 4px }
.novideo { padding: 40px; text-align: center; color: var(--mut); border: 1px dashed var(--line); border-radius: 6px; display: none }
.metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px }
.m { background: #17181b; border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px } .m .k { color: var(--mut); font-size: 12px; text-transform: uppercase; letter-spacing: .08em } .m .v { font-size: 21px; margin-top: 2px; word-break: break-word } .m .n { color: var(--mut); font-size: 12px; margin-top: 4px }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px } figure { margin: 0 } figure img { width: 100%; display: block; border-radius: 4px } figcaption { color: var(--mut); font-size: 14px; margin-top: 6px }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px }
table { border-collapse: collapse; width: 100%; font-size: 14px } td, th { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left } th { color: var(--mut); font-weight: 500 }
pre { background: #141518; border: 1px solid var(--line); border-radius: 6px; padding: 14px; overflow: auto; font: 13px/1.5 ui-monospace, Menlo, monospace; max-height: 420px }
.ops { display: flex; flex-wrap: wrap; gap: 6px } .ops span { background: #1a1b1f; border: 1px solid var(--line); border-radius: 3px; padding: 2px 8px; font: 13px ui-monospace, Menlo, monospace } .ops b { color: var(--acc); font-weight: 600 }
ul { padding-left: 20px } li { margin: 4px 0 } .renderer { font: 13px ui-monospace, Menlo, monospace; color: var(--mut) }
</style></head><body><main>
<a class="back" href="../index.html">← all demos</a>
<div class="kick">${esc(R.kicker ?? 'threepipe modelling demo')}</div>
<h1>${esc(R.title)}</h1>
<p class="intro">${R.intro ?? ''}</p>
${R.hero ? `<div class="hero"><img src="shots/${typeof R.hero === 'string' ? R.hero : R.hero.file}.jpg" alt="${esc(R.title)}"></div>` : ''}

<h2>The film</h2>
<video id="v" src="video.mp4" controls preload="metadata" ${R.hero ? `poster="shots/${typeof R.hero === 'string' ? R.hero : R.hero.file}.jpg"` : ''} onerror="this.style.display='none';document.getElementById('nv').style.display='block'"></video>
<div class="novideo" id="nv">video.mp4 is not here (it is not committed), or this browser cannot play H.264 - record it with <code>${esc(R.recordCommand ?? 'record.mjs')}</code> (see direction.md).</div>
<div class="chapters">${chapters}</div>
<p class="renderer">${fmtS(film.seconds)} · ${film.width}×${film.height} · ${film.fps} fps · H.264, faststart · rendered frame by frame on <b>${esc(film.renderer)}</b></p>

<h2>Metrics</h2>
<div class="metrics">${m.map(metric).join('')}</div>

${R.compare?.length ? `<h2>${esc(R.compareTitle ?? 'Before and after')}</h2>${R.compareIntro ? `<p>${R.compareIntro}</p>` : ''}${R.compare.map(([a, b]) => `<div class="pair">${still(a)}${still(b)}</div>`).join('')}` : ''}

<h2>Key steps</h2>
<div class="grid">${(R.stills ?? []).map(still).join('')}</div>

${R.checks?.length ? `<h2>Checks</h2><table><tr>${R.checks[0].map(h => `<th>${esc(h)}</th>`).join('')}</tr>${R.checks.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''}

<h2>How it was made</h2>
${R.how ?? ''}
<p>The film ran <b>${commands.length}</b> commands (${commands.filter(t => !t.ok).length} failed), ${film.commandMs} ms of command time in the page on the GPU. By operation:</p>
<div class="ops">${Object.entries(opCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span><b>${v}</b> ${esc(k)}</span>`).join('')}</div>
<p>The first commands of the transcript (<a href="transcript.json">transcript.json</a> has all of them, with results):</p>
<pre>${esc(commands.slice(0, R.transcriptLines ?? 24).map(t => JSON.stringify(t.command).slice(0, 220)).join('\n'))}\n…</pre>

${R.weak?.length ? `<h2>What still looks weak</h2><ul>${R.weak.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
${R.credits ? `<h2>Credits</h2><p>${R.credits}</p>` : ''}
</main>
<script>function seek(t){const v=document.getElementById('v');v.currentTime=t;v.play()}</script>
</body></html>
`
writeFileSync(join(dir, 'index.html'), html)
// The overview page (demos/index.html, demos/shared/overview.mjs) reads this: one hero and one metrics line per demo.
writeFileSync(join(dir, 'summary.json'), JSON.stringify({title: R.title, blurb: R.blurb ?? '', hero: R.hero ? `shots/${typeof R.hero === 'string' ? R.hero : R.hero.file}.jpg` : null,
    line: R.line ?? [`${nCmd} commands, ${nFail} failed`, st.tris ? `${st.tris.toLocaleString('en')} triangles` : null, `${fmtS(film.seconds)} film`, film.frameMs ? `${film.frameMs.median} ms/frame` : null].filter(Boolean).join(' · '),
    renderer: film.renderer, seconds: film.seconds, generated: new Date().toISOString().slice(0, 10)}, null, 1))
console.log(JSON.stringify({page: join(dir, 'index.html'), shots: shots.length, commands: commands.length}))
