/**
 * The edit-chain report data: report.json from the harness's results.json (every main-chain step with its five
 * scores), then the shared report page.
 *
 *     node demos/edit-chain/make-report.mjs     # after run.mjs (results.json) and record.mjs (the film, pulled to film/)
 */
import {readFileSync, writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'

const R = JSON.parse(readFileSync('demos/edit-chain/results.json', 'utf8'))
const S = R.summary
const main = R.steps.filter(s => s.chain === 'main').sort((a, b) => a.n - b.n)
const fails = R.steps.filter(s => Object.values(s.checks).some(c => c.status === 'FAIL' || c.status === 'UNVERIFIED'))
const st = (s, k) => s.checks[k]?.status ?? ''
const report = {
    title: '30 edits, one mesh',
    kicker: 'threepipe modelling demo · edit chain',
    accent: '#e8a33d',
    blurb: 'A cylinder edited into a chess rook with Blender\'s edit-mode operators, every step scored.',
    intro: 'An EditHero-style chain for the modelling command API: a 16-sided cylinder becomes a chess rook in 30 edit-mode steps - inset, extrude, subdivide, bevel, bisect, connect, dissolve, grid fill, mirror, limited dissolve, make face - and every step is scored on five checks: <b>did</b> it do what it claims, <b>locality</b> (everything it did not claim is bit-identical), <b>manifold</b>, exact <b>undo</b>/redo, and <b>determinism</b> across two fresh pages. Side chains cover the rest of the command set, hazards (bad input) and controls (steps built to fail, which the harness must catch).',
    recordCommand: 'node demos/edit-chain/record.mjs',
    hero: {file: 'hero', caption: 'The rook after step 30'},
    stills: [
        {file: 'step-06', caption: 'Step 6: the new ring moved up - the crown band'},
        {file: 'step-12', caption: 'Step 12: the bottom rim bevelled, 3 segments'},
        {file: 'step-17', caption: 'Step 17: four merlons extruded'},
        {file: 'step-21', caption: 'Step 21: the arrow slit extruded inward'},
        {file: 'step-24', caption: 'Step 24: the live mirror applied'},
    ],
    metricsFirst: [
        ['harness', `${S.main.byStatus.PASS} / ${S.main.steps}`, `main chain all PASS; all chains ${S.byStatus.PASS} PASS, ${S.byStatus.FAIL} FAIL, ${S.byStatus.UNVERIFIED} UNVERIFIED of ${S.steps}`],
        ['locality · manifold', `${S.byCheck.locality.PASS} · ${S.byCheck.manifold.PASS}`, `of ${S.steps} steps`],
        ['undo / redo exact', `${S.byCheck.undo.PASS}`, `${S.byCheck.undo['N/A']} N/A (read-only steps)`],
        ['determinism', `${S.byCheck.determinism.PASS} / ${S.steps}`, 'two passes in fresh pages, document hash per step'],
        ['controls caught', `${S.controls.detected} / ${S.controls.steps}`, 'steps built to fail locality or manifold'],
        ['harness wall time', `${R.wallSeconds} s`, `${R.commands} commands incl. the scoring (inspect, undo, redo) - SwiftShader, local`],
    ],
    metrics: [['agent (original demo)', '155 min', 'claude-opus-5-5 · 173 tool calls · 179k output / 57M input tokens']],
    commandsNote: 'the 30 main-chain steps as filmed',
    checks: [['step', 'did', 'locality', 'manifold', 'undo', 'determinism'], ...main.map(s => [`${s.n}. ${s.title}`, st(s, 'did'), st(s, 'locality'), st(s, 'manifold'), st(s, 'undo'), st(s, 'determinism')])],
    how: `<p><code>chain.mjs</code> is the chain as data: each step a command (selections written as geometry queries, resolved per run), a claim of what it may touch, and expectations, with the Blender behaviour cited where it is not obvious. <code>run.mjs</code> runs every chain through a modelling session and scores it (<code>topology.mjs</code> diffs meshes bit for bit); <code>results.json</code> is its output, re-run on the current editor on ${R.generated.slice(0, 10)}. <code>record.mjs</code> films the main chain from the resolved commands in <code>results.json</code> on the GPU VM: a clay surface with the master mesh's edges drawn over it (hidden ones faint, as Blender's edit-mode overlay), each step's scores beside it.</p><p>Re-run: <code>npm run modelling:session -- demos/edit-chain/run.mjs --port 9479 --out tmp/edit-chain-session</code>, <code>node demos/edit-chain/record.mjs</code>, <code>node demos/edit-chain/make-report.mjs</code>.</p>`
        + `<p>Not PASS outside the main chain (${fails.length}): ${fails.map(s => `<code>${s.id}</code> ${s.title}`).join('; ')}. The controls fail on purpose; the others are open issues: <code>chain-display-material-overwrites-colour.md</code> (scene-06), <code>chain-export-not-deterministic.md</code> and <code>command-export-objects-ignored.md</code> (export-02), <code>chain-transform-range-schema.md</code> (hazard-06); bevel-03 has no Blender fixture for its case.</p>`,
    weak: [
        'The rook is a test object, not a showpiece: low-poly, flat-shaded, one material.',
        'The film shows each step\'s result; the harness\'s own undo/redo and determinism passes are scored, not shown.',
    ],
}
writeFileSync('demos/edit-chain/report.json', JSON.stringify(report, null, 1))
execFileSync(process.execPath, ['demos/shared/report.mjs', 'demos/edit-chain'], {stdio: 'inherit'})
