/**
 * The edit-chain harness: run `chain.mjs` through a modelling session and score every step.
 *
 * EditHero (arXiv 2610.02298) scores an editing agent on long chains of edits by whether each edit
 * did what was asked *and nothing else*. This is that, for threepipe's modelling command API:
 *
 *     npm run demo:edit-chain -- --url http://127.0.0.1:9375/examples/modelling-api/index.html --no-serve
 *
 * (`demo:edit-chain` is `modelling:session` with this build script; the `--url` points at the vite dev
 * server, `--port 9385` is the session's own static server if you use that instead.)
 *
 * After every step it records counts, quad share, bounds, Euler characteristic, boundary loops,
 * non-manifold edges, area and volume of the step's target, and scores five checks:
 *
 * - **did**: the step's own expectations (counts, topology, measured positions);
 * - **locality**: nothing the step did not claim changed - vertex positions bit-identical, faces and
 *   edges with their attribute layers intact, other objects untouched (`topology.mjs` `localityDiff`);
 * - **manifold**: the kernel validator (`selftest`) is clean and no new non-manifold edges, wire
 *   edges or flipped windings appeared, plus any topology the step expects;
 * - **undo**: `undo` brings back the pre-step document bit for bit, `redo` the post-step one;
 * - **determinism**: a second pass in a freshly loaded page produces the same document at every step.
 *
 * Each is PASS, FAIL, UNVERIFIED (could not be computed) or N/A. A failed step does not stop the
 * chain: a command that errors has been rolled back by the plugin, and a step that leaves an invalid
 * mesh is undone before the next one runs.
 *
 * Output: `demos/edit-chain/results.json` and `demos/edit-chain/captures/*.jpg`, which `index.html`
 * reads.
 */

import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {deflateSync} from 'node:zlib'
import {chains, COVERAGE_NOTES, ISSUES} from './chain.mjs'
import {decodeMesh, localityDiff, measureMesh, meshDiffExact, query} from './topology.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CAPTURES = join(HERE, 'captures')

/**
 * `EDIT_CHAIN_PASSES=1`, `=2` or `=1,2` (the default) picks which passes this session runs. Each pass is
 * saved to `tmp/edit-chain/pass-<n>.json` as it finishes and the report is assembled from whatever pass
 * files exist, so on a loaded machine a pass that dies can be re-run alone. Both passes send the same
 * commands; pass 2 runs in a freshly loaded page and does not write the captures.
 */
const PASS_DIR = resolve(HERE, '../../tmp/edit-chain')

