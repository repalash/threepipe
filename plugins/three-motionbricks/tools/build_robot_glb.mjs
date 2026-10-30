// Convert a humanoid's MJCF (such as one from MuJoCo Menagerie) and its STL meshes into one GLB, for
// RetargetedCharacter. Each body becomes a node named after it with its rest transform, and its visual meshes
// hang under it; the bodies stay in MuJoCo space (Z up, +X forward) under a root node turned to Y up.
//   npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer@0.22 @xmldom/xmldom@0.8
//   node build_robot_glb.mjs h1.xml h1.glb [simplifyRatio] [simplifyError]
import fs from 'node:fs'
import path from 'node:path'
import {DOMParser} from '@xmldom/xmldom'
import {Document, NodeIO} from '@gltf-transform/core'
import {KHRMeshQuantization} from '@gltf-transform/extensions'
import {normals, quantize, simplify, weld} from '@gltf-transform/functions'
import {MeshoptSimplifier} from 'meshoptimizer'

const [xmlPath, outPath, ratioArg] = process.argv.slice(2)
const ratio = Number(ratioArg ?? 0.3)
const error = Number(process.argv[5] ?? 0.001)
const xml = new DOMParser().parseFromString(fs.readFileSync(xmlPath, 'utf8'), 'text/xml')
const elements = (el, tag) => Array.from(el.childNodes).filter(c => c.tagName === tag)
// xmldom returns '' for a missing attribute.
const nums = (s, d) => (s || d).trim().split(/\s+/).map(Number)
const compiler = xml.getElementsByTagName('compiler')[0]
const meshDir = path.join(path.dirname(xmlPath), compiler?.getAttribute('meshdir') || '.')

// <default> classes: the geom attributes each class sets, on top of its parent class.
// Mesh defaults too: a <mesh scale> there applies to every mesh asset (OP3's are in millimetres).
const classes = {}
let meshDefaults = {}
function readDefaults(el, inherited) {
    const own = {...inherited}
    for (const g of elements(el, 'geom')) for (const a of Array.from(g.attributes)) own[a.name] = a.value
    for (const m of elements(el, 'mesh')) for (const a of Array.from(m.attributes)) meshDefaults[a.name] = a.value
    classes[el.getAttribute('class') || 'main'] = own
    for (const c of elements(el, 'default')) readDefaults(c, own)
}
for (const d of elements(xml.documentElement, 'default')) readDefaults(d, {})

const meshes = {}
for (const m of Array.from(xml.getElementsByTagName('mesh'))) {
    if (m.parentNode.tagName !== 'asset') continue
    const file = m.getAttribute('file')
    meshes[m.getAttribute('name') || path.basename(file, path.extname(file))] = {file, scale: nums(m.getAttribute('scale') || meshDefaults.scale, '1 1 1')}
}
const mjMaterials = {}
for (const m of Array.from(xml.getElementsByTagName('material'))) mjMaterials[m.getAttribute('name')] = nums(m.getAttribute('rgba'), '0.7 0.7 0.7 1')

const doc = new Document()
const buffer = doc.createBuffer()
const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const materials = {}
function material(rgba) {
    const key = rgba.map(v => v.toFixed(2)).join(',')
    if (!materials[key]) {
        // Satin, like the G1: dark parts a little smoother than light ones.
        const dark = (rgba[0] + rgba[1] + rgba[2]) / 3 < 0.4
        materials[key] = doc.createMaterial(dark ? 'Joint housings' : 'Shells')
            .setBaseColorFactor([...rgba.slice(0, 3).map(srgbToLinear), rgba[3] ?? 1])
            .setMetallicFactor(dark ? 0.2 : 0.3)
            .setRoughnessFactor(dark ? 0.5 : 0.4)
    }
    return materials[key]
}
function readStl(file, scale) {
    const b = fs.readFileSync(path.join(meshDir, file))
    const n = b.readUInt32LE(80)
    const pos = new Float32Array(n * 9)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = b.readFloatLE(84 + i * 50 + 12 + k * 4) * scale[k % 3]
    return pos
}

function addBody(el, parent, childclass) {
    const cls = el.getAttribute('childclass') || childclass
    const node = doc.createNode(el.getAttribute('name')).setTranslation(nums(el.getAttribute('pos'), '0 0 0'))
    const [w, x, y, z] = nums(el.getAttribute('quat'), '1 0 0 0')
    node.setRotation([x, y, z, w])
    parent.addChild(node)
    for (const g of elements(el, 'geom')) {
        const attrs = {...classes.main, ...classes[cls], ...classes[g.getAttribute('class')]}
        for (const a of Array.from(g.attributes)) attrs[a.name] = a.value
        const visual = (g.getAttribute('class') || '').includes('visual') || attrs.contype === '0' || attrs.group === '2'
        if (!attrs.mesh || !visual || !meshes[attrs.mesh] || !/\.stl$/i.test(meshes[attrs.mesh].file)) continue
        const mesh = meshes[attrs.mesh]
        const rgba = attrs.rgba ? nums(attrs.rgba) : mjMaterials[attrs.material] ?? [0.7, 0.7, 0.7, 1]
        const prim = doc.createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(readStl(mesh.file, mesh.scale)).setBuffer(buffer))
            .setMaterial(material(rgba))
        const geomNode = doc.createNode(attrs.mesh + '_mesh').setMesh(doc.createMesh(attrs.mesh).addPrimitive(prim))
        if (attrs.pos) geomNode.setTranslation(nums(attrs.pos))
        if (attrs.quat) {
            const [qw, qx, qy, qz] = nums(attrs.quat)
            geomNode.setRotation([qx, qy, qz, qw])
        }
        node.addChild(geomNode)
    }
    for (const c of elements(el, 'body')) addBody(c, node, cls)
    return node
}

const scene = doc.createScene(path.basename(xmlPath, '.xml'))
const root = doc.createNode(path.basename(outPath, '.glb')).setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
scene.addChild(root)
const world = xml.getElementsByTagName('worldbody')[0]
for (const b of elements(world, 'body')) if (elements(b, 'body').length || elements(b, 'geom').length) addBody(b, root, b.getAttribute('childclass') || '')

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
console.log(`${outPath}: ${(fs.statSync(outPath).size / 1e6).toFixed(2)} MB, ${tris} triangles, ${Object.keys(materials).length} materials`)
