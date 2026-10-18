/**
 * Corner, vertex and face normals and custom normals against Blender 5.2.2 (`fixtures/normals.json`, written by
 * `gen-normals-fixtures.py`).
 *
 * - Every case: `meshCornerNormals`, `meshVertNormals`, the geometric face normals and `normalsDomain` from the mesh
 *   Blender ended with (its custom normal data and sharp edges).
 * - Cases that set custom normals (`normals_split_custom_set[_from_vertices]`): `meshSetCustomNormals` from the
 *   same input reproduces Blender's sharp edges and its int16x2 encoding.
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {meshCornerNormals, meshSetCustomNormals, meshVertNormals, normalsDomain} from '../src/normals'
import {meshFaceNormals} from '../src/shading'
import {loadFixture} from './parity-util'

interface NormalsCase {
    name: string
    input: {positions: number[][], faces: number[][], sharpEdges: number[][], sharpFaces: number[] | null, custom: number[][] | null, customFromVerts: boolean, free: string | null}
    normalsDomain: 'POINT' | 'FACE' | 'CORNER'
    cornerNormals: number[][]
    vertexNormals: number[][]
    faceNormals: number[][]
    customNormal: {type: 'int16x2' | 'float3', domain: string, data: number[][]} | null
    sharpEdges: number[][]
}

const fixture = loadFixture<NormalsCase>('normals.json')
const pair = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`
const DOMAIN: Record<string, AttrDomain> = {POINT: AttrDomain.Point, FACE: AttrDomain.Face, CORNER: AttrDomain.Corner}

function build(c: NormalsCase, sharpEdgePairs: number[][]): MeshData {
    const m = MeshData.fromFaces({positions: c.input.positions.flat(), faces: c.input.faces})
    if (sharpEdgePairs.length) {
        const want = new Set(sharpEdgePairs.map(([a, b]) => pair(a, b)))
        const layer = m.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data
        for (let e = 0; e < m.edgesNum; e++) layer[e] = want.has(pair(m.edgeVerts[2 * e], m.edgeVerts[2 * e + 1])) ? 1 : 0
    }
    if (c.input.sharpFaces) {
        const layer = m.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data
        c.input.sharpFaces.forEach((v, i) => { layer[i] = v ? 1 : 0 })
    }
    return m
}

const maxDiff = (got: ArrayLike<number>, want: number[][]) => {
    let d = 0
    want.forEach((w, i) => { for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(got[3 * i + k] - w[k])) })
    return d
}

describe(`normals parity with Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(`${c.name}: normals of Blender's result`, () => {
            const m = build(c, c.sharpEdges)
            if (c.customNormal) {
                const layer = m.attributes.ensure(AttrName.customNormal, DOMAIN[c.customNormal.domain], c.customNormal.type)
                c.customNormal.data.forEach((v, i) => { for (let k = 0; k < v.length; k++) layer.data[i * v.length + k] = v[k] })
            }
            expect(normalsDomain(m)).toBe(c.normalsDomain)
            expect(maxDiff(meshCornerNormals(m), c.cornerNormals)).toBeLessThan(1e-4)
            expect(maxDiff(meshVertNormals(m), c.vertexNormals)).toBeLessThan(1e-4)
            // `MeshPolygon.normal` is the geometric `face_normal_calc` (rna_mesh.cc), not the custom-aware face_normals()
            expect(maxDiff(meshFaceNormals(m), c.faceNormals)).toBeLessThan(1e-4)
        })
        if (c.input.custom && c.customNormal?.type === 'int16x2') {
            it(`${c.name}: setting the custom normals`, () => {
                const m = build(c, c.input.sharpEdges)
                meshSetCustomNormals(m, Float32Array.from(c.input.custom!.flat()), {fromVertices: c.input.customFromVerts})
                const se = m.attributes.get(AttrName.sharpEdge)!.data
                const got: string[] = []
                for (let e = 0; e < m.edgesNum; e++) if (se[e]) got.push(pair(m.edgeVerts[2 * e], m.edgeVerts[2 * e + 1]))
                expect(got.sort()).toEqual(c.sharpEdges.map(([a, b]) => pair(a, b)).sort())
                const data = m.attributes.get(AttrName.customNormal)!.data
                let worst = 0
                c.customNormal!.data.forEach((v, i) => { worst = Math.max(worst, Math.abs(data[2 * i] - v[0]), Math.abs(data[2 * i + 1] - v[1])) })
                expect(worst).toBeLessThanOrEqual(2) // the encoding rounds float angles to 1/32767
                expect(maxDiff(meshCornerNormals(m), c.cornerNormals)).toBeLessThan(1e-4)
            })
        }
    }
})
