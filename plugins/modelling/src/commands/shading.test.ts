import {describe, expect, it} from 'vitest'
import {AttrName, MeshData, primitiveCone} from '@threepipe/mesh-kernel'
import {shadeCommand} from './shading'
import {CommandContext, validateParams} from './types'

/** A document stub that resolves names to entries and records `setMesh`. */
function stub(meshes: Record<string, MeshData>) {
    const entries = Object.entries(meshes).map(([name, mesh]) => ({name, mesh}))
    const doc = {
        resolve: (ref: string | string[]) => (Array.isArray(ref) ? ref : [ref]).flatMap(r =>
            r.endsWith('*') ? entries.filter(e => e.name.startsWith(r.slice(0, -1))) : entries.filter(e => e.name === r)),
        setMesh: (entry: {mesh: MeshData}, mesh: MeshData) => { entry.mesh = mesh },
    }
    return {ctx: {doc, warn: () => undefined} as unknown as CommandContext, entries}
}
const count = (m: MeshData, n: string) => { const l = m.attributes.get(n); return l ? (l.data as Uint8Array).reduce((a, b) => a + b, 0) : null }

describe('shade', () => {
    it('byAngle by default: a flat 32-sided cylinder becomes smooth with sharp cap rims', () => {
        const cyl = primitiveCone({segments: 32})
        expect(count(cyl, AttrName.sharpFace)).toBe(34) // primitives come out flat
        expect(validateParams(shadeCommand, {object: 'cyl'})).toEqual([])
        const {ctx, entries} = stub({cyl})
        const r = shadeCommand.run({object: 'cyl'}, ctx) as {data: {sharpEdges: number}}
        expect(entries[0].mesh.attributes.get(AttrName.sharpFace)).toBeUndefined()
        expect(r.data.sharpEdges).toBe(64)
        expect(count(cyl, AttrName.sharpFace)).toBe(34) // the input was cloned, not edited in place
    })

    it('flat and smooth, on several objects, with keepSharpEdges', () => {
        const {ctx, entries} = stub({'a.1': primitiveCone({segments: 8}), 'a.2': primitiveCone({segments: 8}), b: primitiveCone({segments: 8})})
        shadeCommand.run({object: 'a*', mode: 'byAngle', angle: 10}, ctx)
        expect(count(entries[0].mesh, AttrName.sharpEdge)).toBe(24) // 8 sides at 45 deg + 16 rim edges
        shadeCommand.run({object: 'a*', mode: 'smooth'}, ctx)
        expect(count(entries[0].mesh, AttrName.sharpEdge)).toBe(24)
        shadeCommand.run({object: 'a*', mode: 'smooth', keepSharpEdges: false}, ctx)
        expect(entries[0].mesh.attributes.get(AttrName.sharpEdge)).toBeUndefined()
        shadeCommand.run({objects: ['a.1'], mode: 'flat'}, ctx)
        expect(count(entries[0].mesh, AttrName.sharpFace)).toBe(10)
        expect(entries[1].mesh.attributes.get(AttrName.sharpFace)).toBeUndefined()
        expect(count(entries[2].mesh, AttrName.sharpFace)).toBe(10)
    })

    it('rejects an unknown mode', () => {
        expect(validateParams(shadeCommand, {object: 'x', mode: 'auto'}).length).toBeGreaterThan(0)
    })
})
