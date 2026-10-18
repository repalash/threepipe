/**
 * Manifold boolean against Blender 5.2.2's Boolean modifier, solver MANIFOLD (`fixtures/boolean.json`, written by
 * `gen-boolean-fixtures.py`).
 *
 * Vertices are paired by position; faces compared as cyclic vertex sequences through that pairing (winding
 * included); then the attributes: `w` (point) per paired vertex, `fw` and `material_index` (face) per paired face,
 * and the UV map per paired corner. Materials use the modifier's Index Based mode (target slots A, B; operands B).
 */

import {beforeAll, describe, expect, it} from 'vitest'
import Module from 'manifold-3d'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {Mat4} from '../src/math'
import {ManifoldApi, materialRemapIndexBased, meshBooleanManifold} from '../src/boolean/manifoldBoolean'
import {loadFixture} from './parity-util'

interface InputMesh { positions: number[][], faces: number[][], material: number, location: number[], rotation: number[], scale: number[] }
interface BooleanCase {
    name: string
    operation: 'DIFFERENCE' | 'UNION' | 'INTERSECT'
    target: InputMesh
    operands: InputMesh[]
    positions: number[][]
    faces: number[][]
    edges: number[][]
    material_index?: number[]
    fw?: number[]
    materials: (string | null)[]
    w?: number[]
    uv?: number[][]
}

const fixture = loadFixture<BooleanCase>('boolean.json')
const TOL = 1e-5

let api: ManifoldApi
beforeAll(async() => {
    const wasm = await Module()
    wasm.setup()
    api = wasm as unknown as ManifoldApi
})

/** The generator's input mesh with its attributes (same formulas as `make()` there). */
function build(m: InputMesh): MeshData {
    const mesh = MeshData.fromFaces({positions: m.positions.flat(), faces: m.faces})
    mesh.materials = m.material === 0 ? ['A', 'B'] : ['B']
    const mat = mesh.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32').data
    for (let f = 0; f < mesh.facesNum; f++) mat[f] = m.material === 0 ? f % 2 : 0
    const fw = mesh.attributes.ensure('fw', AttrDomain.Face, 'float').data
    for (let f = 0; f < mesh.facesNum; f++) fw[f] = Math.fround(m.material + 0.01 * f)
    const w = mesh.attributes.ensure('w', AttrDomain.Point, 'float').data
    for (let v = 0; v < mesh.vertsNum; v++) w[v] = Math.fround(0.1 * m.material + 0.01 * v)
    const uv = mesh.attributes.ensure('UVMap', AttrDomain.Corner, 'float2').data
    for (let f = 0; f < mesh.facesNum; f++) {
        const s = mesh.faceOffsets[f], n = mesh.faceOffsets[f + 1] - s
        for (let k = 0; k < n; k++) {
            const a = 2 * Math.PI * k / n
            uv[2 * (s + k)] = 0.5 + 0.5 * Math.cos(a)
            uv[2 * (s + k) + 1] = 0.5 + 0.5 * Math.sin(a)
        }
    }
    return mesh
}