export default async (session) => {
    const {run, page, log} = session
    const started = Date.now()
    const wanted = (process.env.EDIT_CHAIN_PASSES ?? '1,2').split(',').map(Number)
    await mkdir(PASS_DIR, {recursive: true})

    let commandTable = null
    let first = 0
    for (const pass of wanted) {
        if (first++) await reloadPage(page)
        if (pass === 1) {
            await rm(CAPTURES, {recursive: true, force: true})
            await mkdir(CAPTURES, {recursive: true})
        }
        commandTable = (await run({op: 'help'})).data
        const mutating = new Set(commandTable.filter(c => c.mutates).map(c => c.op))
        log(`\n=== pass ${pass} ===`)
        const records = await runPass({run, page, log, pass, mutating})
        await writeFile(join(PASS_DIR, `pass-${pass}.json`), JSON.stringify({commandTable, records, at: new Date().toISOString()}))
    }
    const load = async n => {
        try {
            return JSON.parse(await readFile(join(PASS_DIR, `pass-${n}.json`), 'utf8'))
        } catch {
            return null
        }
    }
    const p1 = await load(1), p2 = await load(2)
    if (!p1) {
        log('no pass 1 on disk yet: run with EDIT_CHAIN_PASSES=1')
        return
    }
    commandTable = p1.commandTable
    const passes = [p1.records, p2?.records ?? []]

    // --- determinism: compare the two passes step by step ----------------------------------------
    const [first1, second] = passes
    const firstRecs = first1
    for (const rec of firstRecs) {
        const twin = second.find(r => r.id === rec.id)
        if (!twin) {
            rec.checks.determinism = {status: 'UNVERIFIED', detail: 'the step did not run in pass 2'}
        } else if (twin.hash === rec.hash && twin.resultHash === rec.resultHash) {
            rec.checks.determinism = {status: 'PASS', detail: `document hash ${rec.hash.slice(0, 12)} in both passes`}
        } else {
            rec.checks.determinism = {status: 'FAIL', detail: twin.hash !== rec.hash
                ? `document differs: ${rec.hash.slice(0, 12)} vs ${twin.hash.slice(0, 12)}`
                : 'the command result differs between passes',
            pass1: rec.hash !== twin.hash ? undefined : rec.result, pass2: rec.hash !== twin.hash ? undefined : twin.result}
        }
        rec.status = finalStatus(rec)
    }

    // --- coverage --------------------------------------------------------------------------------
    const coverage = commandTable.map(c => {
        const steps = firstRecs.filter(r => r.commandOps.includes(c.op))
        const harness = HARNESS_OPS.includes(c.op)
        return {
            op: c.op, mutates: c.mutates,
            steps: steps.map(s => s.id),
            used: steps.length > 0,
            passed: steps.filter(s => s.status === 'PASS').length,
            failed: steps.filter(s => s.status === 'FAIL').length,
            harness,
            note: COVERAGE_NOTES[c.op] ?? null,
        }
    })

    const summary = summarise(firstRecs)
    const results = {
        generated: new Date().toISOString(),
        wallSeconds: Math.round((Date.now() - started) / 1000),
        commands: commandTable.length,
        commandList: commandTable.map(c => c.op),
        summary,
        coverage,
        issues: ISSUES,
        chains: chains.map(c => ({id: c.id, name: c.name, steps: c.steps.length})),
        steps: firstRecs,
        pass2: second.map(r => ({id: r.id, hash: r.hash, status: r.status})),
        passFiles: {pass1: p1.at, pass2: p2?.at ?? null},
    }
    await writeFile(join(HERE, 'results.json'), JSON.stringify(results, null, 1))
    log(`\nsteps ${summary.steps}: ${JSON.stringify(summary.byStatus)}; controls detected ${summary.controls.detected}/${summary.controls.steps}`)
    for (const [check, counts] of Object.entries(summary.byCheck)) log(`  ${check}: ${JSON.stringify(counts)}`)
    const unused = coverage.filter(c => !c.used).map(c => c.op)
    log(`coverage: ${coverage.length - unused.length}/${coverage.length} commands used`
        + (unused.length ? `; unused: ${unused.join(', ')}` : ''))
    log(`results: ${join(HERE, 'results.json')}`)
}

/** Ops the harness itself calls around every step, in addition to any step that names them. */
const HARNESS_OPS = ['selftest', 'undo', 'redo', 'camera', 'capture', 'help']

// --- one pass --------------------------------------------------------------------------------------

async function runPass({run, page, log, pass, mutating}) {
    const records = []
    /** Post-step documents by step id, for checks that compare against an earlier step. */
    const history = new Map()
    let doc = await dumpDocument(page)
    history.set('start', doc)

    for (const chain of chains) {
        log(`--- ${chain.name}`)
        for (const step of chain.steps) {
            const rec = await runStep({run, page, log, pass, mutating, chain, step, pre: doc, history})
            records.push(rec)
            doc = rec.__post
            history.set(rec.id, doc)
            delete rec.__post
        }
    }
    return records
}

