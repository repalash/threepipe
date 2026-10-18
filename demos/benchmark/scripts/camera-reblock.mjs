// The camera re-block (16-realism.md §3.3): body, prism hump + hot shoe and grip rebuilt as subdivision cages
// fitted to the public measurement set in demos/benchmark/targets/canon-5d4-measure/measurements.json, and the top
// controls the set locates moved to where it puts them. The reference GLB is not read here.
//
//   node demos/benchmark/scripts/camera-reblock.mjs [demo-transcript.json] [out.json]
//
// It runs the new blocks in a modelling session as it writes them - the grip's top ring is addressed by the
// indices `inspect` reports after its bisects, as an agent would - then splices them into the demo transcript.
import {readFileSync, writeFileSync} from 'node:fs'
import {NodeModellingSession} from '../../../plugins/modelling-cli/dist/index.mjs'
import {fitClosedCage, prismCage, resampleClosed, resampleSides, signedArea} from './cage.mjs'

const M = JSON.parse(readFileSync(new URL('../targets/canon-5d4-measure/measurements.json', import.meta.url))).readings
const orig = JSON.parse(readFileSync(process.argv[2] ?? 'tmp/realism/camera-cmds.json', 'utf8'))
const outPath = process.argv[3] ?? 'tmp/realism/reblock/camera-reblock.json'
// level 2: the fitted cages are dense enough that level 3 only quadruples the triangles (166k vs 62k) at the same score
const levels = Number(process.env.LEVELS ?? 2)

const session = new NodeModellingSession()
const log = []
async function run(cmd) {
    const r = await session.run(cmd)
    if (!r.ok) throw new Error(`${cmd.op} failed: ${JSON.stringify(r).slice(0, 400)}`)
    log.push(cmd)
    return r
}
// Replace the cage's two n-gon caps with quad grids (Blender's Grid Fill over the face): a 64-gon cap subdivides
// into a fan of thin quads around one pole, which shows as a starburst in the shading of a flat face. The cage is
// sampled with equal counts on opposite sides; the grid's `span` and corner `offset` that give the squarest quads
// are found by trying them (each trial undone, so it leaves no trace in the model or the transcript).
const trials = {count: 0}
async function gridCaps(name, n, spans) {
    for (let k = 0; k < 2; k++) {
        const ins = await session.run({op: 'inspect', object: name, detail: true, limit: 100000})
        const f = ins.data.faceVerts.findIndex(fv => fv.length === n)
        if (f < 0) throw new Error(`${name}: no ${n}-gon cap left`)
        let best = null
        for (const span of spans) for (let offset = 0; offset < n; offset++) {
            const r = await session.run({op: 'gridFill', object: name, faces: [f], span, offset})
            trials.count++
            if (!r.ok) continue
            const g = (await session.run({op: 'inspect', object: name, detail: true, limit: 100000})).data
            // squareness: the worst ratio of a new quad's shorter to longer diagonal
            let q = 1
            for (const fv of g.faceVerts.slice(ins.data.faceVerts.length - 1)) {
                if (fv.length !== 4) { q = 0; break }
                const P = fv.map(i => g.vertices[i])
                const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
                const d1 = d(P[0], P[2]), d2 = d(P[1], P[3])
                q = Math.min(q, Math.min(d1, d2) / Math.max(d1, d2))
            }
            await session.run({op: 'undo'})
            if (!best || q > best.q) best = {q, span, offset}
        }
        await run({op: 'gridFill', object: name, faces: [f], span: best.span, offset: best.offset})
    }
}
const orient = (poly, sign) => Math.sign(signedArea(poly)) === sign ? poly : [...poly].reverse()
const r2 = v => +v.toFixed(3)

