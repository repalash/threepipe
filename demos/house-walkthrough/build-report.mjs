#!/usr/bin/env node
/**
 * Writes the house-walkthrough report: `index.html` (plain HTML + CSS, served at
 * /demos/house-walkthrough/) and `ux-findings.md`, from `run-blender.json`, `run-design.json` (written by
 * drive.mjs) and `findings.mjs`.
 *
 *   node demos/house-walkthrough/build-report.mjs
 */

import {existsSync, readFileSync, writeFileSync, statSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execSync} from 'node:child_process'
import {findings, worked} from './findings.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const runs = ['blender', 'design'].map(k => {
    const p = join(here, `run-${k}.json`)
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}).filter(Boolean)
const fixes = existsSync(join(here, 'fixes.json')) ? JSON.parse(readFileSync(join(here, 'fixes.json'), 'utf8')) : []
const videoInfo = existsSync(join(here, 'videos.json')) ? JSON.parse(readFileSync(join(here, 'videos.json'), 'utf8')) : {}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const shotFor = ref => {
    if (!ref) return null
    if (!ref.startsWith('step:')) return ref
    const [, keymap, id] = ref.split(':')
    return runs.find(r => r.keymap === keymap)?.steps.find(s => s.id === id)?.shot ?? null
}
let commit = ''
try { commit = execSync('git rev-parse --short HEAD', {cwd: here}).toString().trim() } catch {}

// ── ux-findings.md ──
const md = []
md.push('# House walkthrough: UX findings')
md.push('')
md.push('A newcomer (one Blender tutorial, or Figma only) builds a low-poly house in the modelling editor with')
md.push('real keyboard and mouse input, Blender keymap then Design keymap (`drive.mjs`). Ranked: blocking, major,')
md.push('minor. Each finding: what was tried, what happened, what Blender / Figma / Tinkercad do, a screenshot,')
md.push('and where in the editor it comes from. The report page is `index.html` (`/demos/house-walkthrough/`).')
md.push('')
for (const rank of ['blocking', 'major', 'minor']) {
    const list = findings.filter(f => f.rank === rank)
    if (!list.length) continue
    md.push(`## ${rank[0].toUpperCase() + rank.slice(1)}`)
    md.push('')
    list.forEach((f, i) => {
        md.push(`### ${rank[0].toUpperCase()}${i + 1}. ${f.title}`)
        md.push('')
        md.push(`- **Tried:** ${f.tried}`)
        md.push(`- **Happened:** ${f.happened}`)
        md.push(`- **Elsewhere:** ${f.others}`)
        md.push(`- **Where:** ${f.where}`)
        const shot = shotFor(f.shot)
        if (shot) md.push(`- **Screenshot:** [${shot}](./${shot})`)
        if (f.issue?.length) md.push(`- **Issue:** ${f.issue.map(x => x.startsWith('issues/') ? `[${x.split(' ')[0]}](../../${x.split(' ')[0]})${x.includes(' ') ? ' ' + x.slice(x.indexOf(' ') + 1) : ''}` : x).join(', ')}`)
        md.push(`- **Status:** ${f.status}`)
        md.push('')
    })
}
md.push('## What worked')
md.push('')
for (const w of worked) md.push(`- ${w}`)
md.push('')
if (runs.length) {
    md.push('## Runs')
    md.push('')
    md.push('| keymap | steps ok | final mesh (verts, edges, faces) | glb re-opened | seconds |')
    md.push('|---|---|---|---|---|')
    for (const r of runs) {
        const ok = r.steps.filter(s => s.ok).length
        md.push(`| ${r.keymap} | ${ok}/${r.steps.length} | ${JSON.stringify(r.finalCounts ?? null)} | ${r.roundTrip ? JSON.stringify(r.roundTrip.reopened) + (r.roundTrip.same ? ' (same)' : ' (DIFFERENT)') : 'n/a'} | ${r.seconds} |`)
    }
    md.push('')
    const failed = runs.flatMap(r => r.steps.filter(s => !s.ok).map(s => `- ${r.keymap} \`${s.id}\`: ${s.error}`))
    if (failed.length) {
        md.push('Steps that did not complete:')
        md.push('')
        md.push(...failed)
        md.push('')
    }
}
writeFileSync(join(here, 'ux-findings.md'), md.join('\n'))

