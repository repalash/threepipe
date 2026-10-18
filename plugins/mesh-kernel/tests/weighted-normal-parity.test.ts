/**
 * Weighted Normal modifier against Blender 5.2.2 (`fixtures/weighted-normal.json`, written by
 * `gen-weighted-normal-fixtures.py`): beveled box and cylinder, the three modes, weights 1 / 50 / 60-100,
 * threshold, keep sharp and face influence. Compares the shaded corner normals, the sharp edges and the
 * `custom_normal` encoding.
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {meshCornerNormals} from '../src/normals'
import {FACE_WEIGHT_LAYER, weightedNormal, WeightedNormalMode} from '../src/weightedNormal'
import {loadFixture} from './parity-util'

interface WNCase {
    name: string
    input: {positions: number[][], faces: number[][], sharpEdges: number[][], faceStrength: number[] | null}
    modifier: {mode: WeightedNormalMode, weight: number, thresh: number, keepSharp: boolean, useFaceInfluence: boolean}
    cornerNormals: number[][]
    customNormal: number[][] | null
    sharpEdges: number[][]
}

const fixture = loadFixture<WNCase>('weighted-normal.json')
const pair = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`

describe(`weighted normal parity with Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const m = MeshData.fromFaces({positions: c.input.positions.flat(), faces: c.input.faces})
            if (c.input.sharpEdges.length) {
                const want = new Set(c.input.sharpEdges.map(([a, b]) => pair(a, b)))
                const layer = m.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data
                for (let e = 0; e < m.edgesNum; e++) layer[e] = want.has(pair(m.edgeVerts[2 * e], m.edgeVerts[2 * e + 1])) ? 1 : 0
            }
            if (c.input.faceStrength) {
                const layer = m.attributes.ensure(FACE_WEIGHT_LAYER, AttrDomain.Face, 'int32').data
                c.input.faceStrength.forEach((v, i) => { layer[i] = v })
            }
            const r = weightedNormal(m, {
                mode: c.modifier.mode, weight: c.modifier.weight, threshold: c.modifier.thresh,
                keepSharp: c.modifier.keepSharp, useFaceInfluence: c.modifier.useFaceInfluence,
            })
            const se = r.attributes.get(AttrName.sharpEdge)?.data
            const got: string[] = []
            if (se) for (let e = 0; e < r.edgesNum; e++) if (se[e]) got.push(pair(r.edgeVerts[2 * e], r.edgeVerts[2 * e + 1]))
            expect(got.sort()).toEqual(c.sharpEdges.map(([a, b]) => pair(a, b)).sort())
            const n = meshCornerNormals(r)
            let worst = 0
            c.cornerNormals.forEach((w, i) => { for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(n[3 * i + k] - w[k])) })
            expect(worst).toBeLessThan(1e-4)
            const data = r.attributes.get(AttrName.customNormal)!.data
            let worstData = 0
            c.customNormal!.forEach((v, i) => { worstData = Math.max(worstData, Math.abs(data[2 * i] - v[0]), Math.abs(data[2 * i + 1] - v[1])) })
            expect(worstData).toBeLessThanOrEqual(2)
        })
    }
})