// ---------------------------------------------------------------- body: front outline, extruded rear to front
const O = M.outline, D = M.depthLayout
const gs = O.gripSide, fs = O.farSide
// far side going up and grip-side corner going down: the side and top scans of the same corner merged by height
const farSide = [...fs.sideAtY.map(([y, x]) => [x, y]), ...fs.topAtX, [75.6, 30], [75.7, 40], [75.6, 50]].sort((p, q) => p[1] - q[1])
const gripCorner = [...gs.sideAtY.map(([y, x]) => [x, y]), ...gs.topAtX.filter(([x]) => x <= -59), [-74.9, 50], [-75.0, 40], [-75.0, 30]].sort((p, q) => q[1] - p[1])
const bodyOutline = [
    [-66, 0], [64, 0], ...farSide,
    [66.0, 87.4], [63, fs.plateUnderModeDial], [44, fs.plateUnderModeDial + 0.2],
    // under the prism (hidden) a straight run, then the grip-side plate (button tops left out) and its shoulder
    [-17, 92.4], [-21, 92.1], [-25, 91.2], [-31, 90.6], [-41, 90.2], [-49, 90.3], [-57, 90.0],
    ...gripCorner,
]
// split at the four shoulders and base corners: 20 samples along base and top, 12 up each side
const bodyTarget = orient(resampleSides(bodyOutline, [[-72, 2], [72, 4], [68, 86], [-63, 87.7]], [20, 12, 20, 12]), -1)
const bodyCage = fitClosedCage(bodyTarget)
for (const c of prismCage('body', 'z', bodyCage, (i, e, p) => [p[0], p[1], e ? D.bodyFront : D.rearFace])) await run(c)
await gridCaps('body', bodyCage.length, [12, 20])
// support loops 4 mm in from the rear and front faces: the plan corners round to about that radius
await run({op: 'bisect', object: 'body', planeCo: [0, 0, 4], planeNo: [0, 0, 1]})
await run({op: 'bisect', object: 'body', planeCo: [0, 0, D.bodyFront - 4], planeNo: [0, 0, 1]})
await run({op: 'modifier', object: 'body', add: {type: 'subsurf', levels}})
await run({op: 'modifier', object: 'body', apply: true})
await run({op: 'material', object: 'body', color: '#141517', metalness: 0.1, roughness: 0.6})
// rear monitor recess (published 3:2 active area plus the bezel the rear photo shows) and the top LCD window
const lcd = {w: 72.5, h: 49.8, cx: 20.2, cy: 40.95}
await run({op: 'primitive', type: 'cube', name: 'cut-lcd', width: lcd.w, height: lcd.h, depth: 2.8, position: [lcd.cx, lcd.cy, 0]})
await run({op: 'boolean', object: 'body', with: 'cut-lcd'})
const T = M.topLcd
const topLcd = {x0: T.x[0], x1: T.x[1], z0: T.z[0], z1: T.z[1], floor: 89.4}
await run({op: 'primitive', type: 'cube', name: 'cut-top-lcd', width: r2(topLcd.x1 - topLcd.x0), height: 8, depth: r2(topLcd.z1 - topLcd.z0),
    position: [r2((topLcd.x0 + topLcd.x1) / 2), topLcd.floor + 4, r2((topLcd.z0 + topLcd.z1) / 2)]})
await run({op: 'boolean', object: 'body', with: 'cut-top-lcd'})
// port doors, on the far (+x) side face
await run({op: 'primitive', type: 'cube', name: 'cut-port-a', width: 1.4, height: 30, depth: 22, position: [75.6, 58, 26]})
await run({op: 'primitive', type: 'cube', name: 'cut-port-b', width: 1.4, height: 22, depth: 22, position: [75.4, 24, 26]})
await run({op: 'boolean', object: 'body', with: 'cut-port-*'})
const bodyCmds = log.splice(0)

