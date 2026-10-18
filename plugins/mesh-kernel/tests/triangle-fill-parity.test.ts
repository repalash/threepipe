/**
 * Ground-truth parity for `triangleFill` (Blender's scan-fill) and `faceAttributeFill` against
 * Blender's own `bmesh.ops.triangle_fill(use_beauty=False)` and `bmesh.ops.face_attribute_fill`.
 *
 * The expectations come from `fixtures/triangle-fill.json`, written by
 * `fixtures/gen-triangle-fill-fixtures.py` running inside Blender. Each case carries its input mesh as
 * explicit coordinates, edges (in creation order, so disk cycles match) and faces; this suite builds
 * the same mesh, runs the ports with the same parameters and compares.
 *
 * What is compared:
 * - Vertex positions, index for index (neither operator adds or removes vertices), within 1e-4.
 * - Faces. For `strictOrder` cases (no dissolve, and no island-order difference between Blender
 *   3.4.1 and main - see the generator) the face list must match exactly: same order, same first
 *   loop, same winding - and so must each face's material, smooth flag and corner UVs, and `geom.out`
 *   (edges with their `v1`/`v2` orientation, then faces) in order. Otherwise faces are compared as a
 *   multiset of cyclic vertex sequences, which still checks winding, with their attributes alongside.
 * - `faces_fail.out` of `face_attribute_fill`, as a multiset of cyclic sequences.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BMesh} from '../src/bmesh/BMesh'
import {BMFace, BMVert} from '../src/bmesh/types'
import {diskEdgeExists} from '../src/bmesh/structure'
import {getValue, setValue} from '../src/bmesh/customdata'
import {ElemFlag} from '../src/constants'
import {triangleFill} from '../src/ops/triangleFill'
import {faceAttributeFill} from '../src/ops/faceAttributeFill'
import type {Vec3} from '../src/math'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'triangle-fill.json')

interface Output {
    positions: number[][]
    faces: number[][]
    materials: number[]
    smooth: number[]
    uvs?: number[][][]
    geomFaces: number[][]
    geomEdges: number[][]
    facesFail: number[][] | null
}

interface Case {
    name: string
    positions: number[][]
    edges: number[][]
    faces: number[][]
    fillEdges: number[][]
    normal: number[]
    useDissolve: boolean
    attrFill: {use_normals: boolean, use_data: boolean} | null
    strictOrder: boolean
    materials: number[] | null
    smooth: number[] | null
    uvs: number[][][] | null
    output: Output
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {blender: string, cases: Case[]}

/** Blender works in float32 and the fixture is rounded to 6 places; 1e-4 is well inside both. */
const TOL = 1e-4

function build(c: Case) {
    const bm = new BMesh()
    const verts = c.positions.map(p => bm.vertCreate(p[0], p[1], p[2]))
    for (const [a, b] of c.edges) bm.edgeCreate(verts[a], verts[b])
    const uvLayer = c.uvs ? bm.addLayer('loop', 'UVMap', 'float2') : null
    c.faces.forEach((fv, i) => {
        const f = bm.faceCreate(fv.map(j => verts[j]))
        if (c.materials) f.matNr = c.materials[i]
        // Kernel faces are created flat, as Blender's are; the fixture sets smooth explicitly.
        if (c.smooth) f.setFlag(ElemFlag.Smooth, !!c.smooth[i])
        if (uvLayer) f.loops().forEach((l, k) => setValue(l, bm.ldata, uvLayer, c.uvs![i][k]))
    })
    const fill = c.fillEdges.map(([a, b]) => {
        const e = diskEdgeExists(verts[a], verts[b])
        if (!e) throw new Error(`fixture edge ${a}-${b} missing`)
        return e
    })
    return {bm, verts, fill}
}

