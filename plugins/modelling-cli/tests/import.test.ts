/**
 * `import` and `ModellingDocument.importObject`: plain three.js meshes and foreign glTFs become editable
 * by welding; a GLB this package wrote comes back with its exact topology.
 */

import {describe, expect, it} from 'vitest'
import '../src/node/polyfill'
import {BoxGeometry, Mesh2, PhysicalMaterial} from 'threepipe'
import {NodeSession} from '../src/node/NodeSession'

const ok = async(s: NodeSession, c: Record<string, unknown>) => {
    const r = await s.run(c as never)
    if (!r.ok) throw new Error(`${c.op}: ${r.error}`)
    return r as typeof r & {data: any}
}

describe('import', () => {
    it('welds a plain three.js mesh into editable topology, keeping the object', async() => {
        const s = new NodeSession()
        const material = new PhysicalMaterial({color: '#ff0000'})
        const box = new Mesh2(new BoxGeometry(2, 1, 1), material)
        box.name = 'generated'
        box.position.set(3, 0, 0)
        s.viewer.scene.addObject(box as never, {autoScale: false, autoCenter: false})
        const r = await ok(s, {op: 'import', object: 'generated'})
        expect(r.data.imported).toEqual([{name: 'generated', source: 'welded', welded: 16, verts: 8, edges: 18, faces: 12}])
        const entry = s.modelling.document.find('generated')!
        expect(entry.object).toBe(box)
        expect(entry.object.position.x).toBe(3)
        // now every command addresses it: a bevel on it works, and it validates
        expect((await ok(s, {op: 'validate', object: 'generated'})).data.verdict).toBe('PASS')
        expect((await ok(s, {op: 'extrude', object: 'generated', faces: [0], distance: 0.2})).ok).toBe(true)
        // undo takes the import back out of the document
        await ok(s, {op: 'undo', steps: 2})
        expect(s.modelling.document.find('generated')).toBeUndefined()
        s.dispose()
    })

    it('brings a GLB written here back with its exact n-gon topology and modifiers', async() => {
        const a = new NodeSession()
        await ok(a, {op: 'primitive', type: 'cylinder', name: 'post', radius: 0.5, depth: 2, segments: 12})
        await ok(a, {op: 'modifier', object: 'post', add: {type: 'array', count: 3, step: [2, 0, 0]}})
        const exported = await ok(a, {op: 'export', includeData: true})
        const before = a.modelling.document.find('post')!
        const counts = [before.mesh.vertsNum, before.mesh.edgesNum, before.mesh.facesNum]
        a.dispose()

        const b = new NodeSession()
        const r = await ok(b, {op: 'import', data: exported.data.base64})
        expect(r.data.imported).toEqual([{name: 'post', source: 'topology', welded: 0, verts: counts[0], edges: counts[1], faces: counts[2]}])
        const post = b.modelling.document.find('post')!
        expect(post.mesh.facesNum).toBe(14) // 12 sides + two 12-gon caps, not triangles
        expect(post.modifiers).toHaveLength(1)
        // part of the import command's undo step, not a separate one
        expect(r.locality.objects.created).toEqual(['post'])
        b.dispose()
    })

    it('needs exactly one source', async() => {
        const s = new NodeSession()
        const r = await s.run({op: 'import'})
        expect(r.ok).toBe(false)
        expect(r.error).toContain('exactly one of')
        s.dispose()
    })
})
