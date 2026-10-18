// index.html for a benchmark run: the metrics tables and, per view, a sheet (rows: full, clay, distance heat;
// columns: reference, candidate, silhouette overlay). Static, relative paths, no scripts.

import {writeFileSync} from 'node:fs'
import {join} from 'node:path'

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
const n = (x, d = 3) => x === null || x === undefined || Number.isNaN(x) ? '—' : typeof x === 'number' ? (Number.isInteger(x) ? x.toLocaleString('en') : x.toFixed(d)) : esc(x)
const pct = x => Number.isFinite(x) ? (100 * x).toFixed(1) + ' %' : '—'
/** Background for a distance in mm on the heat scale. */
function heatBg(mm, stops, max) {
    if (!Number.isFinite(mm)) return ''
    const x = Math.min(1, mm / max)
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a)
        return `background:rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`
    }
    return ''
}
const table = (head, rows) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => typeof c === 'object' && c ? `<td style="${c.style ?? ''}">${c.v}</td>` : `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`

export function writeReport(out, s, {views, heatStops, heatMax}) {
    const sh = s.shape, q = s.quality, im = s.image, a = s.alignment
    const legend = `<div class="legend">${[0, 1, 2, 3, 4, 5].map(mm => `<span style="${heatBg(mm * heatMax / 5, heatStops, heatMax)}">${(mm * heatMax / 5).toFixed(1)} mm${mm === 5 ? '+' : ''}</span>`).join('')}</div>`
    const comp = s.composite
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>benchmark: ${esc(s.label)} vs ${esc(s.target.name)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1820px;padding:0 16px;color:#1d1d22}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{border-collapse:collapse;margin:6px 0 12px}td,th{border:1px solid #ddd;padding:3px 8px;text-align:right}th{background:#f4f4f6}
td:first-child,th:first-child{text-align:left}.small{color:#666;font-size:12px}.big{font-size:28px;font-weight:600}
.legend span{display:inline-block;padding:2px 8px;margin-right:2px;font-size:12px}img{max-width:100%;display:block;margin:6px 0 18px;border:1px solid #ddd}
.cols{display:flex;gap:32px;flex-wrap:wrap}
</style></head><body>
<h1>${esc(s.label)}${s.ceiling ? ' (ceiling: the reference scaled to the published dimensions)' : ''} vs ${esc(s.target.name)}</h1>
<div class="small">${esc(s.date)} · reference ${esc(s.inputs.reference.path)} (sha256 ${esc(s.inputs.reference.sha256.slice(0, 12))}…) · candidate ${esc(s.inputs.candidate.path)} (${esc(s.inputs.candidate.sha256.slice(0, 12))}…) · renderer ${esc(s.renders?.renderer ?? 'none')}${s.renders && !s.renders.gpu ? ' <b>(not a GPU: not comparable with GPU runs)</b>' : ''}</div>

<h2>Components (the result)</h2>
<div class="cols"><div>
${table([`Shape (mm, after ${esc(a.mode)} alignment)`, ''], [
        ['accuracy: candidate → reference, mean', n(sh.accuracy)], ['completeness: reference → candidate, mean', n(sh.completeness)],
        ['Chamfer (mean of the two)', n(sh.chamfer)], ['Hausdorff95', n(sh.hausdorff95)], ['Hausdorff (max)', n(sh.hausdorff)],
        ...Object.entries(sh.fscore).map(([t, f]) => [`F-score @ ${t} mm (precision / recall)`, `${n(f.f)} (${n(f.precision)} / ${n(f.recall)})`]),
        ['samples per surface', n(sh.samples)]])}
${table(['Images (mean of ' + views.length + ' views)', ''], Object.entries(im.mean ?? {}).map(([k, v]) => [esc(k), n(v)]))}
</div><div>
${table(['Composite — ranking aid only', 'value', 'weight'], [
        ...Object.entries(comp.weights).map(([k, w]) => [esc(k), n(comp.components[k]), w]),
        [{v: '<b>score (0–100)</b>'}, {v: `<span class="big">${n(comp.score, 1)}</span>`}, comp.weightCovered]])}
<div class="small">${esc(comp.label)}</div>
${table(['Alignment', ''], [['initial rotation (deg)', esc(a.initialRotationDeg.join(', '))], ['units', esc(a.units)], ['fitted scale', n(a.scale, 4)],
        ['mode', esc(a.mode)], ['rotation residual (deg)', n(a.rotationResidualDeg, 2)], ['ICP iterations / RMS (mm)', `${a.iterations} / ${n(a.rmsMm)}`],
        ['diagnostic: a free-rotation fit would tilt by (deg)', `${n(a.freeRotationDiagnostic.rotationDeg, 2)} about [${a.freeRotationDiagnostic.axisInCandidateFrame.join(', ')}], RMS ${n(a.freeRotationDiagnostic.rmsMm)}`]])}
</div></div>

<h2>Per group (reference groups: is it there? candidate groups: is it right?)</h2>
${legend}
${table(['group', 'ref parts', 'completeness mean (mm)', 'ref within 2 mm', 'candidate parts', 'accuracy mean (mm)', 'candidate within 2 mm'],
        Object.entries(s.groups).map(([g, v]) => [esc(g), v.refParts,
            {v: n(v.completeness?.meanMm), style: heatBg(v.completeness?.meanMm, heatStops, heatMax)}, pct(v.completeness?.within), v.candParts,
            {v: n(v.accuracy?.meanMm), style: heatBg(v.accuracy?.meanMm, heatStops, heatMax)}, pct(v.accuracy?.within)]))}
${s.unassignedCandidateParts?.length ? `<div class="small">candidate parts in no group: ${esc(s.unassignedCandidateParts.join(', '))}</div>` : ''}

<h2>Per view</h2>
${table(['view', 'IoU', 'SSIM full', 'edge-SSIM full', 'SSIM notex', 'SSIM clay', 'edge-SSIM clay'],
        Object.entries(im.views ?? {}).map(([v, r]) => [esc(v), n(r.iou), n(r.ssim_full), n(r.edgeSsim_full), n(r.ssim_notex), n(r.ssim_clay), n(r.edgeSsim_clay)]))}
<div class="small">Each sheet: rows <b>full</b>, <b>clay</b>, <b>distance heat</b> (each vertex coloured by its distance to the other model's surface); columns reference, candidate, silhouette overlay (grey both, red reference only, cyan candidate only).</div>
${legend}
${views.map(v => `<h3>${esc(v.name)}</h3><img src="sheets/${esc(v.name)}.jpg" alt="${esc(v.name)}">`).join('\n')}

<h2>Geometry quality</h2>
${table(['', 'reference', 'candidate'], [
        ...['parts', 'triangles', 'vertices', 'components', 'closedParts', 'boundaryEdges', 'nonManifoldEdges'].map(k => [k, n(q.reference[k]), n(q.candidate[k])]),
        ['faceting (split vertices, all)', pct(q.reference.splitVertexRatio), pct(q.candidate.splitVertexRatio)],
        ['faceting of large parts (area-weighted)', pct(q.reference.facetingLarge), pct(q.candidate.facetingLarge)],
        ['slivers (min angle < 10°)', pct(q.reference.sliverRatio), pct(q.candidate.sliverRatio)],
        ['parts with UVs', n(q.reference.uvParts), n(q.candidate.uvParts)],
        ['file bytes', n(q.reference.fileBytes), n(q.candidate.fileBytes)],
        ['quads / n-gon faces (topology)', q.reference.topology ? pct(q.reference.topology.quadRatio) : '— (triangles only)', q.candidate.topology ? `${pct(q.candidate.topology.quadRatio)} of ${n(q.candidate.topology.faces)}` : '—'],
        ['poles 3 / 5+ (interior)', q.reference.topology ? `${q.reference.topology.poles3} / ${q.reference.topology.poles5}` : '—', q.candidate.topology ? `${q.candidate.topology.poles3} / ${q.candidate.topology.poles5}` : '—']])}

<h2>Run</h2>
${s.run.build ? table(['Build (transcript)', ''], [['commands / failed', `${s.run.build.commands} / ${s.run.build.failed}`], ['renders in the build', s.run.build.renders],
        ['command time (ms)', n(s.run.build.commandMs)], ['operation wall (ms)', n(s.run.build.operationWallMs)], ['render wall (ms)', n(s.run.build.renderWallMs)],
        ['build wall (ms)', n(s.run.build.buildWallMs)], ['session', esc(s.run.build.session ?? '—')]]) : '<div class="small">no build transcript given</div>'}
${s.run.agent ? table(['Agent', ''], [['model', esc(s.run.agent.models.join(', '))], ['active minutes', s.run.agent.activeMin], ['tool calls', s.run.agent.toolCalls],
        ['output tokens', n(s.run.agent.outputTokens)], ['input tokens (incl. cache)', n(s.run.agent.inputTokens)]]) : '<div class="small">no agent transcript given</div>'}
${table(['Benchmark timing (ms since start)', ''], Object.entries(s.timings).map(([k, v]) => [esc(k), n(v)]))}
</body></html>`
    writeFileSync(join(out, 'index.html'), html)
}