async function runStep({run, page, log, pass, mutating, chain, step, pre, history}) {
    const id = `${chain.id}-${String(step.n).padStart(2, '0')}`
    const stepStarted = Date.now()
    const ctx = makeContext(pre, step, history)
    const command = typeof step.command === 'function' ? step.command(ctx) : step.command
    const commands = Array.isArray(command) ? command : [command]
    const claim = typeof step.claim === 'function' ? step.claim(ctx) : (step.claim ?? {})

    const rec = {
        id, chain: chain.id, chainName: chain.name, n: step.n, title: step.title,
        claimText: step.claimText ?? step.title,
        target: step.target ?? null,
        commands, commandOps: [...new Set(commands.map(c => c.op))],
        checks: {}, stats: {}, notes: [],
    }

    // --- run the command(s) ----------------------------------------------------------------------
    const results = []
    for (const c of commands) results.push(await run(c))
    const result = results[results.length - 1]
    rec.ok = results.every(r => r.ok)
    rec.error = results.find(r => !r.ok)?.error ?? null
    rec.warnings = results.flatMap(r => r.warnings ?? [])
    rec.result = trimResult(result)
    let post = await dumpDocument(page)
    const extra = step.after ? await step.after({run, page, pre, post, result, results, ctx, pass}) : null
    // A hook that touched the page (the export re-import) cleans up after itself; score what is left.
    if (step.after) post = await dumpDocument(page)

    const preEntry = ctx.target
    const postEntry = findEntry(post, step.target, preEntry?.id)
    const preMesh = preEntry ? decodeMesh(preEntry.mesh) : null
    const postMesh = postEntry ? decodeMesh(postEntry.mesh) : null
    const preStats = preMesh ? measureMesh(preMesh) : null
    const postStats = postMesh ? measureMesh(postMesh) : null
    rec.stats = {pre: preStats, post: postStats,
        evaluated: postEntry?.evaluatedMesh ? measureMesh(decodeMesh(postEntry.evaluatedMesh)) : null}

    // --- did: the step's own expectations ----------------------------------------------------------
    const expectErr = !!step.expectError
    const did = []
    did.push({what: expectErr ? 'command is rejected' : 'command succeeds', ok: expectErr ? !rec.ok : rec.ok,
        got: rec.ok ? 'ok' : rec.error})
    const postCtx = {
        ...ctx, post, postEntry, postMesh, postStats, preMesh, preStats, result, results,
        command: commands[commands.length - 1],
        q2: postMesh ? query(postMesh) : null,
        history,
        diffDocs: docDiff,
        entry: (doc, name) => findEntry(doc, name),
        mesh: (doc, name) => {
            const e = findEntry(doc, name)
            return e ? decodeMesh(e.mesh) : null
        },
    }
    if (rec.ok || expectErr) {
        try {
            did.push(...expectations(step.expect, postCtx))
            if (extra?.checks) did.push(...extra.checks)
        } catch (e) {
            did.push({what: 'expectations could be evaluated', ok: null, got: e.message})
        }
    }
    rec.checks.did = statusOf(did)

    // --- locality --------------------------------------------------------------------------------
    rec.checks.locality = locality({pre, post, preEntry, postEntry, preMesh, postMesh, claim, rec, step})

    // --- manifold / validity -----------------------------------------------------------------------
    const health = await run({op: 'selftest', verbose: true})
    const problems = health.ok ? health.data.results.filter(r => !r.ok) : []
    const man = []
    man.push({what: 'selftest: every mesh validates', ok: health.ok && health.data.failed === 0,
        got: problems.map(p => `${p.name}: ${p.problems.slice(0, 2).join('; ')}`).join(' | ') || 'clean'})
    if (preStats && postStats) {
        for (const k of ['nonManifoldEdges', 'wireEdges', 'inconsistentWinding', 'degenerateFaces']) {
            if (step.allow?.includes(k)) continue
            man.push({what: `no new ${k}`, ok: postStats[k] <= preStats[k], got: postStats[k], want: `<= ${preStats[k]}`})
        }
    } else if (postStats) {
        for (const k of ['nonManifoldEdges', 'wireEdges', 'inconsistentWinding', 'degenerateFaces']) {
            if (step.allow?.includes(k)) continue
            man.push({what: `${k} is 0`, ok: postStats[k] === 0, got: postStats[k]})
        }
    }
    if (step.expect?.topology && postStats) {
        for (const [k, want] of Object.entries(step.expect.topology)) {
            man.push({what: `topology ${k}`, ok: postStats[k] === want, got: postStats[k], want})
        }
    }
    rec.checks.manifold = statusOf(man)

    // --- undo / redo round trip ---------------------------------------------------------------------
    const isMutating = commands.some(c => mutating.has(c.op))
    const stepUndoes = commands.some(c => c.op === 'undo' || c.op === 'redo')
    if (step.noUndoCheck) {
        rec.checks.undo = {status: 'N/A', detail: step.noUndoCheck}
    } else if (stepUndoes) {
        rec.checks.undo = {status: 'N/A', detail: 'the step is itself an undo/redo'}
    } else if (!isMutating) {
        rec.checks.undo = {status: 'N/A', detail: 'read-only command: not on the undo stack'}
    } else if (!rec.ok) {
        // A rejected command must leave nothing behind - the plugin rolls back what it recorded.
        const left = docDiff(pre, post)
        rec.checks.undo = left.length
            ? {status: 'FAIL', detail: `the failed command left changes: ${left.slice(0, 4).join('; ')}`}
            : {status: 'PASS', detail: 'the rejected command left the document exactly as it was'}
    } else if (results.every((r, i) => !mutating.has(commands[i].op) || r.changed === false)) {
        // Nothing changed, and the command says so: there must be no undo step for it (an `undo` now
        // would undo the command before it - see chain-noop-command-no-undo-step.md) and no change.
        const h = await run({op: 'history', limit: 1})
        const last = h.data?.entries?.[0]
        const pushed = !!last && results.some(r => r.index === last.index)
        const left = docDiff(pre, post)
        rec.checks.undo = pushed || left.length
            ? {status: 'FAIL', detail: `reported changed: false but ${pushed ? 'pushed an undo step' : ''}${pushed && left.length ? ' and ' : ''}${left.length ? 'changed ' + left.slice(0, 3).join('; ') : ''}`}
            : {status: 'PASS', detail: 'no-op: reported changed: false, pushed no undo step, document untouched'}
    } else {
        const steps = commands.filter(c => mutating.has(c.op)).length
        const u = await run({op: 'undo', steps})
        const afterUndo = await dumpDocument(page)
        const r = await run({op: 'redo', steps})
        const afterRedo = await dumpDocument(page)
        const du = docDiff(pre, afterUndo)
        const dr = docDiff(post, afterRedo)
        const parts = []
        if (!u.ok) parts.push(`undo failed: ${u.error}`)
        if (!r.ok) parts.push(`redo failed: ${r.error}`)
        if (du.length) parts.push(`undo does not restore the pre-step document: ${du.slice(0, 4).join('; ')}`)
        if (dr.length) parts.push(`redo does not restore the post-step document: ${dr.slice(0, 4).join('; ')}`)
        rec.checks.undo = parts.length
            ? {status: 'FAIL', detail: parts.join(' | ')}
            : {status: 'PASS', detail: `undo x${steps} restores the pre-step document bit for bit; redo the post-step one`}
        // Keep going from the document as it actually is now.
        post = afterRedo
    }

    // --- restore a broken state before the next step ---------------------------------------------
    if (rec.ok && rec.checks.manifold.status === 'FAIL' && step.restoreOnInvalid !== false
        && rec.checks.manifold.items.some(i => i.what.startsWith('selftest') && !i.ok)) {
        await run({op: 'undo', steps: commands.filter(c => mutating.has(c.op)).length || 1})
        post = await dumpDocument(page)
        rec.notes.push('restored the pre-step document (invalid mesh) before continuing')
    }

    // --- capture: both passes frame and render the same way (a render can move an orbiting camera,
    // and the camera is part of what `export` writes); only pass 1 keeps the files ------------------
    if (step.capture !== false) {
        const fit = step.captureFit ?? (postEntry ? postEntry.name : '*')
        const exists = post.entries.some(e => e.name === fit) || fit === '*'
        if (post.entries.length) {
            await run({op: 'camera', view: step.view ?? 'iso', fit: exists ? fit : '*', padding: 1.25})
            const cap = await run({op: 'capture', mimeType: 'image/jpeg', quality: 0.82, label: id})
            if (cap.ok && pass === 1) {
                const name = `${id}.jpg`
                const data = cap.data.dataUrl
                await writeFile(join(CAPTURES, name), Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'))
                rec.capture = `captures/${name}`
            }
        }
    }

    rec.wallMs = Date.now() - stepStarted
    rec.commandMs = results.map(r => r.ms)
    rec.hash = hashDocument(post)
    rec.resultHash = hashResult(results)
    if (step.control) rec.control = {check: step.control, detected: rec.checks[step.control]?.status === 'FAIL'}
    rec.status = finalStatus(rec)
    rec.__post = post
    const badge = Object.entries(rec.checks).map(([k, v]) => `${k}:${v.status}`).join(' ')
    log(`${rec.status === 'PASS' ? 'ok  ' : rec.status === 'FAIL' ? 'FAIL' : rec.status} ${id} ${rec.title} [${badge}]`)
    if (rec.status === 'FAIL' && pass === 1) {
        for (const [k, v] of Object.entries(rec.checks)) {
            if (v.status !== 'FAIL') continue
            const bad = v.items ? v.items.filter(i => i.ok === false).map(i => `${i.what}: got ${fmt(i.got)}${i.want !== undefined ? ` want ${fmt(i.want)}` : ''}`) : [v.detail]
            log(`       ${k}: ${bad.join(' | ').slice(0, 600)}`)
        }
    }
    return rec
}

// --- checks ------------------------------------------------------------------------------------------

function locality({pre, post, preEntry, postEntry, preMesh, postMesh, claim, rec, step}) {
    const items = []
    const claimedObjects = new Set([...(claim.objects ?? []), ...(claim.creates ?? []), ...(claim.removes ?? [])])
    if (step.target) claimedObjects.add(step.target)

    // Other objects: untouched, bit for bit.
    const preById = new Map(pre.entries.map(e => [e.id, e]))
    const postById = new Map(post.entries.map(e => [e.id, e]))
    const targetId = preEntry?.id ?? postEntry?.id
    const anyFields = claim.anyObject ?? []
    for (const [eid, e] of preById) {
        if (eid === targetId || claimedObjects.has(e.name)) continue
        const after = postById.get(eid)
        if (!after) items.push({what: `object "${e.name}" untouched`, ok: false, got: 'removed'})
        else {
            const d = entryDiff(e, after, anyFields)
            if (d.length) items.push({what: `object "${e.name}" untouched`, ok: false, got: d.slice(0, 3).join('; ')})
        }
    }
    const created = post.entries.filter(e => !preById.has(e.id)).map(e => e.name)
    const expectedNew = claim.creates?.length ?? 0
    const creatingPattern = claim.createsAny === true
    if (!creatingPattern && created.length !== expectedNew) {
        items.push({what: 'objects created', ok: false, got: created.join(', ') || 'none', want: (claim.creates ?? []).join(', ') || 'none'})
    }
    for (const name of claim.removes ?? []) {
        const was = pre.entries.find(e => e.name === name)
        if (was && postById.has(was.id)) items.push({what: `"${name}" removed`, ok: false, got: 'still there'})
    }
    // Scene state outside the document (lights, references, display mode, camera) unless claimed.
    for (const key of Object.keys(pre.scene)) {
        if (claim.scene?.includes(key)) continue
        const a = JSON.stringify(pre.scene[key]), b = JSON.stringify(post.scene[key])
        if (a !== b) items.push({what: `scene ${key} untouched`, ok: false, got: b.slice(0, 120), want: a.slice(0, 120)})
    }

    // The target object: its non-mesh state, then its mesh, element by element.
    let checked = null
    if (preEntry && postEntry) {
        const allowed = new Set([...(claim.object ?? []), ...anyFields])
        for (const field of ['name', 'transform', 'material', 'modifiers', 'visible']) {
            if (allowed.has(field)) continue
            const a = JSON.stringify(preEntry[field]), b = JSON.stringify(postEntry[field])
            if (a !== b) items.push({what: `target ${field} untouched`, ok: false, got: b.slice(0, 160), want: a.slice(0, 160)})
        }
        if (claim.all) {
            items.push({what: 'mesh: whole-mesh operation claimed', ok: true, got: 'vacuous'})
        } else {
            const d = localityDiff(preMesh, postMesh, claim)
            checked = d.checked
            const c = d.collateral
            items.push({what: `mesh outside the claim unchanged (${d.checked.verts} verts, ${d.checked.faces} faces, ${d.checked.edges} edges checked)`,
                ok: c.length === 0,
                got: c.length ? `${c.length} collateral: ${c.slice(0, 4).map(x => `${x.kind} ${x.index} ${x.what}${x.at ? ' @' + x.at.join(',') : x.center ? ' @' + x.center.join(',') : ''}`).join('; ')}` : 'none'})
            rec.collateral = c.slice(0, 50)
        }
    } else if (!preEntry && postEntry) {
        items.push({what: 'target created', ok: true, got: postEntry.name})
    }
    const status = statusOf(items)
    if (!items.length) return {status: 'PASS', detail: 'nothing in the document changed', items}
    if (status.status === 'PASS' && claim.all && !items.some(i => !i.ok)) status.detail = 'whole-mesh operation: only other objects and scene checked'
    status.checked = checked
    return status
}

function expectations(expect, c) {
    const out = []
    if (!expect) return out
    const s = c.postStats, p = c.preStats
    if (expect.counts && s) {
        for (const [k, want] of Object.entries(expect.counts)) {
            if (typeof want === 'object' && want !== null && 'delta' in want) {
                const got = s[k] - (p?.[k] ?? 0)
                out.push({what: `${k} change`, ok: got === want.delta, got, want: want.delta})
            } else out.push({what: k, ok: s[k] === want, got: s[k], want})
        }
    }
    if (expect.bbox && s?.bbox) {
        const tol = expect.bbox.tol ?? 1e-5
        for (const side of ['min', 'max']) {
            if (!expect.bbox[side]) continue
            const ok = expect.bbox[side].every((w, i) => w === null || Math.abs(s.bbox[side][i] - w) <= tol)
            out.push({what: `bbox ${side}`, ok, got: s.bbox[side].map(r5), want: expect.bbox[side]})
        }
    }
    if (expect.check) out.push(...expect.check(c))
    return out
}

function statusOf(items) {
    if (items.some(i => i.ok === false)) return {status: 'FAIL', items}
    if (items.some(i => i.ok === null || i.ok === undefined)) return {status: 'UNVERIFIED', items}
    return {status: 'PASS', items}
}

/**
 * A control step exists to prove a check is not vacuous: it does damage on purpose and the step
 * passes when the named check catches it.
 */
function finalStatus(rec) {
    if (rec.control) {
        const others = Object.entries(rec.checks).filter(([k]) => k !== rec.control.check && k !== 'did' && k !== 'determinism')
        return rec.control.detected && !others.some(([, v]) => v.status === 'FAIL') ? 'PASS' : 'FAIL'
    }
    return overall(rec.checks)
}

function overall(checks) {
    const s = Object.values(checks).map(c => c.status)
    if (s.includes('FAIL')) return 'FAIL'
    if (s.includes('UNVERIFIED')) return 'UNVERIFIED'
    return 'PASS'
}

function summarise(records) {
    const byStatus = {PASS: 0, FAIL: 0, UNVERIFIED: 0}
    const byCheck = {}
    const controls = records.filter(r => r.control)
    for (const r of records) {
        if (r.control) continue
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
        for (const [k, v] of Object.entries(r.checks)) {
            byCheck[k] ??= {PASS: 0, FAIL: 0, UNVERIFIED: 0, 'N/A': 0}
            byCheck[k][v.status]++
        }
    }
    const main = records.filter(r => r.chain === 'main')
    const mainBy = {PASS: 0, FAIL: 0, UNVERIFIED: 0}
    for (const r of main) mainBy[r.status]++
    return {steps: records.length - controls.length, byStatus, byCheck, main: {steps: main.length, byStatus: mainBy},
        controls: {steps: controls.length, detected: controls.filter(r => r.control.detected).length,
            list: controls.map(r => ({id: r.id, check: r.control.check, detected: r.control.detected}))}}
}

// --- the document, losslessly ------------------------------------------------------------------------

/**
 * Every object in the modelling document, with each `MeshData` layer as raw bytes, plus the scene
 * state the non-mesh commands touch. Read from the page because the API has no lossless dump; see
 * `issues/open/modelling-tools/chain-no-lossless-mesh-dump.md`.
 */
async function dumpDocument(page) {
    return page.evaluate(() => {
        const b64 = ta => {
            const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)
            let s = ''
            for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
            return btoa(s)
        }
        const meshOf = m => ({
            faceOffsets: b64(m.faceOffsets),
            materials: [...m.materials],
            layers: m.attributes.layers().map(l => ({name: l.name, domain: l.domain, type: l.type, bytes: b64(l.data)}))
                .sort((a, b) => a.name < b.name ? -1 : 1),
            select: JSON.parse(JSON.stringify(m.select)),
        })
        const modelling = window.modelling
        const viewer = window.viewer
        const entries = modelling.document.entries.map(e => {
            const o = e.object
            const mat = o.material
            return {
                id: e.id, name: e.name,
                objectName: o.name, inScene: !!o.parent,
                mesh: meshOf(e.mesh),
                evaluatedMesh: e.modifiers.length ? meshOf(e.evaluated) : null,
                modifiers: JSON.parse(JSON.stringify(e.modifiers)),
                transform: {position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray()},
                material: mat ? {
                    color: mat.color?.getHexString?.(), metalness: mat.metalness, roughness: mat.roughness,
                    opacity: mat.opacity, transparent: mat.transparent, flatShading: mat.flatShading,
                    wireframe: mat.wireframe,
                } : null,
                visible: o.visible,
            }
        })
        const lights = []
        viewer.scene.modelRoot.traverse(o => {
            if (o.isLight) lights.push({name: o.name, type: o.type, intensity: o.intensity, color: o.color?.getHexString?.(), position: o.position.toArray()})
        })
        return {
            entries,
            scene: {
                lights,
                references: [...modelling.references.keys()],
                displayMode: modelling.displayMode,
                environmentIntensity: viewer.scene.environmentIntensity,
                background: viewer.scene.backgroundColor?.getHexString?.() ?? String(viewer.scene.background),
            },
        }
    })
}