// ---------------------------------------------------------------- grip: plan outline, extruded up, top on the shoulder
// Plan from the top photo (x anchored on the front photo, z normalised to the published depth): the outer side
// runs straight on the body side, the front is flat between about -60 and -39 at z = 75.9, the inner side returns
// to the body front near x = -28. Its rear part sits inside the body.
const gripPlan = [
    [-74.9, 30], [-74.9, 50], [-74.6, 60], [-73.4, 66], [-70.5, 71], [-66, 74.4], [-60, 75.7], [-50, 75.9], [-42, 75.6],
    [-36.5, 74], [-32.5, 70.5], [-29.6, 65.5], [-28, 60], [-27.6, 55], [-28.5, 30], [-50, 25],
]
const gripTarget = orient(resampleSides(gripPlan, [[-74.9, 30], [-73.4, 66], [-36.5, 74], [-28.5, 30]], [6, 10, 6, 10], 2), 1)
const gripCage = fitClosedCage(gripTarget)
// the top follows the measured grip-side shoulder (front outline), 0.5 mm under the body's
const shoulder = x => {
    const pts = [[-75.6, 70], [-74.6, 74], [-73, 76.7], [-71, 79.7], [-69, 82.4], [-67, 85.0], [-65, 86.6], [-63, 87.7], [-61, 88.5], [-59, 89.1], [-57, 89.6], [-40, 89.6], [-26, 89.6]]
    if (x <= pts[0][0]) return pts[0][1]
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, b] = [pts[i - 1], pts[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]) }
    return pts[pts.length - 1][1]
}
// and in front of the main dial it falls away at the shutter's tilt: the front photo sees the shutter cap as an
// ellipse 9.9 wide and 7.2 high centred 84.6 mm up, a face turned about 35 degrees from vertical towards the lens
const SH = M.shutter, slope = Math.tan(SH.tiltDeg * Math.PI / 180)
const gripTop = (x, z) => Math.min(shoulder(x) - 0.5, z <= SH.slopeFromZ ? Infinity : 89.1 - slope * (z - SH.slopeFromZ))
const gripBase = 1.5
for (const c of prismCage('grip', 'y', gripCage, (i, e, p) => [p[0], e ? gripTop(p[0], p[1]) : gripBase, p[1]])) await run(c)
await gridCaps('grip', gripCage.length, [6, 10])
// support loops: 4 mm above the base, and a ring 4 mm under the sloped top - bisect at a level the whole band
// crosses, then lift each ring vertex to 4 mm under the top edge above it
await run({op: 'bisect', object: 'grip', planeCo: [0, gripBase + 4, 0], planeNo: [0, 1, 0]})
await run({op: 'bisect', object: 'grip', planeCo: [0, 60, 0], planeNo: [0, 1, 0]})
const gi = await run({op: 'inspect', object: 'grip', detail: true, limit: 100000})
const gv = gi.data.vertices
const ring = gv.map((p, i) => [i, p]).filter(([, p]) => Math.abs(p[1] - 60) < 1e-3)
await run({op: 'vertices', object: 'grip', verts: ring.map(([i, p]) => [i, p[0], r2(gripTop(p[0], p[2]) - 4), p[2]])})
await run({op: 'modifier', object: 'grip', add: {type: 'subsurf', levels}})
await run({op: 'modifier', object: 'grip', apply: true})
await run({op: 'material', object: 'grip', color: '#161616', metalness: 0, roughness: 0.92})
const gripCmds = log.splice(0)

// ---------------------------------------------------------------- prism hump: front outline, front face sloped back
const P = M.prism
const top = P.housingTop.value
const prismOutline = [
    [-17, 86], ...P.flanksAtY.map(([y, l]) => [l, y]), [-0.6, 113.7], [3, top], [27, top], [30.6, 113.7],
    ...P.flanksAtY.slice().reverse().map(([y, , r]) => [r, y]), [46, 86],
]
const prismTarget = orient(resampleSides(prismOutline, [[-17, 86], [-9.6, 105], [39.3, 105], [46, 86]], [8, 12, 8, 12], 3), -1)
const prismCageP = fitClosedCage(prismTarget)
// front: 70 at the base, where it overhangs the mount boss, sloping to 48 at the housing top's front edge; rear 0 to 5.
// (The top photo's reading of a curved front, P.frontAtY, scored worse and is outside the photo's +-3 mm, so the
// straight slope stays.)
const yBase = 93, zFront = y => y <= yBase ? 70 : 70 - 22 * (y - yBase) / (top - yBase), zRear = y => y <= yBase ? 0 : 5 * (y - yBase) / (top - yBase)
for (const c of prismCage('body-prism', 'z', prismCageP, (i, e, p) => [p[0], p[1], e ? zFront(p[1]) : zRear(p[1])])) await run(c)
await gridCaps('body-prism', prismCageP.length, [8, 12])
// Grid Fill places the inner grid by blending the boundary (a Coons patch), which twists across the front's kink at
// the plate; put every cap vertex back on its face - z of the front or rear by height
{
    const g = (await run({op: 'inspect', object: 'body-prism', detail: true, limit: 100000})).data
    const moves = []
    g.vertices.forEach(([x, y, z], i) => {
        const zf = zFront(y), zr = zRear(y), zt = Math.abs(z - zf) < Math.abs(z - zr) ? zf : zr
        if (Math.abs(zt - z) > 1e-4) moves.push([i, x, y, r2(zt)])
    })
    if (moves.length) await run({op: 'vertices', object: 'body-prism', verts: moves})
}
// The front and rear are not planar (vertical below the plate, sloped above), so a support loop cut by a plane
// would cross the grid-filled front; crease the two rims instead (OpenSubdiv semi-sharp: sharpness 10 c^2).
const pi = (await run({op: 'inspect', object: 'body-prism', detail: true, limit: 100000})).data
// band faces have corners on both ends; their edges with both ends on one cap are the rims
const end = v => { const [, y, z] = pi.vertices[v]; return Math.abs(z - zFront(y)) < 1e-3 ? 1 : Math.abs(z - zRear(y)) < 1e-3 ? 0 : -1 }
const rims = []
pi.faceVerts.forEach((fv, f) => {
    const ends = fv.map(end)
    if (!(ends.includes(0) && ends.includes(1))) return
    pi.faceEdges[f].forEach((e, k) => { const a = fv[k], b = fv[(k + 1) % fv.length]; if (end(a) === end(b) && end(a) >= 0) rims.push(e) })
})
await run({op: 'crease', object: 'body-prism', edges: rims, value: 0.6})
await run({op: 'modifier', object: 'body-prism', add: {type: 'subsurf', levels}})
await run({op: 'material', object: 'body-prism', color: '#141517', metalness: 0.1, roughness: 0.6})
const prismCmds = log.splice(0)

