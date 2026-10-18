/**
 * Subdivision Surface against Blender 5.2.2 (`fixtures/subsurf.json`, written by `gen-subsurf-fixtures.py`).
 *
 * Geometry is compared as in the other parity suites (`parity-util.ts` `compareMeshes`): every Blender vertex
 * paired with one of ours within the tolerance, faces as cyclic vertex sequences. UVs are compared per face corner after mapping faces through the vertex pairing.
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {subdivisionSurface} from '../src/subdiv'
import {bmFromMesh, bmToMesh} from '../src/bmesh/convert'
import {compareMeshes, loadFixture} from './parity-util'

interface SubsurfCase {
    name: string
    input: {positions: number[][], faces: number[][], looseEdges: number[][], edgeCrease: [number[], number][], vertCrease: number[][], uv: boolean}
    modifier: {levels: number, quality: number, useLimitSurface: boolean, useCreases: boolean, boundarySmooth: 'ALL' | 'PRESERVE_CORNERS', uvSmooth: string, type: 'CATMULL_CLARK' | 'SIMPLE'}
    positions: number[][]
    faces: number[][]
    looseEdges: number[][]
    uv?: number[][]
}

const fixture = loadFixture<SubsurfCase>('subsurf.json')
const TOL = 2e-4

function build(c: SubsurfCase): MeshData {
    let m = MeshData.fromFaces({positions: c.input.positions.flat(), faces: c.input.faces})
    if (c.input.looseEdges.length) {
        const bm = bmFromMesh(m)
        const verts = Array.from(bm.verts)
        for (const [a, b] of c.input.looseEdges) bm.edgeCreate(verts[a], verts[b], undefined, {noDouble: true})
        m = bmToMesh(bm)
    }
    if (c.input.edgeCrease.length) {
        const layer = m.attributes.ensure(AttrName.creaseEdge, AttrDomain.Edge, 'float').data as Float32Array
        const want = new Map(c.input.edgeCrease.map(([p, v]) => [p[0] < p[1] ? `${p[0]}-${p[1]}` : `${p[1]}-${p[0]}`, v]))
        for (let e = 0; e < m.edgesNum; e++) {
            const a = m.edgeVerts[2 * e], b = m.edgeVerts[2 * e + 1]
            layer[e] = want.get(a < b ? `${a}-${b}` : `${b}-${a}`) ?? 0
        }
    }
    if (c.input.vertCrease.length) {
        const layer = m.attributes.ensure(AttrName.creaseVert, AttrDomain.Point, 'float').data as Float32Array
        for (const [i, v] of c.input.vertCrease) layer[i] = v
    }
    if (c.input.uv) {
        // the generator's layout: corner k of face f at (1.5 f + 0.5 + 0.5 cos a, 0.5 + 0.5 sin a), a = 2 pi k / n
        const uv = m.attributes.ensure('UVMap', AttrDomain.Corner, 'float2').data as Float32Array
        for (let f = 0; f < m.facesNum; f++) {
            const s = m.faceOffsets[f], n = m.faceOffsets[f + 1] - s
            for (let k = 0; k < n; k++) {
                const a = 2 * Math.PI * k / n
                uv[2 * (s + k)] = f * 1.5 + 0.5 + 0.5 * Math.cos(a)
                uv[2 * (s + k) + 1] = 0.5 + 0.5 * Math.sin(a)
            }
        }
    }
    return m
}

describe(`subsurf parity with Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const out = subdivisionSurface(build(c), {
                levels: c.modifier.levels, quality: c.modifier.quality, useLimitSurface: c.modifier.useLimitSurface,
                useCreases: c.modifier.useCreases, boundarySmooth: c.modifier.boundarySmooth,
                uvSmooth: c.modifier.uvSmooth as never, scheme: c.modifier.type,
            })
            // Blender keeps loose edges (subdivided); the port does not carry them yet (16b S7), so compare the
            // face-bound geometry only
            const used = new Set(c.faces.flat())
            const keep = c.positions.map((_, i) => used.has(i))
            const remap = new Map<number, number>()
            const wantPositions: number[][] = []
            c.positions.forEach((p, i) => { if (keep[i]) { remap.set(i, wantPositions.length); wantPositions.push(p) } })
            const want = {positions: wantPositions, faces: c.faces.map(f => f.map(i => remap.get(i)!))}
            const got = {positions: Array.from({length: out.vertsNum}, (_, v) => [out.positions[3 * v], out.positions[3 * v + 1], out.positions[3 * v + 2]]),
                faces: Array.from({length: out.facesNum}, (_, f) => Array.from(out.cornerVerts.subarray(out.faceOffsets[f], out.faceOffsets[f + 1])))}
            expect(compareMeshes(got, want, {edges: false, tol: TOL})).toEqual([])

            if (c.uv) {
                // corner UVs: match each Blender face to ours by its vertex positions, then compare corner by corner
                const ouv = out.attributes.get('UVMap')!.data
                // Blender vertex -> ours: the nearest within the tolerance (as compareMeshes pairs them)
                const ourOf = c.positions.map(p => {
                    let best = -1, bd = TOL
                    got.positions.forEach((q, v) => {
                        const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]))
                        if (d < bd) { bd = d; best = v }
                    })
                    return best
                })
                const ourFace = new Map<string, number>()
                for (let f = 0; f < out.facesNum; f++) ourFace.set([...got.faces[f]].sort((a, b) => a - b).join(','), f)
                let corner = 0, bad = 0
                for (const f of c.faces) {
                    const verts = f.map(i => ourOf[i])
                    const of = ourFace.get([...verts].sort((a, b) => a - b).join(','))
                    if (of === undefined) { bad++; corner += f.length; continue }
                    const s = out.faceOffsets[of]
                    for (let k = 0; k < f.length; k++, corner++) {
                        const ck = s + got.faces[of].indexOf(verts[k])
                        const w = c.uv[corner]
                        if (Math.abs(ouv[2 * ck] - w[0]) > TOL || Math.abs(ouv[2 * ck + 1] - w[1]) > TOL) bad++
                    }
                }
                expect(bad).toBe(0)
            }
        })
    }
})
