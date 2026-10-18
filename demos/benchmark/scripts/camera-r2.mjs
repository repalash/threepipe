// The R2 measurement (16-realism.md §3.2): the camera demo transcript with the body and prism rebuilt as
// subdivision cages on support loops, recesses cut by boolean, weighted normals on the hard-surface bevel parts and
// shade by angle on everything. Usage: node demos/benchmark/scripts/camera-r2.mjs [levels] [demo.json] [out.json]
import {readFileSync, writeFileSync} from 'node:fs'
const orig = JSON.parse(readFileSync(process.argv[3] ?? "tmp/realism/camera-cmds.json"))
const skip = new Set()
for (let i = 34; i <= 54; i++) skip.add(i)   // body: cube + 6-segment bevels + bisect/inset recess
for (let i = 62; i <= 79; i++) skip.add(i)   // prism + top LCD recess on body
const levels = Number(process.argv[2] ?? 3)
const body = [
    {op: 'primitive', type: 'cube', name: 'body', width: 149.95, height: 88.5, depth: 58, position: [0.375, 44.25, 29]},
    {op: 'applyTransform', object: 'body'},
    // support loops: the shoulders (x and top y) at 11, the bottom at 4, front and back at 3.5
    {op: 'bisect', object: 'body', planeCo: [-63.6, 0, 0], planeNo: [1, 0, 0]},
    {op: 'bisect', object: 'body', planeCo: [64.35, 0, 0], planeNo: [1, 0, 0]},
    {op: 'bisect', object: 'body', planeCo: [0, 77.5, 0], planeNo: [0, 1, 0]},
    {op: 'bisect', object: 'body', planeCo: [0, 4, 0], planeNo: [0, 1, 0]},
    {op: 'bisect', object: 'body', planeCo: [0, 0, 3.5], planeNo: [0, 0, 1]},
    {op: 'bisect', object: 'body', planeCo: [0, 0, 54.5], planeNo: [0, 0, 1]},
    {op: 'modifier', object: 'body', add: {type: 'subsurf', levels}},
    {op: 'modifier', object: 'body', apply: true},
    {op: 'material', object: 'body', color: '#141517', metalness: 0.1, roughness: 0.6},
    // the rear LCD recess and the top LCD recess, cut (were bisect + inset)
    {op: 'primitive', type: 'cube', name: 'cut-lcd', width: 72.5, height: 49.8, depth: 2.8, position: [20.2, 40.95, 0]},
    {op: 'boolean', object: 'body', with: 'cut-lcd'},
    {op: 'primitive', type: 'cube', name: 'cut-top-lcd', width: 37, height: 1.6, depth: 22, position: [-42.5, 88.5, 25]},
    {op: 'boolean', object: 'body', with: 'cut-top-lcd'},
    // port doors on the grip-free left side: two shallow recesses
    {op: 'primitive', type: 'cube', name: 'cut-port-a', width: 1.2, height: 30, depth: 22, position: [-74.6, 58, 26]},
    {op: 'primitive', type: 'cube', name: 'cut-port-b', width: 1.2, height: 22, depth: 22, position: [-74.6, 24, 26]},
    {op: 'boolean', object: 'body', with: 'cut-port-*'},
]
const prism = [
    {op: 'primitive', type: 'cube', name: 'body-prism', width: 66, height: 29, depth: 70, position: [15.5, 97, 35]},
    {op: 'applyTransform', object: 'body-prism'},
    {op: 'vertices', object: 'body-prism', verts: [[2, -7.5, 111.5, 5], [3, -7.5, 111.5, 48], [6, 38.5, 111.5, 5], [7, 38.5, 111.5, 48]]},
    {op: 'bisect', object: 'body-prism', planeCo: [0, 106, 0], planeNo: [0, 1, 0]},
    {op: 'bisect', object: 'body-prism', planeCo: [0, 86, 0], planeNo: [0, 1, 0]},
    {op: 'bisect', object: 'body-prism', planeCo: [-3, 0, 0], planeNo: [1, 0, 0]},
    {op: 'bisect', object: 'body-prism', planeCo: [34, 0, 0], planeNo: [1, 0, 0]},
    {op: 'bisect', object: 'body-prism', planeCo: [0, 0, 9.5], planeNo: [0, 0, 1]},
    {op: 'bisect', object: 'body-prism', planeCo: [0, 0, 43.5], planeNo: [0, 0, 1]},
    {op: 'modifier', object: 'body-prism', add: {type: 'subsurf', levels}},
]
const out = []
orig.forEach((c, i) => {
    if (i === 34) out.push(...body)
    if (i === 62) out.push(...prism)
    if (skip.has(i)) return
    if (c.op === 'inspect' && (c.object === 'body' || c.object === 'body-prism')) return
    if (c.op === 'export') return
    out.push(c)
})
out.push(
    {op: 'shade', object: '*', mode: 'byAngle'},
    ...['lens-switch-panel', 'lens-switch-0', 'lens-switch-1', 'shoe', 'rubber-thumb', 'eyepiece']
        .map(object => ({op: 'modifier', object, add: {type: 'weightedNormal', weight: 100, keepSharp: true}})),
)
writeFileSync(process.argv[4] ?? `tmp/realism/r2/camera-r2-l${levels}.json`, JSON.stringify(out))
console.log('commands', out.length)
