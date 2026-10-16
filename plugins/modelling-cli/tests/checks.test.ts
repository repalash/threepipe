/**
 * The measured checks - `validate`, `diff`, `locality`, the `inspect` fixes - end to end through
 * `ModellingPlugin.run` on a Node session.
 */

import {beforeEach, describe, expect, it} from 'vitest'
import {NodeSession} from '../src/node/NodeSession'

let s: NodeSession
const run = async(c: Record<string, unknown>) => {
    const r = await s.run(c as never)
    if (!r.ok) throw new Error(`${c.op}: ${r.error}`)
    return r as typeof r & {data: any, locality: any}
}

beforeEach(() => {
    s?.dispose()
    s = new NodeSession()
})

describe('validate', () => {
    it('passes a fresh cube with structural evidence and Blender\'s validator', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box', size: 2})
        const r = await run({op: 'validate'})
        expect(r.data.verdict).toBe('PASS')
        expect(r.data.conforms).toBe(true)
        const checks = r.data.objects[0].checks
        expect(checks.map((c: any) => c.id)).toEqual(['structure', 'bmesh', 'bake'])
        expect(checks[1].source).toContain('bmesh_mesh_validate.cc:63')
        expect(r.data.objects[0].measure.closed).toBe(true)
    })

    it('checks the evaluated mesh too when there is a modifier stack', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box', size: 1})
        await run({op: 'array', object: 'box', count: 3, step: [2, 0, 0], live: true})
        const r = await run({op: 'validate', object: 'box'})
        expect(r.data.objects[0].checks.map((c: any) => c.id)).toContain('evaluated.bmesh')
        // the drawn shape: three 1-unit cubes, 2 apart
        expect(r.data.objects[0].measure.bounds.size[0]).toBeCloseTo(5, 5)
    })

    it('verifies a spec in world space, three-valued', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box', size: 2, position: [10, 0, 0]})
        const ok = await run({op: 'validate', object: 'box', spec: {
            bbox: {size: [2, 2, 2], min: [9, null, null]}, volume: 8, manifold: {closed: true}, genus: 0}})
        expect(ok.data.objects[0].spec.conforms).toBe(true)
        expect(ok.data.conforms).toBe(true)
        const bad = await run({op: 'validate', object: 'box', spec: {bbox: {size: [3, null, null]}}})
        expect(bad.data.verdict).toBe('FAIL')
        const empty = await run({op: 'validate', object: 'box', spec: {}})
        expect(empty.data.conforms).toBe(false)
    })

    it('checks named groups unchanged since a checkpoint', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box', size: 2})
        await run({op: 'checkpoint', name: 'blocked'})
        await run({op: 'extrude', object: 'box', faces: [0], distance: 0.5})
        const spec = {groups: {top: {faces: [0]}, rest: {faces: [2, 4]}}, unchanged: ['rest']}
        const r = await run({op: 'validate', object: 'box', spec, against: 'blocked', mesh: 'master'})
        expect(r.data.objects[0].spec.conforms).toBe(true)
        const r2 = await run({op: 'validate', object: 'box', spec: {...spec, unchanged: ['top']}, against: 'blocked', mesh: 'master'})
        expect(r2.data.objects[0].spec.conforms).toBe(false)
    })
})

describe('locality on every mutating command', () => {
    it('reports an extrude as local to its face', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box', size: 2})
        await run({op: 'primitive', type: 'cube', name: 'other', size: 1, position: [5, 0, 0]})
        const r = await run({op: 'extrude', object: 'box', faces: [1], distance: 0.5})
        expect(r.locality.local).toBe(true)
        expect(r.locality.objects).toMatchObject({claimed: ['box'], changed: ['box'], collateral: []})
        expect(r.locality.meshes.box.faces.removed).toBe(1)
        expect(r.locality.meshes.box.collateral.faceCount).toBe(0)
    })

    it('reports created and deleted objects, and read-only commands carry none', async() => {
        const p = await run({op: 'primitive', type: 'cube', name: 'box'})
        expect(p.locality.objects.created).toEqual(['box'])
        const d = await run({op: 'delete', object: 'box'})
        expect(d.locality.objects.deleted).toEqual(['box'])
        expect(d.locality.local).toBe(true)
        const i = await run({op: 'inspect'})
        expect(i.locality).toBeUndefined()
    })

    it('claims exactly the vertices a command names, and their faces', async() => {
        await run({op: 'primitive', type: 'grid', name: 'g', xSegments: 4, ySegments: 4})
        const r = await run({op: 'vertices', object: 'g', verts: [[0, 0, 0, 1], [24, 0, 0, 1]], relative: true})
        expect(r.locality.local).toBe(true)
        expect(r.locality.meshes.g.claimed).toEqual({all: false, verts: 8, faces: 2})
        const t = await run({op: 'transform', object: 'g', verts: [12], move: [0, 0, 1]})
        expect(t.locality.local).toBe(true)
        expect(t.locality.meshes.g.verts.removed).toBe(1)
    })
})