/** Blender's object matrix: T * R * S, with an XYZ Euler meaning R = Rz * Ry * Rx (column-major Mat4). */
function objectMatrix(m: InputMesh): Mat4 {
    const [x, y, z] = m.rotation
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z)
    const r = [
        [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
        [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
        [-sy, sx * cy, cx * cy],
    ]
    const [a, b, c] = m.scale
    return [
        r[0][0] * a, r[1][0] * a, r[2][0] * a, 0,
        r[0][1] * b, r[1][1] * b, r[2][1] * b, 0,
        r[0][2] * c, r[1][2] * c, r[2][2] * c, 0,
        m.location[0], m.location[1], m.location[2], 1,
    ]
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe(`boolean parity with Blender ${fixture.blender} (Manifold solver)`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            // the target sits at the origin in every case, so operand transforms are already target-relative
            expect(c.target.location).toEqual([0, 0, 0])
            const inputs = [build(c.target), ...c.operands.map(build)]
            const remaps = [[], ...inputs.slice(1).map(m => materialRemapIndexBased(inputs[0].materials, m.materials))]
            const r = meshBooleanManifold(api, inputs, c.operation, [IDENTITY, ...c.operands.map(objectMatrix)], remaps)
            if (c.name === 'box-non-manifold-operand') {
                // Blender reports the error and leaves the target as it was
                expect(r.error).toBe('NON_MANIFOLD')
                expect(r.nonManifoldMeshIndices).toEqual([1])
                expect(c.positions).toEqual(c.target.positions)
                return
            }
            expect(r.error).toBe('NONE')
            const m = r.mesh!
            expect([m.vertsNum, m.facesNum, m.edgesNum]).toEqual([c.positions.length, c.faces.length, c.edges.length])

            // vertices by position
            const map: number[] = []
            const used = new Uint8Array(m.vertsNum)
            const P = m.positions
            const missing: string[] = []
            c.positions.forEach((p, i) => {
                let j = -1
                for (let v = 0; v < m.vertsNum; v++) {
                    if (!used[v] && Math.abs(P[3 * v] - p[0]) < TOL && Math.abs(P[3 * v + 1] - p[1]) < TOL && Math.abs(P[3 * v + 2] - p[2]) < TOL) { j = v; break }
                }
                if (j < 0) missing.push(`[${p.map(x => x.toFixed(6))}]`)
                else { used[j] = 1; map[i] = j }
            })
            expect(missing).toEqual([])

            // faces as cyclic sequences, through the pairing
            const cyclic = (f: number[]) => {
                let best = 0
                for (let i = 1; i < f.length; i++) if (f[i] < f[best]) best = i
                return [...f.slice(best), ...f.slice(0, best)]
            }
            const ours = new Map<string, number>()
            for (let f = 0; f < m.facesNum; f++) ours.set(cyclic(Array.from(m.cornerVerts.subarray(m.faceOffsets[f], m.faceOffsets[f + 1]))).join(','), f)
            const faceMap: number[] = []
            const badFaces: string[] = []
            c.faces.forEach((f, i) => {
                const k = cyclic(f.map(v => map[v])).join(',')
                const of = ours.get(k)
                if (of === undefined) badFaces.push(`face ${i} [${f}]`)
                else faceMap[i] = of
            })
            expect(badFaces).toEqual([])

            // attributes
            const w = m.attributes.get('w')!.data
            const badW = c.w!.flatMap((v, i) => Math.abs(w[map[i]] - v) > 1e-6 ? [`v${i}: ${w[map[i]]} vs ${v}`] : [])
            expect(badW).toEqual([])
            expect(m.materials).toEqual(c.materials)
            const mat = m.attributes.get(AttrName.materialIndex)!.data
            expect(c.material_index!.map((_, i) => mat[faceMap[i]])).toEqual(c.material_index)
            const fw = m.attributes.get('fw')!.data
            expect(c.fw!.map((_, i) => fw[faceMap[i]])).toEqual(c.fw!.map(Math.fround))
            const uv = m.attributes.get('UVMap')!.data
            const badUV: string[] = []
            let corner = 0
            c.faces.forEach((f, i) => {
                const of = faceMap[i]
                const s = m.faceOffsets[of]
                const verts = Array.from(m.cornerVerts.subarray(s, m.faceOffsets[of + 1]))
                for (const v of f) {
                    const ck = s + verts.indexOf(map[v])
                    const want = c.uv![corner++]
                    if (Math.abs(uv[2 * ck] - want[0]) > 1e-5 || Math.abs(uv[2 * ck + 1] - want[1]) > 1e-5) badUV.push(`face ${i} v${v}: [${uv[2 * ck]}, ${uv[2 * ck + 1]}] vs [${want}]`)
                }
            })
            expect(badUV).toEqual([])
        })
    }
})
