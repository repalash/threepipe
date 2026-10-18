/**
 * Score a build against a target's ground truth (issues/open/modelling-tools/16-realism.md §2).
 *
 *     npm run benchmark:score -- --target canon-5d4 --glb <build.glb> [--transcript transcript.json]
 *         [--agent agent.jsonl] [--out tmp/bench/<label>] [--renders vm|local|none|<dir>] [--label name]
 *     npm run benchmark:score -- --target canon-5d4 --ceiling      # the reference, scaled to spec, vs itself
 *
 * Writes <out>/score.json (every metric, inputs' hashes, renderer) and <out>/index.html (sheets per view,
 * silhouette overlays, distance heat maps, tables). Shape and quality run here in Node; renders run on the GPU
 * VM by default (`--renders vm`: commits are synced with tpvm, untracked inputs pushed), or locally on
 * SwiftShader (`local`, flagged in the output), or are read from a directory of a previous run.
 */

import '../../plugins/modelling-cli/dist/index.mjs' // threepipe's Node polyfill (ImageData, document), before three
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Box3, Euler, Matrix4, Quaternion, Vector3} from 'three'
import sharp from 'sharp'
import {readGlb} from './lib/glb.mjs'
import {soup, sample, TriangleBVH, distances, summarize, icp, area} from './lib/shape.mjs'
import {modelQuality} from './lib/quality.mjs'
import {toGray, ssim, sobel, mask, iou, maskBounds} from './lib/image.mjs'
import {transcriptMetrics, agentMetrics} from './lib/run.mjs'
import * as vm from './lib/vm.mjs'
import {writeReport} from './lib/report.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const t0 = Date.now()
const timings = {}
const lap = k => { timings[k] = Date.now() - t0 }

// --- arguments ----------------------------------------------------------------------------------
const argv = process.argv.slice(2), flags = {}
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2), v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++ }
}
const abs = p => isAbsolute(p) ? p : resolve(root, p)
const targetPath = flags.target?.endsWith?.('.json') ? abs(flags.target) : join(root, 'demos/benchmark/targets', `${flags.target ?? 'canon-5d4'}.json`)
const target = JSON.parse(readFileSync(targetPath, 'utf8'))
const ceiling = !!flags.ceiling
if (!ceiling && !flags.glb) {
    console.error('usage: npm run benchmark:score -- --target <name> --glb <build.glb> [--transcript t.json] [--agent a.jsonl] [--out dir] [--renders vm|local|none|<dir>]')
    process.exit(1)
}
const refPath = abs(target.reference.path)
if (!existsSync(refPath)) throw new Error(`the reference ${target.reference.path} is not here (it is never committed; copy it in)`)
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const refSha = sha256(refPath)
if (target.reference.sha256 && refSha !== target.reference.sha256) throw new Error(`reference sha256 ${refSha} does not match the target's ${target.reference.sha256}`)

const candPath = ceiling ? refPath : abs(flags.glb)
const cand = ceiling
    ? {units: 'ref', rotation: [0, 0, 0], exclude: [], prescale: target.spec.refScaleToSpec}
    : {...target.candidate, ...(flags.units ? {units: flags.units} : {}),
        ...(flags.rotation ? {rotation: String(flags.rotation).split(',').map(Number)} : {}),
        prescale: flags.prescale ? String(flags.prescale).split(',').map(Number) : null}
const label = flags.label ?? (ceiling ? 'ceiling' : basename(candPath, '.glb'))
const out = abs(flags.out ?? `tmp/bench/${label}`)
mkdirSync(out, {recursive: true})
const S = target.reference.mmPerUnit
const samples = +(flags.samples ?? target.samples ?? 100000)
const taus = target.taus ?? [1, 2, 5]
const seed = target.seed ?? 1

// --- read ---------------------------------------------------------------------------------------
const globRe = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
const exclude = (cand.exclude ?? []).map(globRe)
const refParts = (await readGlb(refPath)).parts
const candParts = (await readGlb(candPath)).parts.filter(p => !exclude.some(r => r.test(p.name)))
lap('read')

/** A copy of the parts with positions and normals transformed by `m`. */
function transformParts(parts, m) {
    const n = new Matrix4().copy(m).invert().transpose(), v = new Vector3()
    return parts.map(p => {
        const position = new Float32Array(p.position.length)
        for (let i = 0; i < position.length; i += 3) { v.fromArray(p.position, i).applyMatrix4(m); v.toArray(position, i) }
        let normal = null
        if (p.normal) { normal = new Float32Array(p.normal.length); for (let i = 0; i < normal.length; i += 3) { v.fromArray(p.normal, i).transformDirection(n); v.toArray(normal, i) } }
        return {...p, position, normal}
    })
}