// ---------------------------------------------------------------- shoe: measured width and top, ISO 518 rails
const S = M.shoe
const shoe = {w: S.topWidth[0], x: S.centreX, y0: top - 0.4, y1: S.top, z: 34.7, d: 21.4}
const shoeCmds = [
    {op: 'primitive', type: 'cube', name: 'shoe', width: shoe.w, height: r2(shoe.y1 - shoe.y0), depth: shoe.d, position: [shoe.x, r2((shoe.y0 + shoe.y1) / 2), shoe.z]},
    {op: 'applyTransform', object: 'shoe'},
    {op: 'inspect', object: 'shoe', detail: true, limit: 1000000},
    // ISO 518: 18.6 mm between the rails, 2 mm deep
    {op: 'inset', object: 'shoe', faces: [1], thickness: r2((shoe.w - 18.6) / 2), depth: -2},
    {op: 'inspect', object: 'shoe', detail: true, limit: 1000000},
    {op: 'bevel', object: 'shoe', edges: [1, 3, 7, 9], profile: 0.5, offset: 1.2, segments: 2},
    {op: 'lathe', name: 'shoe-contact', axis: 'y', center: [shoe.x, 0, shoe.z], segments: 24, profile: [[0, r2(shoe.y1 - 2)], [2.2, r2(shoe.y1 - 2)], [2.2, r2(shoe.y1 - 1.55)], [0, r2(shoe.y1 - 1.55)]]},
]

// ---------------------------------------------------------------- top controls at their measured places
const MD = M.modeDial, r = MD.diameter / 2
const dialMode = {op: 'lathe', name: 'dial-mode', axis: 'y', center: [MD.centreX, 0, MD.centreZ], segments: 72,
    profile: [[0, MD.base], [r, MD.base], [r, MD.base + 0.8], [r, MD.top - 1.8], [r, MD.top - 1.3], [r - 0.6, MD.top - 0.7], [4.6, MD.top - 0.7], [4.6, MD.top], [0, MD.top]]}
const MN = M.mainDial, mr = MN.diameter / 2, mz = MN.centreZ
const dialMain = {op: 'lathe', name: 'dial-main', axis: 'z', center: [MN.centreX, r2(MN.top - mr), 0], segments: 60,
    profile: [[0, mz - 3], [mr - 0.7, mz - 3], [mr, mz - 2.3], [mr, mz + 2.3], [mr - 0.7, mz + 3], [0, mz + 3]]}
