/**
 * Subdivision Surface against Blender 5.2.2 (`fixtures/subsurf.json`, written by `gen-subsurf-fixtures.py`), index for
 * index: the input is rebuilt with Blender's edge order (`subdiv_foreach` numbers the output by coarse edge), and
 * vertex i, edge i, face i and corner i's UV must equal Blender's. Positions and UVs are compared bit for bit.
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain, AttrName} from '../src/constants'
import {subdivisionSurface} from '../src/subdiv'
import {loadFixture} from './parity-util'

interface SubsurfCase {
    name: string
    input: {positions: number[][], faces: number[][], edges: number[][], looseEdges: number[][], edgeCrease: [number[], number][], vertCrease: number[][], uv: boolean}
    modifier: {levels: number, quality: number, useLimitSurface: boolean, useCreases: boolean, boundarySmooth: 'ALL' | 'PRESERVE_CORNERS', uvSmooth: string, type: 'CATMULL_CLARK' | 'SIMPLE'}
    positions: number[][]
    edges: number[][]
    faces: number[][]
    looseEdges: number[][]
    uv?: number[][]
}

const fixture = loadFixture<SubsurfCase>('subsurf.json')

/**
 * Allowed difference: none. Uniform refinement is OpenSubdiv's float stencil pipeline, and the limit surface
 * (`use_limit_surface`) its float adaptive refinement, Gregory end-cap local points and patch evaluation, as Blender runs
 * them. The tolerance stays a parameter for diagnosis.
 */
const TOLERANCE = (_c: SubsurfCase): Tolerance => ({abs: 0, ulps: 0})
interface Tolerance { abs: number, ulps: number }

const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer)
/** Ordered float32 bits: the ulp distance is the difference. */
function ordered(x: number): number {
    f32[0] = x
    const i = i32[0]
    return i < 0 ? -2147483648 - i : i
}
const ulps = (a: number, b: number) => Math.abs(ordered(a) - ordered(b))

/** The input as Blender built it: positions, faces, and the edges in Blender's order (loose edges included). */
function build(c: SubsurfCase): MeshData {
    const m = MeshData.fromFaces({positions: c.input.positions.flat(), faces: c.input.faces})
    m.resize({edges: c.input.edges.length})
    m.edgeVerts.set(c.input.edges.flat())
    m.calculateCornerEdges()
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
        // the generator's layout: corner k of face f at (1.5 f + 0.5 + 0.5 cos a, 0.5 + 0.5 sin a), a = 2 pi k / n,
        // computed in double and stored as float (`MLoopUV`)
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

/** Index-for-index differences: counts, topology, and values beyond the tolerance; plus the largest differences seen. */
function compare(out: MeshData, c: SubsurfCase, tol: Tolerance): {errors: string[], worst: number, worstAbs: number} {
    const errors: string[] = []
    let worst = 0, worstAbs = 0
    const check = (what: string, got: number, want: number) => {
        const d = ulps(got, want), a = Math.abs(got - want)
        worst = Math.max(worst, d)
        worstAbs = Math.max(worstAbs, a)
        if (a > tol.abs && d > tol.ulps && errors.length < 40) errors.push(`${what}: ${got}, Blender ${want} (${d} ulps)`)
    }
    const counts = [['vertex', out.vertsNum, c.positions.length], ['edge', out.edgesNum, c.edges.length], ['face', out.facesNum, c.faces.length]] as const
    for (const [what, got, want] of counts) if (got !== want) errors.push(`${what} count ${got}, Blender ${want}`)
    if (errors.length) return {errors, worst, worstAbs}
    for (let v = 0; v < out.vertsNum; v++) for (let k = 0; k < 3; k++) check(`vertex ${v}.${k}`, out.positions[3 * v + k], c.positions[v][k])
    for (let e = 0; e < out.edgesNum; e++) {
        const a = out.edgeVerts[2 * e], b = out.edgeVerts[2 * e + 1]
        if (a !== c.edges[e][0] || b !== c.edges[e][1]) { errors.push(`edge ${e}: [${a}, ${b}], Blender [${c.edges[e]}]`); break }
    }
    for (let f = 0; f < out.facesNum; f++) {
        const got = Array.from(out.cornerVerts.subarray(out.faceOffsets[f], out.faceOffsets[f + 1]))
        if (got.join() !== c.faces[f].join()) { errors.push(`face ${f}: [${got}], Blender [${c.faces[f]}]`); break }
    }
    if (c.uv) {
        const uv = out.attributes.get('UVMap')?.data
        if (!uv) errors.push('no UVMap')
        else for (let i = 0; i < c.uv.length; i++) for (let k = 0; k < 2; k++) check(`corner ${i} uv.${k}`, uv[2 * i + k], c.uv[i][k])
    }
    return {errors, worst, worstAbs}
}

describe(`subsurf parity with Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const out = subdivisionSurface(build(c), {
                levels: c.modifier.levels, quality: c.modifier.quality, useLimitSurface: c.modifier.useLimitSurface,
                useCreases: c.modifier.useCreases, boundarySmooth: c.modifier.boundarySmooth,
                uvSmooth: c.modifier.uvSmooth as never, scheme: c.modifier.type,
            })
            const {errors, worst, worstAbs} = compare(out, c, TOLERANCE(c))
            if (worst) console.log(`${c.name}: largest difference ${worstAbs.toExponential(2)} (${worst} ulps)`)
            expect(errors).toEqual([])
        })
    }
})