// --- frames: everything in the reference's frame, in mm ------------------------------------------
const refToMm = new Matrix4().makeScale(S, S, S)
const refMm = transformParts(refParts, refToMm)
const unit = cand.units === 'ref' ? S : cand.units === 'm' ? 1000 : cand.units === 'cm' ? 10 : 1
const D = Math.PI / 180
const pre = new Matrix4()
if (cand.prescale) {
    // per-axis scale about the model's own bbox centre (the ceiling: the reference brought to the published size)
    const b = new Box3()
    for (const p of candParts) for (let i = 0; i < p.position.length; i += 3) b.expandByPoint(new Vector3().fromArray(p.position, i))
    const c = b.getCenter(new Vector3())
    pre.makeTranslation(c.x, c.y, c.z).multiply(new Matrix4().makeScale(...cand.prescale)).multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z))
}
const M0 = new Matrix4().makeRotationFromEuler(new Euler(cand.rotation[0] * D, cand.rotation[1] * D, cand.rotation[2] * D))
    .multiply(new Matrix4().makeScale(unit, unit, unit)).multiply(pre)
const refSoup = soup(refMm)
const bbox = s => { const b = new Box3(), v = new Vector3(); for (let i = 0; i < s.tris.length; i += 3) b.expandByPoint(v.set(s.tris[i], s.tris[i + 1], s.tris[i + 2])); return b }
const cR = bbox(refSoup).getCenter(new Vector3()), cC = bbox(soup(candParts, M0.toArray())).getCenter(new Vector3())
const init = new Matrix4().makeTranslation(cR.x - cC.x, cR.y - cC.y, cR.z - cC.z).multiply(M0)
const refBVH = new TriangleBVH(refSoup)
lap('bvh')

// --- align: trimmed ICP ---------------------------------------------------------------------------
// Default `scale-translation`: the orientation is the target's convention and a tilt is a modelling error to
// count, not to fit away. A free-rotation (similarity) fit is run as a diagnostic and reported beside it.
const alignMode = flags.align ?? target.align ?? 'scale-translation'
const candRaw = soup(candParts)
const icpSource = sample(candRaw, 20000, seed + 6).points
const icpRes = icp(icpSource, refBVH, init, {mode: alignMode, keep: 0.9})
const A = icpRes.matrix
const pos = new Vector3(), quat = new Quaternion(), scl = new Vector3()
A.decompose(pos, quat, scl)
const R0 = new Quaternion().setFromEuler(new Euler(cand.rotation[0] * D, cand.rotation[1] * D, cand.rotation[2] * D))
const tilt = m => {
    const q = new Quaternion(), p = new Vector3(), s = new Vector3()
    m.decompose(p, q, s)
    const d = R0.clone().invert().multiply(q), ang = 2 * Math.acos(Math.min(1, Math.abs(d.w))), sn = Math.sin(ang / 2) || 1
    return {deg: ang / D, axis: [d.x / sn, d.y / sn, d.z / sn].map(v => +v.toFixed(3))}
}
const free = alignMode === 'similarity' ? icpRes : icp(icpSource, refBVH, init, {mode: 'similarity', keep: 0.9})
const alignment = {
    mode: alignMode, initialRotationDeg: cand.rotation, units: cand.units, prescale: cand.prescale ?? null,
    scale: scl.x / unit, rotationResidualDeg: tilt(A).deg,
    translationMm: pos.toArray(), iterations: icpRes.iterations, rmsMm: icpRes.rms, rmsHistory: icpRes.history,
    matrix: A.toArray(),
    freeRotationDiagnostic: {rotationDeg: tilt(free.matrix).deg, axisInCandidateFrame: tilt(free.matrix).axis, rmsMm: free.rms, iterations: free.iterations},
}
lap('align')

// --- shape ----------------------------------------------------------------------------------------
const candMm = transformParts(candParts, A)
const candSoup = soup(candMm)
const candBVH = new TriangleBVH(candSoup)
const sa = sample(candSoup, samples, seed), sb = sample(refSoup, samples, seed + 1)
const dAB = distances(sa.points, refBVH), dBA = distances(sb.points, candBVH)
const shape = summarize(dAB, dBA, taus)
shape.samples = samples
shape.areaMm2 = {reference: area(refSoup), candidate: area(candSoup)}
lap('shape')