function findEntry(doc, name, id) {
    if (id) {
        const byId = doc.entries.find(e => e.id === id)
        if (byId) return byId
    }
    return name ? doc.entries.find(e => e.name === name) ?? null : null
}

function entryDiff(a, b, ignore = []) {
    const out = []
    for (const f of ['name', 'objectName', 'inScene', 'transform', 'material', 'modifiers', 'visible']) {
        if (ignore.includes(f)) continue
        if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) out.push(`${f} differs`)
    }
    const md = meshDiffExact(decodeMesh(a.mesh), decodeMesh(b.mesh))
    if (md.length) out.push(...md.map(x => `mesh: ${x}`))
    if (JSON.stringify(a.mesh.select) !== JSON.stringify(b.mesh.select)) out.push('mesh select state differs')
    return out
}

/** Two documents, compared exactly: the same objects, each identical. */
function docDiff(a, b) {
    const out = []
    const ids = new Set([...a.entries.map(e => e.id), ...b.entries.map(e => e.id)])
    for (const id of ids) {
        const ea = a.entries.find(e => e.id === id), eb = b.entries.find(e => e.id === id)
        if (!ea || !eb) {
            out.push(`object ${(ea ?? eb).name} (${id}) ${ea ? 'missing' : 'extra'}`)
            continue
        }
        for (const d of entryDiff(ea, eb)) out.push(`${ea.name}: ${d}`)
    }
    return out
}

