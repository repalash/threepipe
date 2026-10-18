import {describe, expect, it} from 'vitest'
import {Object3D} from 'threepipe'
import {MeshData, primitiveCone, primitiveCube} from '@threepipe/mesh-kernel'
import {booleanCommand} from './boolean'
import {CommandContext, validateParams} from './types'

interface StubEntry { name: string, mesh: MeshData, evaluated: MeshData, object: Object3D }

function stub(entries: StubEntry[]) {
    const removed: string[] = []
    const doc = {
        resolve: (ref: string | string[]) => (Array.isArray(ref) ? ref : [ref]).flatMap(r =>
            r.endsWith('*') ? entries.filter(e => e.name.startsWith(r.slice(0, -1))) : entries.filter(e => e.name === r)),
        setMesh: (entry: StubEntry, mesh: MeshData) => { entry.mesh = mesh; entry.evaluated = mesh },
        remove: (entry: StubEntry) => { removed.push(entry.name) },
        record: () => undefined,
    }
    return {ctx: {doc, warn: () => undefined} as unknown as CommandContext, removed}
}
const entry = (name: string, mesh: MeshData, position: [number, number, number] = [0, 0, 0]): StubEntry => {
    const object = new Object3D()
    object.position.set(...position)
    return {name, mesh, evaluated: mesh, object}
}

describe('boolean', () => {
    it('drills a hole through a box with a cylinder placed in world space, and deletes the cutter', async() => {
        const box = entry('box', primitiveCube({size: 2}), [5, 0, 0])
        const drill = entry('drill', primitiveCone({segments: 24, radiusBottom: 0.3, radiusTop: 0.3, depth: 4}), [5.5, 0, 0])
        const {ctx, removed} = stub([box, drill])
        expect(validateParams(booleanCommand, {object: 'box', with: 'drill'})).toEqual([])
        const r = await booleanCommand.run({object: 'box', with: 'drill'}, ctx) as {data: {faces: number}}
        expect(removed).toEqual(['drill'])
        const m = box.mesh
        expect(m.validate()).toEqual([])
        // the bore sits at local x = 0.5: no vertex of the result lies inside it
        let inside = 0
        for (let v = 0; v < m.vertsNum; v++) {
            const dx = m.positions[3 * v] - 0.5, dy = m.positions[3 * v + 1]
            if (Math.hypot(dx, dy) < 0.29) inside++
        }
        expect(inside).toBe(0)
        expect(r.data.faces).toBeGreaterThan(6 + 24 - 2)
    })

    it('reports a non-manifold cutter by name and leaves the target alone', async() => {
        const box = entry('box', primitiveCube({size: 2}))
        const sheet = entry('sheet', MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [[0, 1, 2]]}))
        const before = box.mesh
        const {ctx} = stub([box, sheet])
        await expect(booleanCommand.run({object: 'box', with: 'sheet', operation: 'UNION'}, ctx)).rejects.toThrow(/not manifold: sheet/)
        expect(box.mesh).toBe(before)
    })
})