// per group: completeness of each reference group, accuracy of each candidate group
const groupOfRef = new Map(), groupOfCand = new Map()
for (const [g, def] of Object.entries(target.groups ?? {})) {
    for (const n of def.ref) groupOfRef.set(n, g)
    const rs = (def.candidate ?? []).map(globRe)
    candParts.forEach((p, i) => { if (!groupOfCand.has(i) && rs.some(r => r.test(p.name))) groupOfCand.set(i, g) })
}
const tau2 = taus.includes(2) ? 2 : taus[0]
const groups = {}
for (const g of Object.keys(target.groups ?? {})) groups[g] = {refParts: target.groups[g].ref.length, candParts: 0, completeness: [], accuracy: []}
for (let i = 0; i < samples; i++) {
    const g = groupOfRef.get(refParts[refSoup.part[sb.tri[i]]].name); if (g) groups[g].completeness.push(dBA[i])
    const h = groupOfCand.get(candSoup.part[sa.tri[i]]); if (h) groups[h].accuracy.push(dAB[i])
}
candParts.forEach((p, i) => { const g = groupOfCand.get(i); if (g) groups[g].candParts++ })
const unassigned = candParts.filter((_, i) => !groupOfCand.has(i)).map(p => p.name)
for (const g of Object.values(groups)) {
    const st = a => a.length ? {samples: a.length, meanMm: a.reduce((x, y) => x + y, 0) / a.length, within: a.filter(v => v <= tau2).length / a.length} : null
    g.completeness = st(g.completeness); g.accuracy = st(g.accuracy)
}
lap('groups')

// per-vertex heat: each model's vertices, distance to the other surface
const heatMax = target.render?.heatMaxMm ?? 5
const STOPS = [[0, [43, 131, 186]], [0.2, [171, 221, 164]], [0.4, [255, 255, 191]], [0.7, [253, 174, 97]], [1, [215, 25, 28]]]
const heatColor = d => {
    const x = Math.min(1, d / heatMax)
    for (let i = 1; i < STOPS.length; i++) if (x <= STOPS[i][0]) {
        const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = (x - a) / (b - a)
        return ca.map((c, k) => Math.round(c + (cb[k] - c) * t))
    }
    return STOPS[STOPS.length - 1][1]
}
function heat(parts, bvh) {
    return {maxMm: heatMax, meshes: parts.map(p => {
        const n = p.position.length / 3, rgb = Buffer.alloc(n * 3)
        for (let i = 0; i < n; i++) {
            const d = Math.sqrt(bvh.closest(p.position[3 * i], p.position[3 * i + 1], p.position[3 * i + 2]).d2)
            rgb.set(heatColor(d), 3 * i)
        }
        return {name: p.name, verts: n, rgb: rgb.toString('base64')}
    })}
}
writeFileSync(join(out, 'heat-ref.json'), JSON.stringify(heat(refMm, candBVH)))
writeFileSync(join(out, 'heat-cand.json'), JSON.stringify(heat(candMm, refBVH)))
lap('heat')

// --- geometry quality (each model at its own mm scale) ----------------------------------------------
const quality = {
    reference: modelQuality(refMm).total,
    candidate: modelQuality(transformParts(candParts, new Matrix4().makeScale(unit, unit, unit).multiply(pre))),
}
quality.candidateParts = quality.candidate.parts
quality.candidate = quality.candidate.total
quality.reference.fileBytes = readFileSync(refPath).length
quality.candidate.fileBytes = readFileSync(candPath).length
lap('quality')