function hashDocument(doc) {
    const h = createHash('sha256')
    h.update(JSON.stringify(doc))
    return h.digest('hex')
}

function hashResult(results) {
    const h = createHash('sha256')
    h.update(JSON.stringify(results.map(r => ({ok: r.ok, error: r.error, objects: r.objects, data: stripVolatile(r.data)}))))
    return h.digest('hex')
}

/**
 * A result with what may legitimately differ between sessions removed: timings, the document id, object
 * uuids (runtime identity), and rendered pixels (the renderer is not under test). An exported file is
 * kept as its hash - a replayed session should write the same bytes.
 */
function stripVolatile(data) {
    return JSON.parse(JSON.stringify(data ?? null, (k, v) => {
        // `index` / `at` are the session's command counters, which differ because pass 2 sends no
        // camera or capture commands; nothing about the document depends on them.
        if (k === 'dataUrl' || k === 'ms' || k === 'documentId' || k === 'uuid' || k === 'index' || k === 'at') return undefined
        if (k === 'base64' && typeof v === 'string') return 'sha256:' + createHash('sha256').update(v).digest('hex').slice(0, 16)
        return v
    }))
}

function trimResult(r) {
    if (!r) return null
    const data = stripVolatile(r.data)
    const text = JSON.stringify(data)
    return {ok: r.ok, objects: r.objects, data: text && text.length > 1500 ? JSON.parse(JSON.stringify(data, (k, v) => Array.isArray(v) && v.length > 24 ? [...v.slice(0, 24), `...+${v.length - 24}`] : v)) : data}
}

