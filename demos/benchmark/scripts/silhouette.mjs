// Silhouette fit against a calibrated product photograph (public reference, never the scored GLB).
//
//   node demos/benchmark/scripts/silhouette.mjs <calibration.json> <build.glb> [out-prefix]
//   e.g. demos/benchmark/targets/canon-5d4-measure/silhouette-front.json
//
// The photograph is segmented from its white studio background (non-white pixels, the largest connected
// region, holes filled). The build is projected orthographically onto the same plane and rasterised at the
// photograph's scale. The calibration maps image pixels to model millimetres:
//
//   {"photo": "...jpg", "view": "front" | "back", "mmPerPx": 0.1102,
//    "anchorPx": [cx, baseY], "anchorMm": [x, 0], "exclude": [[x0, y0, x1, y1], ...] (px boxes to ignore, e.g. lugs),
//    "objects": "regex of object names to include (default all)"}
//
// Reported: IoU, and the profiles that carry the form - the top edge per column (where the prism, shoe and
// shoulders are) and the left / right edges per row - as model-minus-photo differences in mm, plus an overlay PNG
// (photo only = red, build only = blue, both = grey).
import '../../../plugins/modelling-cli/dist/index.mjs'
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import sharp from 'sharp'
import {readGlb} from '../metrics/glb.mjs'

const [calPath, glbPath, outPrefix] = process.argv.slice(2)
const cal = JSON.parse(readFileSync(calPath, 'utf8'))
const photoPath = resolve(dirname(calPath), cal.photo)

// --- photo mask ---
const img = sharp(photoPath)
const {data, info} = await img.raw().toBuffer({resolveWithObject: true})
const W = info.width, H = info.height, C = info.channels
const fg = new Uint8Array(W * H)
const thr = cal.whiteThreshold ?? 232
for (let i = 0; i < W * H; i++) {
    const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2]
    fg[i] = Math.min(r, g, b) < thr ? 1 : 0
}
for (const [x0, y0, x1, y1] of cal.exclude ?? []) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fg[y * W + x] = 0
// largest 4-connected component
const label = new Int32Array(W * H)
let best = 0, bestSize = 0, next = 0
const stack = []
for (let i = 0; i < W * H; i++) {
    if (!fg[i] || label[i]) continue
    next++
    let size = 0
    stack.push(i); label[i] = next
    while (stack.length) {
        const p = stack.pop(); size++
        const x = p % W, y = (p / W) | 0
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
            if (q >= 0 && fg[q] && !label[q]) { label[q] = next; stack.push(q) }
        }
    }
    if (size > bestSize) { bestSize = size; best = next }
}
const photo = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) photo[i] = label[i] === best ? 1 : 0
// fill holes: background = what the border reaches
const outside = new Uint8Array(W * H)
for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (!photo[y * W + x] && !outside[y * W + x]) { outside[y * W + x] = 1; stack.push(y * W + x) }
for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (!photo[y * W + x] && !outside[y * W + x]) { outside[y * W + x] = 1; stack.push(y * W + x) }
while (stack.length) {
    const p = stack.pop(); const x = p % W, y = (p / W) | 0
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && !photo[q] && !outside[q]) { outside[q] = 1; stack.push(q) }
    }
}
for (let i = 0; i < W * H; i++) if (!outside[i]) photo[i] = 1

// --- model mask, in photo pixels ---
const s = cal.mmPerPx, mirror = cal.view === 'back' ? -1 : 1
const toPx = (x, y) => [cal.anchorPx[0] + mirror * (x - cal.anchorMm[0]) / s, cal.anchorPx[1] - (y - cal.anchorMm[1]) / s]
const {parts} = await readGlb(glbPath)
const include = cal.objects ? new RegExp(cal.objects) : null
const exclude = cal.excludeObjects ? new RegExp(cal.excludeObjects) : null
const model = new Uint8Array(W * H)
for (const p of parts) {
    if (p.mode !== 4) continue
    if (include && !p.path.some(n => include.test(n))) continue
    if (exclude && p.path.some(n => exclude.test(n))) continue
    const P = p.position, I = p.index
    for (let t = 0; t < I.length; t += 3) {
        const a = toPx(P[3 * I[t]], P[3 * I[t] + 1]), b = toPx(P[3 * I[t + 1]], P[3 * I[t + 1] + 1]), c = toPx(P[3 * I[t + 2]], P[3 * I[t + 2] + 1])
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
        const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if (Math.abs(area) < 1e-9) continue
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5, py = y + 0.5
                const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area
                const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area
                const w2 = 1 - w0 - w1
                if (w0 >= 0 && w1 >= 0 && w2 >= 0) model[y * W + x] = 1
            }
        }
    }
}
for (const [x0, y0, x1, y1] of cal.exclude ?? []) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) model[y * W + x] = 0

// --- metrics ---
let inter = 0, uni = 0
for (let i = 0; i < W * H; i++) { if (photo[i] && model[i]) inter++; if (photo[i] || model[i]) uni++ }
const toMm = (px, py) => [cal.anchorMm[0] + mirror * (px - cal.anchorPx[0]) * s, cal.anchorMm[1] + (cal.anchorPx[1] - py) * s]
// top edge per 5 mm column, left / right edge per 5 mm row
const top = []
for (let xmm = -75; xmm <= 75; xmm += 5) {
    const [px] = toPx(xmm, 0); const x = Math.round(px)
    if (x < 0 || x >= W) continue
    let tp = -1, tm = -1
    for (let y = 0; y < H; y++) { if (tp < 0 && photo[y * W + x]) tp = y; if (tm < 0 && model[y * W + x]) tm = y }
    top.push({x: xmm, photo: tp < 0 ? null : +toMm(x, tp)[1].toFixed(1), model: tm < 0 ? null : +toMm(x, tm)[1].toFixed(1)})
}
const sides = []
for (let ymm = 5; ymm <= 120; ymm += 5) {
    const y = Math.round(toPx(0, ymm)[1])
    if (y < 0 || y >= H) continue
    const span = mask => { let l = -1, r = -1; for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (l < 0) l = x; r = x } return l < 0 ? null : [toMm(l, y)[0], toMm(r, y)[0]].sort((u, v) => u - v).map(v => +v.toFixed(1)) }
    sides.push({y: ymm, photo: span(photo), model: span(model)})
}
const result = {photo: cal.photo, view: cal.view, iou: +(inter / uni).toFixed(4), top, sides}
const prefix = outPrefix ?? glbPath.replace(/\.glb$/, '') + `-${cal.view}`
writeFileSync(prefix + '.json', JSON.stringify(result, null, 1))
// overlay
const ov = Buffer.alloc(W * H * 3)
for (let i = 0; i < W * H; i++) {
    const a = photo[i], b = model[i]
    const c = a && b ? [150, 150, 150] : a ? [220, 40, 40] : b ? [40, 90, 220] : [250, 250, 250]
    ov[3 * i] = c[0]; ov[3 * i + 1] = c[1]; ov[3 * i + 2] = c[2]
}
await sharp(ov, {raw: {width: W, height: H, channels: 3}}).resize(Math.round(W / 2)).png().toFile(prefix + '.png')
console.log(JSON.stringify({iou: result.iou, overlay: prefix + '.png'}))