// ── index.html ──
const badge = rank => `<span class="badge ${rank}">${rank}</span>`
const fmtCounts = c => c ? `${c[0]} verts · ${c[1]} edges · ${c[2]} faces` : 'n/a'
const video = (file, label) => {
    const info = videoInfo[file]
    return `<figure class="video"><video controls preload="metadata" src="${file}"></video>
      <figcaption>${esc(label)}${info ? ` · ${esc(info.duration)} s · ${esc(info.sizeMB)} MB` : ''} · <a href="${file}">${file}</a></figcaption></figure>`
}
const stepCard = (s) => `<li class="step ${s.ok ? 'ok' : 'fail'}">
    ${s.shot ? `<a href="${s.shot}"><img loading="lazy" src="${s.shot}" alt="${esc(s.title)}"></a>` : '<div class="noshot">no screenshot</div>'}
    <div class="meta"><span class="n">${s.n}</span> ${esc(s.title)}</div>
    <div class="keys">${esc(s.keys)}</div>
    ${s.ok ? '' : `<div class="err">${esc(s.error)}</div>`}
    ${s.toasts?.length ? `<div class="toasts">toasts: ${[...new Set(s.toasts)].map(t => esc(t)).join(' · ')}</div>` : ''}
  </li>`
const findingCard = (f, i) => {
    const shot = shotFor(f.shot)
    return `<article class="finding ${f.rank}" id="${f.id}">
    <header>${badge(f.rank)} <h3>${f.rank[0].toUpperCase()}${i + 1}. ${esc(f.title)}</h3></header>
    <div class="cols">
      <dl>
        <dt>Tried</dt><dd>${esc(f.tried)}</dd>
        <dt>Happened</dt><dd>${esc(f.happened)}</dd>
        <dt>Elsewhere</dt><dd>${esc(f.others)}</dd>
        <dt>Where</dt><dd><code>${esc(f.where)}</code></dd>
        ${f.issue?.length ? `<dt>Issue</dt><dd>${f.issue.map(x => `<code>${esc(x)}</code>`).join('<br>')}</dd>` : ''}
        <dt>Status</dt><dd class="status ${f.status.startsWith('fixed') ? 'fixed' : 'filed'}">${esc(f.status)}</dd>
      </dl>
      ${shot ? `<a class="shot" href="${shot}"><img loading="lazy" src="${shot}" alt="${esc(f.title)}"></a>` : ''}
    </div>
  </article>`
}
const ranked = ['blocking', 'major', 'minor'].flatMap(rank => findings.filter(f => f.rank === rank).map((f, i) => findingCard(f, i)))

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>House walkthrough - threepipe modelling editor</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg: #15161b; --panel: #1e2027; --line: #2e313b; --text: #e6e6ea; --dim: #9a9cab; --blue: #4c8dff;
    --red: #e5534b; --orange: #e09b3d; --grey: #8b8fa3; --green: #46b37b; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 32px 24px 80px; }
  h1 { font-size: 28px; margin: 0 0 4px; } h2 { font-size: 21px; margin: 40px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  h3 { font-size: 16px; margin: 0; display: inline; }
  .sub { color: var(--dim); margin: 0 0 18px; }
  a { color: var(--blue); }
  code { font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: #c9d1ff; word-break: break-word; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; }
  .card ul { margin: 6px 0 0; padding-left: 18px; } .card li { margin: 4px 0; }
  .videos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .video { margin: 0; } .video video { width: 100%; border-radius: 8px; background: #000; border: 1px solid var(--line); }
  .video.wide { grid-column: 1 / -1; }
  figcaption { color: var(--dim); font-size: 13px; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; background: var(--panel); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 600; font-size: 13px; }
  .same { color: var(--green); font-weight: 600; } .diff { color: var(--red); font-weight: 600; }
  .strip { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .step { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; font-size: 13px; }
  .step.fail { border-color: var(--red); }
  .step img { width: 100%; display: block; aspect-ratio: 16 / 9; object-fit: cover; }
  .step .meta { padding: 6px 10px 0; font-weight: 600; } .step .n { color: var(--blue); margin-right: 4px; }
  .step .keys { padding: 2px 10px 8px; color: #ffd36b; font-family: ui-monospace, monospace; font-size: 12px; }
  .step .err { padding: 0 10px 8px; color: #ffb4ae; font-size: 12px; } .step .toasts { padding: 0 10px 8px; color: var(--dim); font-size: 12px; }
  .noshot { aspect-ratio: 16 / 9; display: grid; place-items: center; color: var(--dim); background: #0d0e12; }
  .finding { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--grey); border-radius: 8px; padding: 12px 16px; margin: 0 0 14px; }
  .finding.blocking { border-left-color: var(--red); } .finding.major { border-left-color: var(--orange); }
  .finding .cols { display: grid; grid-template-columns: 1fr 360px; gap: 16px; margin-top: 8px; }
  .finding dl { margin: 0; display: grid; grid-template-columns: 90px 1fr; gap: 4px 10px; }
  .finding dt { color: var(--dim); font-size: 13px; } .finding dd { margin: 0; }
  .finding .shot img { width: 100%; border-radius: 6px; border: 1px solid var(--line); }
  .status.fixed { color: var(--green); } .status.filed { color: var(--dim); }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px;
    border-radius: 4px; margin-right: 8px; vertical-align: 2px; }
  .badge.blocking { background: var(--red); color: #fff; } .badge.major { background: var(--orange); color: #111; } .badge.minor { background: #3a3d4a; color: #ddd; }
  .tabs { display: flex; gap: 8px; margin: 0 0 10px; } .tabs a { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; text-decoration: none; }
  @media (max-width: 900px) { .summary, .videos, .finding .cols { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
<h1>House walkthrough</h1>
<p class="sub">threepipe modelling editor, used as a newcomer would: a low-poly house from the start cube, with real keyboard and
mouse input only (Playwright), once with the Blender keymap and once with the Design keymap. Branch <code>demo-house-walkthrough</code>${commit ? ` at <code>${esc(commit)}</code>` : ''}.
Driver: <a href="drive.mjs">drive.mjs</a> · findings: <a href="ux-findings.md">ux-findings.md</a>.</p>

<section class="summary">
  <div class="card"><strong>What worked</strong><ul>${worked.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
  <div class="card"><strong>What did not</strong><ul>${findings.filter(f => f.rank !== 'minor').map(f => `<li>${badge(f.rank)}<a href="#${f.id}">${esc(f.title)}</a> - <span class="status ${f.status.startsWith('fixed') ? 'fixed' : 'filed'}">${esc(f.status.split(':')[0])}</span></li>`).join('')}</ul></div>
</section>

<h2>Videos</h2>
<div class="videos">
  ${existsSync(join(here, 'video-side-by-side.webm')) ? video('video-side-by-side.webm', 'Blender keymap (left) and Design keymap (right), side by side').replace('class="video"', 'class="video wide"') : ''}
  ${video('video-blender.webm', 'Blender keymap')}
  ${video('video-design.webm', 'Design keymap (Figma / trackpad)')}
</div>
<p class="sub">Recorded with Playwright in headless Chromium on SwiftShader (no GPU), 1280x720; the cursor dot, key chips and title
cards are overlays drawn by the driver, not part of the editor. <code>drive.mjs --ws &lt;endpoint&gt;</code> re-records on a GPU
browser. Videos are not committed: run <code>drive.mjs</code> and <code>compose-videos.mjs</code> to make them.</p>

<h2>Result and glb round trip</h2>
<table>
  <tr><th>keymap</th><th>steps completed</th><th>final mesh</th><th>saved</th><th>re-opened from the .glb</th><th>run time</th></tr>
  ${runs.map(r => `<tr><td>${esc(r.keymap)}</td><td>${r.steps.filter(s => s.ok).length} / ${r.steps.length}</td><td>${fmtCounts(r.finalCounts)}</td>
    <td>${r.steps.find(s => s.id === 'save')?.check ? `<code>${esc(r.steps.find(s => s.id === 'save').check.file)}</code>, ${esc(r.steps.find(s => s.id === 'save').check.bytes)} bytes` : 'n/a'}</td>
    <td>${r.roundTrip ? `${fmtCounts(r.roundTrip.reopened)} <span class="${r.roundTrip.same ? 'same' : 'diff'}">${r.roundTrip.same ? 'same' : 'different'}</span>` : 'n/a'}</td>
    <td>${esc(r.seconds)} s</td></tr>`).join('')}
</table>

<h2>Step by step</h2>
${runs.map(r => `<h3 id="steps-${r.keymap}">${r.keymap === 'blender' ? 'Blender keymap' : 'Design keymap'}</h3>
<ul class="strip" style="margin-top:10px">${r.steps.map(stepCard).join('')}</ul>`).join('<div style="height:24px"></div>')}

<h2>Findings, ranked</h2>
${ranked.join('\n')}

${fixes.length ? `<h2>Fixes in this branch</h2>
<table><tr><th>commit</th><th>what</th><th>e2e test</th></tr>
${fixes.map(f => `<tr><td><code>${esc(f.commit)}</code></td><td>${esc(f.what)}</td><td><code>${esc(f.test)}</code></td></tr>`).join('')}</table>` : ''}
</main>
</body>
</html>
`
writeFileSync(join(here, 'index.html'), html)
console.log('wrote index.html and ux-findings.md;', runs.length, 'runs,', findings.length, 'findings')