// the knurl insets of the demo address the lathe's side faces: dial-main's sides now face +-y and the old indices
// (every 6th face from 1) are still the outer band, as the profile keeps its six points
const TB = M.topButtons, br = TB.diameter / 2
const btnTop = {op: 'lathe', name: 'btn-top', axis: 'y', center: [TB.centresX[0], 0, TB.centreZ], segments: 32, profile: [[0, 88.8], [br, 88.8], [br, TB.top - 0.45], [br - 0.18, TB.top - 0.135], [br - 0.45, TB.top], [0, TB.top]]}
const btnTopArray = {op: 'array', object: 'btn-top', count: 4, step: [r2((TB.centresX[3] - TB.centresX[0]) / 3), 0, 0], merge: false}
const MF = M.mFn
const btnMfn = {op: 'lathe', name: 'btn-mfn', axis: 'y', center: [MF.centreX, 0, MF.centreZ], segments: 32, profile: [[0, 88.8], [MF.diameter / 2, 88.8], [MF.diameter / 2, 90.4], [MF.diameter / 2 - 0.4, 90.8], [0, 90.8]]}
const topLcdGlass = [
    {op: 'primitive', type: 'cube', name: 'top-lcd-glass', width: r2(topLcd.x1 - topLcd.x0 - 1.4), height: 0.3, depth: r2(topLcd.z1 - topLcd.z0 - 1.4),
        position: [r2((topLcd.x0 + topLcd.x1) / 2), topLcd.floor + 0.15, r2((topLcd.z0 + topLcd.z1) / 2)]},
    {op: 'applyTransform', object: 'top-lcd-glass'},
]

// ---------------------------------------------------------------- splice into the demo transcript
const out = []
const replaced = new Set()
const range = (a, b) => { for (let i = a; i <= b; i++) replaced.add(i) }
range(34, 54)   // body cube, bevels, monitor recess (bisect + inset)
range(58, 61)   // grip sweep, bevel, material
range(62, 79)   // prism, top LCD recess
range(80, 81)   // top LCD glass
range(83, 89)   // shoe, contact
orig.forEach((c, i) => {
    if (i === 34) out.push(...bodyCmds)
    if (i === 58) out.push(...gripCmds)
    if (i === 62) out.push(...prismCmds)
    if (i === 80) out.push(...topLcdGlass)
    if (i === 83) out.push(...shoeCmds)
    if (replaced.has(i)) return
    if (c.op === 'inspect' && ['body', 'body-prism', 'grip'].includes(c.object)) return
    if (c.op === 'export') return
    if (c.op === 'lathe' && c.name === 'dial-mode') c = dialMode
    else if (c.op === 'lathe' && c.name === 'dial-main') c = dialMain
    else if (c.op === 'lathe' && c.name === 'btn-shutter') {
        // same profile, at the measured centre, its base on the sloped grip top and tilted with it
        const base = r2(gripTop(SH.centreX, SH.centreZ) - 0.3), dy = base - c.profile[0][1]
        c = {...c, center: [SH.centreX, 0, SH.centreZ], profile: c.profile.map(([a, b]) => [a, r2(b + dy)])}
        out.push(c, {op: 'transform', object: 'btn-shutter', angle: r2(SH.tiltDeg * Math.PI / 180), axis: 'x', pivot: [SH.centreX, base, SH.centreZ]})
        c = null
    } else if (c.op === 'sweep' && c.name === 'lug') {
        const dy = M.strapLug.y - c.path[0][1]
        c = {...c, path: c.path.map(([x, y, z]) => [x, r2(y + dy), z])}
    }
    if (c) out.push(c)
    else out.push(btnTop, btnTopArray, btnMfn)
})
out.push(
    {op: 'material', object: ['btn-top*', 'btn-mfn'], color: '#202124', metalness: 0.2, roughness: 0.5},
    {op: 'shade', object: '*', mode: 'byAngle'},
    ...['lens-switch-panel', 'lens-switch-0', 'lens-switch-1', 'shoe', 'rubber-thumb', 'eyepiece']
        .map(object => ({op: 'modifier', object, add: {type: 'weightedNormal', weight: 100, keepSharp: true}})),
)
writeFileSync(outPath, JSON.stringify(out))
await session.close()
console.log(JSON.stringify({commands: out.length, gridFillTrials: trials.count, newBlock: {body: bodyCmds.length, grip: gripCmds.length, prism: prismCmds.length, shoe: shoeCmds.length}}))