// --- renders ----------------------------------------------------------------------------------------
const mode = flags.renders ?? 'vm'
const views = target.views
const styles = target.render?.styles ?? ['full', 'clay', 'mask']
const runRel = relative(root, out)
const renderDir = join(out, 'renders')
let renderInfo = null
if (mode !== 'none') {
    // the page loads the reference in its own units; the candidate goes through A, then mm -> reference units
    const candToRef = new Matrix4().makeScale(1 / S, 1 / S, 1 / S).multiply(A)
    const inputs = {ref: `tmp/bench-inputs/${refSha.slice(0, 16)}.glb`, cand: `tmp/bench-inputs/${sha256(candPath).slice(0, 16)}.glb`}
    const job = {
        out: `${runRel}/renders`, width: target.render?.width ?? 1200, height: target.render?.height ?? 800, port: 9381,
        models: [
            {id: 'ref', url: inputs.ref, heat: `${runRel}/heat-ref.json`},
            {id: 'cand', url: inputs.cand, matrix: candToRef.toArray(), exclude: cand.exclude, heat: `${runRel}/heat-cand.json`},
        ],
        styles, views,
    }
    writeFileSync(join(out, 'job.json'), JSON.stringify(job, null, 1))
    if (mode === 'vm' || mode === 'local') {
        for (const [k, p] of [['ref', refPath], ['cand', candPath]]) {
            mkdirSync(join(root, 'tmp/bench-inputs'), {recursive: true})
            if (!existsSync(join(root, inputs[k]))) copyFileSync(p, join(root, inputs[k]))
        }
    }
    if (mode === 'vm') {
        const dirty = execFileSync('git', ['status', '--porcelain', '--', 'demos/benchmark', 'package.json'], {cwd: root, encoding: 'utf8'}).trim()
        if (dirty) console.warn('benchmark: uncommitted changes under demos/benchmark are not on the VM:\n' + dirty)
        vm.sync(root)
        for (const f of [inputs.ref, inputs.cand, `${runRel}/heat-ref.json`, `${runRel}/heat-cand.json`, `${runRel}/job.json`]) vm.push(root, join(root, f), f)
        const tr = Date.now()
        const log = vm.run(root, `rm -rf ${runRel}/renders && npm run benchmark:render -- ${runRel}/job.json 2>&1 | tail -3 && tar czf ${runRel}/renders.tgz -C ${runRel} renders`)
        console.log(log.trim().split('\n').slice(-3).join('\n'))
        vm.pull(root, `${runRel}/renders.tgz`, join(out, 'renders.tgz'))
        execFileSync('tar', ['xzf', join(out, 'renders.tgz'), '-C', out])
        timings.vmRenderMs = Date.now() - tr
    } else if (mode === 'local') {
        execFileSync('node', [join(root, 'demos/benchmark/render.mjs'), join(out, 'job.json')], {cwd: root, stdio: 'inherit'})
    }
    renderInfo = JSON.parse(readFileSync(join(mode === 'vm' || mode === 'local' ? renderDir : abs(mode), 'render.json'), 'utf8'))
    renderInfo.mode = mode
    renderInfo.gpu = /Metal|Apple|NVIDIA|AMD|Intel/i.test(renderInfo.renderer ?? '') && !/SwiftShader/i.test(renderInfo.renderer ?? '')
    const heatErrors = Object.entries(renderInfo.loads ?? {}).flatMap(([k, l]) => (l.heatErrors ?? []).map(e => `${k}: ${e}`))
    if (heatErrors.length) console.warn('heat maps did not map onto the page meshes:\n' + heatErrors.slice(0, 5).join('\n'))
    renderInfo.heatErrors = heatErrors
}
lap('renders')

// --- image metrics + sheets ------------------------------------------------------------------------
const imgDir = mode === 'vm' || mode === 'local' ? renderDir : mode !== 'none' ? abs(mode) : null
const image = {views: {}, mean: {}}
if (imgDir) {
    const gray = async f => { const {data, info} = await sharp(join(imgDir, f)).raw().toBuffer({resolveWithObject: true}); return toGray(data, info.width, info.height, info.channels) }
    const has = f => existsSync(join(imgDir, f))
    mkdirSync(join(out, 'sheets'), {recursive: true})
    for (const v of views) {
        const r = {}
        const mr = mask(await gray(`ref-mask-${v.name}.png`)), mc = mask(await gray(`cand-mask-${v.name}.png`))
        const roi = maskBounds([mr, mc], 8)
        r.iou = iou(mr, mc)
        for (const s of ['full', 'notex', 'clay']) {
            if (!has(`ref-${s}-${v.name}.png`) || !has(`cand-${s}-${v.name}.png`)) continue
            const a = await gray(`ref-${s}-${v.name}.png`), b = await gray(`cand-${s}-${v.name}.png`)
            r[`ssim_${s}`] = ssim(a, b, {roi}).mssim
            r[`edgeSsim_${s}`] = ssim(sobel(a), sobel(b), {roi}).mssim
        }
        image.views[v.name] = r
        // overlay: both = grey, reference only = red, candidate only = cyan
        const {w, h} = mr, ov = Buffer.alloc(w * h * 3, 255)
        for (let i = 0; i < w * h; i++) {
            const p = mr.data[i], q = mc.data[i]
            if (p && q) ov.set([150, 150, 150], 3 * i); else if (p) ov.set([220, 40, 40], 3 * i); else if (q) ov.set([20, 190, 220], 3 * i)
        }
        writeFileSync(join(out, 'sheets', `overlay-${v.name}.png`), await sharp(ov, {raw: {width: w, height: h, channels: 3}}).png().toBuffer())
        // sheet: rows full / clay / heat, columns reference / candidate / overlay
        const tw = 600, th = Math.round(tw * h / w), tiles = []
        const tile = async f => existsSync(f) ? sharp(f).resize(tw, th).png().toBuffer() : sharp({create: {width: tw, height: th, channels: 3, background: '#fff'}}).png().toBuffer()
        const cells = [`ref-full-${v.name}.png`, `cand-full-${v.name}.png`, null, `ref-clay-${v.name}.png`, `cand-clay-${v.name}.png`, null, `ref-heat-${v.name}.png`, `cand-heat-${v.name}.png`, null]
        for (let i = 0; i < cells.length; i++) tiles.push(await tile(cells[i] ? join(imgDir, cells[i]) : i === 2 ? join(out, 'sheets', `overlay-${v.name}.png`) : ''))
        await sharp({create: {width: tw * 3, height: th * 3, channels: 3, background: '#fff'}})
            .composite(tiles.map((input, i) => ({input, left: (i % 3) * tw, top: Math.floor(i / 3) * th}))).jpeg({quality: 85})
            .toFile(join(out, 'sheets', `${v.name}.jpg`))
    }
    for (const k of new Set(Object.values(image.views).flatMap(Object.keys))) {
        const vals = Object.values(image.views).map(r => r[k]).filter(Number.isFinite)
        image.mean[k] = vals.reduce((a, b) => a + b, 0) / vals.length
    }
}
lap('image')

