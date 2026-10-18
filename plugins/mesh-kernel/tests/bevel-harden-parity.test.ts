/**
 * Bevel `harden_normals` / `face_strength_mode` against Blender 5.2.2's `bmesh.ops.bevel`
 * (`fixtures/bevel-harden.json`, written by `gen-bevel-harden-fixtures.py`).
 *
 * Output vertices are paired by position, faces as cyclic vertex sequences; then each corner's shaded normal and
 * each face's strength are compared through that pairing.
 *
 * Tolerance: custom normals are stored as 16-bit fractions of the fan's angles, and Blender computes the fans in
 * float, so the stored values can differ by a few units, about 2e-4 in the decoded normal.
 *
 * One known divergence is excluded and counted: in a smooth *cyclic* fan whose corners were given different
 * normals, Blender's result depends on BMesh mempool order (issues/open/modelling-tools/kernel-bmesh-mempool-order.md).
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {bmFromMesh, bmToMesh} from '../src/bmesh/convert'
import {bevelEdges} from '../src/ops/bevel'
import {CornerFanSpaces, faceNormalsTrue, meshCornerNormals, normalsCalcCorners} from '../src/normals'
import {FACE_WEIGHT_LAYER} from '../src/weightedNormal'
import {loadFixture} from './parity-util'

interface HardenCase {
    name: string
    input: {positions: number[][], faces: number[][], edges: number[][] | 'all', smooth: boolean}
    options: {offset: number, segments: number, harden: boolean, faceStrength: 'NONE' | 'NEW' | 'AFFECTED' | 'ALL'}
    positions: number[][]
    faces: number[][]
    cornerNormals: number[][]
    faceStrength: number[] | null
}

const fixture = loadFixture<HardenCase>('bevel-harden.json')
const TOL = 1e-4

describe(`bevel harden normals parity with Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const input = MeshData.fromFaces({positions: c.input.positions.flat(), faces: c.input.faces})
            if (!c.input.smooth) input.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data.fill(1)
            const bm = bmFromMesh(input)
            const verts = [...bm.verts]
            const edges = c.input.edges === 'all'
                ? [...bm.edges]
                : c.input.edges.map(([a, b]) => [...bm.edges].find(e => (e.v1 === verts[a] && e.v2 === verts[b]) || (e.v1 === verts[b] && e.v2 === verts[a]))!)
            bevelEdges(bm, edges, {
                offset: c.options.offset, offsetType: 'offset', segments: c.options.segments, profile: 0.5,
                clampOverlap: false, loopSlide: true, miterOuter: 'sharp', miterInner: 'sharp',
                hardenNormals: c.options.harden, faceStrengthMode: c.options.faceStrength,
            })
            const m = bmToMesh(bm)
            expect([m.vertsNum, m.facesNum]).toEqual([c.positions.length, c.faces.length])
            // vertices by position
            const map = c.positions.map(p => {
                for (let v = 0; v < m.vertsNum; v++) {
                    if (Math.abs(m.positions[3 * v] - p[0]) < TOL && Math.abs(m.positions[3 * v + 1] - p[1]) < TOL && Math.abs(m.positions[3 * v + 2] - p[2]) < TOL) return v
                }
                return -1
            })
            expect(map.filter(v => v < 0).length).toBe(0)
            const cyclic = (f: number[]) => { let b = 0; for (let i = 1; i < f.length; i++) if (f[i] < f[b]) b = i; return [...f.slice(b), ...f.slice(0, b)].join(',') }
            const ours = new Map<string, number>()
            for (let f = 0; f < m.facesNum; f++) ours.set(cyclic(Array.from(m.cornerVerts.subarray(m.faceOffsets[f], m.faceOffsets[f + 1]))), f)
            const n = meshCornerNormals(m)
            // corners of cyclic fans (reference = other edge, refBeta 2pi) holding different encodings: order-dependent
            const spaces: CornerFanSpaces = {spaces: [], cornerSpace: new Int32Array(0), cornersBySpace: []}
            normalsCalcCorners(m, faceNormalsTrue(m), m.attributes.get(AttrName.sharpEdge)?.data ?? null,
                m.attributes.get(AttrName.sharpFace)?.data ?? null, null, spaces, new Float32Array(m.cornersNum * 3))
            const cn = m.attributes.get(AttrName.customNormal)?.data
            const orderDependent = new Set<number>()
            if (cn) {
                spaces.cornersBySpace.forEach((fan, si) => {
                    if (fan.length < 2 || spaces.spaces[si].refBeta !== 2 * Math.PI) return
                    const mixed = fan.some(cc => cn[2 * cc] !== cn[2 * fan[0]] || cn[2 * cc + 1] !== cn[2 * fan[0] + 1])
                    if (mixed) for (const cc of fan) orderDependent.add(cc)
                })
            }
            const strength = m.attributes.get(FACE_WEIGHT_LAYER)?.data
            let corner = 0, worst = 0, divergent = 0
            const badFaces: number[] = []
            c.faces.forEach((f, i) => {
                const of = ours.get(cyclic(f.map(v => map[v])))
                if (of === undefined) { badFaces.push(i); corner += f.length; return }
                const s = m.faceOffsets[of], fv = Array.from(m.cornerVerts.subarray(s, m.faceOffsets[of + 1]))
                for (const v of f) {
                    const oc = s + fv.indexOf(map[v])
                    const w = c.cornerNormals[corner++]
                    let d = 0
                    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(n[3 * oc + k] - w[k]))
                    if (orderDependent.has(oc)) { if (d >= 2.5e-4) divergent++; continue }
                    worst = Math.max(worst, d)
                }
                if (c.faceStrength) expect(strength?.[of], `face ${i} strength`).toBe(c.faceStrength[i])
            })
            expect(badFaces).toEqual([])
            expect(worst).toBeLessThan(2.5e-4)
            // the corners that differ all sit in order-dependent fans; this fixture has exactly one such fan that does
            expect(divergent).toBe(c.name === 'cube-ring-s2-affected' ? 4 : 0)
        })
    }
})
