/**
 * Shade flat / smooth / smooth by angle against Blender 5.2.2 (`fixtures/shading.json`, written by
 * `gen-shading-fixtures.py` through `bpy.ops.object.shade_flat`, `shade_smooth`, `shade_smooth_by_angle`).
 *
 * The result is the set of sharp edges (by vertex pair; Blender's edge order is its own) and the per-face
 * `sharp_face` flags. An absent attribute in Blender means "all false", which is how a missing layer reads here too.
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {shadeFlat, shadeSmooth, shadeSmoothByAngle} from '../src/shading'
import {loadFixture} from './parity-util'

interface ShadingCase {
    name: string
    input: {positions: number[][], faces: number[][], sharpEdges: number[][], sharpFaces: number[] | null}
    op: 'smooth_by_angle' | 'smooth' | 'flat'
    angle: number | null
    keepSharpEdges: boolean
    sharpEdges: number[][] | null
    sharpFaces: boolean[] | null
}

const fixture = loadFixture<ShadingCase>('shading.json')
const pair = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`

describe(`shading parity with Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const m = MeshData.fromFaces({positions: c.input.positions.flat(), faces: c.input.faces})
            if (c.input.sharpEdges.length) {
                const want = new Set(c.input.sharpEdges.map(([a, b]) => pair(a, b)))
                const layer = m.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data
                for (let e = 0; e < m.edgesNum; e++) layer[e] = want.has(pair(m.edgeVerts[2 * e], m.edgeVerts[2 * e + 1])) ? 1 : 0
            }
            if (c.input.sharpFaces) {
                const layer = m.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data
                c.input.sharpFaces.forEach((v, i) => { layer[i] = v ? 1 : 0 })
            }
            if (c.op === 'smooth_by_angle') shadeSmoothByAngle(m, c.angle!, c.keepSharpEdges)
            else if (c.op === 'smooth') shadeSmooth(m, c.keepSharpEdges)
            else shadeFlat(m, c.keepSharpEdges)

            const se = m.attributes.get(AttrName.sharpEdge)?.data
            const got: string[] = []
            if (se) for (let e = 0; e < m.edgesNum; e++) if (se[e]) got.push(pair(m.edgeVerts[2 * e], m.edgeVerts[2 * e + 1]))
            expect(got.sort()).toEqual((c.sharpEdges ?? []).map(([a, b]) => pair(a, b)).sort())

            const sf = m.attributes.get(AttrName.sharpFace)?.data
            const gotFaces = Array.from({length: m.facesNum}, (_, f) => !!sf?.[f])
            expect(gotFaces).toEqual(c.sharpFaces ?? new Array(m.facesNum).fill(false))
        })
    }
})
