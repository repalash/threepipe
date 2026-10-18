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

describe('crease and the subsurf modifier', () => {
    it('crease writes crease_edge / crease_vert; a fully creased cube stays a cube under subsurf', async() => {
        const {evaluateModifiers} = await import('../modifiers')
        const {primitiveCube} = await import('@threepipe/mesh-kernel')
        const {creaseCommand} = await import('./shading')
        const cube = primitiveCube()
        const {ctx, entries} = stub({cube})
        expect(validateParams(creaseCommand, {object: 'cube', edges: 'all'})).toEqual([])
        creaseCommand.run({object: 'cube', edges: 'all'}, ctx)
        const creased = entries[0].mesh
        expect(Array.from(creased.attributes.get(AttrName.creaseEdge)!.data)).toEqual(new Array(12).fill(1))
        const sharp = evaluateModifiers(creased, [{type: 'subsurf', levels: 2}])
        const smooth = evaluateModifiers(cube, [{type: 'subsurf', levels: 2}])
        expect(sharp.facesNum).toBe(96)
        const extent = (m: MeshData) => { let e = 0; for (const v of m.positions) e = Math.max(e, Math.abs(v)); return e }
        expect(extent(sharp)).toBeCloseTo(extent(cube), 6) // corners stay
        expect(extent(smooth)).toBeLessThan(extent(cube) * 0.9) // corners round off
        creaseCommand.run({object: 'cube', verts: [0], vertexValue: 0.5}, ctx)
        expect(entries[0].mesh.attributes.get(AttrName.creaseVert)!.data[0]).toBeCloseTo(0.5, 6)
        expect(() => creaseCommand.run({object: 'cube', edges: [99]}, ctx)).toThrow(/does not exist/)
    })
})

describe('the weightedNormal modifier', () => {
    it('weight 100 on a beveled box: corners on the big faces shade with the face normal', async() => {
        const {evaluateModifiers, checkModifier} = await import('../modifiers')
        const {meshCornerNormals, bmFromMesh, bmToMesh, bevelEdges, primitiveCube} = await import('@threepipe/mesh-kernel')
        expect(validateParams((await import('./modifiers')).modifierCommand, {object: 'b', add: {type: 'weightedNormal', mode: 'FACE_AREA', weight: 100}})).toEqual([])
        const bm = bmFromMesh(primitiveCube({size: 2}))
        bevelEdges(bm, [...bm.edges], {offset: 0.1, segments: 2})
        const box = bmToMesh(bm)
        box.attributes.remove(AttrName.sharpFace) // smooth, as after shade smooth
        checkModifier({type: 'weightedNormal', weight: 100})
        expect(() => checkModifier({type: 'weightedNormal', weight: 0})).toThrow()
        const out = evaluateModifiers(box, [{type: 'weightedNormal', weight: 100}])
        expect(out.attributes.get(AttrName.customNormal)?.type).toBe('int16x2')
        const n = meshCornerNormals(out)
        // a corner of the +Z face (all its vertices have z = 1) takes (0, 0, 1)
        let checked = 0
        for (let f = 0; f < out.facesNum; f++) {
            const s = out.faceOffsets[f], e = out.faceOffsets[f + 1]
            let top = true
            for (let c = s; c < e; c++) if (Math.abs(out.positions[3 * out.cornerVerts[c] + 2] - 1) > 1e-6) top = false
            if (!top) continue
            for (let c = s; c < e; c++) { expect(n[3 * c + 2]).toBeCloseTo(1, 4); checked++ }
        }
        expect(checked).toBeGreaterThan(0)
    })
})
