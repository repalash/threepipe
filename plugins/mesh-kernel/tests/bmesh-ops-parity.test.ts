/**
 * Ground-truth parity for `pokeFaces` and `wireframe` against Blender's own `bmesh.ops.poke` and
 * `bmesh.ops.wireframe`.
 *
 * The expectations come from `fixtures/bmesh-ops-poke-wireframe.json`, written by
 * `fixtures/gen-bmesh-ops-fixtures.py` running inside Blender. Each case carries its input mesh as
 * explicit coordinates; this suite builds the same mesh, runs the port with the same parameters and
 * compares the result.
 *
 * What is compared, and why not more: element *order* is not reproducible across the two. Blender's
 * mempool reuses the slot of a face killed mid-operator (poke kills each face as it goes), so its
 * iteration order is not creation order. Geometry is what matters, so the comparison is the multiset
 * of vertex positions (paired within a tolerance) and the multiset of faces, each face compared as a
 * cyclic sequence of those paired vertices - which also checks winding, because a reversed face is a
 * different cyclic sequence.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BMesh} from '../src/bmesh/BMesh'
import {pokeFaces, PokeCenterMode} from '../src/ops/poke'
import {wireframe, WireframeOptions} from '../src/ops/wireframe'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bmesh-ops-poke-wireframe.json')

interface Case {
    name: string
    op: 'poke' | 'wireframe' | 'poke+wireframe'
    params: Record<string, any>
    input: {positions: number[][], faces: number[][]}
    faceSubset: number[] | null
    output: {positions: number[][], faces: number[][]}
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {blender: string, cases: Case[]}

/** Blender works in float32 and the fixture is rounded to 6 places; 1e-4 is well inside both. */
const TOL = 1e-4

const CENTER: Record<string, PokeCenterMode> = {MEAN_WEIGHTED: 'meanWeighted', MEAN: 'mean', BOUNDS: 'bounds'}

function pokeOpts(p: Record<string, any>) {
    return {
        offset: p.offset ?? 0,
        centerMode: CENTER[p.center_mode ?? 'MEAN_WEIGHTED'],
        useRelativeOffset: !!p.use_relative_offset,
    }
}

/** `bmesh.ops.wireframe` slots default to zero/false; the fixture always passes them all. */
function wireOpts(p: Record<string, any>): WireframeOptions {
    return {
        thickness: p.thickness,
        offset: p.offset,
        useReplace: !!p.use_replace,
        useBoundary: !!p.use_boundary,
        useEvenOffset: !!p.use_even_offset,
        useRelativeOffset: !!p.use_relative_offset,
        useCrease: !!p.use_crease,
        creaseWeight: p.crease_weight,
    }
}

function build(input: Case['input']) {
    const bm = new BMesh()
    const verts = input.positions.map(c => bm.vertCreate(c[0], c[1], c[2]))
    const faces = input.faces.map(f => bm.faceCreate(f.map(i => verts[i])))
    return {bm, faces}
}

/**
 * Pair every expected vertex with a distinct received vertex within {@link TOL}, then map every
 * expected face through that pairing and look for it, as a cyclic sequence, among the received faces.
 * Greedy matching is enough: no two vertices of any fixture are closer than a few hundredths.
 * Returns a list of problems, empty when the two meshes are the same geometry.
 */
function compare(got: {positions: number[][], faces: number[][]}, want: {positions: number[][], faces: number[][]}): string[] {
    const problems: string[] = []
    if (got.positions.length !== want.positions.length) {
        problems.push(`vertex count ${got.positions.length}, Blender ${want.positions.length}`)
    }
    if (got.faces.length !== want.faces.length) {
        problems.push(`face count ${got.faces.length}, Blender ${want.faces.length}`)
    }
    if (problems.length) return problems

    const used = new Array(got.positions.length).fill(false)
    const map: number[] = []
    want.positions.forEach((w, i) => {
        const j = got.positions.findIndex((g, k) => !used[k]
            && Math.abs(g[0] - w[0]) < TOL && Math.abs(g[1] - w[1]) < TOL && Math.abs(g[2] - w[2]) < TOL)
        if (j < 0) problems.push(`no vertex at Blender's [${w.join(', ')}] (index ${i})`)
        else {
            used[j] = true
            map[i] = j
        }
    })
    if (problems.length) return problems

    const cyclic = (f: number[]) => {
        let best = 0
        for (let i = 1; i < f.length; i++) if (f[i] < f[best]) best = i
        return [...f.slice(best), ...f.slice(0, best)].join(',')
    }
    const gotFaces = new Map<string, number>()
    for (const f of got.faces) gotFaces.set(cyclic(f), (gotFaces.get(cyclic(f)) ?? 0) + 1)
    for (const f of want.faces) {
        const k = cyclic(f.map(i => map[i]))
        const n = gotFaces.get(k) ?? 0
        if (!n) problems.push(`no face matching Blender's [${f.join(', ')}] (with the same winding)`)
        else gotFaces.set(k, n - 1)
    }
    return problems
}

function meshOf(bm: BMesh) {
    const all = [...bm.verts]
    const index = new Map(all.map((v, i) => [v, i]))
    return {
        positions: all.map(v => [v.x, v.y, v.z]),
        faces: [...bm.faces].map(f => f.verts().map(v => index.get(v)!)),
    }
}

describe(`poke and wireframe match Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const {bm, faces} = build(c.input)
            const sel = c.faceSubset ? c.faceSubset.map(i => faces[i]) : faces
            if (c.op === 'poke') {
                pokeFaces(bm, sel, pokeOpts(c.params))
            } else if (c.op === 'wireframe') {
                wireframe(bm, sel, wireOpts(c.params))
            } else {
                const poked = pokeFaces(bm, sel, pokeOpts(c.params.poke))
                wireframe(bm, poked.faces, wireOpts(c.params.wireframe))
            }
            expect(bm.validate()).toEqual([])

            expect(compare(meshOf(bm), c.output)).toEqual([])
        })
    }
})