function dump(bm: BMesh, verts: BMVert[]) {
    const index = new Map(verts.map((v, i) => [v, i]))
    const faces = [...bm.faces]
    const uvLayer = bm.ldata.get('UVMap')
    return {
        positions: [...bm.verts].map(v => [v.x, v.y, v.z]),
        faces: faces.map(f => f.verts().map(v => index.get(v)!)),
        materials: faces.map(f => f.matNr),
        smooth: faces.map(f => (f.testFlag(ElemFlag.Smooth) ? 1 : 0)),
        uvs: uvLayer ? faces.map(f => f.loops().map(l => getValue(l, uvLayer))) : undefined,
        index,
    }
}

const cyclic = (f: number[]) => {
    let best = 0
    for (let i = 1; i < f.length; i++) if (f[i] < f[best]) best = i
    return [...f.slice(best), ...f.slice(0, best)].join(',')
}

/** Multiset of cyclic sequences; returns problems. */
function compareCyclic(got: number[][], want: number[][], what: string): string[] {
    const problems: string[] = []
    if (got.length !== want.length) problems.push(`${what}: count ${got.length}, Blender ${want.length}`)
    const pool = new Map<string, number>()
    for (const f of got) pool.set(cyclic(f), (pool.get(cyclic(f)) ?? 0) + 1)
    for (const f of want) {
        const n = pool.get(cyclic(f)) ?? 0
        if (!n) problems.push(`${what}: no match for Blender's [${f.join(', ')}] (same winding)`)
        else pool.set(cyclic(f), n - 1)
    }
    return problems
}

const roundUv = (uv: number[][]) => uv.map(p => p.map(x => Math.round(x * 1e5) / 1e5))

describe(`triangle_fill / face_attribute_fill match Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const {bm, verts, fill} = build(c)
            const res = triangleFill(bm, fill, {normal: c.normal as Vec3, useDissolve: c.useDissolve})
            // `geom.out` as vertex lists now: the generator records it before face_attribute_fill
            // flips any of those faces.
            const vIndex = new Map(verts.map((v, i) => [v, i]))
            const ix = (f: BMFace) => f.verts().map(v => vIndex.get(v)!)
            const geomFaces = res.faces.map(ix)
            const geomEdges = res.edges.map(e => [vIndex.get(e.v1)!, vIndex.get(e.v2)!])
            let facesFail: BMFace[] | null = null
            if (c.attrFill) {
                facesFail = faceAttributeFill(bm, res.faces, {
                    useNormals: c.attrFill.use_normals,
                    useData: c.attrFill.use_data,
                }).facesFail
            }
            expect(bm.validate()).toEqual([])

            const got = dump(bm, verts)
            const want = c.output

            // Positions, index for index.
            expect(got.positions.length).toBe(want.positions.length)
            got.positions.forEach((p, i) => {
                for (let k = 0; k < 3; k++) expect(Math.abs(p[k] - want.positions[i][k])).toBeLessThan(TOL)
            })

            if (c.strictOrder) {
                expect(got.faces).toEqual(want.faces)
                expect(got.materials).toEqual(want.materials)
                expect(got.smooth).toEqual(want.smooth)
                if (want.uvs) expect(got.uvs!.map(roundUv)).toEqual(want.uvs.map(roundUv))
                expect(geomFaces).toEqual(want.geomFaces)
                expect(geomEdges).toEqual(want.geomEdges)
            } else {
                expect(compareCyclic(got.faces, want.faces, 'faces')).toEqual([])
                // Attributes per face, keyed by the face's cyclic sequence.
                const attrs = (faces: number[][], mats: number[], smooth: number[]) =>
                    faces.map((f, i) => `${cyclic(f)}|m${mats[i]}|s${smooth[i]}`).sort()
                expect(attrs(got.faces, got.materials, got.smooth)).toEqual(attrs(want.faces, want.materials, want.smooth))
                expect(compareCyclic(geomFaces, want.geomFaces, 'geom.out faces')).toEqual([])
                const und = (es: number[][]) => es.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)).sort()
                expect(und(geomEdges)).toEqual(und(want.geomEdges))
            }

            if (want.facesFail) {
                expect(compareCyclic(facesFail!.map(ix), want.facesFail, 'faces_fail.out')).toEqual([])
            }
        })
    }
})
