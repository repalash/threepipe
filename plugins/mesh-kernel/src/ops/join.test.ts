import {describe, expect, it} from 'vitest'
import {extractSubset, joinMeshes, separateFaces, separateLooseParts} from './join'
import {primitiveCube} from '../generate/primitives'
import {primitiveGrid} from '../generate/primitives'
import {MeshData} from '../MeshData'
import {AttrDomain, AttrName} from '../constants'
import {mat4Translation} from '../math'

/** A quad with a UV layer, so attribute carrying can be checked by value. */
function uvQuad(offset = 0): MeshData {
    const mesh = MeshData.fromFaces({
        positions: [0 + offset, 0, 0, 1 + offset, 0, 0, 1 + offset, 1, 0, 0 + offset, 1, 0],
        faces: [[0, 1, 2, 3]],
    })
    const uv = mesh.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
    ;(uv.data as Float32Array).set([0, 0, 1, 0, 1, 1, 0, 1])
    return mesh
}

describe('joinMeshes', () => {
    it('concatenates topology without welding', () => {
        const joined = joinMeshes([{mesh: primitiveCube({size: 1})}, {mesh: primitiveCube({size: 1})}])
        expect(joined.vertsNum).toBe(16)
        expect(joined.edgesNum).toBe(24)
        expect(joined.facesNum).toBe(12)
        expect(joined.validate()).toEqual([])
    })

    it('applies a per-input matrix to positions', () => {
        const joined = joinMeshes([
            {mesh: primitiveCube({size: 1})},
            {mesh: primitiveCube({size: 1}), matrix: mat4Translation([10, 0, 0])},
        ])
        const xs = []
        for (let v = 0; v < joined.vertsNum; v++) xs.push(joined.positions[v * 3])
        expect(Math.min(...xs)).toBeCloseTo(-0.5, 5)
        expect(Math.max(...xs)).toBeCloseTo(10.5, 5)
    })

    it('carries an attribute that only one input has, defaulting the other', () => {
        const bare = MeshData.fromFaces({
            positions: [5, 0, 0, 6, 0, 0, 6, 1, 0, 5, 1, 0],
            faces: [[0, 1, 2, 3]],
        })
        const joined = joinMeshes([{mesh: uvQuad()}, {mesh: bare}])
        const uv = joined.attributes.get('uv')
        expect(uv).toBeDefined()
        // The first quad's UVs survive...
        expect(Array.from((uv!.data as Float32Array).slice(0, 8))).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
        // ...and the mesh that had none contributes the type default rather than being skipped,
        // which is `lookup_or_default` in Blender's `fill_new_attribute`.
        expect(Array.from((uv!.data as Float32Array).slice(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    })

    it('refuses to join an attribute declared with two different types', () => {
        const a = uvQuad()
        const b = uvQuad(5)
        b.attributes.remove('uv')
        b.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float3'})
        expect(() => joinMeshes([{mesh: a}, {mesh: b}])).toThrow(/attribute 'uv' is/)
    })

    it('remaps material_index onto the concatenated slot list', () => {
        const a = uvQuad()
        a.materials = ['red']
        a.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32')
        const b = uvQuad(5)
        b.materials = ['blue']
        const bIndex = b.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32')
        ;(bIndex.data as Int32Array)[0] = 0

        const joined = joinMeshes([{mesh: a}, {mesh: b}])
        expect(joined.materials).toEqual(['red', 'blue'])
        const data = joined.attributes.get(AttrName.materialIndex)!.data as Int32Array
        expect(data[0]).toBe(0)
        expect(data[1]).toBe(1)
    })

    it('returns an empty mesh for no inputs and a plain clone for one', () => {
        expect(joinMeshes([]).isEmpty).toBe(true)
        const one = primitiveCube({size: 2})
        const joined = joinMeshes([{mesh: one}])
        expect(joined.vertsNum).toBe(one.vertsNum)
        expect(joined).not.toBe(one)
    })
})

describe('separateLooseParts', () => {
    it('splits two disconnected cubes back into two meshes', () => {
        const joined = joinMeshes([
            {mesh: primitiveCube({size: 1})},
            {mesh: primitiveCube({size: 1}), matrix: mat4Translation([10, 0, 0])},
        ])
        const parts = separateLooseParts(joined)
        expect(parts.length).toBe(2)
        for (const part of parts) {
            expect(part.vertsNum).toBe(8)
            expect(part.facesNum).toBe(6)
            expect(part.edgesNum).toBe(12)
            expect(part.validate()).toEqual([])
        }
        // Round trip: join the parts back and the result matches what we started with.
        const rejoined = joinMeshes(parts.map(mesh => ({mesh})))
        expect(rejoined.vertsNum).toBe(joined.vertsNum)
        expect(rejoined.facesNum).toBe(joined.facesNum)
    })

    it('returns one part for a connected mesh', () => {
        expect(separateLooseParts(primitiveCube({size: 1})).length).toBe(1)
    })

    it('carries attributes into each part', () => {
        const joined = joinMeshes([{mesh: uvQuad()}, {mesh: uvQuad(10)}])
        const parts = separateLooseParts(joined)
        expect(parts.length).toBe(2)
        for (const part of parts) {
            const uv = part.attributes.get('uv')!.data as Float32Array
            expect(Array.from(uv.slice(0, 8))).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
        }
    })
})

describe('separateFaces', () => {
    it('takes the named faces out and leaves the rest', () => {
        const cube = primitiveCube({size: 2})
        const {separated, remaining} = separateFaces(cube, [0, 1])
        expect(separated.facesNum).toBe(2)
        expect(remaining.facesNum).toBe(4)
        expect(separated.validate()).toEqual([])
        expect(remaining.validate()).toEqual([])
    })

    it('leaves shared vertices in both halves, as Blender does', () => {
        const grid = primitiveGrid({xSegments: 2, ySegments: 1, size: 2})
        expect(grid.facesNum).toBe(2)
        const {separated, remaining} = separateFaces(grid, [0])
        // The two quads share an edge, so its two vertices appear in both results.
        expect(separated.vertsNum + remaining.vertsNum).toBe(grid.vertsNum + 2)
    })

    it('rejects a face index that does not exist', () => {
        expect(() => separateFaces(primitiveCube({size: 1}), [99])).toThrow(/out of range/)
    })
})

describe('extractSubset', () => {
    it('re-derives edges for the subset', () => {
        const cube = primitiveCube({size: 1})
        const one = extractSubset(cube, [...Array(cube.vertsNum).keys()], [0])
        expect(one.facesNum).toBe(1)
        // Only the four edges of the kept face survive; the rest joined nothing.
        expect(one.edgesNum).toBe(4)
        expect(one.validate()).toEqual([])
    })
})