function makeContext(pre, step, history) {
    const target = step.target ? findEntry(pre, step.target) : null
    const mesh = target ? decodeMesh(target.mesh) : null
    return {
        pre,
        target,
        q: mesh ? query(mesh) : null,
        mesh,
        stats: mesh ? measureMesh(mesh) : null,
        history,
        /** A query over another object in the pre-step document. */
        get: name => {
            const e = findEntry(pre, name)
            return e ? query(decodeMesh(e.mesh)) : null
        },
        png: tinyPng,
    }
}

async function reloadPage(page) {
    await page.reload({waitUntil: 'domcontentloaded', timeout: 90000})
    await page.waitForFunction(() => !!window.modelling, null, {timeout: 120000})
    await page.evaluate(() => {
        for (const sel of ['#console', '#side', '#tweakpaneUiContainer', '.code-preview', '#example-code-preview', '#example-code-btn']) {
            document.querySelectorAll(sel).forEach(n => (n.style.display = 'none'))
        }
        document.body.style.gridTemplateColumns = '1fr'
        document.body.style.gridTemplateRows = '1fr'
        document.body.style.gridTemplateAreas = '"view"'
        window.dispatchEvent(new Event('resize'))
    })
    // The page builds a demo hull on load; the chain starts from an empty document, as pass 1 did.
}

const r5 = x => Math.round(x * 1e5) / 1e5
const fmt = v => typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v)?.slice(0, 200)

// --- a deterministic reference image -----------------------------------------------------------------

/** A small checker PNG as a data URL, built here so the `reference` step needs no network. */
function tinyPng(w = 64, h = 32) {
    const rows = []
    for (let y = 0; y < h; y++) {
        const row = [0]
        for (let x = 0; x < w; x++) {
            const on = ((x >> 3) + (y >> 3)) & 1
            row.push(on ? 220 : 60, on ? 120 : 60, on ? 60 : 70)
        }
        rows.push(...row)
    }
    const crcTable = Array.from({length: 256}, (_, n) => {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        return c >>> 0
    })
    const crc = buf => {
        let c = 0xffffffff
        for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
        return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const td = Buffer.concat([Buffer.from(type), data])
        const c = Buffer.alloc(4)
        c.writeUInt32BE(crc(td))
        return Buffer.concat([len, td, c])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(h, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(Buffer.from(rows))),
        chunk('IEND', Buffer.alloc(0)),
    ])
    return 'data:image/png;base64,' + png.toString('base64')
}

export {resolve}
