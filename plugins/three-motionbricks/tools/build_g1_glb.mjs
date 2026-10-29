// Convert the Unitree G1 MJCF and its STL meshes into one GLB for three-motionbricks.
// Each MJCF body becomes a node named after it, with its rest transform, so three-motionbricks can turn
// node.quaternion = rest * axisAngle(axis, angle) per joint. Hinge bodies also carry extras {joint, axis}.
// Bodies stay in MuJoCo space (Z up, +X forward) under a root node that turns them to Y up.
//   npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 @xmldom/xmldom@0.8
//   node build_g1_glb.mjs g1_29dof_rev_1_0.xml g1.glb [simplifyRatio] [simplifyError]
import fs from 'node:fs'
import path from 'node:path'
import {DOMParser} from '@xmldom/xmldom'
import {Document, NodeIO} from '@gltf-transform/core'
import {KHRMeshQuantization} from '@gltf-transform/extensions'
import {normals, quantize, simplify, weld} from '@gltf-transform/functions'
import {MeshoptSimplifier} from 'meshoptimizer'

const [xmlPath, outPath, ratioArg] = process.argv.slice(2)
const ratio = Number(ratioArg ?? 0.4)
const error = Number(process.argv[5] ?? 0.001)
const xml = new DOMParser().parseFromString(fs.readFileSync(xmlPath, 'utf8'), 'text/xml')
const meshDir = path.join(path.dirname(xmlPath), xml.getElementsByTagName('compiler')[0].getAttribute('meshdir') || '.')
const meshFiles = {}
for (const m of Array.from(xml.getElementsByTagName('mesh'))) meshFiles[m.getAttribute('name')] = m.getAttribute('file')

const doc = new Document()
const buffer = doc.createBuffer()
const scene = doc.createScene('G1')
// Two satin materials, as three-motionbricks' default: dark joint housings and light shells (sRGB values).
const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const materials = {}
function material(rgba) {
    const part = rgba[0] < 0.5 ? 'joint' : 'shell'
    if (!materials[part]) {
        const color = part === 'joint' ? [0.12, 0.12, 0.13] : [0.8, 0.81, 0.83]
        materials[part] = doc.createMaterial(part === 'joint' ? 'Joint housings' : 'Shells')
            .setBaseColorFactor([...color.map(srgbToLinear), 1])
            .setMetallicFactor(part === 'joint' ? 0.2 : 0.3)
            .setRoughnessFactor(part === 'joint' ? 0.5 : 0.38)
    }
    return materials[part]
}
function readStl(file) {
    const b = fs.readFileSync(path.join(meshDir, file))
    const n = b.readUInt32LE(80)
    const pos = new Float32Array(n * 9)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = b.readFloatLE(84 + i * 50 + 12 + k * 4)
    return pos
}
// xmldom returns '' for a missing attribute.
const nums = (s, d) => (s || d).trim().split(/\s+/).map(Number)

function addBody(el, parent) {
    const node = doc.createNode(el.getAttribute('name')).setTranslation(nums(el.getAttribute('pos'), '0 0 0'))
    const [w, x, y, z] = nums(el.getAttribute('quat'), '1 0 0 0')
    node.setRotation([x, y, z, w])
    const joint = Array.from(el.childNodes).find(c => c.tagName === 'joint')
    if (joint && joint.getAttribute('type') !== 'free') node.setExtras({joint: joint.getAttribute('name'), axis: nums(joint.getAttribute('axis'), '0 0 1')})
    parent.addChild(node)
    for (const g of Array.from(el.childNodes).filter(c => c.tagName === 'geom' && c.getAttribute('type') === 'mesh' && c.getAttribute('contype') === '0')) {
        const pos = readStl(meshFiles[g.getAttribute('mesh')])
        const prim = doc.createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
            .setMaterial(material(nums(g.getAttribute('rgba'), '0.7 0.7 0.7 1')))
        const mesh = doc.createMesh(g.getAttribute('mesh')).addPrimitive(prim)
        node.addChild(doc.createNode(g.getAttribute('mesh') + '_mesh').setMesh(mesh))
    }
    for (const c of Array.from(el.childNodes).filter(c => c.tagName === 'body')) addBody(c, node)
    return node
}
const world = xml.getElementsByTagName('worldbody')[0]
const rootBody = Array.from(world.childNodes).find(c => c.tagName === 'body')
// MuJoCo is Z up; glTF is Y up. The root turns the Z-up bodies so the model stands in any glTF viewer.
const root = doc.createNode('unitree_g1').setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
scene.addChild(root)
addBody(rootBody, root)

await MeshoptSimplifier.ready
await doc.transform(
    weld(),
    simplify({simplifier: MeshoptSimplifier, ratio, error}),
    normals({overwrite: true}),
    quantize({quantizePosition: 14, quantizeNormal: 8}),
)
await new NodeIO().registerExtensions([KHRMeshQuantization]).write(outPath, doc)
let tris = 0
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3
console.log(`${outPath}: ${(fs.statSync(outPath).size / 1e6).toFixed(2)} MB, ${tris} triangles`)