/** On a fresh cube in another session: the face sharing no vertex with face 0. */
async function oppositeFace(): Promise<number> {
    const t = new NodeSession()
    await t.run({op: 'primitive', type: 'cube', name: 'box', size: 2})
    const d = (await t.run({op: 'inspect', object: 'box', detail: true})).data as {faceVerts: number[][]}
    t.dispose()
    return d.faceVerts.findIndex(f => f.every(v => !d.faceVerts[0].includes(v)))
}

describe('diff', () => {
    it('compares against a checkpoint, start, or previous', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box', size: 2})
        await run({op: 'checkpoint', name: 'a'})
        await run({op: 'inset', object: 'box', faces: [0], thickness: 0.2})
        await run({op: 'extrude', object: 'box', faces: [0], distance: 0.3})
        const sinceA = await run({op: 'diff', object: 'box', from: 'a', claim: {faces: [0]}})
        expect(sinceA.data.local).toBe(true)
        expect(sinceA.data.faces.added).toBeGreaterThan(4)
        // The face across the cube from face 0 shares no vertex with it, so its ring does not reach face 0.
        const opposite = await oppositeFace()
        const wrongClaim = await run({op: 'diff', object: 'box', from: 'a', claim: {faces: [opposite]}})
        expect(wrongClaim.data.local).toBe(false)
        expect(wrongClaim.data.collateral.faces).toContain(0)
        const fromStart = await run({op: 'diff', object: 'box', from: 'start'})
        expect(fromStart.data.created).toBe(true)
        const prev = await run({op: 'diff', object: 'box'})
        expect(prev.data.from).toBe('previous')
    })

    it('says unknown checkpoints by name', async() => {
        await run({op: 'primitive', type: 'cube', name: 'box'})
        const r = await s.run({op: 'diff', object: 'box', from: 'nope'})
        expect(r.ok).toBe(false)
        expect(r.error).toContain('no checkpoint "nope"')
    })
})

describe('inspect', () => {
    it('lists edges so edge-taking commands can be addressed', async() => {
        await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
        const r = await run({op: 'inspect', object: 'c', detail: true})
        expect(r.data.edgeVerts).toHaveLength(12)
        expect(r.data.faceEdges).toHaveLength(6)
        // every face edge joins two of that face's vertices
        for (let f = 0; f < 6; f++) {
            for (const e of r.data.faceEdges[f]) {
                for (const v of r.data.edgeVerts[e]) expect(r.data.faceVerts[f]).toContain(v)
            }
        }
    })

    it('reports evaluated and world bounds beside the master', async() => {
        await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
        await run({op: 'array', object: 'c', count: 4, step: [2, 0, 0], live: true})
        const r = await run({op: 'inspect', object: 'c'})
        expect(r.data.bounds.size).toEqual([1, 1, 1])
        expect(r.data.evaluatedBounds.size[0]).toBeCloseTo(7, 5)
        expect(r.data.worldBounds.size[0]).toBeCloseTo(7, 5)
    })
})

describe('measure topology', () => {
    it('measures the drawn shape in world space', async() => {
        await run({op: 'primitive', type: 'cube', name: 'c', size: 2})
        const r = await run({op: 'measure', mode: 'topology'})
        expect(r.data[0].volume).toBeCloseTo(8, 4)
        expect(r.data[0].genus).toBe(0)
    })
})

describe('document UUIDs', () => {
    it('derives them from the document id, and keeps them across delete and undo', async() => {
        s.dispose()
        s = new NodeSession({documentId: 'fixed'})
        await run({op: 'primitive', type: 'cube', name: 'box'})
        const uuid = s.modelling.document.find('box')!.object.uuid
        const material = (s.modelling.document.find('box')!.object.material as any).uuid
        await run({op: 'delete', object: 'box'})
        await run({op: 'undo'})
        const revived = s.modelling.document.find('box')!
        expect(revived.object.uuid).toBe(uuid)
        expect((revived.object.material as any).uuid).toBe(material)
        expect((revived.object.material as any).userData.uuid).toBe(material)
        const other = new NodeSession({documentId: 'other'})
        await other.run({op: 'primitive', type: 'cube', name: 'box'})
        expect(other.modelling.document.find('box')!.object.uuid).not.toBe(uuid)
        other.dispose()
    })
})