// --- run metrics ----------------------------------------------------------------------------------
const run = {}
if (flags.transcript) run.build = transcriptMetrics(JSON.parse(readFileSync(abs(flags.transcript), 'utf8')))
if (flags.agent) run.agent = agentMetrics(abs(flags.agent))

// --- composite (a ranking aid; the components above are the result) -------------------------------
const WEIGHTS = {shape: 30, detail: 10, silhouette: 10, formRender: 20, appearanceRender: 20, geometry: 10}
const groupVals = Object.values(groups).map(g => g.completeness?.within).filter(Number.isFinite)
const qc = quality.candidate
const comp = {
    shape: shape.fscore[tau2].f,
    detail: groupVals.length ? groupVals.reduce((a, b) => a + b, 0) / groupVals.length : null,
    silhouette: image.mean.iou ?? null,
    formRender: image.mean.edgeSsim_clay ?? null,
    appearanceRender: image.mean.ssim_full ?? null,
    geometry: ((1 - qc.facetingLarge) + qc.closedParts / qc.parts + (1 - qc.sliverRatio)) / 3,
}
let wsum = 0, ssum = 0
for (const [k, w] of Object.entries(WEIGHTS)) if (Number.isFinite(comp[k])) { wsum += w; ssum += w * comp[k] }
const composite = {label: 'ranking aid - weighted mean of the components; the components are the result', weights: WEIGHTS,
    components: comp, score: wsum ? 100 * ssum / wsum : null, weightCovered: wsum}

timings.totalMs = Date.now() - t0
const score = {
    target: {name: target.name, file: relative(root, targetPath)}, label, ceiling, date: new Date().toISOString(),
    inputs: {reference: {path: target.reference.path, sha256: refSha, mmPerUnit: S}, candidate: {path: relative(root, candPath), sha256: sha256(candPath)}},
    alignment, shape, groups, unassignedCandidateParts: unassigned, quality, image, renders: renderInfo && {renderer: renderInfo.renderer, gpu: renderInfo.gpu, mode: renderInfo.mode, width: renderInfo.width, height: renderInfo.height, ms: renderInfo.ms, heatErrors: renderInfo.heatErrors},
    run, composite, timings,
}
writeFileSync(join(out, 'score.json'), JSON.stringify(score, null, 1))
writeReport(out, score, {views, heatStops: STOPS, heatMax})
const f = x => Number.isFinite(x) ? +x.toFixed(3) : x
console.log(JSON.stringify({out: relative(root, out), composite: f(composite.score), chamferMm: f(shape.chamfer), hausdorff95Mm: f(shape.hausdorff95),
    fscore: Object.fromEntries(Object.entries(shape.fscore).map(([k, v]) => [k, f(v.f)])), iou: f(image.mean.iou), ssimFull: f(image.mean.ssim_full),
    edgeSsimClay: f(image.mean.edgeSsim_clay), scale: f(alignment.scale), renderer: renderInfo?.renderer, totalMs: timings.totalMs}))
